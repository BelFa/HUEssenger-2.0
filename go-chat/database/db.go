package database

import (
	"database/sql"
	"fmt"
	"log"

	_ "github.com/lib/pq" // Драйвер для PostgreSQL
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

	fmt.Println("✅ Успешное подключение к базе данных")

	schema := `-- Таблица пользователей
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE, 
        password_hash TEXT NOT NULL,
        last_seen TIMESTAMP DEFAULT NOW()
    );

    -- Таблица комнат
    CREATE TABLE IF NOT EXISTS rooms (
        id SERIAL PRIMARY KEY,
        code VARCHAR(10) UNIQUE NOT NULL,
        creator_id INTEGER REFERENCES users(id) ON DELETE CASCADE
    );

    -- Участники комнат (связь многие-ко-многим)
    CREATE TABLE IF NOT EXISTS room_participants (
        id SERIAL PRIMARY KEY,
        room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(room_id, user_id)
    );

    -- Сообщения
    CREATE TABLE IF NOT EXISTS messages (
        id BIGSERIAL PRIMARY KEY,
        room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
        sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
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
	-- Индекс для быстрого поиска
    CREATE INDEX IF NOT EXISTS idx_pending_email ON pending_registrations(email);
    CREATE INDEX IF NOT EXISTS idx_pending_expires ON pending_registrations(expires_at);
	`

	_, err = DB.Exec(schema)
	if err != nil {
		log.Fatal("❌ Ошибка создания таблиц:", err)
	}

	_, err = DB.Exec(schema)
	if err != nil {
		log.Fatal("❌ Ошибка создания таблиц:", err)
	}

	// Миграция email (на случай старой таблицы users)
	DB.Exec(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(100) UNIQUE;`)

	fmt.Println("🚀 Все таблицы базы данных проверены/созданы")

	// Миграции
	migrations := []string{
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(100) UNIQUE;`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP DEFAULT NOW();`,
	}

	for _, mig := range migrations {
		_, err = DB.Exec(mig)
		if err != nil {
			log.Printf("⚠️ Миграция не применилась: %v", err)
		}
	}

	fmt.Println("🚀 Все таблицы и миграции проверены")
}
