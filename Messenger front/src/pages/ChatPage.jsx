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
  const [currentTime, setCurrentTime] = useState("");

  const wsRef = useRef(null);
  const activeChatRef = useRef(null);
  const roomsRef = useRef(rooms);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const fileInputRef = useRef(null);

  const myNick = currentUser?.username || "Guest";

  // Реальное время для статус-бара
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      setCurrentTime(timeStr);
    };
    updateTime();
    const interval = setInterval(updateTime, 60000);
    return () => clearInterval(interval);
  }, []);

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
          style={{ maxWidth: "200px", maxHeight: "200px", borderRadius: "4px", cursor: "pointer", border: "inset 2px #808080" }}
          onClick={() => window.open(`http://localhost:8080${msg.file_path}`, '_blank')}
        />
      );
    } else if (msg.message_type === "pdf" && msg.file_path) {
      return (
        <a 
          href={`http://localhost:8080${msg.file_path}`} 
          target="_blank" 
          rel="noopener noreferrer"
          style={{ color: "#0000FF", textDecoration: "underline", display: "flex", alignItems: "center", gap: "8px" }}
        >
          📄 PDF файл
        </a>
      );
    } else {
      return <div style={{ wordBreak: "break-word", whiteSpace: "pre-wrap" }}>{decryptedText}</div>;
    }
  };

  return (
    <div style={styles.desktop}>
      <div style={styles.noise}></div>
      
      <div style={styles.mainWindow}>
        <div style={styles.titleBar}>
          <div style={styles.titleBarText}>
            <span style={styles.titleIcon}>💬</span>
            HUEssenger - Защищённый мессенджер
          </div>
          <div style={styles.titleBarButtons}>
            <button style={styles.titleButton}>?</button>
            <button style={styles.titleButton} onClick={() => onNavigate("login")}>✕</button>
          </div>
        </div>

        <div style={styles.mainContent}>
          {/* Боковая панель */}
          <div style={styles.sidebar}>
            <div style={styles.sidebarHeader}>
              <span style={styles.sidebarTitle}>📁 Чаты</span>
              <button onClick={() => setShowMenu(!showMenu)} style={styles.sidebarButton}>
                {showMenu ? "←" : "▼"}
              </button>
            </div>
            
            {showMenu && (
              <div style={styles.menuPanel}>
                <input type="text" style={styles.menuInput} placeholder="Ник пользователя" value={inviteNick} onChange={(e) => setInviteNick(e.target.value)} />
                <button onClick={handleCreateRoom} style={styles.menuButton}>➕ Создать комнату</button>
                <input type="text" style={styles.menuInput} placeholder="Код комнаты" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} />
                <button onClick={handleJoinRoom} style={styles.menuButton}>🔑 Вступить по коду</button>
              </div>
            )}
            
            <div style={styles.chatList}>
              {rooms.length === 0 && !showMenu && <div style={styles.emptyChats}>Нет чатов</div>}
              {rooms.map((chat) => (
                <div key={chat.id} onClick={() => setActiveChat(chat.id)} style={{ ...styles.chatItem, ...(activeChat === chat.id ? styles.chatItemActive : {}) }}>
                  <div style={styles.chatItemContent}>
                    <div style={styles.chatName}>{chat.displayName}</div>
                    <div style={styles.chatCode}>код: {chat.code}</div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); setEditingRoom(chat); setNewRoomName(chat.displayName); }} style={styles.chatSettingsBtn}>⚙️</button>
                  {unreadCounts[chat.id] > 0 && activeChat !== chat.id && (
                    <div style={styles.unreadBadge}>{unreadCounts[chat.id] > 9 ? "9+" : unreadCounts[chat.id]}</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Область чата */}
          <div style={styles.chatArea}>
            {!activeChat ? (
              <div style={styles.noChatSelected}>
                <div style={styles.noChatIcon}>💬</div>
                <div>Выберите чат из списка</div>
                <div style={styles.noChatSubtext}>или нажмите ▼ чтобы создать новый</div>
              </div>
            ) : (
              <>
                <div style={styles.chatHeader}>
                  <div>
                    <div style={styles.chatHeaderTitle}>
                      <b>{currentRoom?.displayName}</b>
                      <button onClick={() => { setEditingRoom(currentRoom); setNewRoomName(currentRoom?.displayName || ""); }} style={styles.renameBtn}>✏️</button>
                    </div>
                    <div style={styles.chatHeaderCode}>код: {currentRoomCode}</div>
                    <div style={styles.chatHeaderActions}>
                      <button onClick={() => handleDeleteRoom(activeChat, "me")} style={styles.actionButton}>Покинуть</button>
                      <button onClick={() => handleDeleteRoom(activeChat, "all")} style={{...styles.actionButton, ...styles.dangerButton}}>Удалить чат</button>
                    </div>
                  </div>
                  <div style={styles.encryptionBadge}>🔒 E2EE</div>
                </div>

                <div ref={messagesContainerRef} style={styles.messagesArea}>
                  {uploading && <div style={styles.uploadingIndicator}>📤 Загрузка файла...</div>}
                  {messages.map((m, i) => (
                    <div key={i} style={{ ...styles.messageRow, ...(m.isMe ? styles.messageRowMe : styles.messageRowOther) }} onContextMenu={(e) => handleContextMenu(e, m)}>
                      <span style={styles.messageSender}>{m.sender}</span>
                      <div style={{ ...styles.messageBubble, ...(m.isMe ? styles.messageBubbleMe : styles.messageBubbleOther) }}>
                        {renderMessageContent(m)}
                        <div style={styles.messageTime}>{m.created_at || "—"}</div>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>

                <div style={styles.inputArea}>
                  <button onClick={() => fileInputRef.current?.click()} style={styles.attachButton} disabled={uploading} title="Прикрепить файл (изображение или PDF до 5МБ)">📎</button>
                  <input ref={fileInputRef} type="file" accept="image/*,application/pdf" onChange={handleFileSelect} style={{ display: "none" }} />
                  <input type="text" style={styles.messageInput} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Введите сообщение..." />
                  <button onClick={send} style={styles.sendButton}>Отправить →</button>
                </div>
              </>
            )}
          </div>
        </div>

        <div style={styles.statusBar}>
          <span style={styles.statusText}>{activeChat ? `Чат: ${currentRoom?.displayName}` : "Готов"}</span>
          <span style={styles.statusTime}>{currentTime}</span>
        </div>
      </div>

      {/* Модалки */}
      {editingRoom && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalWindow}>
            <div style={styles.modalTitleBar}><span>✏️ Переименовать чат</span><button onClick={() => setEditingRoom(null)} style={styles.modalCloseBtn}>✕</button></div>
            <div style={styles.modalContent}>
              <input type="text" style={styles.modalInput} value={newRoomName} onChange={(e) => setNewRoomName(e.target.value)} placeholder="Название чата" autoFocus />
              <div style={styles.modalButtons}>
                <button onClick={() => setEditingRoom(null)} style={styles.modalButton}>Отмена</button>
                <button onClick={handleRenameRoom} style={{...styles.modalButton, ...styles.modalButtonPrimary}}>Сохранить</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {contextMenu.visible && (
        <div style={{ ...styles.contextMenu, top: contextMenu.y, left: contextMenu.x }}>
          <button onClick={() => handleDeleteMessage(contextMenu.message, false)} style={styles.contextMenuItem}>❌ Удалить только у себя</button>
          <button onClick={() => handleDeleteMessage(contextMenu.message, true)} style={styles.contextMenuItem}>🗑 Удалить для всех</button>
        </div>
      )}

      {waitingApproval && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalWindow}>
            <div style={styles.modalTitleBar}><span>⏳ Ожидание ответа</span></div>
            <div style={{ ...styles.modalContent, textAlign: "center" }}>
              <img src={zhdun} alt="waiting" style={{ width: "80px", margin: "10px auto" }} />
              <h3>Ждем ответа...</h3>
              <button onClick={() => setWaitingApproval(false)} style={styles.modalButton}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {incomingRequest && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalWindow}>
            <div style={styles.modalTitleBar}><span>{incomingRequest.type === "invite" ? "📩 Вас пригласили!" : "🔔 Запрос на вход!"}</span></div>
            <div style={styles.modalContent}>
              <p>От: <b>{incomingRequest.username}</b></p>
              <div style={{ fontSize: "32px", fontFamily: "monospace", textAlign: "center", margin: "10px 0" }}>00:{incomingRequest.timeLeft.toString().padStart(2, '0')}</div>
              <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
                <button onClick={() => handleApprove(false)} style={{...styles.modalButton, flex: 1}}>Отклонить</button>
                <button onClick={() => handleApprove(true)} style={{...styles.modalButton, ...styles.modalButtonPrimary, flex: 1}}>Принять</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Стили Windows 95
const styles = {
  desktop: {
    position: 'relative',
    width: '100vw',
    height: '100vh',
    background: '#008080',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: '"Microsoft Sans Serif", "MS Sans Serif", "Segoe UI", Tahoma, sans-serif',
    overflow: 'hidden',
  },
  noise: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    backgroundImage: 'radial-gradient(rgba(0,0,0,0.1) 1px, transparent 1px)',
    backgroundSize: '4px 4px',
    pointerEvents: 'none',
    zIndex: 0,
  },
  mainWindow: {
    position: 'relative',
    zIndex: 1,
    width: '90vw',
    height: '85vh',
    backgroundColor: '#c0c0c0',
    boxShadow: 'inset -1px -1px 0 #0a0a0a, inset 1px 1px 0 #dfdfdf, inset -2px -2px 0 #808080, inset 2px 2px 0 #ffffff',
    border: 'none',
    display: 'flex',
    flexDirection: 'column',
  },
  titleBar: {
    background: '#000080',
    padding: '4px 6px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    color: 'white',
    fontWeight: 'bold',
    fontSize: '13px',
    flexShrink: 0,
  },
  titleBarText: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  titleIcon: {
    fontSize: '14px',
  },
  titleBarButtons: {
    display: 'flex',
    gap: '2px',
  },
  titleButton: {
    width: '18px',
    height: '18px',
    backgroundColor: '#c0c0c0',
    border: 'none',
    fontSize: '11px',
    fontWeight: 'bold',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: 'inset -1px -1px 0 #0a0a0a, inset 1px 1px 0 #ffffff',
    color: '#000',
  },
  mainContent: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
    padding: '4px',
    gap: '4px',
  },
  sidebar: {
    width: '260px',
    backgroundColor: '#c0c0c0',
    border: 'inset 2px #808080',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    flexShrink: 0,
  },
  sidebarHeader: {
    padding: '8px',
    backgroundColor: '#c0c0c0',
    borderBottom: 'outset 1px #ffffff',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontWeight: 'bold',
    fontSize: '12px',
  },
  sidebarTitle: {
    color: '#000',
  },
  sidebarButton: {
    backgroundColor: '#c0c0c0',
    border: 'none',
    fontSize: '12px',
    cursor: 'pointer',
    boxShadow: 'inset -1px -1px 0 #0a0a0a, inset 1px 1px 0 #ffffff',
    padding: '2px 6px',
  },
  menuPanel: {
    padding: '8px',
    borderBottom: 'inset 1px #808080',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  menuInput: {
    padding: '4px 6px',
    backgroundColor: '#ffffff',
    border: 'inset 2px #808080',
    fontSize: '11px',
    fontFamily: '"Courier New", monospace',
    outline: 'none',
  },
  menuButton: {
    padding: '4px',
    backgroundColor: '#c0c0c0',
    border: 'none',
    fontSize: '11px',
    cursor: 'pointer',
    boxShadow: 'inset -1px -1px 0 #0a0a0a, inset 1px 1px 0 #ffffff',
    textAlign: 'center',
  },
  chatList: {
    flex: 1,
    overflowY: 'auto',
    padding: '4px',
  },
  emptyChats: {
    textAlign: 'center',
    color: '#808080',
    padding: '20px',
    fontSize: '11px',
  },
  chatItem: {
    padding: '8px',
    marginBottom: '2px',
    cursor: 'pointer',
    border: 'outset 1px #ffffff',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    position: 'relative',
  },
  chatItemActive: {
    background: '#000080',
    border: 'inset 1px #808080',
    color: 'white',
  },
  chatItemContent: {
    flex: 1,
  },
  chatName: {
    fontSize: '12px',
    fontWeight: 'bold',
    color: 'inherit',
  },
  chatCode: {
    fontSize: '9px',
    color: 'inherit',
    opacity: 0.7,
    marginTop: '2px',
  },
  chatSettingsBtn: {
    backgroundColor: '#c0c0c0',
    border: 'none',
    fontSize: '11px',
    cursor: 'pointer',
    boxShadow: 'inset -1px -1px 0 #0a0a0a, inset 1px 1px 0 #ffffff',
    padding: '2px 4px',
    marginRight: '4px',
  },
  unreadBadge: {
    position: 'absolute',
    top: '4px',
    right: '4px',
    backgroundColor: '#ff0000',
    color: 'white',
    borderRadius: '12px',
    padding: '2px 6px',
    fontSize: '10px',
    fontWeight: 'bold',
    minWidth: '18px',
    textAlign: 'center',
  },
  chatArea: {
    flex: 1,
    backgroundColor: '#c0c0c0',
    border: 'inset 2px #808080',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  noChatSelected: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#808080',
    fontSize: '14px',
  },
  noChatIcon: {
    fontSize: '48px',
    marginBottom: '16px',
  },
  noChatSubtext: {
    fontSize: '11px',
    marginTop: '8px',
  },
  chatHeader: {
    padding: '8px 12px',
    backgroundColor: '#c0c0c0',
    borderBottom: 'outset 2px #ffffff',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexShrink: 0,
  },
  chatHeaderTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#000',
  },
  renameBtn: {
    backgroundColor: '#c0c0c0',
    border: 'none',
    fontSize: '11px',
    cursor: 'pointer',
    boxShadow: 'inset -1px -1px 0 #0a0a0a, inset 1px 1px 0 #ffffff',
    padding: '2px 6px',
  },
  chatHeaderCode: {
    fontSize: '9px',
    color: '#808080',
    marginTop: '4px',
  },
  chatHeaderActions: {
    display: 'flex',
    gap: '8px',
    marginTop: '8px',
  },
  actionButton: {
    padding: '2px 8px',
    backgroundColor: '#c0c0c0',
    border: 'none',
    fontSize: '9px',
    cursor: 'pointer',
    boxShadow: 'inset -1px -1px 0 #0a0a0a, inset 1px 1px 0 #ffffff',
    textTransform: 'uppercase',
  },
  dangerButton: {
    color: '#800000',
  },
  encryptionBadge: {
    fontSize: '11px',
    color: '#008080',
    backgroundColor: '#e0e0e0',
    padding: '2px 6px',
    border: 'inset 1px #808080',
  },
  messagesArea: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    backgroundColor: '#ffffff',
  },
  uploadingIndicator: {
    textAlign: 'center',
    padding: '8px',
    backgroundColor: '#c0c0c0',
    border: 'inset 1px #808080',
    fontSize: '11px',
    marginBottom: '8px',
  },
  messageRow: {
    display: 'flex',
    flexDirection: 'column',
    maxWidth: '70%',
  },
  messageRowMe: {
    alignSelf: 'flex-end',
  },
  messageRowOther: {
    alignSelf: 'flex-start',
  },
  messageSender: {
    fontSize: '10px',
    color: '#808080',
    marginBottom: '2px',
    paddingLeft: '4px',
  },
  messageBubble: {
    padding: '8px 12px',
    border: 'outset 2px #ffffff',
    position: 'relative',
  },
  messageBubbleMe: {
    backgroundColor: '#c0c0c0',
  },
  messageBubbleOther: {
    backgroundColor: '#e0e0e0',
  },
  messageTime: {
    fontSize: '8px',
    color: '#808080',
    textAlign: 'right',
    marginTop: '4px',
  },
  inputArea: {
    padding: '8px',
    backgroundColor: '#c0c0c0',
    borderTop: 'outset 2px #ffffff',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexShrink: 0,
  },
  attachButton: {
    width: '32px',
    height: '32px',
    backgroundColor: '#c0c0c0',
    border: 'none',
    fontSize: '18px',
    cursor: 'pointer',
    boxShadow: 'inset -1px -1px 0 #0a0a0a, inset 1px 1px 0 #ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageInput: {
    flex: 1,
    padding: '6px 8px',
    backgroundColor: '#ffffff',
    border: 'inset 2px #808080',
    fontSize: '12px',
    fontFamily: '"Courier New", monospace',
    outline: 'none',
  },
  sendButton: {
    padding: '6px 16px',
    backgroundColor: '#c0c0c0',
    border: 'none',
    fontSize: '12px',
    fontWeight: 'bold',
    cursor: 'pointer',
    boxShadow: 'inset -1px -1px 0 #0a0a0a, inset 1px 1px 0 #ffffff',
  },
  statusBar: {
    background: '#c0c0c0',
    borderTop: 'inset 1px #808080',
    padding: '3px 6px',
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '11px',
    color: '#000',
    flexShrink: 0,
  },
  statusText: {
    fontStyle: 'italic',
  },
  statusTime: {
    fontFamily: '"Courier New", monospace',
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modalWindow: {
    width: '350px',
    backgroundColor: '#c0c0c0',
    boxShadow: 'inset -1px -1px 0 #0a0a0a, inset 1px 1px 0 #dfdfdf, inset -2px -2px 0 #808080, inset 2px 2px 0 #ffffff',
  },
  modalTitleBar: {
    background: '#000080',
    padding: '6px 8px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    color: 'white',
    fontWeight: 'bold',
    fontSize: '12px',
  },
  modalCloseBtn: {
    width: '18px',
    height: '18px',
    backgroundColor: '#c0c0c0',
    border: 'none',
    fontSize: '11px',
    cursor: 'pointer',
    boxShadow: 'inset -1px -1px 0 #0a0a0a, inset 1px 1px 0 #ffffff',
    color: '#000',
  },
  modalContent: {
    padding: '16px',
  },
  modalInput: {
    width: '100%',
    padding: '6px 8px',
    backgroundColor: '#ffffff',
    border: 'inset 2px #808080',
    fontSize: '12px',
    fontFamily: '"Courier New", monospace',
    outline: 'none',
    marginBottom: '16px',
    boxSizing: 'border-box',
  },
  modalButtons: {
    display: 'flex',
    gap: '10px',
    justifyContent: 'flex-end',
  },
  modalButton: {
    padding: '4px 12px',
    backgroundColor: '#c0c0c0',
    border: 'none',
    fontSize: '11px',
    cursor: 'pointer',
    boxShadow: 'inset -1px -1px 0 #0a0a0a, inset 1px 1px 0 #ffffff',
  },
  modalButtonPrimary: {
    fontWeight: 'bold',
    color: '#000080',
  },
  contextMenu: {
    position: 'fixed',
    backgroundColor: '#c0c0c0',
    boxShadow: 'inset -1px -1px 0 #0a0a0a, inset 1px 1px 0 #ffffff',
    zIndex: 1001,
    minWidth: '160px',
  },
  contextMenuItem: {
    display: 'block',
    width: '100%',
    padding: '6px 12px',
    backgroundColor: '#c0c0c0',
    border: 'none',
    fontSize: '11px',
    textAlign: 'left',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};