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

const isImage = (file) => {
  return file.type.startsWith('image/');
};

const isPDF = (file) => {
  return file.type === 'application/pdf';
};

const isValidFile = (file) => {
  const maxSize = 5 * 1024 * 1024;
  return (isImage(file) || isPDF(file)) && file.size <= maxSize;
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
  const [unreadCounts, setUnreadCounts] = useState({});
  const [showMenu, setShowMenu] = useState(false);
  const [editingRoom, setEditingRoom] = useState(null);
  const [newRoomName, setNewRoomName] = useState("");
  const [uploading, setUploading] = useState(false);

  const wsRef = useRef(null);
  const activeChatRef = useRef(null);
  const roomsRef = useRef(rooms);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const fileInputRef = useRef(null);

  const myNick = currentUser?.username || "Guest";

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    activeChatRef.current = activeChat;
    if (activeChat) {
      setUnreadCounts(prev => ({ ...prev, [activeChat]: 0 }));
    }
  }, [activeChat]);

  useEffect(() => {
    roomsRef.current = rooms;
  }, [rooms]);

  useEffect(() => {
    const handleClick = () => {
      setContextMenu({ visible: false, x: 0, y: 0, message: null });
    };
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, []);

  useEffect(() => {
    const handlePaste = async (e) => {
      if (!activeChat) return;
      
      const items = e.clipboardData.items;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file && isValidFile(file)) {
            await uploadAndSendFile(file);
          } else {
            alert("Файл должен быть изображением или PDF до 5MB");
          }
          break;
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [activeChat]);

  const fetchRooms = useCallback(async () => {
    try {
      const response = await fetch(`http://localhost:8080/my-rooms?user_id=${currentUser.id}`);
      if (response.ok) {
        const data = await response.json();
        const roomsWithDetails = await Promise.all(data.map(async (room) => {
          try {
            const participantsRes = await fetch(`http://localhost:8080/room-participants?room_id=${room.id}`);
            if (participantsRes.ok) {
              const participants = await participantsRes.json();
              const otherParticipants = participants.filter(p => p !== myNick);
              let displayName = room.custom_name || "";
              if (!displayName) {
                if (otherParticipants.length === 1) {
                  displayName = otherParticipants[0];
                } else if (otherParticipants.length > 1) {
                  displayName = `${myNick}, ${otherParticipants.slice(0, 2).join(", ")}${otherParticipants.length > 2 ? "..." : ""}`;
                } else {
                  displayName = myNick;
                }
              }
              return { ...room, displayName, participants: [myNick, ...otherParticipants] };
            }
          } catch (err) {
            console.error("Ошибка загрузки участников:", err);
          }
          return { ...room, displayName: room.custom_name || myNick, participants: [myNick] };
        }));
        setRooms(roomsWithDetails);
      }
    } catch (err) {
      console.error("Ошибка загрузки списка комнат:", err);
    }
  }, [currentUser.id, myNick]);

  const handleRenameRoom = async () => {
    if (!editingRoom || !newRoomName.trim()) return;
    
    try {
      const response = await fetch(`http://localhost:8080/rename-room`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_id: editingRoom.id,
          new_name: newRoomName.trim()
        }),
      });
      
      if (response.ok) {
        setRooms(prev => prev.map(room => 
          room.id === editingRoom.id 
            ? { ...room, displayName: newRoomName.trim(), custom_name: newRoomName.trim() }
            : room
        ));
        setEditingRoom(null);
        setNewRoomName("");
        alert("✅ Название чата изменено!");
      } else {
        alert("Ошибка переименования");
      }
    } catch (err) {
      console.error(err);
      alert("Ошибка соединения с сервером");
    }
  };

  const uploadAndSendFile = async (file) => {
    if (!activeChat) return;
    
    const activeRoom = rooms.find(c => c.id === activeChat);
    if (!activeRoom) {
      alert("Комната не найдена");
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const uploadRes = await fetch("http://localhost:8080/upload", {
        method: "POST",
        body: formData,
      });

      if (uploadRes.ok) {
        const filePath = await uploadRes.text();
        const fileType = isImage(file) ? "image" : "pdf";
        const encryptedPath = encryptMessage(filePath, activeRoom.code);
        
        wsRef.current.send(JSON.stringify({
          type: "message",
          code: activeRoom.code,
          text: encryptedPath,
          sender: myNick,
          message_type: fileType,
          file_path: filePath
        }));

        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

        setMessages(prev => [...prev, {
          id: Date.now(),
          sender: myNick,
          text: encryptedPath,
          isMe: true,
          created_at: timeStr,
          message_type: fileType,
          file_path: filePath
        }]);
      } else {
        alert("Ошибка загрузки файла");
      }
    } catch (err) {
      console.error(err);
      alert("Ошибка при отправке файла");
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file && isValidFile(file)) {
      uploadAndSendFile(file);
    } else {
      alert("Файл должен быть изображением или PDF до 5MB");
    }
    fileInputRef.current.value = "";
  };

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
              created_at: m.created_at,
              message_type: m.message_type,
              file_path: m.file_path
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

  useEffect(() => {
    let reconnectAttempts = 0;
    let reconnectTimeout = null;
    let isMounted = true;

    const connectWS = () => {
      if (!isMounted) return;
      
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
          
          setMessages(prev => {
            const exists = prev.some(m => m.text === data.text && m.sender === data.sender);
            if (exists) return prev;
            return [...prev, {
              id: data.id,
              sender: data.sender,
              text: data.text,
              isMe: data.sender === myNick,
              created_at: data.created_at,
              message_type: data.message_type,
              file_path: data.file_path
            }];
          });

          if (currentRoomId !== data.room_id) {
            setUnreadCounts(prev => ({
              ...prev,
              [data.room_id]: (prev[data.room_id] || 0) + 1
            }));
          }
        }

        if (data.type === "delete_message_for_all" || data.type === "delete_message_for_me") {
          setMessages(prev => prev.filter(m => 
            !(m.text === data.text && m.sender === data.sender)
          ));
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

    setMessages(prev => [...prev, {
      id: Date.now(),
      sender: myNick,
      text: encryptedText,
      isMe: true,
      created_at: timeStr,
      message_type: "text"
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
    
    if (deleteForAll) {
      if (window.confirm("Удалить это сообщение для ВСЕХ участников?")) {
        wsRef.current.send(JSON.stringify({
          type: "delete_message_for_all",
          code: activeRoom?.code,
          message_id: message.id,
          text: message.text,
          sender: message.sender
        }));
        setMessages(prev => prev.filter(m => m !== message));
      }
    } else {
      wsRef.current.send(JSON.stringify({
        type: "delete_message_for_me",
        code: activeRoom?.code,
        message_id: message.id,
        text: message.text,
        sender: message.sender
      }));
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
        setShowMenu(false);
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
    setShowMenu(false);
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
  const currentRoom = rooms.find(c => c.id === activeChat);

  const renderMessageContent = (msg) => {
    const decryptedText = decryptMessage(msg.text, currentRoomCode);
    
    if (msg.message_type === "image" && msg.file_path) {
      return (
        <img 
          src={`http://localhost:8080${msg.file_path}`} 
          alt="image" 
          className="max-w-[200px] max-h-[200px] rounded-lg cursor-pointer"
          onClick={() => window.open(`http://localhost:8080${msg.file_path}`, '_blank')}
        />
      );
    } else if (msg.message_type === "pdf" && msg.file_path) {
      return (
        <a 
          href={`http://localhost:8080${msg.file_path}`} 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-blue-300 hover:text-blue-100 underline flex items-center gap-2"
        >
          📄 PDF файл
        </a>
      );
    } else {
      return <div className="break-words whitespace-pre-wrap">{decryptedText}</div>;
    }
  };

  return (
    <div className="relative min-h-screen w-full flex overflow-hidden text-white font-sans">
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600" />
      <div className="relative flex w-full h-screen">
        
        {/* Боковая панель с чатами */}
        <div className="w-72 bg-white/10 backdrop-blur-xl border-r border-white/20 flex flex-col h-full">
          <div className="p-4 font-semibold text-lg border-b border-white/20 flex justify-between items-center flex-shrink-0">
            <span onClick={() => setShowMenu(!showMenu)} className="cursor-pointer hover:opacity-80 transition">
              Go Messenger {showMenu ? "←" : "▼"}
            </span>
            <button onClick={() => onNavigate("login")} className="text-sm opacity-70">Выход</button>
          </div>
          
          {showMenu && (
            <div className="p-3 border-b border-white/20 bg-white/5">
              <div className="space-y-2">
                <input 
                  className="w-full p-2 rounded-lg bg-white/10 border border-white/20 outline-none text-sm"
                  placeholder="Ник пользователя" 
                  value={inviteNick} 
                  onChange={(e) => setInviteNick(e.target.value)} 
                />
                <button onClick={handleCreateRoom} className="w-full p-2 bg-indigo-500 font-bold rounded-lg hover:bg-indigo-600 transition text-sm">
                  ➕ Создать комнату
                </button>
                <input 
                  className="w-full p-2 rounded-lg bg-white/10 border border-white/20 outline-none text-sm"
                  placeholder="Код комнаты" 
                  value={joinCode} 
                  onChange={(e) => setJoinCode(e.target.value)} 
                />
                <button onClick={handleJoinRoom} className="w-full p-2 bg-pink-500 font-bold rounded-lg hover:bg-pink-600 transition text-sm">
                  🔑 Вступить по коду
                </button>
              </div>
            </div>
          )}
          
          <div className="flex-1 overflow-y-auto p-2 custom-scroll">
            {rooms.length === 0 && !showMenu && <div className="p-4 text-center opacity-50">Нет чатов</div>}
            {rooms.map((chat) => (
              <div key={chat.id} onClick={() => setActiveChat(chat.id)}
                className={`p-3 rounded-xl cursor-pointer mb-1 transition relative ${activeChat === chat.id ? "bg-white/20" : "hover:bg-white/10"}`}>
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="font-medium">{chat.displayName}</div>
                    <div className="text-[8px] opacity-40 mt-0.5">код: {chat.code}</div>
                  </div>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingRoom(chat);
                      setNewRoomName(chat.displayName);
                    }}
                    className="opacity-50 hover:opacity-100 transition text-xs ml-2"
                  >
                    ⚙️
                  </button>
                </div>
                {unreadCounts[chat.id] > 0 && activeChat !== chat.id && (
                  <div className="absolute top-2 right-2 bg-red-500 rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold">
                    {unreadCounts[chat.id] > 9 ? "9+" : unreadCounts[chat.id]}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {editingRoom && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-gray-900 border border-indigo-500/50 rounded-2xl p-6 w-96 shadow-2xl">
              <h3 className="text-xl font-bold mb-4">Переименовать чат</h3>
              <input 
                className="w-full mb-4 p-3 rounded-xl bg-white/10 border border-white/20 outline-none"
                value={newRoomName} 
                onChange={(e) => setNewRoomName(e.target.value)}
                placeholder="Название чата"
                autoFocus
              />
              <div className="flex gap-3">
                <button 
                  onClick={() => setEditingRoom(null)}
                  className="flex-1 p-3 bg-white/10 rounded-xl hover:bg-red-500/50 transition"
                >
                  Отмена
                </button>
                <button 
                  onClick={handleRenameRoom}
                  className="flex-1 p-3 bg-indigo-500 font-bold rounded-xl hover:bg-indigo-600 transition"
                >
                  Сохранить
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Основная область чата */}
        <div className="flex-1 flex flex-col h-full">
          {!activeChat ? (
            <div className="flex-1 flex items-center justify-center bg-black/10">
              <div className="text-center">
                <p className="text-lg opacity-70">Выберите чат из списка</p>
                <p className="text-sm opacity-50 mt-2">или нажмите Go Messenger чтобы создать новый</p>
              </div>
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-white/20 backdrop-blur-xl bg-white/5 flex justify-between items-center flex-shrink-0">
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <b className="text-lg">{currentRoom?.displayName}</b>
                    <button 
                      onClick={() => {
                        setEditingRoom(currentRoom);
                        setNewRoomName(currentRoom?.displayName || "");
                      }}
                      className="opacity-50 hover:opacity-100 transition text-xs"
                    >
                      ✏️
                    </button>
                  </div>
                  <div className="text-[10px] opacity-50 mt-0.5">код: {currentRoomCode}</div>
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => handleDeleteRoom(activeChat, "me")} className="text-[10px] uppercase bg-white/10 px-2 py-1 rounded hover:bg-orange-500">Покинуть</button>
                    <button onClick={() => handleDeleteRoom(activeChat, "all")} className="text-[10px] uppercase bg-white/10 px-2 py-1 rounded hover:bg-red-500">Удалить чат</button>
                  </div>
                </div>
                <span className="text-sm opacity-70">🔒 E2EE Активно</span>
              </div>

              <div 
                ref={messagesContainerRef}
                className="flex-1 overflow-y-auto p-4 bg-black/10 flex flex-col space-y-3 custom-scroll"
              >
                {uploading && (
                  <div className="flex justify-center">
                    <div className="bg-white/20 px-4 py-2 rounded-full text-sm">
                      📤 Загрузка файла...
                    </div>
                  </div>
                )}
                {messages.map((m, i) => (
                  <div 
                    key={i} 
                    className={`flex flex-col ${m.isMe ? "items-end" : "items-start"}`}
                    onContextMenu={(e) => handleContextMenu(e, m)}
                  >
                    <span className="text-sm font-semibold opacity-80 mb-1 px-2">{m.sender}</span>
                    <div className={`max-w-[70%] px-4 py-2 rounded-2xl ${m.isMe ? "bg-indigo-500" : "bg-white/20"} cursor-context-menu`}>
                      {renderMessageContent(m)}
                      <div className="text-[9px] opacity-50 text-right mt-1">
                        {m.created_at || "—"}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Поле ввода со скрепкой */}
              <div className="p-4 bg-white/5 backdrop-blur-xl border-t border-white/20 flex gap-3 flex-shrink-0 items-center">
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="opacity-70 hover:opacity-100 transition text-2xl bg-white/10 p-2 rounded-full w-10 h-10 flex items-center justify-center flex-shrink-0"
                  disabled={uploading}
                  title="Прикрепить файл (изображение или PDF до 5МБ)"
                >
                  📎
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <input 
                  className="flex-1 p-3 rounded-xl bg-white/10 border border-white/20 outline-none"
                  value={input} 
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()} 
                  placeholder="Ваше сообщение..." 
                />
                <button 
                  onClick={send} 
                  className="px-6 py-3 bg-white text-indigo-600 font-bold rounded-xl hover:bg-indigo-100 transition"
                >
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
              <button 
                onClick={() => handleDeleteMessage(contextMenu.message, false)}
                className="block w-full px-4 py-2 text-left text-gray-300 hover:bg-gray-700 transition text-sm"
              >
                ❌ Удалить только у себя
              </button>
              <button 
                onClick={() => handleDeleteMessage(contextMenu.message, true)}
                className="block w-full px-4 py-2 text-left text-red-400 hover:bg-red-500/20 transition text-sm"
              >
                🗑 Удалить для всех
              </button>
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

      <style jsx>{`
        .custom-scroll::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scroll::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scroll::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.3);
          border-radius: 10px;
        }
        .custom-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.5);
        }
      `}</style>
    </div>
  );
}