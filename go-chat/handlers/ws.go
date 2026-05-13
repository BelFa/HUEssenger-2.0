package handlers

import (
	"log"
	"net/http"
	"sync"
	"time"

	"go-chat/database"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

var clients = make(map[string]*websocket.Conn)
var mu sync.Mutex
var pendingRequests = sync.Map{}

type WSMessage struct {
	Type          string `json:"type"`
	Code          string `json:"code,omitempty"`
	RequesterID   string `json:"requester_id,omitempty"`
	RequesterNick string `json:"requester_nick,omitempty"`
	TargetNick    string `json:"target_nick,omitempty"`
	Text          string `json:"text,omitempty"`
	FilePath      string `json:"file_path,omitempty"`
	MessageType   string `json:"message_type,omitempty"`
	Sender        string `json:"sender,omitempty"`
	SenderID      string `json:"sender_id,omitempty"`
	MessageID     int    `json:"message_id,omitempty"`
}

func ServeWS(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	userNick := r.URL.Query().Get("nick")

	if userID == "" || userNick == "" {
		log.Println("ERROR: missing user_id or nick")
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("ERROR: websocket upgrade failed:", err)
		return
	}

	mu.Lock()
	clients[userNick] = conn
	mu.Unlock()

	log.Printf("✅ CONNECTED: %s (id: %s)", userNick, userID)

	defer func() {
		mu.Lock()
		delete(clients, userNick)
		mu.Unlock()
		conn.Close()
		log.Printf("❌ DISCONNECTED: %s", userNick)
	}()

	for {
		var msg WSMessage
		err := conn.ReadJSON(&msg)
		if err != nil {
			log.Println("ERROR: read failed:", err)
			break
		}

		log.Printf("📥 WS message: %+v", msg)

		switch msg.Type {
		case "join_request":
			handleJoinRequest(userID, userNick, msg.Code)
		case "approve_join":
			handleDecision(msg.Code, msg.RequesterID, msg.RequesterNick, true)
		case "reject_join":
			handleDecision(msg.Code, msg.RequesterID, msg.RequesterNick, false)
		case "invite":
			handleInvite(msg.TargetNick, msg.Code, userNick)
		case "new_message":
			handleNewMessage(userID, userNick, msg)
		case "message":
			handleNewMessage(userID, userNick, msg)
		case "accept_invite":
			handleAcceptInvite(msg.Code, userNick)
		case "delete_message_for_all":
			handleDeleteMessageForAll(msg.Code, msg.MessageID, msg.Text, msg.Sender)
		case "delete_message_for_me":
			handleDeleteMessageForMe(msg.Code, msg.MessageID, msg.Text, msg.Sender)
		}

	}
}

// ✅ ИСПРАВЛЕННАЯ handleNewMessage (из первой версии)
func handleNewMessage(senderID, senderNick string, msg WSMessage) {
	var roomID int
	err := database.DB.QueryRow("SELECT id FROM rooms WHERE code = $1", msg.Code).Scan(&roomID)
	if err != nil {
		log.Println("ERROR: room not found:", msg.Code)
		return
	}

	// Сохраняем сообщение в БД
	_, err = database.DB.Exec(`
		INSERT INTO messages (room_id, sender_id, sender_nick, content, message_type, file_path)
		VALUES ($1, $2, $3, $4, $5, $6)`,
		roomID, senderID, senderNick, msg.Text, msg.MessageType, msg.FilePath)
	if err != nil {
		log.Println("ERROR: failed to save message:", err)
		return
	}

	// Получаем created_at сохранённого сообщения
	var createdAt time.Time
	err = database.DB.QueryRow(`
		SELECT created_at FROM messages 
		WHERE room_id = $1 AND sender_id = $2 AND content = $3 
		ORDER BY id DESC LIMIT 1
	`, roomID, senderID, msg.Text).Scan(&createdAt)
	if err != nil {
		log.Println("WARNING: failed to get created_at:", err)
		createdAt = time.Now() // fallback
	}

	// Получаем всех участников комнаты
	rows, err := database.DB.Query(`
		SELECT u.username FROM room_participants rp 
		JOIN users u ON rp.user_id = u.id 
		WHERE rp.room_id = $1`, roomID)
	if err != nil {
		log.Println("ERROR: failed to get participants:", err)
		return
	}
	defer rows.Close()

	mu.Lock()
	defer mu.Unlock()

	for rows.Next() {
		var nick string
		rows.Scan(&nick)
		if conn, ok := clients[nick]; ok {
			err := conn.WriteJSON(map[string]interface{}{
				"type":       "message",
				"room_id":    roomID,
				"sender":     senderNick,
				"text":       msg.Text,
				"code":       msg.Code,
				"created_at": createdAt.Format("15:04"),
			})
			if err != nil {
				log.Printf("ERROR: could not send to %s: %v", nick, err)
			}
		}
	}
	log.Printf("✅ Message from %s sent to room %d", senderNick, roomID)
}

// ✅ ИСПРАВЛЕННЫЙ handleJoinRequest (из первой версии)
func handleJoinRequest(requesterID, requesterNick, code string) {
	var creatorID string
	var creatorNick string

	err := database.DB.QueryRow(`
		SELECT u.id, u.username
		FROM rooms r
		JOIN users u ON r.creator_id = u.id
		WHERE r.code = $1
	`, code).Scan(&creatorID, &creatorNick)

	if err != nil {
		sendToUser(requesterNick, map[string]string{"type": "error", "message": "Room not found"})
		return
	}

	requestKey := code + "_" + requesterID
	pendingRequests.Store(requestKey, true)

	mu.Lock()
	creatorConn, ok := clients[creatorNick]
	mu.Unlock()

	if !ok {
		sendToUser(requesterNick, map[string]string{"type": "error", "message": "Creator is offline"})
		return
	}

	creatorConn.WriteJSON(map[string]interface{}{
		"type":           "incoming_request",
		"requester_id":   requesterID,
		"requester_nick": requesterNick,
		"code":           code,
	})

	time.AfterFunc(30*time.Second, func() {
		if _, exists := pendingRequests.Load(requestKey); exists {
			pendingRequests.Delete(requestKey)
			sendToUser(requesterNick, map[string]string{"type": "join_rejected", "reason": "timeout"})
		}
	})
}

// ✅ ИСПРАВЛЕННАЯ handleDecision
func handleDecision(code, requesterID, requesterNick string, approved bool) {
	requestKey := code + "_" + requesterID
	pendingRequests.Delete(requestKey)

	mu.Lock()
	reqConn, ok := clients[requesterNick]
	mu.Unlock()

	if approved {
		// Добавляем пользователя в комнату
		_, err := database.DB.Exec(`
			INSERT INTO room_participants (room_id, user_id)
			SELECT id, $2 FROM rooms WHERE code = $1
			ON CONFLICT DO NOTHING
		`, code, requesterID)

		if err != nil {
			log.Println("ERROR: failed to add participant:", err)
		}

		if ok {
			reqConn.WriteJSON(map[string]string{"type": "join_approved", "code": code})
		}
	} else {
		if ok {
			reqConn.WriteJSON(map[string]string{"type": "join_rejected", "reason": "denied"})
		}
	}
}

// ✅ ИСПРАВЛЕННЫЙ handleInvite (из первой версии)
func handleInvite(targetNick string, roomCode string, senderNick string) {
	mu.Lock()
	targetConn, isOnline := clients[targetNick]
	mu.Unlock()

	if isOnline {
		targetConn.WriteJSON(map[string]interface{}{
			"type":        "incoming_invite",
			"room_code":   roomCode,
			"sender_nick": senderNick,
		})
	} else {
		log.Printf("Пользователь %s не в сети, инвайт не отправлен", targetNick)
	}
}

func handleAcceptInvite(roomCode, acceptingNick string) {
	log.Printf("🔍 accept_invite: code=%s, nick=%s", roomCode, acceptingNick)

	var roomID int
	err := database.DB.QueryRow("SELECT id FROM rooms WHERE code = $1", roomCode).Scan(&roomID)
	if err != nil {
		log.Printf("❌ Комната с кодом %s не найдена: %v", roomCode, err)
		sendToUser(acceptingNick, map[string]string{
			"type":    "error",
			"message": "Комната не найдена",
		})
		return
	}

	// Добавляем пользователя в участники
	res, err := database.DB.Exec(`
        INSERT INTO room_participants (room_id, user_id)
        SELECT $1, id FROM users WHERE username = $2
        ON CONFLICT DO NOTHING
    `, roomID, acceptingNick)
	if err != nil {
		log.Printf("❌ Ошибка добавления участника: %v", err)
		sendToUser(acceptingNick, map[string]string{
			"type":    "error",
			"message": "Ошибка сервера",
		})
		return
	}

	rowsAffected, _ := res.RowsAffected()
	log.Printf("✅ Участник %s добавлен в комнату %d (rows: %d)", acceptingNick, roomID, rowsAffected)

	// Отправляем подтверждение
	sendToUser(acceptingNick, map[string]interface{}{
		"type": "join_approved",
		"code": roomCode,
	})
}

// ✅ Хелпер для отправки сообщения по нику
func sendToUser(nick string, data interface{}) {
	mu.Lock()
	conn, ok := clients[nick]
	mu.Unlock()

	if ok {
		conn.WriteJSON(data)
	}
}

func handleDeleteMessageForAll(roomCode string, messageID int, text, sender string) {
	var roomID int
	database.DB.QueryRow("SELECT id FROM rooms WHERE code = $1", roomCode).Scan(&roomID)

	// Удаляем из БД
	database.DB.Exec("DELETE FROM messages WHERE room_id = $1 AND content = $2 AND sender_nick = $3",
		roomID, text, sender)

	// Рассылаем всем участникам
	rows, _ := database.DB.Query(`
        SELECT u.username FROM room_participants rp 
        JOIN users u ON rp.user_id = u.id 
        WHERE rp.room_id = $1`, roomID)
	defer rows.Close()

	mu.Lock()
	defer mu.Unlock()
	for rows.Next() {
		var nick string
		rows.Scan(&nick)
		if conn, ok := clients[nick]; ok {
			conn.WriteJSON(map[string]interface{}{
				"type":       "delete_message_for_all",
				"message_id": messageID,
				"text":       text,
				"sender":     sender,
			})
		}
	}
}

func handleDeleteMessageForMe(roomCode string, messageID int, text, sender string) {
	// Отправляем только запросившему
	sendToUser(sender, map[string]interface{}{
		"type":       "delete_message_for_me",
		"message_id": messageID,
		"text":       text,
		"sender":     sender,
	})
}
