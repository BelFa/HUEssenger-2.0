package handlers

import (
	"database/sql"
	"log"
	"net/http"
	"sync"
	"time"

	"go-chat/database"

	"github.com/gorilla/websocket"
)

// --- WS config ---
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// user_id -> conn
var clients = make(map[string]*websocket.Conn)
var mu sync.Mutex

// pending requests
var pendingRequests sync.Map // code_userId -> bool

// --- message struct ---
type WSMessage struct {
	Type          string `json:"type"`
	Code          string `json:"code,omitempty"`
	RequesterID   string `json:"requester_id,omitempty"`
	RequesterNick string `json:"requester_nick,omitempty"`
	TargetNick    string `json:"target_nick,omitempty"`
	Text          string `json:"text,omitempty"`
	FilePath      string `json:"file_path,omitempty"`    // Путь к картинке
	MessageType   string `json:"message_type,omitempty"` // 'text' или 'image'
}

// --- WS handler ---
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

	// register client
	mu.Lock()
	clients[userID] = conn
	mu.Unlock()

	log.Println("=================================")
	log.Println("CONNECTED")
	log.Println("userID:", userID, "nick:", userNick)

	printClients()

	defer func() {
		mu.Lock()
		delete(clients, userID)
		mu.Unlock()

		conn.Close()

		log.Println("DISCONNECTED:", userID)
		printClients()
	}()

	for {
		var msg WSMessage
		err := conn.ReadJSON(&msg)
		if err != nil {
			log.Println("ERROR: read failed:", err)
			break
		}

		log.Println("RECEIVED:", msg)

		switch msg.Type {

		case "join_request":
			handleJoinRequest(userID, userNick, msg.Code)

		case "approve_join":
			handleDecision(userID, msg.Code, msg.RequesterID, true)

		case "reject_join":
			handleDecision(userID, msg.Code, msg.RequesterID, false)

		case "invite": // ← Добавили
			handleInvite(msg.TargetNick, msg.Code, userNick)

		case "new_message":
			handleNewMessage(userID, userNick, msg)
		}
	}
}

// 🔵 JOIN REQUEST
func handleJoinRequest(requesterID, requesterNick, code string) {
	log.Println("=================================")
	log.Println("JOIN REQUEST")
	log.Println("from:", requesterID, requesterNick)
	log.Println("room code:", code)

	printClients()

	var creatorID string
	var creatorNick string

	err := database.DB.QueryRow(`
		SELECT u.id, u.username
		FROM rooms r
		JOIN users u ON r.creator_id = u.id
		WHERE r.code = $1
	`, code).Scan(&creatorID, &creatorNick)

	if err != nil {
		if err == sql.ErrNoRows {
			log.Println("ERROR: room not found")
		} else {
			log.Println("ERROR: DB query failed:", err)
		}

		sendToUser(requesterID, map[string]string{
			"type":    "error",
			"message": "Room not found",
		})
		return
	}

	log.Println("ROOM CREATOR:")
	log.Println("creatorID:", creatorID)
	log.Println("creatorNick:", creatorNick)

	requestKey := code + "_" + requesterID
	pendingRequests.Store(requestKey, true)

	mu.Lock()
	creatorConn, ok := clients[creatorID]
	mu.Unlock()

	if !ok {
		log.Println("ERROR: creator is NOT online")
		sendToUser(requesterID, map[string]string{
			"type":    "error",
			"message": "Creator is not online",
		})
		return
	}

	log.Println("SENDING incoming_request to creator")

	err = creatorConn.WriteJSON(map[string]interface{}{
		"type":           "incoming_request",
		"requester_id":   requesterID,
		"requester_nick": requesterNick,
		"code":           code,
	})

	if err != nil {
		log.Println("ERROR: failed to send message:", err)
		return
	}

	log.Println("STARTED 30s TIMEOUT")

	time.AfterFunc(30*time.Second, func() {
		if _, exists := pendingRequests.Load(requestKey); exists {
			log.Println("TIMEOUT reached for:", requesterID)

			pendingRequests.Delete(requestKey)

			sendToUser(requesterID, map[string]string{
				"type":   "join_rejected",
				"reason": "timeout",
			})
		}
	})
}

