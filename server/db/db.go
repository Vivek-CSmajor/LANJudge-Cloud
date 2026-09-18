package db

import (
	"log"

	"campuscodecloud/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var conn *gorm.DB

func InitDB() {
	database, err := gorm.Open(sqlite.Open("data/cloud.sqlite"), &gorm.Config{})
	if err != nil {
		panic(err)
	}
	log.Println("DB connection established")
	if err := database.AutoMigrate(&models.Contest{}); err != nil {
		panic(err)
	}
	conn = database
}

func Conn() *gorm.DB {
	return conn
}
