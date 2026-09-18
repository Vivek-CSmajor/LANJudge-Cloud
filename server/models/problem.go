package models

import "time"

// Problem is one contest problem: its statement plus judging limits. It
// belongs to exactly one Contest and owns a list of TestCases.
type Problem struct {
	ID               uint       `json:"id" gorm:"primaryKey"`
	ContestID        uint       `json:"contest_id" gorm:"not null;index"`
	Contest          Contest    `json:"-" gorm:"foreignKey:ContestID;references:ID;constraint:OnDelete:CASCADE"`
	Title            string     `json:"title"`
	TimeLimitSeconds float64    `json:"time_limit_seconds"`
	MemoryLimitMB    int        `json:"memory_limit_mb"`
	Statement        string     `json:"statement"`
	TestCases        []TestCase `json:"test_cases,omitempty" gorm:"foreignKey:ProblemID"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}
