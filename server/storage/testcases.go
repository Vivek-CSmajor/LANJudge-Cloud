// Package storage writes test case input/output content to disk as plain
// .in/.out files, keyed by problem and test case id. Keeping them as real
// files (rather than DB blobs) means the eventual downloadable contest
// package can just copy this tree out directly.
package storage

import (
	"fmt"
	"os"
	"path/filepath"
)

const testCaseRoot = "data/testcases"

func problemDir(problemID uint) string {
	return filepath.Join(testCaseRoot, fmt.Sprintf("problem_%d", problemID))
}

// WriteTestCaseFiles writes the input/output content for one test case and
// returns the paths they were written to.
func WriteTestCaseFiles(problemID, testCaseID uint, input, output []byte) (inputPath, outputPath string, err error) {
	dir := problemDir(problemID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", "", err
	}

	inputPath = filepath.Join(dir, fmt.Sprintf("%d.in", testCaseID))
	outputPath = filepath.Join(dir, fmt.Sprintf("%d.out", testCaseID))

	if err := os.WriteFile(inputPath, input, 0o644); err != nil {
		return "", "", err
	}
	if err := os.WriteFile(outputPath, output, 0o644); err != nil {
		return "", "", err
	}
	return inputPath, outputPath, nil
}

// RemoveTestCaseFiles deletes one test case's files. Missing files are not
// an error — the caller is cleaning up, not verifying prior state.
func RemoveTestCaseFiles(problemID, testCaseID uint) {
	dir := problemDir(problemID)
	os.Remove(filepath.Join(dir, fmt.Sprintf("%d.in", testCaseID)))
	os.Remove(filepath.Join(dir, fmt.Sprintf("%d.out", testCaseID)))
}

// RemoveProblemDir deletes every test case file belonging to a problem.
func RemoveProblemDir(problemID uint) {
	os.RemoveAll(problemDir(problemID))
}
