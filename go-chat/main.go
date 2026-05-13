package main

import (
	"fmt"
	"go-chat/database"
	"go-chat/handlers"
	"net/http"
)

func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next(w, r)
	}
}

func main() {
	database.InitDB()

	// ====================== АВТОРИЗАЦИЯ ======================
	http.HandleFunc("/login", corsMiddleware(handlers.LoginHandler))
	http.HandleFunc("/register", corsMiddleware(handlers.SendVerificationCode))
	http.HandleFunc("/confirm-registration", corsMiddleware(handlers.ConfirmRegistration))

	// ====================== КОМНАТЫ ======================
	http.HandleFunc("/create", corsMiddleware(handlers.CreateRoomHandler))
	http.HandleFunc("/my-rooms", corsMiddleware(handlers.GetUserRoomsHandler))
	http.HandleFunc("/delete-room", corsMiddleware(handlers.DeleteRoomHandler))
	http.HandleFunc("/messages", corsMiddleware(handlers.GetMessagesHandler))
	http.HandleFunc("/rename-room", corsMiddleware(handlers.RenameRoomHandler))
	http.HandleFunc("/room-participants", corsMiddleware(handlers.GetRoomParticipantsHandler))

	// ====================== WEBSOCKET ======================
	http.HandleFunc("/ws", handlers.ServeWS)

	// ====================== ЗАГРУЗКА ФАЙЛОВ ======================
	http.HandleFunc("/upload", corsMiddleware(handlers.UploadFileHandler))

	// ====================== СТАТИКА ======================
	http.Handle("/uploads/", http.StripPrefix("/uploads/", http.FileServer(http.Dir("./static/uploads"))))
	http.Handle("/", http.FileServer(http.Dir("./static")))

	fmt.Println("🚀 Сервер запущен на http://localhost:8080")
	http.ListenAndServe(":8080", nil)
}
