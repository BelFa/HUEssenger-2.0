import { useState } from "react";

export default function LoginPage({ onLoginSuccess, onNavigate }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleLogin = async () => {
    setError("");
    try {
      const response = await fetch("http://localhost:8080/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (response.ok) {
        const userData = await response.json();
        onLoginSuccess(userData); 
      } else {
        setError("Ошибка входа: проверьте данные");
      }
    } catch (err) {
      setError("Сервер недоступен");
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#1a1a1a', color: 'white', fontFamily: 'sans-serif' }}>
      <div style={{ background: '#2a2a2a', padding: '2rem', borderRadius: '12px', boxShadow: '0 4px 15px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', gap: '15px', width: '300px' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '10px' }}>Вход</h2>
        
        {error && <p style={{ color: '#ff4d4d', fontSize: '14px', textAlign: 'center', margin: 0 }}>{error}</p>}
        
        <input 
          style={{ padding: '10px', borderRadius: '6px', border: '1px solid #444', background: '#333', color: 'white' }} 
          placeholder="Никнейм" 
          value={username} 
          onChange={e => setUsername(e.target.value)} 
        />
        <input 
          style={{ padding: '10px', borderRadius: '6px', border: '1px solid #444', background: '#333', color: 'white' }} 
          type="password" 
          placeholder="Пароль" 
          value={password} 
          onChange={e => setPassword(e.target.value)} 
        />
        
        <button 
          style={{ padding: '10px', borderRadius: '6px', border: 'none', background: '#5d5fef', color: 'white', cursor: 'pointer', fontWeight: 'bold' }} 
          onClick={handleLogin}
        >
          Войти
        </button>
        
        <p 
          style={{ fontSize: '12px', textAlign: 'center', cursor: 'pointer', color: '#aaa', marginTop: '10px' }} 
          onClick={onNavigate}
        >
          Нет аккаунта? Зарегистрироваться
        </p>
      </div>
    </div>
  );
}