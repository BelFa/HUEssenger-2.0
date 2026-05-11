package handlers

import (
	"crypto/aes"
	"crypto/cipher"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"net/smtp"
	"regexp"
	"time"
	"unicode/utf8"

	"go-chat/database"

	"golang.org/x/crypto/bcrypt"
)

var dbSecretKey = []byte("a-very-secret-key-32-characters!")

// --- СТРУКТУРЫ ---
type AuthRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Email    string `json:"email"`
}

type UserResponse struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
}

type ConfirmRequest struct {
	Username string `json:"username"`
	Code     string `json:"code"`
}

type RoomResponse struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
	Code string `json:"code"`
}

// Инициализация рандома
func init() {
	rand.Seed(time.Now().UnixNano())
}

// ====================== ШИФРОВАНИЕ ======================
func encryptData(text string) string {
	if text == "" {
		return ""
	}
	block, err := aes.NewCipher(dbSecretKey)
	if err != nil {
		fmt.Printf("❌ ОШИБКА AES: %v\n", err)
		return ""
	}
	iv := make([]byte, aes.BlockSize)
	stream := cipher.NewCFBEncrypter(block, iv)
	ciphertext := make([]byte, len(text))
	stream.XORKeyStream(ciphertext, []byte(text))
	return base64.StdEncoding.EncodeToString(ciphertext)
}

func decryptData(encrypted string) string {
	if encrypted == "" {
		return ""
	}
	block, err := aes.NewCipher(dbSecretKey)
	if err != nil {
		return ""
	}
	iv := make([]byte, aes.BlockSize)
	stream := cipher.NewCFBDecrypter(block, iv)
	data, err := base64.StdEncoding.DecodeString(encrypted)
	if err != nil {
		return ""
	}
	plaintext := make([]byte, len(data))
	stream.XORKeyStream(plaintext, data)
	return string(plaintext)
}

// ====================== РЕГИСТРАЦИЯ ======================
func generateVerificationCode() string {
	return fmt.Sprintf("%06d", rand.Intn(1000000))
}

func SendVerificationCode(w http.ResponseWriter, r *http.Request) {
	var req AuthRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Ошибка данных", http.StatusBadRequest)
		return
	}

	// Валидация пароля
	if utf8.RuneCountInString(req.Password) < 6 {
		http.Error(w, "Пароль слишком короткий (минимум 6 символов)", http.StatusBadRequest)
		return
	}
	hasLetter := regexp.MustCompile(`[a-zA-Z]`).MatchString(req.Password)
	hasDigit := regexp.MustCompile(`[0-9]`).MatchString(req.Password)
	if !hasLetter || !hasDigit {
		http.Error(w, "Пароль должен содержать латинские буквы и цифры", http.StatusBadRequest)
		return
	}

	// Проверка занятости
	var exists int
	database.DB.QueryRow("SELECT 1 FROM users WHERE username = $1", req.Username).Scan(&exists)
	if exists == 1 {
		http.Error(w, "Этот ник уже занят", http.StatusConflict)
		return
	}

	encryptedEmail := encryptData(req.Email)
	database.DB.QueryRow("SELECT 1 FROM users WHERE email = $1", encryptedEmail).Scan(&exists)
	if exists == 1 {
		http.Error(w, "Эта почта уже зарегистрирована", http.StatusConflict)
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, "Ошибка хеширования", http.StatusInternalServerError)
		return
	}

	code := generateVerificationCode()
	expiresAt := time.Now().Add(15 * time.Minute)

	_, err = database.DB.Exec(`
		INSERT INTO pending_registrations (username, email, password_hash, verification_code, expires_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (username) DO UPDATE 
		SET email = EXCLUDED.email, 
		    password_hash = EXCLUDED.password_hash,
		    verification_code = EXCLUDED.verification_code, 
		    expires_at = EXCLUDED.expires_at`,
		req.Username, encryptedEmail, string(hashedPassword), code, expiresAt)

	if err != nil {
		log.Printf("Ошибка pending: %v", err)
		http.Error(w, "Ошибка сервера", http.StatusInternalServerError)
		return
	}

	go sendVerificationEmail(req.Email, req.Username, code)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "code_sent", "message": "Код отправлен на почту"})
}

