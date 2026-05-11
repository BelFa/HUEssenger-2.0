const API_URL = 'http://localhost:8080';
const WS_URL = 'ws://localhost:8080';

// Создание комнаты
export const createRoom = async (userId) => {
  try {
    // Теперь отправляем POST запрос с ID создателя
    const response = await fetch(`${API_URL}/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ creator_id: userId })
    });

    if (!response.ok) {
      throw new Error('Failed to create room');
    }
    return await response.json(); // Вернет { code: "A1B2C", room_id: 123 }
  } catch (error) {
    console.error('Create room error:', error);
    throw error;
  }
};

// Подключение к WebSocket
// Вместо token передаем userId, как того требует сервер
export const connectToRoom = (userId, nick) => {
  const ws = new WebSocket(
    `${WS_URL}/ws?user_id=${encodeURIComponent(userId)}&nick=${encodeURIComponent(nick)}`
  );
  return ws;
};

// Моковые функции (если ты уже сделал реальный логин, замени их на fetch к /login и /register)
export const mockLogin = async (data) => {
  return { success: true, user: { id: 1, username: data.username || "User" } };
};