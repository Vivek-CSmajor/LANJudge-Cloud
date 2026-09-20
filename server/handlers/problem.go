package handlers

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"campuscodecloud/db"
	"campuscodecloud/models"
	"campuscodecloud/storage"

	"gorm.io/gorm"
)

// Held in memory before the multipart reader spills remaining file parts
// to temp disk on its own — this isn't a hard cap on upload size.
const maxUploadMemory = 32 << 20

// maxRequestBodySize is the actual hard cap — http.MaxBytesReader rejects
// anything past this before ParseMultipartForm ever gets to decide where
// to put it (memory vs. temp disk).
const maxRequestBodySize = 50 << 20

var errValidation = errors.New("validation")

type testCaseInput struct {
	Label  string
	Input  []byte
	Output []byte
}

type problemFormData struct {
	Title            string
	TimeLimitSeconds float64
	MemoryLimitMB    int
	Statement        string
	KeepTestCaseIDs  []uint
	NewTestCases     []testCaseInput
}

// parseProblemForm reads the multipart fields shared by create and update:
// title/limits/statement, which existing test case rows to keep (update
// only), and any newly uploaded or manually-entered test case pairs. Both
// entry methods land here as ordinary multipart file parts — the client
// wraps manual textarea content in a Blob before appending it, so this
// handler only ever sees one shape.
func parseProblemForm(r *http.Request) (*problemFormData, string, error) {
	if err := r.ParseMultipartForm(maxUploadMemory); err != nil {
		return nil, "Couldn't read the submitted form.", err
	}

	title := strings.TrimSpace(r.FormValue("title"))
	statement := strings.TrimSpace(r.FormValue("statement"))

	timeLimit, timeErr := strconv.ParseFloat(r.FormValue("time_limit_seconds"), 64)
	memoryLimit, memErr := strconv.Atoi(r.FormValue("memory_limit_mb"))

	if title == "" || statement == "" || timeErr != nil || timeLimit <= 0 || memErr != nil || memoryLimit <= 0 {
		return nil, "Title, a positive time limit, a positive memory limit, and a non-empty statement are all required.", errValidation
	}

	var keepIDs []uint
	if raw := r.FormValue("keep_testcase_ids"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &keepIDs); err != nil {
			return nil, "keep_testcase_ids was not valid JSON.", err
		}
	}

	count, _ := strconv.Atoi(r.FormValue("testcase_count"))
	newCases := make([]testCaseInput, 0, count)
	for i := 0; i < count; i++ {
		idx := strconv.Itoa(i)

		inFile, _, err := r.FormFile("testcase_input_" + idx)
		if err != nil {
			return nil, "One of the test cases was missing its input content.", err
		}
		inBytes, err := io.ReadAll(inFile)
		inFile.Close()
		if err != nil {
			return nil, "Couldn't read a test case's input content.", err
		}

		outFile, _, err := r.FormFile("testcase_output_" + idx)
		if err != nil {
			return nil, "One of the test cases was missing its output content.", err
		}
		outBytes, err := io.ReadAll(outFile)
		outFile.Close()
		if err != nil {
			return nil, "Couldn't read a test case's output content.", err
		}

		label := strings.TrimSpace(r.FormValue("testcase_label_" + idx))
		if label == "" {
			label = "Test " + strconv.Itoa(i+1)
		}

		newCases = append(newCases, testCaseInput{Label: label, Input: inBytes, Output: outBytes})
	}

	if len(keepIDs) == 0 && len(newCases) == 0 {
		return nil, "At least one test case (input and output) is required.", errValidation
	}

	return &problemFormData{
		Title:            title,
		TimeLimitSeconds: timeLimit,
		MemoryLimitMB:    memoryLimit,
		Statement:        statement,
		KeepTestCaseIDs:  keepIDs,
		NewTestCases:     newCases,
	}, "", nil
}

func parseIDParam(r *http.Request, name string) (uint, bool) {
	id, err := strconv.ParseUint(r.PathValue(name), 10, 64)
	if err != nil {
		return 0, false
	}
	return uint(id), true
}