// 🟢 APPROVE / REJECT
func handleDecision(creatorID, code, requesterID string, approved bool) {
	log.Println("=================================")
	log.Println("DECISION")
	log.Println("creatorID:", creatorID)
	log.Println("requesterID:", requesterID)
	log.Println("approved:", approved)

	requestKey := code + "_" + requesterID
	pendingRequests.Delete(requestKey)

	mu.Lock()
	reqConn, ok := clients[requesterID]
	mu.Unlock()

	if !ok {
		log.Println("ERROR: requester not online")
		return
	}

	if approved {
		log.Println("APPROVED")

		_, err := database.DB.Exec(`
			INSERT INTO room_participants (room_id, user_id)
			SELECT id, $2 FROM rooms WHERE code = $1
		`, code, requesterID)

		if err != nil {
			log.Println("ERROR: DB insert failed:", err)
			return
		}

		reqConn.WriteJSON(map[string]string{
			"type": "join_approved",
			"code": code,
		})

	} else {
		log.Println("REJECTED")

		reqConn.WriteJSON(map[string]string{
			"type":   "join_rejected",
			"reason": "denied",
		})
	}
}

// 🟡 helper
func sendToUser(userID string, data interface{}) {
	mu.Lock()
	conn, ok := clients[userID]
	mu.Unlock()

	if !ok {
		log.Println("ERROR: sendToUser -> user not found:", userID)
		return
	}

	err := conn.WriteJSON(data)
	if err != nil {
		log.Println("ERROR: sendToUser failed:", err)
	}
}

// 🧪 print clients
func printClients() {
	log.Println("=== ACTIVE CLIENTS ===")

	mu.Lock()
	defer mu.Unlock()

	if len(clients) == 0 {
		log.Println("no active clients")
		return
	}

	for id := range clients {
		log.Println("client:", id)
	}
}
func handleNewMessage(senderID, senderNick string, msg WSMessage) {
	// 1. Сохраняем в базу данных
	// Ищем ID комнаты по её коду
	var roomID int
	err := database.DB.QueryRow("SELECT id FROM rooms WHERE code = $1", msg.Code).Scan(&roomID)
	if err != nil {
		log.Println("ERROR: room not found for message:", msg.Code)
		return
	}

	// Записываем сообщение в таблицу messages (те самые новые столбцы)
	_, err = database.DB.Exec(`
        INSERT INTO messages (room_id, sender_id, content, file_path, message_type)
        VALUES ($1, $2, $3, $4, $5)`,
		roomID, senderID, msg.Text, msg.FilePath, msg.MessageType)

	if err != nil {
		log.Println("ERROR: failed to save message to DB:", err)
		return
	}

	// 2. Рассылаем сообщение всем активным клиентам
	mu.Lock()
	defer mu.Unlock()
	for id, conn := range clients {
		err := conn.WriteJSON(map[string]interface{}{
			"type":         "broadcast_message",
			"sender":       senderNick,
			"text":         msg.Text,
			"file_path":    msg.FilePath,
			"message_type": msg.MessageType,
			"code":         msg.Code,
		})
		if err != nil {
			log.Printf("ERROR: could not send to %s: %v", id, err)
		}
	}
} // ←←←← ЭТУ СКОБКУ НЕ ХВАТАЛО!

// ====================== ИНВАЙТ (ПРИГЛАШЕНИЕ) ======================
func handleInvite(targetNick string, roomCode string, senderNick string) {
	mu.Lock()
	targetConn, isOnline := clients[targetNick]
	mu.Unlock()

	log.Printf("📨 Приглашение от %s → %s | код: %s", senderNick, targetNick, roomCode)

	// Находим ID комнаты
	var roomID int
	err := database.DB.QueryRow("SELECT id FROM rooms WHERE code = $1", roomCode).Scan(&roomID)
	if err != nil {
		log.Println("❌ Комната не найдена при инвайте:", roomCode)
		return
	}

	// Добавляем приглашённого в участники
	_, err = database.DB.Exec(`
		INSERT INTO room_participants (room_id, user_id)
		SELECT $1, id FROM users WHERE username = $2 
		ON CONFLICT DO NOTHING`, roomID, targetNick)

	if err != nil {
		log.Println("⚠️ Ошибка добавления участника:", err)
	}

	// Отправляем уведомление
	if isOnline {
		err = targetConn.WriteJSON(map[string]interface{}{
			"type":        "incoming_invite",
			"room_code":   roomCode,
			"sender_nick": senderNick,
		})
		if err != nil {
			log.Println("Ошибка отправки инвайта:", err)
		} else {
			log.Printf("✅ Инвайт успешно отправлен %s", targetNick)
		}
	} else {
		log.Printf("ℹ️ %s не в сети", targetNick)
	}
}
