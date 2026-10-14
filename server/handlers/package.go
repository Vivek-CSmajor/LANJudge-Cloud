package handlers

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"lanjudgecloud/db"
	"lanjudgecloud/models"
)

// These mirror LANJudge-Server/Backend/judge/fileSystem.go's Manifest,
// Problem, and ProblemMeta structs exactly — field names and JSON tags
// included — since that's the code that will parse what this handler
// writes. Redeclared here rather than imported because the LAN server is a
// separate, unrelated Go module.
type packageManifest struct {
	ContestID       string           `json:"contest_id"`
	Name            string           `json:"name"`
	DurationMinutes int              `json:"duration_minutes"`
	Problems        []packageProblem `json:"problems"`
	AdminUsername   string           `json:"admin_user_name"`
	AdminLoginCode  string           `json:"admin_login_code"`
}

type packageProblem struct {
	ID    string `json:"id"`
	Path  string `json:"path"`
	Title string `json:"title"`
}

type packageProblemMeta struct {
	TimeLimitMS   int `json:"time_limit_ms"`
	MemoryLimitMB int `json:"memory_limit_mb"`
}

// packageReadinessIssues re-checks everything the client's checklist
// already showed. The client can't be trusted to be the only caller, and a
// package built from an invalid contest would just fail mysteriously on
// the LAN server later instead of here, where it's still fixable.
func packageReadinessIssues(contest models.Contest, problems []models.Problem) []string {
	var issues []string

	if strings.TrimSpace(contest.Name) == "" {
		issues = append(issues, "Contest is missing a name.")
	}
	if contest.DurationMinutes <= 0 {
		issues = append(issues, "Contest is missing a valid duration.")
	}
	if strings.TrimSpace(contest.AdminUsername) == "" || contest.AdminPassword == "" {
		issues = append(issues, "Contest is missing admin credentials.")
	}
	if len(problems) == 0 {
		issues = append(issues, "Contest has no problems.")
	}

	for _, p := range problems {
		title := strings.TrimSpace(p.Title)
		label := title
		if label == "" {
			label = fmt.Sprintf("#%d", p.ID)
			issues = append(issues, fmt.Sprintf("Problem %s has no title.", label))
		}
		if p.TimeLimitSeconds <= 0 {
			issues = append(issues, fmt.Sprintf("Problem %q has an invalid time limit.", label))
		}
		if p.MemoryLimitMB <= 0 {
			issues = append(issues, fmt.Sprintf("Problem %q has an invalid memory limit.", label))
		}
		if strings.TrimSpace(p.Statement) == "" {
			issues = append(issues, fmt.Sprintf("Problem %q has no statement.", label))
		}
		if len(p.TestCases) == 0 {
			issues = append(issues, fmt.Sprintf("Problem %q has no test cases.", label))
		}
	}

	return issues
}

