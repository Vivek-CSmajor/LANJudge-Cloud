package main

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed web/dist
var frontendFS embed.FS

func frontendHandler() http.Handler {
	sub, _ := fs.Sub(frontendFS, "web/dist")
	return http.FileServer(http.FS(sub))
}
