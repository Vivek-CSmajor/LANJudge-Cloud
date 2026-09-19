package db

import (
	"fmt"
	"log"

	"campuscodecloud/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var conn *gorm.DB

func InitDB() error {
	database, err := gorm.Open(sqlite.Open("data/cloud.sqlite"), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}
	log.Println("DB connection established")
	if err := database.AutoMigrate(&models.Contest{}, &models.Problem{}, &models.TestCase{}); err != nil {
		return fmt.Errorf("failed to migrate schema: %w", err)
	}
	conn = database
	return nil
}

func Conn() *gorm.DB {
	return conn
}