// buildContestPackage builds the exact contest/ tree LANJudge-Server/Backend
// expects (manifest.json, problems/<n>/meta.json, problems/<n>/statement.md,
// problems/<n>/tests/<m>.in|out), writing manifest.json/problems at the zip
// root (no wrapping "contest" folder) so it can be extracted directly into
// that server's server_data/contest/ directory. Problems and test cases are
// renumbered sequentially from 1 regardless of their Cloud database ids,
// since the LAN server adopts the manifest's problem ids as its own primary
// keys (judge.LoadOrInitProblems). There used to be a standalone endpoint
// that returned just this zip on its own; it's gone now (every download is
// a full per-platform bundle, see GenerateBundleHandler below), but this
// function remains as the shared piece that bundle handler builds on.
func buildContestPackage(contest models.Contest, problems []models.Problem) ([]byte, error) {
	buf := &bytes.Buffer{}
	zw := zip.NewWriter(buf)

	manifestProblems := make([]packageProblem, 0, len(problems))
	for i, p := range problems {
		id := strconv.Itoa(i + 1)
		manifestProblems = append(manifestProblems, packageProblem{
			ID:    id,
			Path:  "problems/" + id,
			Title: p.Title,
		})
	}

	m := packageManifest{
		ContestID:       strconv.Itoa(int(contest.ID)),
		Name:            contest.Name,
		DurationMinutes: contest.DurationMinutes,
		Problems:        manifestProblems,
		AdminUsername:   contest.AdminUsername,
		AdminLoginCode:  contest.AdminPassword,
	}
	if err := writeJSONEntry(zw, "manifest.json", m); err != nil {
		return nil, err
	}

	for i, p := range problems {
		base := fmt.Sprintf("problems/%d/", i+1)

		meta := packageProblemMeta{
			TimeLimitMS:   int(p.TimeLimitSeconds * 1000),
			MemoryLimitMB: p.MemoryLimitMB,
		}
		if err := writeJSONEntry(zw, base+"meta.json", meta); err != nil {
			return nil, err
		}
		if err := writeStringEntry(zw, base+"statement.md", p.Statement); err != nil {
			return nil, err
		}

		for j, tc := range p.TestCases {
			n := j + 1
			if err := writeFileEntry(zw, fmt.Sprintf("%stests/%d.in", base, n), tc.InputPath); err != nil {
				return nil, err
			}
			if err := writeFileEntry(zw, fmt.Sprintf("%stests/%d.out", base, n), tc.OutputPath); err != nil {
				return nil, err
			}
		}
	}

	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// platformBundleRoot mirrors data/testcases' convention: a pre-populated,
// read-only tree the server ships alongside its own binary. Each platform's
// directory holds everything LANJudge-Server's Part 2 packaging step
// produced for it — the LAN server binary, the Docker setup script(s), a
// README, and the Electron participant client installer. The organizer
// bundle below (GenerateBundleHandler) zips up everything except that last
// one; ClientDownloadHandler serves it separately, on its own.
const platformBundleRoot = "data/platform-bundles"

var validPlatforms = map[string]bool{
	"windows":     true,
	"macos-intel": true,
	"macos-arm":   true,
}

// bundleSemaphore bounds how many bundle downloads (each streaming a
// platform's ~130-150MB installer) can be in flight at once. The target
// deployment is a 1GB-RAM instance; two or three of these concurrently is
// already a meaningful fraction of that.
var bundleSemaphore = make(chan struct{}, 2)

// GenerateBundleHandler builds the same contest package GeneratePackageHandler
// does, then wraps it together with the requested platform's pre-built bundle
// into one outer zip, so the organizer downloads a single file containing
// everything needed to run this specific contest on their laptop.
func GenerateBundleHandler(w http.ResponseWriter, r *http.Request) {
	platform := r.PathValue("platform")
	if !validPlatforms[platform] {
		writeError(w, http.StatusBadRequest, "Unknown platform. Choose windows, macos-intel, or macos-arm.")
		return
	}

	contestID, ok := parseIDParam(r, "contestID")
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid contest id.")
		return
	}

	var contest models.Contest
	if err := db.Conn().First(&contest, contestID).Error; err != nil {
		writeError(w, http.StatusNotFound, "Contest not found.")
		return
	}

	var problems []models.Problem
	if err := db.Conn().
		Preload("TestCases", orderedTestCases).
		Where("contest_id = ?", contestID).
		Order("created_at ASC").
		Find(&problems).Error; err != nil {
		writeInternalError(w, "list problems for bundle", err, "Couldn't load problems. Please try again.")
		return
	}

	if issues := packageReadinessIssues(contest, problems); len(issues) > 0 {
		writeError(w, http.StatusBadRequest, strings.Join(issues, " "))
		return
	}

	contestZip, err := buildContestPackage(contest, problems)
	if err != nil {
		writeInternalError(w, "build contest package for bundle", err, "Couldn't generate the package. Please try again.")
		return
	}

	// Checked before anything is written to the response, so a missing
	// platform directory still produces a clean JSON error instead of a
	// truncated zip — once headers below are sent, that's no longer possible.
	bundleDir := filepath.Join(platformBundleRoot, platform)
	entries, err := os.ReadDir(bundleDir)
	if err != nil {
		writeInternalError(w, "read platform bundle dir "+bundleDir, err, "This platform's bundle isn't available on the server right now.")
		return
	}

	select {
	case bundleSemaphore <- struct{}{}:
		defer func() { <-bundleSemaphore }()
	default:
		writeError(w, http.StatusTooManyRequests, "Server is busy building another bundle. Please try again in a moment.")
		return
	}

	// No Content-Length: the bundle (up to ~150MB, dominated by the
	// platform's installer) is streamed straight into the response as the
	// zip is built rather than assembled in memory first, so the total
	// size isn't known upfront. Browsers handle this fine.
	filename := slugify(contest.Name) + "-" + platform + "-bundle.zip"
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.WriteHeader(http.StatusOK)

	streamPlatformBundle(w, entries, bundleDir, platform, contestZip)
}

