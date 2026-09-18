package models

import "time"

// Contest holds the basic configuration collected on the Create Contest
// page. This is the seed of what will eventually be exported as the
// manifest.json the offline contest server reads on contest day.
type Contest struct {
	ID              uint      `json:"id" gorm:"primaryKey"`
	Name            string    `json:"name"`
	DurationMinutes int       `json:"duration_minutes"`
	AdminUsername   string    `json:"admin_username"`
	AdminPassword   string    `json:"-"` // plaintext admin_login_code for the LAN server; never echoed back in API responses
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}