func ConfirmRegistration(w http.ResponseWriter, r *http.Request) {
	var req ConfirmRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Ошибка данных", http.StatusBadRequest)
		return
	}

	var pendingID int
	var encryptedEmail, passwordHash string

	err := database.DB.QueryRow(`
		SELECT id, email, password_hash 
		FROM pending_registrations 
		WHERE username = $1 AND verification_code = $2 AND expires_at > NOW()`,
		req.Username, req.Code).Scan(&pendingID, &encryptedEmail, &passwordHash)

	if err == sql.ErrNoRows {
		http.Error(w, "Неверный или просроченный код", http.StatusBadRequest)
		return
	}
	if err != nil {
		http.Error(w, "Ошибка сервера", http.StatusInternalServerError)
		return
	}

	var userID int
	err = database.DB.QueryRow(
		"INSERT INTO users (username, password_hash, email) VALUES ($1, $2, $3) RETURNING id",
		req.Username, passwordHash, encryptedEmail,
	).Scan(&userID)

	if err != nil {
		http.Error(w, "Ошибка создания пользователя", http.StatusInternalServerError)
		return
	}

	database.DB.Exec("DELETE FROM pending_registrations WHERE id = $1", pendingID)
	go sendWelcomeEmail(decryptData(encryptedEmail), req.Username)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(UserResponse{ID: userID, Username: req.Username})
}

