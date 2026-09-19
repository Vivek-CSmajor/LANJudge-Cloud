package main

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed web/dist
var frontendFS embed.FS

func frontendHandler() http.Handler {
	// fs.Sub can only fail if "web/dist" doesn't exist inside frontendFS —
	// impossible here, since //go:embed web/dist above already guarantees
	// it exists at compile time. Safe to ignore, but only for that reason.
	sub, _ := fs.Sub(frontendFS, "web/dist")
	return http.FileServer(http.FS(sub))
}
