import { useState, useRef, useEffect } from "react";
import zhdun from "../assets/zhdun.png";

export default function ChatPage({ onNavigate, currentUser }) {
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  
  // Состояния Лобби
  const [inviteNick, setInviteNick] = useState("");
  const [joinCode, setJoinCode] = useState("");
  
  // Состояния заявок
  const [waitingApproval, setWaitingApproval] = useState(false);
  const [incomingRequest, setIncomingRequest] = useState(null);

  const [rooms, setRooms] = useState([]);

  const wsRef = useRef(null);
  const myNick = currentUser?.username || "Guest";

  // --- ЗАГРУЗКА СПИСКА КОМНАТ ---
  const fetchRooms = async () => {
  try {
    const response = await fetch(`http://localhost:8080/my-rooms?user_id=${currentUser.id}`);
    if (response.ok) {
      const data = await response.json();
      console.log("Комнаты загружены:", data);
      setRooms(data || []);
    } else {
      console.error("Ошибка загрузки комнат, статус:", response.status);
    }
  } catch (err) {
    console.error("Ошибка fetchRooms:", err);
  }
};

  // --- WEBSOCKET ---
  useEffect(() => {
    if (!currentUser?.id) return;

    fetchRooms();

    const wsUrl = `ws://localhost:8080/ws?user_id=${currentUser.id}&nick=${encodeURIComponent(myNick)}`;
    console.log("🔌 Подключаем WebSocket:", wsUrl);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => console.log("✅ WebSocket подключён успешно");
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log("📨 Получено:", data);

      if (data.type === "incoming_request" || data.type === "incoming_invite") {
        setIncomingRequest({
          type: data.type === "incoming_invite" ? "invite" : "request",
          username: data.sender_nick || data.requester_nick,
          code: data.room_code || data.code,
          timeLeft: 30
        });
        fetchRooms();
      }

      if (data.type === "join_approved") {
        setWaitingApproval(false);
        fetchRooms();
        alert(`✅ Доступ разрешён в комнату: ${data.code}`);
      }

      if (data.type === "join_rejected") {
        setWaitingApproval(false);
        alert("❌ В доступе отказано");
      }
    };

    ws.onerror = (err) => console.error("❌ WebSocket ошибка:", err);
    ws.onclose = () => console.log("🔴 WebSocket закрыт");

    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, [currentUser?.id, myNick]);

  // --- СОЗДАНИЕ КОМНАТЫ ---
  const handleCreateRoom = async () => {
    const targetUser = inviteNick.trim();
    if (!targetUser) {
      alert("Введите ник пользователя");
      return;
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      alert("WebSocket не подключён. Перезайдите в аккаунт.");
      return;
    }

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
        wsRef.current.send(JSON.stringify({
          type: "invite",
          target_nick: targetUser,
          code: generatedCode
        }));

        alert(`✅ Комната создана!\nКод: ${generatedCode}`);
        setInviteNick("");
        fetchRooms();
      } else {
        alert("Не удалось создать комнату");
      }
    } catch (err) {
      console.error(err);
      alert("Ошибка соединения");
    }
  };

  const handleJoinRoom = () => {
    if (!joinCode.trim() || !wsRef.current) return;
    
    wsRef.current.send(JSON.stringify({ type: "join_request", code: joinCode }));
    setWaitingApproval(true);
  };

  const handleApprove = (isApproved) => {
    if (!wsRef.current || !incomingRequest) return;

    wsRef.current.send(JSON.stringify({ 
      type: isApproved ? "approve_join" : "reject_join", 
      requester_nick: incomingRequest.username,
      code: incomingRequest.code 
    }));

    setIncomingRequest(null);
    setTimeout(fetchRooms, 500);
  };

  return (
    <div className="relative min-h-screen w-full flex overflow-hidden text-white font-sans">
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600" />

      <div className="relative flex w-full">
        {/* Sidebar */}
        <div className="w-72 bg-white/10 backdrop-blur-xl border-r border-white/20 flex flex-col">
          <div className="p-4 font-semibold text-lg border-b border-white/20 flex justify-between items-center" onClick={() => setActiveChat(null)}>
            HUEssenger
            <button onClick={() => onNavigate("login")} className="text-sm opacity-70 hover:opacity-100">Выход</button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {rooms.length === 0 && <div className="p-4 text-center opacity-50">Нет чатов</div>}
            {rooms.map((chat) => (
              <div 
                key={chat.id} 
                onClick={() => setActiveChat(chat.id)}
                className={`p-3 rounded-xl cursor-pointer mb-1 transition ${activeChat === chat.id ? "bg-white/20" : "hover:bg-white/10"}`}
              >
                {chat.name}
              </div>
            ))}
          </div>
        </div>

        {/* Main Area */}
        <div className="flex-1 flex flex-col relative">
          {!activeChat ? (
            <div className="flex-1 flex items-center justify-center bg-black/10">
              <div className="flex gap-8">
                {/* Создать комнату */}
                <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-6 w-80 shadow-2xl">
                  <h3 className="text-xl font-bold mb-4">Создать комнату</h3>
                  <input
                    className="w-full mb-4 p-3 rounded-xl bg-white/10 border border-white/20 outline-none"
                    placeholder="Ник приглашённого"
                    value={inviteNick}
                    onChange={(e) => setInviteNick(e.target.value)}
                  />
                  <button 
                    onClick={handleCreateRoom} 
                    className="w-full p-3 bg-indigo-500 font-bold rounded-xl hover:bg-indigo-600 transition"
                  >
                    Пригласить
                  </button>
                </div>

                {/* Подключиться */}
                <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-6 w-80 shadow-2xl">
                  <h3 className="text-xl font-bold mb-4">Подключиться</h3>
                  <input
                    className="w-full mb-4 p-3 rounded-xl bg-white/10 border border-white/20 outline-none"
                    placeholder="Код комнаты"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                  />
                  <button 
                    onClick={handleJoinRoom} 
                    className="w-full p-3 bg-pink-500 font-bold rounded-xl hover:bg-pink-600 transition"
                  >
                    Подключиться
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div>Чат с room {activeChat} (в разработке)</div>
          )}
        </div>
      </div>

      {/* Модалки */}
      {waitingApproval && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 p-8 rounded-3xl text-center">
            <img src={zhdun} alt="waiting" className="w-32 mx-auto mb-4 animate-pulse" />
            <h3>Ожидание ответа...</h3>
          </div>
        </div>
      )}

      {incomingRequest && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 p-8 rounded-3xl text-center w-80">
            <h3 className="text-xl font-bold mb-4">Новое приглашение</h3>
            <p>От: <b>{incomingRequest.username}</b></p>
            <p>Код: <b>{incomingRequest.code}</b></p>
            <div className="flex gap-3 mt-6">
              <button onClick={() => handleApprove(false)} className="flex-1 py-3 bg-red-500/30 rounded-xl">Отклонить</button>
              <button onClick={() => handleApprove(true)} className="flex-1 py-3 bg-indigo-500 rounded-xl">Принять</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}