// ====================== ЛОГИН ======================
func LoginHandler(w http.ResponseWriter, r *http.Request) {
	var req AuthRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	var user UserResponse
	var dbPasswordHash string

	err := database.DB.QueryRow(
		"SELECT id, username, password_hash FROM users WHERE username = $1",
		req.Username,
	).Scan(&user.ID, &user.Username, &dbPasswordHash)

	if err == sql.ErrNoRows {
		http.Error(w, "Пользователь не найден", http.StatusUnauthorized)
		return
	}
	if err != nil {
		http.Error(w, "Ошибка базы данных", http.StatusInternalServerError)
		return
	}

	err = bcrypt.CompareHashAndPassword([]byte(dbPasswordHash), []byte(req.Password))
	if err != nil {
		http.Error(w, "Неверный пароль", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

type CreateRoomReq struct {
	CreatorID   int    `json:"creator_id"`
	InvitedNick string `json:"invited_nick"`
	Code        string `json:"code"`
}

// ====================== GET MESSAGES ======================
func GetMessagesHandler(w http.ResponseWriter, r *http.Request) {
	roomID := r.URL.Query().Get("room_id")

	rows, err := database.DB.Query(`
        SELECT u.username, m.content, m.file_path, m.message_type 
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.room_id = $1 
        ORDER BY m.created_at ASC`, roomID)

	if err != nil {
		http.Error(w, "Ошибка БД", 500)
		return
	}
	defer rows.Close()

	var msgs []map[string]interface{}
	for rows.Next() {
		var nick, text string
		var filePath, msgType sql.NullString
		rows.Scan(&nick, &text, &filePath, &msgType)

		msgs = append(msgs, map[string]interface{}{
			"sender":       nick,
			"text":         text,
			"file_path":    filePath.String,
			"message_type": msgType.String,
		})
	}

	if msgs == nil {
		msgs = []map[string]interface{}{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(msgs)
}

// ====================== EMAIL ======================
func sendVerificationEmail(toEmail, username, code string) {
	from := "gdun_rassilca@internet.ru"
	pass := "bF2dtLxzfXYW69ec1aJg"
	smtpHost := "smtp.mail.ru"
	smtpPort := "587"

	subject := "Код подтверждения для HUEssenger"
	body := fmt.Sprintf(`
        <html><body style="font-family:Arial,sans-serif;">
            <h2>Привет, %s!</h2>
            <p>Твой код подтверждения:</p>
            <h1 style="color:#5d5fef;font-size:48px;">%s</h1>
            <p>Код действителен 15 минут.</p>
        </body></html>`, username, code)

	message := "From: " + from + "\r\n" +
		"To: " + toEmail + "\r\n" +
		"Subject: " + subject + "\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: text/html; charset=\"utf-8\"\r\n\r\n" + body

	auth := smtp.PlainAuth("", from, pass, smtpHost)
	err := smtp.SendMail(smtpHost+":"+smtpPort, auth, from, []string{toEmail}, []byte(message))

	if err != nil {
		log.Printf("❌ Ошибка отправки кода на %s: %v\n", toEmail, err)
	} else {
		log.Printf("✅ Код отправлен на %s\n", toEmail)
	}
}

func sendWelcomeEmail(toEmail, username string) {
	from := "gdun_rassilca@internet.ru"
	pass := "bF2dtLxzfXYW69ec1aJg"
	smtpHost := "smtp.mail.ru"
	smtpPort := "587"

	subject := "Успешная регистрация в HUEssenger!"
	body := fmt.Sprintf(`
        <html><body>
            <h2>Привет, %s!</h2>
            <p>Добро пожаловать в наш защищенный мессенджер.</p>
        </body></html>`, username)

	message := "From: " + from + "\r\n" +
		"To: " + toEmail + "\r\n" +
		"Subject: " + subject + "\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: text/html; charset=\"utf-8\"\r\n\r\n" + body

	auth := smtp.PlainAuth("", from, pass, smtpHost)
	err := smtp.SendMail(smtpHost+":"+smtpPort, auth, from, []string{toEmail}, []byte(message))

	if err != nil {
		log.Printf("❌ Ошибка welcome письма: %v\n", err)
	}
}

// ====================== СОЗДАНИЕ КОМНАТЫ ======================
func CreateRoomHandler(w http.ResponseWriter, r *http.Request) {
	var req CreateRoomReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Ошибка данных", http.StatusBadRequest)
		return
	}

	if req.InvitedNick == "" || req.CreatorID == 0 {
		http.Error(w, "Некорректные данные", http.StatusBadRequest)
		return
	}

	// 1. Создаём комнату
	var roomID int
	err := database.DB.QueryRow(
		"INSERT INTO rooms (code, creator_id) VALUES ($1, $2) RETURNING id",
		req.Code, req.CreatorID,
	).Scan(&roomID)

	if err != nil {
		log.Println("Ошибка создания комнаты:", err)
		http.Error(w, "Не удалось создать комнату", http.StatusInternalServerError)
		return
	}

	// 2. Добавляем создателя
	database.DB.Exec("INSERT INTO room_participants (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
		roomID, req.CreatorID)

	// 3. Добавляем приглашённого (если он существует)
	var invitedID int
	err = database.DB.QueryRow("SELECT id FROM users WHERE username = $1", req.InvitedNick).Scan(&invitedID)
	if err == nil {
		database.DB.Exec("INSERT INTO room_participants (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
			roomID, invitedID)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "success",
		"room_id": roomID,
		"code":    req.Code,
	})
}

// ====================== СПИСОК КОМНАТ ======================
func GetUserRoomsHandler(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		http.Error(w, "user_id is required", http.StatusBadRequest)
		return
	}

	rows, err := database.DB.Query(`
		SELECT r.id, r.code 
		FROM rooms r
		JOIN room_participants rp ON r.id = rp.room_id
		WHERE rp.user_id = $1`, userID)

	if err != nil {
		log.Println("Ошибка GetUserRoomsHandler:", err)
		http.Error(w, "Ошибка базы данных", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var rooms []RoomResponse
	for rows.Next() {
		var room RoomResponse
		rows.Scan(&room.ID, &room.Code)
		room.Name = "Комната " + room.Code
		rooms = append(rooms, room)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(rooms)
}

// Вставь это в handlers/auth.go, если его там нет
func DeleteRoomHandler(w http.ResponseWriter, r *http.Request) {
	roomID := r.URL.Query().Get("room_id")
	userID := r.URL.Query().Get("user_id")
	mode := r.URL.Query().Get("mode")

	if mode == "all" {
		database.DB.Exec("DELETE FROM rooms WHERE id = $1", roomID)
	} else {
		database.DB.Exec("DELETE FROM room_participants WHERE room_id = $1 AND user_id = $2", roomID, userID)
	}
	w.WriteHeader(http.StatusOK)
}
