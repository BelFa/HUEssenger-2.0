import { useState, useRef, useEffect, useCallback } from "react";
import CryptoJS from "crypto-js";
import zhdun from "../assets/zhdun.png";

// --- ФУНКЦИИ ШИФРОВАНИЯ (E2EE) ---
const encryptMessage = (text, secretKey) => {
  return CryptoJS.AES.encrypt(text, secretKey).toString();
};

const decryptMessage = (cipherText, secretKey) => {
  try {
    const bytes = CryptoJS.AES.decrypt(cipherText, secretKey);
    const originalText = bytes.toString(CryptoJS.enc.Utf8);
    return originalText || cipherText;
  } catch (e) {
    return cipherText;
  }
};

export default function ChatPage({ onNavigate, currentUser }) {
  console.log("🔥 ChatPage рендер, пользователь:", currentUser?.username);

  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [inviteNick, setInviteNick] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [waitingApproval, setWaitingApproval] = useState(false);
  const [incomingRequest, setIncomingRequest] = useState(null);
  const [rooms, setRooms] = useState([]);

  const wsRef = useRef(null);
  const activeChatRef = useRef(null);
  const roomsRef = useRef(rooms);

  const myNick = currentUser?.username || "Guest";

  // Обновляем refs при изменении состояний
  useEffect(() => {
    activeChatRef.current = activeChat;
  }, [activeChat]);

  useEffect(() => {
    roomsRef.current = rooms;
  }, [rooms]);

  // Загрузка списка комнат с логированием
  const fetchRooms = useCallback(async () => {
    console.log("🔄 fetchRooms вызван, user_id:", currentUser.id);
    try {
      const response = await fetch(`http://localhost:8080/my-rooms?user_id=${currentUser.id}`);
      if (response.ok) {
        const data = await response.json();
        console.log("📋 Получены комнаты:", data);
        setRooms(data || []);
      } else {
        console.error("❌ Ошибка загрузки комнат, статус:", response.status);
      }
    } catch (err) {
      console.error("❌ Ошибка загрузки списка комнат:", err);
    }
  }, [currentUser.id]);

  // Загрузка истории сообщений
  useEffect(() => {
    if (activeChat) {
      const loadMessages = async () => {
        console.log("📜 Загрузка истории для комнаты:", activeChat);
        try {
          const res = await fetch(`http://localhost:8080/messages?room_id=${activeChat}`);
          if (res.ok) {
            const data = await res.json();
            setMessages(data.map(m => ({
              sender: m.sender,
              text: m.text,
              isMe: m.sender === myNick
            })));
            console.log(`✅ Загружено ${data.length} сообщений`);
          }
        } catch (err) {
          console.error("❌ Ошибка загрузки истории:", err);
        }
      };
      loadMessages();
    } else {
      setMessages([]);
    }
  }, [activeChat, myNick]);

  // WebSocket – с подробными логами и без зависимости от rooms
  useEffect(() => {
    console.log("🟢 WebSocket ЭФФЕКТ ЗАПУЩЕН (создание нового соединения)");

    const ws = new WebSocket(`ws://localhost:8080/ws?user_id=${currentUser.id}&nick=${encodeURIComponent(myNick)}`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("✅ WebSocket соединение ОТКРЫТО");
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log("📨 WS получено сообщение:", data);

      if (data.type === "message") {
        const currentRoomId = activeChatRef.current;
        const currentRooms = roomsRef.current;
        const currentRoom = currentRooms.find(r => r.id === currentRoomId);
        if (currentRoom && (data.code === currentRoom.code || data.room_id === currentRoomId)) {
          console.log(`💬 Новое сообщение в активный чат от ${data.sender}`);
          setMessages(prev => [...prev, {
            sender: data.sender,
            text: data.text,
            isMe: data.sender === myNick
          }]);
        } else {
          console.log("⏸ Сообщение не для активного чата, проигнорировано");
        }
      }

      if (data.type === "delete_message") {
        setMessages(prev => prev.filter(m => 
          !(m.sender === data.sender && m.text === data.text)
        ));
      }

      if (data.type === "incoming_request") {
        console.log("🔔 Входящий запрос на вступление от:", data.requester_nick);
        setIncomingRequest({
          type: "request",
          userId: data.requester_id,
          username: data.requester_nick,
          code: data.code,
          timeLeft: 30
        });
      }

      if (data.type === "incoming_invite") {
        console.log("📩 Получено приглашение от:", data.sender_nick, "в комнату", data.room_code);
        fetchRooms(); // обновляем список
        setIncomingRequest({
          type: "invite",
          username: data.sender_nick,
          code: data.room_code,
          timeLeft: 30
        });
      }

      if (data.type === "join_approved") {
        console.log("✅ Запрос/приглашение ОДОБРЕНО для комнаты", data.code);
        setWaitingApproval(false);
        fetchRooms();
        alert(`✅ Доступ разрешён в комнату: ${data.code}`);
      }

      if (data.type === "join_rejected") {
        console.log("❌ Запрос/приглашение ОТКЛОНЕНО");
        setWaitingApproval(false);
        alert("❌ В доступе отказано.");
      }

      if (data.type === "error") {
        console.error("❌ Ошибка от сервера:", data.message);
        alert("Ошибка: " + data.message);
      }
    };

    ws.onerror = (err) => {
      console.error("❌ WebSocket ошибка:", err);
    };

    ws.onclose = (event) => {
      console.log(`❌ WebSocket ЗАКРЫТ, код: ${event.code}, причина: ${event.reason || "нет"}`);
    };

    return () => {
      console.log("🔴 WebSocket ЭФФЕКТ ЗАВЕРШЁН, закрываю соединение");
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    };
  }, [currentUser.id, myNick]); // ТОЛЬКО эти зависимости (без fetchRooms и rooms)

  // Отдельный эффект для первоначальной загрузки комнат (один раз)
  useEffect(() => {
    fetchRooms();
  }, []); // пустой массив – вызывается только при монтировании

  // Отправка сообщения
  const send = () => {
  if (!input.trim() || !wsRef.current || !activeChat) return;

  const activeRoom = rooms.find(c => c.id === activeChat);
  if (!activeRoom) {
    alert("Комната не найдена");
    return;
  }

  const encryptedText = encryptMessage(input, activeRoom.code);

  wsRef.current.send(JSON.stringify({
    type: "message",
    code: activeRoom.code,
    text: encryptedText,
    sender: myNick,
    message_type: "text"
  }));

  setInput("");
};

  const deleteMessage = (msgToDelete) => {
    if (!wsRef.current) return;
    const activeRoom = rooms.find(c => c.id === activeChat);
    wsRef.current.send(JSON.stringify({
      type: "delete_message",
      code: activeRoom?.code,
      room_id: activeChat,
      sender: msgToDelete.sender,
      text: msgToDelete.text
    }));
    setMessages(prev => prev.filter(m => 
      !(m.sender === msgToDelete.sender && m.text === msgToDelete.text)
    ));
  };

  const handleCreateRoom = async () => {
    const targetUser = inviteNick.trim();
    if (!targetUser) return alert("Введите ник пользователя");

    const generatedCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    console.log("🏠 Создание комнаты, код:", generatedCode, "приглашаемый:", targetUser);

    try {
      const response = await fetch("http://localhost:8080/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creator_id: currentUser.id,
          invited_nick: targetUser,
          code: generatedCode
        }),
      });

      if (response.ok) {
        alert(`✅ Комната создана!\nКод: ${generatedCode}`);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          console.log("📤 Отправка invite через WebSocket");
          wsRef.current.send(JSON.stringify({
            type: "invite",
            target_nick: targetUser,
            code: generatedCode
          }));
        } else {
          console.warn("⚠️ WebSocket не открыт, invite не отправлен");
        }
        setInviteNick("");
        fetchRooms(); // обновляем список комнат
      } else {
        alert("Не удалось создать комнату");
      }
    } catch (err) {
      console.error(err);
      alert("Ошибка соединения с сервером");
    }
  };

  const handleJoinRoom = () => {
    const code = joinCode.trim();
    if (!code || !wsRef.current) return;
    console.log("🔑 Запрос на вступление в комнату с кодом:", code);
    wsRef.current.send(JSON.stringify({ type: "join_request", code }));
    setWaitingApproval(true);
    setTimeout(() => {
      setWaitingApproval(prev => {
        if (prev) alert("Время ожидания истекло.");
        return false;
      });
    }, 30000);
  };

  const handleApprove = (isApproved) => {
    if (!wsRef.current || !incomingRequest) return;

    if (incomingRequest.type === "request") {
      console.log("✏️ Ответ на запрос входа:", isApproved ? "одобрено" : "отклонено");
      wsRef.current.send(JSON.stringify({
        type: isApproved ? "approve_join" : "reject_join",
        requester_id: incomingRequest.userId,
        code: incomingRequest.code
      }));
    } else if (incomingRequest.type === "invite") {
      if (isApproved) {
        console.log("📤 Sending accept_invite for code:", incomingRequest.code);
        wsRef.current.send(JSON.stringify({
          type: "accept_invite",
          code: incomingRequest.code
        }));
      }
    }

    setTimeout(fetchRooms, 500);
    setIncomingRequest(null);
  };

  const handleDeleteRoom = async (roomId, mode) => {
    if (!window.confirm(mode === "all" ? "Удалить чат для всех?" : "Выйти из чата?")) return;
    try {
      const res = await fetch(
        `http://localhost:8080/delete-room?room_id=${roomId}&user_id=${currentUser.id}&mode=${mode}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setActiveChat(null);
        fetchRooms();
      }
    } catch (err) {
      alert("Ошибка удаления");
    }
  };

  // Таймер для модалки уведомления
  useEffect(() => {
    let timer;
    if (incomingRequest && incomingRequest.timeLeft > 0) {
      timer = setTimeout(() => {
        setIncomingRequest(prev => ({ ...prev, timeLeft: prev.timeLeft - 1 }));
      }, 1000);
    } else if (incomingRequest && incomingRequest.timeLeft === 0) {
      setIncomingRequest(null);
    }
    return () => clearTimeout(timer);
  }, [incomingRequest]);

  const currentRoomCode = rooms.find(c => c.id === activeChat)?.code || "";

  return (
    <div className="relative min-h-screen w-full flex overflow-hidden text-white font-sans">
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600" />
      <div className="relative flex w-full">
        {/* Боковая панель */}
        <div className="w-72 bg-white/10 backdrop-blur-xl border-r border-white/20 flex flex-col">
          <div className="p-4 font-semibold text-lg border-b border-white/20 flex justify-between items-center cursor-pointer"
               onClick={() => setActiveChat(null)}>
            Go Messenger
            <button onClick={() => onNavigate("login")} className="text-sm opacity-70">Выход</button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {rooms.length === 0 && <div className="p-4 text-center opacity-50">Нет чатов</div>}
            {rooms.map((chat) => (
              <div key={chat.id} onClick={() => setActiveChat(chat.id)}
                className={`p-3 rounded-xl cursor-pointer mb-1 transition ${activeChat === chat.id ? "bg-white/20" : "hover:bg-white/10"}`}>
                <div className="flex justify-between items-center">
                  <span>{chat.name}</span>
                  <span className="text-[9px] opacity-30">{chat.code}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Основная область чата */}
        <div className="flex-1 flex flex-col relative">
          {!activeChat ? (
            <div className="flex-1 flex items-center justify-center bg-black/10">
              <div className="flex gap-8">
                <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-6 w-80 shadow-2xl">
                  <h3 className="text-xl font-bold mb-4">Создать комнату</h3>
                  <input className="w-full mb-4 p-3 rounded-xl bg-white/10 border border-white/20 outline-none"
                    placeholder="Ник пользователя" value={inviteNick} onChange={(e) => setInviteNick(e.target.value)} />
                  <button onClick={handleCreateRoom} className="w-full p-3 bg-indigo-500 font-bold rounded-xl hover:bg-indigo-600 transition">
                    Пригласить
                  </button>
                </div>
                <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-6 w-80 shadow-2xl">
                  <h3 className="text-xl font-bold mb-4">Вступить по коду</h3>
                  <input className="w-full mb-4 p-3 rounded-xl bg-white/10 border border-white/20 outline-none"
                    placeholder="Код комнаты" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} />
                  <button onClick={handleJoinRoom} className="w-full p-3 bg-pink-500 font-bold rounded-xl hover:bg-pink-600 transition">
                    Подключиться
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-white/20 backdrop-blur-xl bg-white/5 flex justify-between items-center">
                <div className="flex flex-col">
                  <b className="text-lg">{rooms.find(c => c.id === activeChat)?.name || "Чат"}</b>
                  <div className="flex gap-2 mt-1">
                    <button onClick={() => handleDeleteRoom(activeChat, "me")} className="text-[10px] uppercase bg-white/10 px-2 py-1 rounded hover:bg-orange-500">Покинуть</button>
                    <button onClick={() => handleDeleteRoom(activeChat, "all")} className="text-[10px] uppercase bg-white/10 px-2 py-1 rounded hover:bg-red-500">Удалить чат</button>
                  </div>
                </div>
                <span className="text-sm opacity-70">🔒 E2EE Активно</span>
              </div>
              <div className="flex-1 p-4 overflow-y-auto bg-black/10 flex flex-col">
                {messages.map((m, i) => (
                  <div key={i} className={`mb-3 flex flex-col ${m.isMe ? "items-end" : "items-start"}`}>
                    <span className="text-[10px] opacity-50 mb-1 px-2">{m.sender}</span>
                    <div className="flex items-center gap-2">
                      <span className={`px-4 py-2 rounded-2xl max-w-[70%] break-words ${m.isMe ? "bg-indigo-500" : "bg-white/20"}`}>
                        {decryptMessage(m.text, currentRoomCode)}
                      </span>
                      {m.isMe && (
                        <button onClick={() => deleteMessage(m)} className="text-red-400 hover:text-red-600 text-xs mt-1">✕</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-4 bg-white/5 backdrop-blur-xl border-t border-white/20 flex gap-3">
                <input className="flex-1 p-3 rounded-xl bg-white/10 border border-white/20 outline-none"
                  value={input} onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Ваше сообщение..." />
                <button onClick={send} className="px-6 py-3 bg-white text-indigo-600 font-bold rounded-xl hover:bg-indigo-100 transition">
                  Отправить
                </button>
              </div>
            </>
          )}

          {/* Модалка ожидания */}
          {waitingApproval && (
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
              <div className="bg-gray-900 border border-white/20 rounded-3xl p-8 w-80 text-center shadow-2xl">
                <img src={zhdun} alt="waiting" className="w-32 mx-auto mb-4 animate-pulse" />
                <h3 className="text-xl font-bold mb-2">Ждем ответа...</h3>
                <button onClick={() => setWaitingApproval(false)} className="w-full p-2 text-white/30 hover:text-white transition">Отмена</button>
              </div>
            </div>
          )}

          {/* Модалка входящего запроса/приглашения */}
          {incomingRequest && (
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
              <div className="bg-gray-900 border border-indigo-500/50 rounded-3xl p-8 w-80 text-center shadow-2xl">
                <h3 className="text-xl font-bold mb-2">
                  {incomingRequest.type === "invite" ? "Вас пригласили!" : "Запрос на вход!"}
                </h3>
                <p className="text-white/80 mb-4">От: <b>{incomingRequest.username}</b></p>
                <div className="text-4xl font-mono text-pink-400 mb-6 font-bold">
                  00:{incomingRequest.timeLeft.toString().padStart(2, '0')}
                </div>
                <div className="flex gap-3">
                  <button onClick={() => handleApprove(false)} className="flex-1 p-3 bg-white/10 rounded-xl hover:bg-red-500/50 transition">Отклонить</button>
                  <button onClick={() => handleApprove(true)} className="flex-1 p-3 bg-indigo-500 font-bold rounded-xl hover:bg-indigo-600 transition">Принять</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}