func contestExists(contestID uint) bool {
	var count int64
	db.Conn().Model(&models.Contest{}).Where("id = ?", contestID).Count(&count)
	return count > 0
}

func orderedTestCases(tx *gorm.DB) *gorm.DB {
	return tx.Order("test_cases.ordinal ASC")
}

// ListProblemsHandler returns every problem for a contest, each with its
// test cases (id/label/ordinal only, no file content) so the client can
// show a test case count and prefill an edit form's "kept" list.
func ListProblemsHandler(w http.ResponseWriter, r *http.Request) {
	contestID, ok := parseIDParam(r, "contestID")
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid contest id.")
		return
	}
	if !contestExists(contestID) {
		writeError(w, http.StatusNotFound, "Contest not found.")
		return
	}

	var problems []models.Problem
	if err := db.Conn().
		Preload("TestCases", orderedTestCases).
		Where("contest_id = ?", contestID).
		Order("created_at ASC").
		Find(&problems).Error; err != nil {
		writeInternalError(w, "list problems", err, "Couldn't load problems. Please try again.")
		return
	}

	writeJSON(w, http.StatusOK, problems)
}

// CreateProblemHandler saves a new problem and its test case files.
func CreateProblemHandler(w http.ResponseWriter, r *http.Request) {
	contestID, ok := parseIDParam(r, "contestID")
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid contest id.")
		return
	}
	if !contestExists(contestID) {
		writeError(w, http.StatusNotFound, "Contest not found.")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodySize)
	form, message, err := parseProblemForm(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, message)
		return
	}
	if len(form.KeepTestCaseIDs) > 0 {
		writeError(w, http.StatusBadRequest, "A new problem has no existing test cases to keep.")
		return
	}

	problem := models.Problem{
		ContestID:        contestID,
		Title:            form.Title,
		TimeLimitSeconds: form.TimeLimitSeconds,
		MemoryLimitMB:    form.MemoryLimitMB,
		Statement:        form.Statement,
	}

	txErr := db.Conn().Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&problem).Error; err != nil {
			return err
		}
		for i, tc := range form.NewTestCases {
			row := models.TestCase{ProblemID: problem.ID, Label: tc.Label, Ordinal: i}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
			inputPath, outputPath, err := storage.WriteTestCaseFiles(problem.ID, row.ID, tc.Input, tc.Output)
			if err != nil {
				return err
			}
			row.InputPath = inputPath
			row.OutputPath = outputPath
			if err := tx.Save(&row).Error; err != nil {
				return err
			}
			problem.TestCases = append(problem.TestCases, row)
		}
		return nil
	})
	if txErr != nil {
		storage.RemoveProblemDir(problem.ID)
		writeInternalError(w, "create problem", txErr, "Couldn't save the problem. Please try again.")
		return
	}

	writeJSON(w, http.StatusCreated, problem)
}

