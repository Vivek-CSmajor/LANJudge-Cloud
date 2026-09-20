package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"campuscodecloud/db"
	"campuscodecloud/models"
)

type createContestRequest struct {
	Name            string `json:"name"`
	DurationMinutes int    `json:"duration_minutes"`
	AdminUsername   string `json:"admin_username"`
	AdminPassword   string `json:"admin_password"`
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// writeInternalError logs the real underlying error server-side — visible
// via journalctl/stdout — before returning only a generic message to the
// client. Every 500 response used to just discard its Go error entirely,
// which is why a real failure showed nothing in the logs and only a vague
// message on the client: there was nothing recording what actually broke.
func writeInternalError(w http.ResponseWriter, context string, err error, publicMessage string) {
	log.Printf("%s: %v", context, err)
	writeError(w, http.StatusInternalServerError, publicMessage)
}

func generateAccessToken() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// RequireContestAccess gates every contest-scoped route behind the token
// issued when that contest was created. There are no user accounts in this
// app — this token is the only thing distinguishing an owner from anyone
// else who can reach the server.
func RequireContestAccess(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
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
		token := r.Header.Get("X-Access-Token")
		if token == "" || token != contest.AccessToken {
			writeError(w, http.StatusUnauthorized, "Missing or invalid access token for this contest.")
			return
		}
		next(w, r)
	}
}

// CreateContestHandler persists the contest-creation form. Validation is
// re-checked here even though the client already validates, since the
// client can't be trusted to be the only caller.
func CreateContestHandler(w http.ResponseWriter, r *http.Request) {
	var req createContestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Request body was not valid JSON.")
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	req.AdminUsername = strings.TrimSpace(req.AdminUsername)

	if req.Name == "" || req.AdminUsername == "" || req.AdminPassword == "" || req.DurationMinutes <= 0 {
		writeError(w, http.StatusBadRequest, "Contest name, duration, admin username, and admin password are all required.")
		return
	}
	if len(req.AdminPassword) < 8 {
		writeError(w, http.StatusBadRequest, "Admin password must be at least 8 characters.")
		return
	}

	accessToken, err := generateAccessToken()
	if err != nil {
		writeInternalError(w, "generateAccessToken", err, "Couldn't create the contest. Please try again.")
		return
	}

	contest := models.Contest{
		Name:            req.Name,
		DurationMinutes: req.DurationMinutes,
		AdminUsername:   req.AdminUsername,
		// Stored as-is (not hashed): the LAN server compares this literally
		// against what the admin types in on contest day (see
		// AdminLoginCode in its judge/fileSystem.go Manifest), the same
		// way team login codes work there — it's a per-contest access
		// code, not a persistent account password.
		AdminPassword: req.AdminPassword,
		AccessToken:   accessToken,
	}

	if err := db.Conn().Create(&contest).Error; err != nil {
		writeInternalError(w, "create contest", err, "Couldn't save the contest. Please try again.")
		return
	}

	writeJSON(w, http.StatusCreated, contest)
}
