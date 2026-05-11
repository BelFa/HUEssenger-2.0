package handlers

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// UploadFileHandler отвечает за загрузку картинок на сервер
func UploadFileHandler(w http.ResponseWriter, r *http.Request) {
	// 1. Читаем файл из формы (ключ должен быть "file")
	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "Ошибка при чтении файла", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// 2. Создаем уникальное имя файла, чтобы не было повторов
	fileName := fmt.Sprintf("%d%s", time.Now().UnixNano(), filepath.Ext(header.Filename))

	// Путь, где файл будет лежать на диске
	filePath := filepath.Join("static", "uploads", fileName)
	// Путь, который мы отдадим клиенту (и сохраним в базу)
	dbPath := "/uploads/" + fileName

	// 3. Создаем файл на сервере
	out, err := os.Create(filePath)
	if err != nil {
		http.Error(w, "Не удалось сохранить файл на сервере", http.StatusInternalServerError)
		return
	}
	defer out.Close()

	// 4. Копируем содержимое загруженного файла в созданный
	_, err = io.Copy(out, file)
	if err != nil {
		http.Error(w, "Ошибка при копировании файла", http.StatusInternalServerError)
		return
	}

	// 5. Возвращаем путь к файлу фронтенду
	w.Header().Set("Content-Type", "text/plain")
	fmt.Fprint(w, dbPath)
}
