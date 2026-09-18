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

	"campuscodecloud/db"
	"campuscodecloud/models"
)

// These mirror CampusCode-Server/Backend/judge/fileSystem.go's Manifest,
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

// GeneratePackageHandler builds the exact contest/ tree
// CampusCode-Server/Backend expects (manifest.json, problems/<n>/meta.json,
// problems/<n>/statement.md, problems/<n>/tests/<m>.in|out) and streams it
// back as a zip. Problems and test cases are renumbered sequentially from 1
// in this package regardless of their Cloud database ids, since the LAN
// server adopts the manifest's problem ids as its own primary keys
// (judge.LoadOrInitProblems). Everything is built in memory; if any step
// fails, nothing has been written anywhere and the response is just an
// error — there's no partial file left for a client to download.
func GeneratePackageHandler(w http.ResponseWriter, r *http.Request) {
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
		writeError(w, http.StatusInternalServerError, "Couldn't load problems. Please try again.")
		return
	}

	if issues := packageReadinessIssues(contest, problems); len(issues) > 0 {
		writeError(w, http.StatusBadRequest, strings.Join(issues, " "))
		return
	}

	zipBytes, err := buildContestPackage(contest, problems)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Couldn't generate the package. Please try again.")
		return
	}

	filename := slugify(contest.Name) + "-contest.zip"
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.Header().Set("Content-Length", strconv.Itoa(len(zipBytes)))
	w.WriteHeader(http.StatusOK)
	w.Write(zipBytes)
}

// buildContestPackage writes manifest.json/problems at the zip root (no
// wrapping "contest" folder) so it can be extracted directly into the LAN
// server's server_data/contest/ directory.
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
// directory holds exactly what CampusCode-Server's Part 2 packaging step
// produced for it — the LAN server binary, the Docker setup script(s), the
// Electron participant client installer, and a README.
const platformBundleRoot = "data/platform-bundles"

var validPlatforms = map[string]bool{
	"windows":     true,
	"macos-intel": true,
	"macos-arm":   true,
}

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
		writeError(w, http.StatusInternalServerError, "Couldn't load problems. Please try again.")
		return
	}

	if issues := packageReadinessIssues(contest, problems); len(issues) > 0 {
		writeError(w, http.StatusBadRequest, strings.Join(issues, " "))
		return
	}

	contestZip, err := buildContestPackage(contest, problems)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Couldn't generate the package. Please try again.")
		return
	}

	bundleZip, err := buildPlatformBundle(platform, contestZip)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Couldn't assemble the platform bundle. Please try again.")
		return
	}

	filename := slugify(contest.Name) + "-" + platform + "-bundle.zip"
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.Header().Set("Content-Length", strconv.Itoa(len(bundleZip)))
	w.WriteHeader(http.StatusOK)
	w.Write(bundleZip)
}

// buildPlatformBundle nests the already-built contest package zip alongside
// every file in the platform's pre-built bundle directory, into one outer zip.
func buildPlatformBundle(platform string, contestZip []byte) ([]byte, error) {
	buf := &bytes.Buffer{}
	zw := zip.NewWriter(buf)

	if err := writeBytesEntry(zw, "contest-package.zip", contestZip); err != nil {
		return nil, err
	}

	bundleDir := filepath.Join(platformBundleRoot, platform)
	entries, err := os.ReadDir(bundleDir)
	if err != nil {
		return nil, fmt.Errorf("platform bundle for %q is not available on this server: %w", platform, err)
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if err := writeFileEntry(zw, entry.Name(), filepath.Join(bundleDir, entry.Name())); err != nil {
			return nil, err
		}
	}

	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
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

func writeFileEntry(zw *zip.Writer, name, srcPath string) error {
	src, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer src.Close()

	entry, err := zw.Create(name)
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