// UpdateProblemHandler replaces a problem's fields and reconciles its test
// cases against the client's keep-list: anything not kept is deleted,
// anything newly uploaded is added.
func UpdateProblemHandler(w http.ResponseWriter, r *http.Request) {
	contestID, ok := parseIDParam(r, "contestID")
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid contest id.")
		return
	}
	problemID, ok := parseIDParam(r, "problemID")
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid problem id.")
		return
	}

	var existing models.Problem
	if err := db.Conn().Where("id = ? AND contest_id = ?", problemID, contestID).First(&existing).Error; err != nil {
		writeError(w, http.StatusNotFound, "Problem not found.")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodySize)
	form, message, err := parseProblemForm(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, message)
		return
	}

	var currentIDs []uint
	if err := db.Conn().Model(&models.TestCase{}).Where("problem_id = ?", problemID).Pluck("id", &currentIDs).Error; err != nil {
		writeInternalError(w, "list existing test case ids", err, "Couldn't update the problem. Please try again.")
		return
	}
	currentSet := make(map[uint]bool, len(currentIDs))
	for _, id := range currentIDs {
		currentSet[id] = true
	}
	keepSet := make(map[uint]bool, len(form.KeepTestCaseIDs))
	for _, id := range form.KeepTestCaseIDs {
		if !currentSet[id] {
			writeError(w, http.StatusBadRequest, "One of the kept test cases doesn't belong to this problem.")
			return
		}
		keepSet[id] = true
	}
	var toDelete []uint
	for _, id := range currentIDs {
		if !keepSet[id] {
			toDelete = append(toDelete, id)
		}
	}

	// Test case files are written to disk inside the loop below, but a
	// filesystem write isn't part of the DB transaction it's nested in —
	// if a later test case in this same request fails, the transaction
	// rolls back the rows but not files already written for earlier ones
	// in this loop. writtenIDs tracks exactly those so they can be cleaned
	// up on failure, the same way CreateProblemHandler removes its whole
	// (all-new) problem directory on failure.
	var writtenIDs []uint

	txErr := db.Conn().Transaction(func(tx *gorm.DB) error {
		existing.Title = form.Title
		existing.TimeLimitSeconds = form.TimeLimitSeconds
		existing.MemoryLimitMB = form.MemoryLimitMB
		existing.Statement = form.Statement
		if err := tx.Save(&existing).Error; err != nil {
			return err
		}

		if len(toDelete) > 0 {
			if err := tx.Where("id IN ?", toDelete).Delete(&models.TestCase{}).Error; err != nil {
				return err
			}
		}

		// Kept test cases keep their identity but move to reflect the
		// client's current ordering; new ones are appended after them.
		for i, id := range form.KeepTestCaseIDs {
			if err := tx.Model(&models.TestCase{}).Where("id = ?", id).Update("ordinal", i).Error; err != nil {
				return err
			}
		}
		base := len(form.KeepTestCaseIDs)
		for i, tc := range form.NewTestCases {
			row := models.TestCase{ProblemID: existing.ID, Label: tc.Label, Ordinal: base + i}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
			inputPath, outputPath, err := storage.WriteTestCaseFiles(existing.ID, row.ID, tc.Input, tc.Output)
			if err != nil {
				return err
			}
			writtenIDs = append(writtenIDs, row.ID)
			row.InputPath = inputPath
			row.OutputPath = outputPath
			if err := tx.Save(&row).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if txErr != nil {
		for _, id := range writtenIDs {
			storage.RemoveTestCaseFiles(existing.ID, id)
		}
		writeInternalError(w, "update problem", txErr, "Couldn't update the problem. Please try again.")
		return
	}

	for _, id := range toDelete {
		storage.RemoveTestCaseFiles(existing.ID, id)
	}

	var updated models.Problem
	if err := db.Conn().Preload("TestCases", orderedTestCases).First(&updated, existing.ID).Error; err != nil {
		writeInternalError(w, "reload updated problem", err, "Problem was saved but couldn't be reloaded.")
		return
	}

	writeJSON(w, http.StatusOK, updated)
}

// DeleteProblemHandler removes a problem, its test case rows, and their
// files on disk.
func DeleteProblemHandler(w http.ResponseWriter, r *http.Request) {
	contestID, ok := parseIDParam(r, "contestID")
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid contest id.")
		return
	}
	problemID, ok := parseIDParam(r, "problemID")
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid problem id.")
		return
	}

	var existing models.Problem
	if err := db.Conn().Where("id = ? AND contest_id = ?", problemID, contestID).First(&existing).Error; err != nil {
		writeError(w, http.StatusNotFound, "Problem not found.")
		return
	}

	txErr := db.Conn().Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("problem_id = ?", problemID).Delete(&models.TestCase{}).Error; err != nil {
			return err
		}
		return tx.Delete(&existing).Error
	})
	if txErr != nil {
		writeInternalError(w, "delete problem", txErr, "Couldn't delete the problem. Please try again.")
		return
	}

	storage.RemoveProblemDir(problemID)

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
