package main

import (
	"log"
	"net/http"
	"os"

	"campuscodecloud/db"
	"campuscodecloud/handlers"
)

// Restricted to the Vite dev server's origin rather than "*" — the built
// production frontend is served same-origin from this same binary (see
// web.go) and never needs a CORS header at all. Overridable via env for
// anyone who deploys the two apart instead of embedding them.
func allowedOrigin() string {
	if origin := os.Getenv("CORS_ORIGIN"); origin != "" {
		return origin
	}
	return "http://localhost:5174"
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", allowedOrigin())
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Access-Token")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		// The package download's filename rides in Content-Disposition,
		// which isn't in the default CORS-safelisted response headers —
		// without this the frontend's fetch() can't read it.
		w.Header().Set("Access-Control-Expose-Headers", "Content-Disposition")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	if err := db.InitDB(); err != nil {
		log.Fatal(err)
	}

	http.HandleFunc("POST /contests", handlers.CreateContestHandler)
	http.HandleFunc("GET /contests/{contestID}/problems", handlers.RequireContestAccess(handlers.ListProblemsHandler))
	http.HandleFunc("POST /contests/{contestID}/problems", handlers.RequireContestAccess(handlers.CreateProblemHandler))
	http.HandleFunc("PUT /contests/{contestID}/problems/{problemID}", handlers.RequireContestAccess(handlers.UpdateProblemHandler))
	http.HandleFunc("DELETE /contests/{contestID}/problems/{problemID}", handlers.RequireContestAccess(handlers.DeleteProblemHandler))
	http.HandleFunc("POST /contests/{contestID}/package", handlers.RequireContestAccess(handlers.GeneratePackageHandler))
	http.HandleFunc("POST /contests/{contestID}/bundle/{platform}", handlers.RequireContestAccess(handlers.GenerateBundleHandler))

	// Embedded static frontend — fallback, only catches what nothing above
	// matched (same pattern as CampusCode-Server/Backend/api/server.go).
	http.Handle("/", frontendHandler())

	// $PORT is read from the environment (e.g. set in the systemd unit's
	// EnvironmentFile) so the listen port is configurable without a code
	// change; 8081 stays the default for local dev where nothing sets it.
	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}

	log.Printf("CampusCode Cloud server listening on :%s\n", port)
	if err := http.ListenAndServe(":"+port, cors(http.DefaultServeMux)); err != nil {
		log.Fatal("Server failed to start: ", err)
	}
}
