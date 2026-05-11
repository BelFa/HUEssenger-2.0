import { useState } from "react";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ChatPage from "./pages/ChatPage";

export default function App() {
  // Храним данные авторизованного пользователя
  const [user, setUser] = useState(null);
  // Храним текущую страницу ("login", "register", "chat")
  const [page, setPage] = useState("login");

  // Если пользователь успешно вошел или зарегистрировался
  const handleAuthSuccess = (userData) => {
    setUser(userData);
    setPage("chat");
  };

  // Простая навигация
  if (page === "login") {
    return (
      <LoginPage 
        onLoginSuccess={handleAuthSuccess} 
        onNavigate={() => setPage("register")} 
      />
    );
  }

  if (page === "register") {
    return (
      <RegisterPage 
        onRegisterSuccess={handleAuthSuccess} 
        onNavigate={() => setPage("login")} 
      />
    );
  }

  if (page === "chat" && user) {
    return <ChatPage currentUser={user} />;
  }

  return <LoginPage onLoginSuccess={handleAuthSuccess} />;
}