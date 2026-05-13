package database

import (
	"database/sql"
	"fmt"
	"log"

	_ "github.com/lib/pq"
)

var DB *sql.DB

func InitDB() {
	connStr := "host=localhost port=5432 user=postgres password=your_password dbname=go_chat sslmode=disable"

	var err error
	DB, err = sql.Open("postgres", connStr)
	if err != nil {
		log.Fatal("❌ Ошибка подключения к БД:", err)
	}
	if err = DB.Ping(); err != nil {
		log.Fatal("❌ База недоступна:", err)
	}

	schema := `
	CREATE TABLE IF NOT EXISTS users (
		id SERIAL PRIMARY KEY,
		username VARCHAR(50) UNIQUE NOT NULL,
		email TEXT UNIQUE,
		password_hash TEXT NOT NULL,
		last_seen TIMESTAMP DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS rooms (
		id SERIAL PRIMARY KEY,
		code VARCHAR(10) UNIQUE NOT NULL,
		creator_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
		custom_name VARCHAR(100)
	);

	CREATE TABLE IF NOT EXISTS room_participants (
		id SERIAL PRIMARY KEY,
		room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
		user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
		UNIQUE(room_id, user_id)
	);

	CREATE TABLE IF NOT EXISTS messages (
		id BIGSERIAL PRIMARY KEY,
		room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
		sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
		sender_nick VARCHAR(50),
		content TEXT NOT NULL,
		file_path TEXT,
		message_type VARCHAR(20) DEFAULT 'text',
		created_at TIMESTAMP DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS pending_registrations (
		id SERIAL PRIMARY KEY,
		username VARCHAR(50) UNIQUE NOT NULL,
		email TEXT NOT NULL,
		password_hash TEXT NOT NULL,
		verification_code VARCHAR(10) NOT NULL,
		expires_at TIMESTAMP NOT NULL,
		created_at TIMESTAMP DEFAULT NOW()
	);
`

	_, err = DB.Exec(schema)
	if err != nil {
		log.Fatal("❌ Ошибка создания таблиц:", err)
	}

	fmt.Println("✅ PostgreSQL подключен, все таблицы готовы")
}
