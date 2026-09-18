package main

import (
	"log"
	"net/http"

	"campuscodecloud/db"
	"campuscodecloud/handlers"
)

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
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
	db.InitDB()

	http.HandleFunc("POST /contests", handlers.CreateContestHandler)
	http.HandleFunc("GET /contests/{contestID}/problems", handlers.ListProblemsHandler)
	http.HandleFunc("POST /contests/{contestID}/problems", handlers.CreateProblemHandler)
	http.HandleFunc("PUT /contests/{contestID}/problems/{problemID}", handlers.UpdateProblemHandler)
	http.HandleFunc("DELETE /contests/{contestID}/problems/{problemID}", handlers.DeleteProblemHandler)
	http.HandleFunc("POST /contests/{contestID}/package", handlers.GeneratePackageHandler)
	http.HandleFunc("POST /contests/{contestID}/bundle/{platform}", handlers.GenerateBundleHandler)

	log.Println("CampusCode Cloud server listening on :8081")
	if err := http.ListenAndServe(":8081", cors(http.DefaultServeMux)); err != nil {
		log.Fatal("Server failed to start: ", err)
	}
}
