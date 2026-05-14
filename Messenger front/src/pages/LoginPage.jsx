import { useState, useEffect } from "react";

export default function LoginPage({ onLoginSuccess, onNavigate }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [currentTime, setCurrentTime] = useState("");

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      setCurrentTime(timeStr);
    };
    updateTime();
    const interval = setInterval(updateTime, 60000); // Обновляем каждую минуту
    return () => clearInterval(interval);
  }, []);

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

  const handleReset = () => {
    setUsername("");
    setPassword("");
    setError("");
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleLogin();
    }
  };

  return (
    <div style={styles.desktop}>
      <div style={styles.noise}></div>
      
      <div style={styles.window}>
        <div style={styles.titleBar}>
          <div style={styles.titleBarText}>
            <span style={styles.titleIcon}>🔑</span>
            Вход в систему
          </div>
          <div style={styles.titleBarButtons}>
            <button style={styles.titleButton}>?</button>
            <button style={styles.titleButton}>✕</button>
          </div>
        </div>

        <div style={styles.windowContent}>
          <div style={styles.welcomeBox}>
            <div style={styles.computerIcon}>🖥️</div>
            <div style={styles.welcomeText}>
              <div style={styles.welcomeTitle}>Добро пожаловать!</div>
              <div style={styles.welcomeSubtitle}>Введите ваши учётные данные</div>
            </div>
          </div>

          <div style={styles.fieldGroup}>
            <div style={styles.fieldRow}>
              <label style={styles.label}>👤 Имя пользователя:</label>
              <input
                type="text"
                style={styles.input}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Введите никнейм"
              />
            </div>
            <div style={styles.fieldRow}>
              <label style={styles.label}>🔒 Пароль:</label>
              <input
                type="password"
                style={styles.input}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Введите пароль"
              />
            </div>
          </div>

          {error && (
            <div style={styles.errorBox}>
              <span style={styles.errorIcon}>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <div style={styles.checkboxRow}>
            <input type="checkbox" id="remember" style={styles.checkbox} />
            <label htmlFor="remember" style={styles.checkboxLabel}>Запомнить меня</label>
          </div>

          <div style={styles.buttonRow}>
            <button 
              type="button" 
              style={styles.button}
              onClick={handleReset}
            >
              Сброс
            </button>
            <button 
              type="button" 
              style={styles.button}
              onClick={handleLogin}
            >
              Вход →
            </button>
          </div>

          <div style={styles.registerLink}>
            <hr style={styles.divider} />
            <button 
              style={styles.linkButton}
              onClick={onNavigate}
            >
              📝 Нет аккаунта? Зарегистрироваться
            </button>
          </div>
        </div>

        <div style={styles.statusBar}>
          <span style={styles.statusText}>
            Введите имя пользователя и пароль
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
    width: '420px',
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
  welcomeBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
    marginBottom: '20px',
    padding: '10px',
    background: '#c0c0c0',
    border: 'outset 2px #ffffff',
  },
  computerIcon: {
    fontSize: '48px',
  },
  welcomeText: {
    flex: 1,
  },
  welcomeTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#000',
    marginBottom: '4px',
  },
  welcomeSubtitle: {
    fontSize: '11px',
    color: '#000',
    fontStyle: 'italic',
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
    width: '130px',
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
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '20px',
    paddingLeft: '5px',
  },
  checkbox: {
    width: '14px',
    height: '14px',
    margin: 0,
    cursor: 'pointer',
  },
  checkboxLabel: {
    fontSize: '11px',
    color: '#000',
    cursor: 'pointer',
  },
  buttonRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    marginBottom: '20px',
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
    minWidth: '80px',
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
  errorIcon: {
    fontSize: '14px',
  },
  registerLink: {
    marginTop: '10px',
  },
  divider: {
    border: 'none',
    borderTop: 'outset 1px #ffffff',
    borderBottom: 'inset 1px #808080',
    margin: '10px 0',
  },
  linkButton: {
    width: '100%',
    padding: '6px',
    backgroundColor: '#c0c0c0',
    border: 'none',
    fontSize: '11px',
    fontFamily: 'inherit',
    cursor: 'pointer',
    boxShadow: 'inset -1px -1px 0 #0a0a0a, inset 1px 1px 0 #ffffff',
    color: '#000',
    textAlign: 'center',
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