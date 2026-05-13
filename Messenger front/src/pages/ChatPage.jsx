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
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [inviteNick, setInviteNick] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [waitingApproval, setWaitingApproval] = useState(false);
  const [incomingRequest, setIncomingRequest] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, message: null });

  const wsRef = useRef(null);
  const activeChatRef = useRef(null);
  const roomsRef = useRef(rooms);

  const myNick = currentUser?.username || "Guest";

  useEffect(() => {
    activeChatRef.current = activeChat;
  }, [activeChat]);

  useEffect(() => {
    roomsRef.current = rooms;
  }, [rooms]);

  // Закрытие контекстного меню при клике вне его
  useEffect(() => {
    const handleClick = () => {
      setContextMenu({ visible: false, x: 0, y: 0, message: null });
    };
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, []);

  const fetchRooms = useCallback(async () => {
    try {
      const response = await fetch(`http://localhost:8080/my-rooms?user_id=${currentUser.id}`);
      if (response.ok) {
        const data = await response.json();
        setRooms(data || []);
      }
    } catch (err) {
      console.error("Ошибка загрузки списка комнат:", err);
    }
  }, [currentUser.id]);

  // Загрузка истории сообщений
  useEffect(() => {
    if (activeChat) {
      const loadMessages = async () => {
        try {
          const res = await fetch(`http://localhost:8080/messages?room_id=${activeChat}`);
          if (res.ok) {
            const data = await res.json();
            setMessages(data.map(m => ({
              id: m.id,
              sender: m.sender,
              text: m.text,
              isMe: m.sender === myNick,
              created_at: m.created_at
            })));
          }
        } catch (err) {
          console.error("Ошибка загрузки истории:", err);
        }
      };
      loadMessages();
    } else {
      setMessages([]);
    }
  }, [activeChat, myNick]);

  // WebSocket с автоматическим переподключением
  useEffect(() => {
    let reconnectAttempts = 0;
    let reconnectTimeout = null;
    let isMounted = true;

    const connectWS = () => {
      if (!isMounted) return;
      
      console.log("🟢 Подключение WebSocket...");
      const ws = new WebSocket(`ws://localhost:8080/ws?user_id=${currentUser.id}&nick=${encodeURIComponent(myNick)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("✅ WebSocket соединение открыто");
        reconnectAttempts = 0;
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log("📨 WS Data:", data);

        if (data.type === "message") {
          const currentRoomId = activeChatRef.current;
          const currentRooms = roomsRef.current;
          const currentRoom = currentRooms.find(r => r.id === currentRoomId);
          if (currentRoom && (data.code === currentRoom.code || data.room_id === currentRoomId)) {
            setMessages(prev => {
              const exists = prev.some(m => m.text === data.text && m.sender === data.sender && m.created_at === data.created_at);
              if (exists) return prev;
              return [...prev, {
                id: data.id,
                sender: data.sender,
                text: data.text,
                isMe: data.sender === myNick,
                created_at: data.created_at
              }];
            });
          }
        }

        if (data.type === "delete_message_for_all") {
          // Удаляем сообщение у всех
          setMessages(prev => prev.filter(m => !(m.id === data.message_id || (m.text === data.text && m.sender === data.sender))));
        }

        if (data.type === "delete_message_for_me") {
          // Удаляем сообщение только у себя
          setMessages(prev => prev.filter(m => !(m.id === data.message_id || (m.text === data.text && m.sender === data.sender))));
        }

        if (data.type === "incoming_request") {
          setIncomingRequest({
            type: "request",
            userId: data.requester_id,
            username: data.requester_nick,
            code: data.code,
            timeLeft: 30
          });
        }

        if (data.type === "incoming_invite") {
          fetchRooms();
          setIncomingRequest({
            type: "invite",
            username: data.sender_nick,
            code: data.room_code,
            timeLeft: 30
          });
        }

        if (data.type === "join_approved") {
          setWaitingApproval(false);
          fetchRooms();
          alert(`✅ Доступ разрешён в комнату: ${data.code}`);
        }

        if (data.type === "join_rejected") {
          setWaitingApproval(false);
          alert("❌ В доступе отказано.");
        }
      };

      ws.onerror = (err) => {
        console.error("❌ WebSocket ошибка:", err);
      };

      ws.onclose = (event) => {
        console.log(`❌ WebSocket закрыт, код: ${event.code}`);
        if (isMounted && reconnectAttempts < 10) {
          reconnectTimeout = setTimeout(() => {
            reconnectAttempts++;
            console.log(`🔄 Попытка переподключения ${reconnectAttempts}/10...`);
            connectWS();
          }, 3000);
        }
      };
    };

    connectWS();

    return () => {
      isMounted = false;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    };
  }, [currentUser.id, myNick, fetchRooms]);

  // Отдельный эффект для загрузки комнат при старте
  useEffect(() => {
    fetchRooms();
  }, []);

  const send = () => {
    if (!input.trim() || !wsRef.current || !activeChat) return;

    const activeRoom = rooms.find(c => c.id === activeChat);
    if (!activeRoom) {
      alert("Комната не найдена");
      return;
    }

    const encryptedText = encryptMessage(input, activeRoom.code);
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    // Добавляем локально, чтобы отправитель видел сообщение сразу
    setMessages(prev => [...prev, {
      id: Date.now(),
      sender: myNick,
      text: encryptedText,
      isMe: true,
      created_at: timeStr
    }]);

    wsRef.current.send(JSON.stringify({
      type: "message",
      code: activeRoom.code,
      text: encryptedText,
      sender: myNick,
      message_type: "text"
    }));

    setInput("");
  };

  const handleContextMenu = (e, message) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      message: message
    });
  };

  const handleDeleteMessage = (message, deleteForAll) => {
    if (!wsRef.current || !activeChat) return;

    const activeRoom = rooms.find(c => c.id === activeChat);
    
    if (deleteForAll && message.isMe) {
      // Удаляем для всех (только если своё сообщение)
      wsRef.current.send(JSON.stringify({
        type: "delete_message_for_all",
        code: activeRoom?.code,
        message_id: message.id,
        text: message.text,
        sender: message.sender
      }));
      // Локально удаляем сразу
      setMessages(prev => prev.filter(m => m !== message));
    } else {
      // Удаляем только у себя
      wsRef.current.send(JSON.stringify({
        type: "delete_message_for_me",
        code: activeRoom?.code,
        message_id: message.id,
        text: message.text,
        sender: message.sender
      }));
      // Локально удаляем сразу
      setMessages(prev => prev.filter(m => m !== message));
    }

    setContextMenu({ visible: false, x: 0, y: 0, message: null });
  };

  const handleCreateRoom = async () => {
    const targetUser = inviteNick.trim();
    if (!targetUser) return alert("Введите ник пользователя");

    const generatedCode = Math.random().toString(36).substring(2, 8).toUpperCase();

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
          wsRef.current.send(JSON.stringify({
            type: "invite",
            target_nick: targetUser,
            code: generatedCode
          }));
        }
        setInviteNick("");
        fetchRooms();
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
      wsRef.current.send(JSON.stringify({
        type: isApproved ? "approve_join" : "reject_join",
        requester_id: incomingRequest.userId,
        code: incomingRequest.code
      }));
    } else if (incomingRequest.type === "invite") {
      if (isApproved) {
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

              {/* Список сообщений */}
              <div className="flex-1 p-4 overflow-y-auto bg-black/10 flex flex-col space-y-3">
                {messages.map((m, i) => (
                  <div 
                    key={i} 
                    className={`flex flex-col ${m.isMe ? "items-end" : "items-start"}`}
                    onContextMenu={(e) => handleContextMenu(e, m)}
                  >
                    <span className="text-sm font-semibold opacity-80 mb-1 px-2">{m.sender}</span>
                    <div className={`max-w-[70%] px-4 py-2 rounded-2xl ${m.isMe ? "bg-indigo-500" : "bg-white/20"} cursor-context-menu`}>
                      <div className="break-words whitespace-pre-wrap">
                        {decryptMessage(m.text, currentRoomCode)}
                      </div>
                      <div className="text-[9px] opacity-50 text-right mt-1">
                        {m.created_at || "—"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Поле ввода */}
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

          {/* Контекстное меню */}
          {contextMenu.visible && (
            <div 
              className="fixed bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 overflow-hidden"
              style={{ top: contextMenu.y, left: contextMenu.x }}
            >
              {contextMenu.message?.isMe ? (
                <>
                  <button 
                    onClick={() => handleDeleteMessage(contextMenu.message, true)}
                    className="block w-full px-4 py-2 text-left text-red-400 hover:bg-red-500/20 transition text-sm"
                  >
                    🗑 Удалить для всех
                  </button>
                  <button 
                    onClick={() => handleDeleteMessage(contextMenu.message, false)}
                    className="block w-full px-4 py-2 text-left text-gray-300 hover:bg-gray-700 transition text-sm"
                  >
                    ❌ Удалить только у себя
                  </button>
                </>
              ) : (
                <button 
                  onClick={() => handleDeleteMessage(contextMenu.message, false)}
                  className="block w-full px-4 py-2 text-left text-gray-300 hover:bg-gray-700 transition text-sm"
                >
                  ❌ Скрыть сообщение
                </button>
              )}
            </div>
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