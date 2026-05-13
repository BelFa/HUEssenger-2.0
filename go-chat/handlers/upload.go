package handlers

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

func UploadFileHandler(w http.ResponseWriter, r *http.Request) {
	// 1. Читаем файл из формы
	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "Ошибка при чтении файла", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// 2. Создаем уникальное имя файла
	fileName := fmt.Sprintf("%d%s", time.Now().UnixNano(), filepath.Ext(header.Filename))

	// Создаем директорию если не существует
	uploadDir := "./static/uploads"
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		http.Error(w, "Ошибка создания директории", http.StatusInternalServerError)
		return
	}

	// Путь для сохранения
	filePath := filepath.Join(uploadDir, fileName)
	dbPath := "/uploads/" + fileName

	// 3. Сохраняем файл
	out, err := os.Create(filePath)
	if err != nil {
		http.Error(w, "Не удалось сохранить файл", http.StatusInternalServerError)
		return
	}
	defer out.Close()

	_, err = io.Copy(out, file)
	if err != nil {
		http.Error(w, "Ошибка при копировании файла", http.StatusInternalServerError)
		return
	}

	// 4. Возвращаем путь
	w.Header().Set("Content-Type", "text/plain")
	fmt.Fprint(w, dbPath)
}
