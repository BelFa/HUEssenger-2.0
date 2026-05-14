import { useState, useRef, useEffect } from "react";

export default function RegisterPage({ onRegisterSuccess, onNavigate }) {
  const [step, setStep] = useState(1);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [codeDigits, setCodeDigits] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [currentTime, setCurrentTime] = useState("");

  const inputRefs = useRef([]);

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
    <div style={styles.desktop}>
      <div style={styles.noise}></div>
      
      <div style={styles.window}>
        <div style={styles.titleBar}>
          <div style={styles.titleBarText}>
            <span style={styles.titleIcon}>📟</span>
            Регистрация
          </div>
          <div style={styles.titleBarButtons}>
            <button style={styles.titleButton}>?</button>
            <button style={styles.titleButton}>✕</button>
          </div>
        </div>

        <div style={styles.windowContent}>
          {step === 1 ? (
            <form onSubmit={handleRegister}>
              <div style={styles.fieldGroup}>
                <div style={styles.fieldRow}>
                  <label style={styles.label}>👤 Никнейм:</label>
                  <input
                    type="text"
                    style={styles.input}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                </div>
                <div style={styles.fieldRow}>
                  <label style={styles.label}>📧 Электронная почта:</label>
                  <input
                    type="email"
                    style={styles.input}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div style={styles.fieldRow}>
                  <label style={styles.label}>🔒 Пароль:</label>
                  <input
                    type="password"
                    style={styles.input}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <div style={styles.fieldRow}>
                  <label style={styles.label}>🔒 Повторите пароль:</label>
                  <input
                    type="password"
                    style={styles.input}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
              </div>

              {error && (
                <div style={styles.errorBox}>
                  <span style={styles.errorIcon}>⚠️</span>
                  <span>{error}</span>
                </div>
              )}

              {successMessage && (
                <div style={styles.successBox}>
                  <span style={styles.successIcon}>✓</span>
                  <span>{successMessage}</span>
                </div>
              )}

              <div style={styles.buttonRow}>
                <button 
                  type="button" 
                  style={styles.button}
                  onClick={() => onNavigate("login")}
                >
                  Отмена
                </button>
                <button 
                  type="submit" 
                  style={styles.button}
                  disabled={loading}
                >
                  {loading ? "Отправка..." : "Получить код →"}
                </button>
              </div>
            </form>
          ) : (
            <div>
              <div style={styles.infoBox}>
                <span style={styles.infoIcon}>📨</span>
                <span>Код подтверждения отправлен на <b>{email}</b></span>
              </div>

              <div style={styles.codeGroup}>
                <label style={styles.label}>Введите 6-значный код:</label>
                <div style={styles.codeInputs}>
                  {codeDigits.map((digit, index) => (
                    <input
                      key={index}
                      ref={el => inputRefs.current[index] = el}
                      type="text"
                      maxLength="1"
                      value={digit}
                      onChange={(e) => handleCodeChange(index, e.target.value)}
                      style={styles.codeInput}
                    />
                  ))}
                </div>
              </div>

              {error && (
                <div style={styles.errorBox}>
                  <span style={styles.errorIcon}>⚠️</span>
                  <span>{error}</span>
                </div>
              )}

              <div style={styles.buttonRow}>
                <button 
                  style={styles.button}
                  onClick={() => setStep(1)}
                >
                  ← Назад
                </button>
                <button 
                  style={styles.button}
                  onClick={handleConfirmCode}
                  disabled={loading || codeDigits.join("").length !== 6}
                >
                  {loading ? "Проверка..." : "Подтвердить →"}
                </button>
              </div>
            </div>
          )}
        </div>

        <div style={styles.statusBar}>
          <span style={styles.statusText}>
            {step === 1 ? "Заполните форму регистрации" : "Введите код из письма"}
          </span>
          <span style={styles.statusTime}>{currentTime}</span>
        </div>
      </div>
    </div>
  );
}

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
  window: {
    position: 'relative',
    zIndex: 1,
    width: '450px',
    backgroundColor: '#c0c0c0',
    boxShadow: 'inset -1px -1px 0 #0a0a0a, inset 1px 1px 0 #dfdfdf, inset -2px -2px 0 #808080, inset 2px 2px 0 #ffffff',
    border: 'none',
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
    letterSpacing: '0.5px',
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
    background: '#c0c0c0',
  },
  windowContent: {
    padding: '20px',
  },
  fieldGroup: {
    marginBottom: '20px',
    padding: '10px',
    border: 'inset 2px #808080',
    background: '#c0c0c0',
  },
  fieldRow: {
    marginBottom: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  label: {
    width: '140px',
    fontSize: '12px',
    fontWeight: 'bold',
    color: '#000',
  },
  input: {
    flex: 1,
    padding: '4px 6px',
    backgroundColor: '#ffffff',
    border: 'inset 2px #808080',
    fontSize: '12px',
    fontFamily: '"Courier New", monospace',
    outline: 'none',
  },
  buttonRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    marginTop: '20px',
  },
  button: {
    padding: '6px 16px',
    backgroundColor: '#c0c0c0',
    border: 'none',
    fontSize: '12px',
    fontWeight: 'bold',
    fontFamily: 'inherit',
    cursor: 'pointer',
    boxShadow: 'inset -1px -1px 0 #0a0a0a, inset 1px 1px 0 #ffffff',
    color: '#000',
    minWidth: '90px',
  },
  errorBox: {
    backgroundColor: '#c0c0c0',
    border: 'inset 2px #808080',
    padding: '8px',
    marginBottom: '15px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    color: '#800000',
    fontWeight: 'bold',
  },
  successBox: {
    backgroundColor: '#c0c0c0',
    border: 'inset 2px #808080',
    padding: '8px',
    marginBottom: '15px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    color: '#006400',
    fontWeight: 'bold',
  },
  errorIcon: {
    fontSize: '14px',
  },
  successIcon: {
    fontSize: '14px',
  },
  infoBox: {
    backgroundColor: '#c0c0c0',
    border: 'inset 2px #808080',
    padding: '10px',
    marginBottom: '20px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '12px',
    color: '#000',
  },
  infoIcon: {
    fontSize: '18px',
  },
  codeGroup: {
    marginBottom: '20px',
  },
  codeInputs: {
    display: 'flex',
    gap: '8px',
    justifyContent: 'center',
    marginTop: '10px',
  },
  codeInput: {
    width: '45px',
    height: '45px',
    textAlign: 'center',
    fontSize: '24px',
    fontWeight: 'bold',
    backgroundColor: '#ffffff',
    border: 'inset 2px #808080',
    fontFamily: '"Courier New", monospace',
    outline: 'none',
  },
  statusBar: {
    background: '#c0c0c0',
    borderTop: 'inset 1px #808080',
    padding: '3px 6px',
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '11px',
    color: '#000',
    fontFamily: '"Microsoft Sans Serif", monospace',
  },
  statusText: {
    fontStyle: 'italic',
  },
  statusTime: {
    fontFamily: '"Courier New", monospace',
  },
};