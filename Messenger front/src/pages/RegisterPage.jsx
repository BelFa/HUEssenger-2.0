import { useState, useRef, useEffect } from "react";

export default function RegisterPage({ onRegisterSuccess, onNavigate }) {
  const [step, setStep] = useState(1);

  // Шаг 1
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Шаг 2
  const [codeDigits, setCodeDigits] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const inputRefs = useRef([]);

  useEffect(() => {
    if (step === 2 && inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, [step]);

  const handleRegister = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (password !== confirmPassword) {
      setError("Пароли не совпадают");
      setLoading(false);
      return;
    }
    if (password.length < 6) {
      setError("Пароль должен содержать минимум 6 символов");
      setLoading(false);
      return;
    }

    try {
      const response = await fetch("http://localhost:8080/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password }),
      });

      const data = await response.json();

      if (response.ok && data.status === "code_sent") {
        setSuccessMessage("Код подтверждения отправлен на вашу почту!");
        setStep(2);
      } else {
        setError(data.message || "Ошибка при отправке кода");
      }
    } catch (err) {
      setError("Не удалось подключиться к серверу");
    } finally {
      setLoading(false);
    }
  };

  const handleCodeChange = (index, value) => {
    if (value.length > 1) return;
    const newDigits = [...codeDigits];
    newDigits[index] = value;
    setCodeDigits(newDigits);

    if (value !== "" && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleConfirmCode = async () => {
    const code = codeDigits.join("");
    if (code.length !== 6) return;

    setLoading(true);
    setError("");

    try {
      const response = await fetch("http://localhost:8080/confirm-registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, code }),
      });

      const data = await response.json();

      if (response.ok) {
        onRegisterSuccess(data);
      } else {
        setError(data.message || "Неверный код подтверждения");
        setCodeDigits(["", "", "", "", "", ""]);
      }
    } catch (err) {
      setError("Ошибка сервера");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: '#1a1a1a',
      color: 'white',
      fontFamily: 'sans-serif'
    }}>
      <div style={{
        background: '#2a2a2a',
        padding: '2.5rem 2rem',
        borderRadius: '16px',
        boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
        width: '380px'
      }}>
        <h2 style={{ textAlign: 'center', marginBottom: '20px' }}>
          {step === 1 ? "Регистрация" : "Подтверждение email"}
        </h2>

        {error && (
          <div style={{
            color: '#ff6b6b',
            background: 'rgba(255,107,107,0.15)',
            padding: '12px',
            borderRadius: '8px',
            marginBottom: '15px',
            textAlign: 'center'
          }}>
            {error}
          </div>
        )}

        {successMessage && (
          <div style={{
            color: '#4ade80',
            background: 'rgba(74,222,128,0.15)',
            padding: '12px',
            borderRadius: '8px',
            marginBottom: '15px',
            textAlign: 'center'
          }}>
            {successMessage}
          </div>
        )}

        {step === 1 && (
          <form onSubmit={handleRegister}>
            <input style={inputStyle} placeholder="Никнейм" value={username} onChange={(e) => setUsername(e.target.value)} required />
            <input style={inputStyle} type="email" placeholder="Электронная почта" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input style={inputStyle} type="password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <input style={inputStyle} type="password" placeholder="Повторите пароль" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />

            <button style={buttonStyle} type="submit" disabled={loading}>
              {loading ? "Отправка..." : "Получить код"}
            </button>
          </form>
        )}

        {step === 2 && (
          <div>
            <p style={{ textAlign: 'center', marginBottom: '20px', opacity: 0.8 }}>
              Код отправлен на <b>{email}</b>
            </p>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', margin: '20px 0' }}>
              {codeDigits.map((digit, index) => (
                <input
                  key={index}
                  ref={el => inputRefs.current[index] = el}
                  type="text"
                  maxLength="1"
                  value={digit}
                  onChange={(e) => handleCodeChange(index, e.target.value)}
                  style={codeInputStyle}
                />
              ))}
            </div>

            <button style={buttonStyle} onClick={handleConfirmCode} disabled={loading || codeDigits.join("").length !== 6}>
              {loading ? "Проверка..." : "Подтвердить"}
            </button>

            <button 
              style={{ marginTop: '15px', background: 'transparent', color: '#aaa', border: 'none', cursor: 'pointer' }}
              onClick={() => setStep(1)}
            >
              ← Изменить данные
            </button>
          </div>
        )}

        <p 
          style={{ textAlign: 'center', marginTop: '20px', cursor: 'pointer', color: '#aaa' }}
          onClick={() => onNavigate("login")}
        >
          Уже есть аккаунт? <b>Войти</b>
        </p>
      </div>
    </div>
  );
}

// Стили
const inputStyle = {
  padding: "14px",
  borderRadius: "8px",
  border: "1px solid #444",
  background: "#333",
  color: "white",
  outline: "none",
  fontSize: "16px",
  width: "100%",
  marginBottom: "12px"
};

const buttonStyle = {
  padding: "14px",
  borderRadius: "8px",
  border: "none",
  background: "#5d5fef",
  color: "white",
  fontWeight: "bold",
  fontSize: "16px",
  width: "100%",
  cursor: "pointer",
  marginTop: "10px"
};

const codeInputStyle = {
  width: "48px",
  height: "58px",
  textAlign: "center",
  fontSize: "28px",
  fontWeight: "bold",
  border: "2px solid #555",
  borderRadius: "10px",
  background: "#222",
  color: "white",
};