// streamPlatformBundle writes the already-built contest package zip
// alongside every file in the platform's pre-built bundle directory except
// the participant client installer — this bundle is for the organizer's
// own laptop (contest data + LAN server + Docker setup script), and the
// client is downloaded separately via ClientDownloadHandler — straight
// into w as one outer zip. Nothing is buffered in memory beyond one file's
// read/write chunks at a time. Errors here can't be reported to the client
// anymore (headers are already sent); the response is just cut short,
// which is the standard, accepted tradeoff for a streamed download.
func streamPlatformBundle(w io.Writer, entries []os.DirEntry, bundleDir, platform string, contestZip []byte) {
	zw := zip.NewWriter(w)
	if err := writeBytesEntry(zw, "contest-package.zip", contestZip); err != nil {
		return
	}
	clientInstaller := clientInstallerFilenames[platform]
	for _, entry := range entries {
		if entry.IsDir() || entry.Name() == clientInstaller {
			continue
		}
		if err := writeFileEntry(zw, entry.Name(), filepath.Join(bundleDir, entry.Name())); err != nil {
			return
		}
	}
	zw.Close()
}

func writeBytesEntry(zw *zip.Writer, name string, data []byte) error {
	entry, err := zw.Create(name)
	if err != nil {
		return err
	}
	_, err = entry.Write(data)
	return err
}

func writeJSONEntry(zw *zip.Writer, name string, v any) error {
	entry, err := zw.Create(name)
	if err != nil {
		return err
	}
	enc := json.NewEncoder(entry)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

func writeStringEntry(zw *zip.Writer, name, content string) error {
	entry, err := zw.Create(name)
	if err != nil {
		return err
	}
	_, err = io.WriteString(entry, content)
	return err
}

// writeFileEntry preserves srcPath's real file mode (via FileInfoHeader)
// rather than zw.Create's default of a non-executable 0666 — without this,
// campuscode-server, setup.sh, and launch.command would all lose their
// executable bit on extraction, defeating the one-click launch entirely.
func writeFileEntry(zw *zip.Writer, name, srcPath string) error {
	src, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer src.Close()

	info, err := src.Stat()
	if err != nil {
		return err
	}
	header, err := zip.FileInfoHeader(info)
	if err != nil {
		return err
	}
	header.Name = name
	header.Method = zip.Deflate

	entry, err := zw.CreateHeader(header)
	if err != nil {
		return err
	}
	_, err = io.Copy(entry, src)
	return err
}

func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	prevDash := false
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z' || r >= '0' && r <= '9':
			b.WriteRune(r)
			prevDash = false
		default:
			if !prevDash && b.Len() > 0 {
				b.WriteByte('-')
				prevDash = true
			}
		}
	}
	out := strings.TrimSuffix(b.String(), "-")
	if out == "" {
		return "contest"
	}
	return out
}
