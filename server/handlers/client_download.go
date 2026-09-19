package handlers

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
)

// clientInstallerFilenames maps each platform to the exact filename of its
// participant-client installer inside platformBundleRoot/<platform>/ — the
// one file end users actually need, out of everything else in that
// directory (the LAN server binary, setup scripts, README).
//
// NOTE: as of this writing, only the two macOS entries actually exist on
// disk — server/data/platform-bundles/windows/ has no client installer yet,
// only the LAN server's own campuscode-server.exe. The filename below is
// where the Windows installer is expected to land once it's built; until
// then, requests for it correctly fall into the "not available" branch
// below rather than serving the wrong file.
var clientInstallerFilenames = map[string]string{
	"windows":     "CampusCode Setup 0.0.0.exe",
	"macos-intel": "CampusCode-Client-Setup.dmg",
	"macos-arm":   "CampusCode-Client-Setup.dmg",
}

// ClientDownloadHandler serves just the participant client installer for a
// platform — reusing the same platform-bundles files GenerateBundleHandler
// draws from, nothing duplicated on disk. Unlike that handler, this one
// isn't tied to a contest: the installer is identical no matter which
// contest someone is about to join, so it needs no access token.
func ClientDownloadHandler(w http.ResponseWriter, r *http.Request) {
	platform := r.PathValue("platform")
	if !validPlatforms[platform] {
		writeError(w, http.StatusBadRequest, "Unknown platform. Choose windows, macos-intel, or macos-arm.")
		return
	}

	filename := clientInstallerFilenames[platform]
	path := filepath.Join(platformBundleRoot, platform, filename)

	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		writeError(w, http.StatusNotFound, "The installer for this platform isn't available on the server yet.")
		return
	}

	// http.ServeFile handles range requests (resumable downloads) and sets
	// Content-Type from the extension; Content-Disposition still needs to
	// be set explicitly to force a save-as with the right filename instead
	// of letting the browser decide.
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	http.ServeFile(w, r, path)
}
