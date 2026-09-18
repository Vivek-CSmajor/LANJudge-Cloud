package models

import "time"

// TestCase is one Codeforces-style .in/.out file pair belonging to a
// Problem. The file's own first input line may state how many sub-cases
// it batches, but from the package's point of view each row here is
// exactly one input file and one output file, written to disk under
// data/testcases/ so they can be copied out as-is into the eventual
// downloadable contest package.
type TestCase struct {
	ID         uint      `json:"id" gorm:"primaryKey"`
	ProblemID  uint      `json:"problem_id" gorm:"not null;index"`
	Problem    Problem   `json:"-" gorm:"foreignKey:ProblemID;references:ID;constraint:OnDelete:CASCADE"`
	Label      string    `json:"label"`
	Ordinal    int       `json:"ordinal"`
	InputPath  string    `json:"-"`
	OutputPath string    `json:"-"`
	CreatedAt  time.Time `json:"created_at"`
}
