package handlers

import (
	"encoding/json"
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

	contest := models.Contest{
		Name:            req.Name,
		DurationMinutes: req.DurationMinutes,
		AdminUsername:   req.AdminUsername,
		AdminPassword:   req.AdminPassword,
	}

	if err := db.Conn().Create(&contest).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Couldn't save the contest. Please try again.")
		return
	}

	writeJSON(w, http.StatusCreated, contest)
}
