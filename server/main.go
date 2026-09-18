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
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

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

	log.Println("CampusCode Cloud server listening on :8081")
	if err := http.ListenAndServe(":8081", cors(http.DefaultServeMux)); err != nil {
		log.Fatal("Server failed to start: ", err)
	}
}
