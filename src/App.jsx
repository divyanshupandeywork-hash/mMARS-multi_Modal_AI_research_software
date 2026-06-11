import React, { useState, useEffect, useRef } from 'react';
import {
  Bot, User, UploadCloud, Trash2, FileText, Music,
  Image as ImageIcon, Database, Settings, Send, FolderOpen,
  HelpCircle, CheckCircle, AlertCircle, Loader, FileCode,
  Sun, Moon
} from 'lucide-react';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

// Supported format extensions list
const SUPPORTED_FORMATS = [
  'pdf', 'docx', 'xlsx', 'xls', 'csv', 'txt', 'py', 'js', 'java', 'c', 'cpp',
  'rs', 'xml', 'md', 'zip', 'db', 'sqlite', 'sql', 'wav', 'mp3', 'm4a',
  'jpg', 'jpeg', 'png', 'webp', 'bmp'
];

export default function App() {
  // Config & API States
  const [modelName, setModelName] = useState('gemini-2.0-flash');
  const [temperature, setTemperature] = useState(0.3);
  const [systemInstruction, setSystemInstruction] = useState(
    'You are mMARS, a helpful Multi-modal AI Research Assistant. Answer questions based on the uploaded file contexts and media provided.'
  );

  // App workspace states
  const [files, setFiles] = useState([]);
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'files' | 'formats'
  const [chatHistory, setChatHistory] = useState([]); // Array of { role: 'user'|'model', content: string }
  const [inputValue, setInputValue] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState({ type: '', text: '' }); // 'success' | 'error' | ''
  const [retryCountdown, setRetryCountdown] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');

  // Auth & Session States
  const [token, setToken] = useState(() => localStorage.getItem('token') || '');
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null');
    } catch {
      return null;
    }
  });
  const [chatSessions, setChatSessions] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);

  // Auth Form States
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register'
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const chatEndRef = useRef(null);

  // Apply theme to document body
  useEffect(() => {
    if (theme === 'light') {
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.remove('light-theme');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  // Fetch chats on token login
  useEffect(() => {
    if (token) {
      fetchChats(token);
    }
  }, [token]);

  const fetchChats = async (userToken) => {
    try {
      const res = await fetch('/api/chats', {
        headers: { 'Authorization': `Bearer ${userToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setChatSessions(data.chats || []);
        // Load the first session if available and none is active
        if (data.chats && data.chats.length > 0 && !activeChatId) {
          loadChatSession(data.chats[0]);
        }
      } else if (res.status === 401 || res.status === 403) {
        handleLogout();
      }
    } catch (err) {
      console.error('Failed to fetch chats:', err);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken('');
    setUser(null);
    setChatSessions([]);
    setActiveChatId(null);
    setChatHistory([]);
    setFiles([]);
    setAuthError('');
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const payload = authMode === 'login'
      ? { email: authEmail, password: authPassword }
      : { name: authName, email: authEmail, password: authPassword };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed.');
      }

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      setToken(data.token);
      setUser(data.user);
      setAuthName('');
      setAuthEmail('');
      setAuthPassword('');
    } catch (err) {
      setAuthError(err.message);
    }
  };

  // Google Login callback listener
  useEffect(() => {
    if (!token && window.google) {
      window.google.accounts.id.initialize({
        client_id: "mmars-dummy-id.apps.googleusercontent.com",
        callback: handleCredentialResponse
      });
    }
  }, [token]);

  const handleCredentialResponse = async (response) => {
    try {
      const jwtVal = response.credential;
      const payload = JSON.parse(atob(jwtVal.split('.')[1]));

      const email = payload.email;
      const name = payload.name;
      const picture = payload.picture;

      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, picture })
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Google Sign-In failed on backend.');
      }

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      setToken(data.token);
      setUser(data.user);
    } catch (err) {
      console.error(err);
      setAuthError(err.message || 'Failed to authenticate via Google.');
    }
  };

  const handleGoogleLoginClick = () => {
    if (window.google) {
      window.google.accounts.id.prompt();
    } else {
      setAuthError('Google Login SDK is loading or blocked by browser extensions.');
    }
  };

  const handleDemoLogin = async () => {
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'guest@mmars-research.org',
          name: 'Guest Researcher',
          picture: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&h=150'
        })
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Demo login failed.');
      }

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      setToken(data.token);
      setUser(data.user);
    } catch (err) {
      setAuthError('Demo login server unreachable.');
    }
  };

  // Chat Session Actions
  const loadChatSession = (session) => {
    setActiveChatId(session.id);
    setChatHistory(session.chatHistory || []);
    setFiles(session.files || []);
    setStatusMessage({ type: '', text: '' });
  };

  const handleNewChat = () => {
    setActiveChatId(null);
    setChatHistory([]);
    setFiles([]);
    setStatusMessage({ type: '', text: '' });
  };

  const handleDeleteChat = async (e, chatId) => {
    e.stopPropagation();
    if (!token) return;
    try {
      const res = await fetch(`/api/chats/${chatId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setChatSessions(prev => prev.filter(s => s.id !== chatId));
        if (activeChatId === chatId) {
          handleNewChat();
        }
      }
    } catch (err) {
      console.error('Failed to delete chat:', err);
    }
  };

  const syncChatSession = async (updatedHistory, updatedFiles, targetId = activeChatId) => {
    if (!token) return;
    try {
      let title = 'Research Session';
      const currentSession = chatSessions.find(s => s.id === targetId);
      if (currentSession && currentSession.title && currentSession.title !== 'Research Session' && currentSession.title !== 'New Research Session') {
        title = currentSession.title;
      } else if (updatedHistory.length > 0) {
        const firstUserMsg = updatedHistory.find(m => m.role === 'user');
        if (firstUserMsg) {
          title = firstUserMsg.content.substring(0, 30) + (firstUserMsg.content.length > 30 ? '...' : '');
        }
      }

      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          id: targetId,
          title,
          chatHistory: updatedHistory,
          files: updatedFiles
        })
      });

      if (res.ok) {
        const data = await res.json();
        setChatSessions(prev => {
          const idx = prev.findIndex(s => s.id === data.chat.id);
          if (idx !== -1) {
            const updated = [...prev];
            updated[idx] = data.chat;
            return updated;
          } else {
            return [data.chat, ...prev];
          }
        });
        if (!activeChatId) {
          setActiveChatId(data.chat.id);
        }
      }
    } catch (err) {
      console.error('Failed to sync chat session:', err);
    }
  };

  // Scroll to bottom of chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, isGenerating]);

  // Load sql.js dynamically when an sqlite database is uploaded
  const loadSqlJs = () => {
    return new Promise((resolve, reject) => {
      if (window.initSqlJs) {
        resolve(window.initSqlJs);
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.6.2/sql-wasm.js';
      script.onload = () => resolve(window.initSqlJs);
      script.onerror = () => reject(new Error('Failed to load SQL.js library.'));
      document.head.appendChild(script);
    });
  };

  // Convert File to base64
  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(file);
    });
  };

  // Create generative inline_data object
  const makeGenerativePart = async (file) => {
    const base64 = await fileToBase64(file);
    let mimeType = file.type;
    if (!mimeType) {
      const ext = file.name.split('.').pop().toLowerCase();
      const mimes = {
        pdf: 'application/pdf',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        bmp: 'image/bmp',
        wav: 'audio/wav',
        mp3: 'audio/mp3',
        m4a: 'audio/m4a'
      };
      mimeType = mimes[ext] || 'application/octet-stream';
    }
    return {
      inlineData: {
        data: base64,
        mimeType
      }
    };
  };

  // Process and parse uploaded file based on format
  const processFile = async (file) => {
    const ext = file.name.split('.').pop().toLowerCase();
    const textExtensions = ['txt', 'py', 'js', 'html', 'css', 'json', 'xml', 'md', 'java', 'c', 'cpp', 'rs', 'csv', 'sql'];
    const mediaExtensions = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'wav', 'mp3', 'm4a'];

    const fileObj = {
      id: Math.random().toString(36).substring(7),
      name: file.name,
      size: (file.size / 1024).toFixed(1) + ' KB',
      type: ext,
      status: 'processing',
      parsedContent: '',
      generativePart: null,
      error: null
    };

    try {
      if (textExtensions.includes(ext)) {
        fileObj.parsedContent = await file.text();
        fileObj.status = 'processed';
      } else if (ext === 'docx') {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        fileObj.parsedContent = result.value;
        fileObj.status = 'processed';
      } else if (ext === 'xlsx' || ext === 'xls') {
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        let text = '';
        workbook.SheetNames.forEach(sheetName => {
          const sheet = workbook.Sheets[sheetName];
          const csv = XLSX.utils.sheet_to_csv(sheet);
          text += `\n--- Sheet: ${sheetName} ---\n${csv}\n`;
        });
        fileObj.parsedContent = text;
        fileObj.status = 'processed';
      } else if (ext === 'zip') {
        const zip = await JSZip.loadAsync(file);
        let text = '';
        for (const filename of Object.keys(zip.files)) {
          const f = zip.files[filename];
          if (!f.dir) {
            const fileExt = filename.split('.').pop().toLowerCase();
            if (textExtensions.includes(fileExt)) {
              const content = await f.async('string');
              text += `\n--- File: ${filename} ---\n${content}\n`;
            }
          }
        }
        fileObj.parsedContent = text;
        fileObj.status = 'processed';
      } else if (ext === 'db' || ext === 'sqlite') {
        const initSqlJs = await loadSqlJs();
        const arrayBuffer = await file.arrayBuffer();
        const SQL = await initSqlJs({
          locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.6.2/${file}`
        });
        const db = new SQL.Database(new Uint8Array(arrayBuffer));
        const stmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table';");
        let text = '';
        while (stmt.step()) {
          const tableName = stmt.getAsObject().name;
          text += `\n--- Table: ${tableName} ---\n`;
          try {
            const res = db.exec(`SELECT * FROM "${tableName}" LIMIT 5`);
            if (res.length > 0) {
              text += `Columns: ${res[0].columns.join(', ')}\n`;
              res[0].values.forEach(row => {
                text += row.join(' | ') + '\n';
              });
            } else {
              text += 'No records found.\n';
            }
          } catch (e) {
            text += `Error reading table: ${e.message}\n`;
          }
        }
        db.close();
        fileObj.parsedContent = text;
        fileObj.status = 'processed';
      } else if (mediaExtensions.includes(ext)) {
        fileObj.generativePart = await makeGenerativePart(file);
        fileObj.status = 'processed';
      } else {
        throw new Error(`Unsupported file layout: .${ext}`);
      }
    } catch (err) {
      fileObj.status = 'error';
      fileObj.error = err.message;
    }

    return fileObj;
  };

  // Handles drag & drop uploading
  const handleUpload = async (e) => {
    const uploadedFiles = Array.from(e.target.files || e.dataTransfer.files);
    if (uploadedFiles.length === 0) return;

    setStatusMessage({ type: '', text: '' });

    // Add temporary files to state to show spinner
    const pendingFiles = uploadedFiles.map(f => ({
      id: Math.random().toString(36).substring(7),
      name: f.name,
      size: (f.size / 1024).toFixed(1) + ' KB',
      type: f.name.split('.').pop().toLowerCase(),
      status: 'processing',
      parsedContent: '',
      generativePart: null,
      error: null
    }));

    setFiles(prev => [...prev, ...pendingFiles]);

    // Process them
    const processedList = [];
    for (let i = 0; i < uploadedFiles.length; i++) {
      const pFile = await processFile(uploadedFiles[i]);
      processedList.push(pFile);
    }

    // Replace the pending files in state with processed ones
    setFiles(prev => {
      const filtered = prev.filter(f => !pendingFiles.some(pf => pf.name === f.name));
      const nextFiles = [...filtered, ...processedList];
      if (activeChatId) {
        syncChatSession(chatHistory, nextFiles);
      }
      return nextFiles;
    });

    // Notify of any errors
    const errors = processedList.filter(f => f.status === 'error');
    if (errors.length > 0) {
      setStatusMessage({
        type: 'error',
        text: `Errors encountered in ${errors.length} file(s). Check the File Board.`
      });
    } else {
      setStatusMessage({
        type: 'success',
        text: 'All files successfully parsed and loaded!'
      });
    }
  };

  const removeFile = (id) => {
    setFiles(prev => {
      const nextFiles = prev.filter(f => f.id !== id);
      if (activeChatId) {
        syncChatSession(chatHistory, nextFiles);
      }
      return nextFiles;
    });
  };

  // Send RAG request to Gemini API via backend Serverless Function
  const handleSend = async (e) => {
    e.preventDefault();
    if (!inputValue.trim() || isGenerating) return;

    const currentQuestion = inputValue;
    setInputValue('');
    setIsGenerating(true);

    // Update history with User message
    setChatHistory(prev => [...prev, { role: 'user', content: currentQuestion }]);

    try {
      // 1. Collect context from processed files
      let docTextContext = '';
      const mediaParts = [];

      files.forEach(f => {
        if (f.status === 'processed') {
          if (f.parsedContent) {
            docTextContext += `\n--- File: ${f.name} ---\n${f.parsedContent}\n`;
          } else if (f.generativePart) {
            mediaParts.push(f.generativePart);
          }
        }
      });

      // 2. Prepare payload parts
      let userQueryText = currentQuestion;
      if (docTextContext) {
        userQueryText = `Context from loaded files:\n${docTextContext}\n\nUser Question: ${currentQuestion}`;
      }

      const queryPart = { text: userQueryText };
      const parts = [...mediaParts, queryPart];

      // 3. Setup chat history for backend (up to last 10 turns)
      const activeHistory = chatHistory.slice(-10);

      // 4. Query backend
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          parts,
          history: activeHistory,
          modelName,
          temperature: parseFloat(temperature),
          systemInstruction
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP error! Status: ${response.status}`);
      }

      const data = await response.json();
      const answer = data.answer;

      // Update history with response
      const updatedHistory = [...chatHistory, { role: 'user', content: currentQuestion }, { role: 'model', content: answer }];
      setChatHistory(prev => [...prev, { role: 'model', content: answer }]);
      await syncChatSession(updatedHistory, files);
    } catch (err) {
      console.error(err);
      setChatHistory(prev => [...prev, {
        role: 'model',
        content: `Error generating response: ${err.message}. Please check server settings and try again.`
      }]);
    } finally {
      setIsGenerating(false);
      setRetryCountdown(null);
    }
  };

  const getFileIcon = (type) => {
    switch (type) {
      case 'pdf': return <FileText className="text-red-400" size={18} />;
      case 'docx':
      case 'doc': return <FileText className="text-blue-400" size={18} />;
      case 'xlsx':
      case 'xls':
      case 'csv': return <Database className="text-green-400" size={18} />;
      case 'zip': return <FolderOpen className="text-yellow-400" size={18} />;
      case 'db':
      case 'sqlite': return <Database className="text-purple-400" size={18} />;
      case 'wav':
      case 'mp3':
      case 'm4a': return <Music className="text-pink-400" size={18} />;
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'webp': return <ImageIcon className="text-cyan-400" size={18} />;
      default: return <FileCode className="text-slate-400" size={18} />;
    }
  };

  // Helper to format code snippets or blocks in messages
  const renderMessageContent = (text) => {
    // Basic markdown block parsing
    const parts = text.split(/(```[\s\S]*?```)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('```')) {
        const codeLines = part.split('\n');
        const language = codeLines[0].replace('```', '').trim();
        const code = codeLines.slice(1, -1).join('\n');
        return (
          <pre key={idx}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '6px', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px' }}>
              {language.toUpperCase() || 'CODE'}
            </div>
            <code>{code}</code>
          </pre>
        );
      }
      return <span key={idx} style={{ whiteSpace: 'pre-wrap' }}>{part}</span>;
    });
  };

  if (!token) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-header">
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px' }}>
              <Bot className="text-red-500" size={40} />
            </div>
            <h2>mMARS Multimodal RAG</h2>
            <p>
              {authMode === 'login' ? "Log in to access your research workspace" : "Register to start research projects"}
            </p>
          </div>

          {authError && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              color: '#EF4444',
              borderRadius: '8px',
              padding: '10px',
              fontSize: '13px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <AlertCircle size={14} />
              <span>{authError}</span>
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="auth-form">
            {authMode === 'register' && (
              <div className="input-group">
                <span className="input-label">Full Name</span>
                <input
                  type="text"
                  value={authName}
                  onChange={(e) => setAuthName(e.target.value)}
                  placeholder="John Doe"
                  className="text-input"
                  required
                />
              </div>
            )}
            <div className="input-group">
              <span className="input-label">Email Address</span>
              <input
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="you@example.com"
                className="text-input"
                required
              />
            </div>
            <div className="input-group">
              <span className="input-label">Password</span>
              <input
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="••••••••"
                className="text-input"
                required
              />
            </div>

            <button type="submit" className="auth-btn">
              {authMode === 'login' ? 'Log In' : 'Sign Up'}
            </button>
          </form>

          <div className="divider">or</div>

          <div className="oauth-container">
            <button onClick={handleGoogleLoginClick} className="google-btn">
              <svg width="18" height="18" viewBox="0 0 18 18" style={{ marginRight: '8px' }}>
                <path d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.47h4.84c-.21 1.12-.84 2.07-1.79 2.7l2.76 2.13c1.61-1.49 2.54-3.69 2.54-6.46z" fill="#4285F4" />
                <path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.76-2.13c-.76.51-1.74.82-3.2.82-2.46 0-4.55-1.66-5.3-3.9L.94 12.7C2.42 15.63 5.47 18 9 18z" fill="#34A853" />
                <path d="M3.7 10.61c-.19-.57-.3-1.19-.3-1.81 0-.62.11-1.24.3-1.81L.94 4.89C.34 6.09 0 7.46 0 8.8c0 1.34.34 2.71.94 3.91l2.76-2.1z" fill="#FBBC05" />
                <path d="M9 3.58c1.32 0 2.5.45 3.44 1.35L15 2.4C13.46.97 11.41 0 9 0 5.47 0 2.42 2.37.94 5.3L3.7 7.42C4.45 5.18 6.54 3.58 9 3.58z" fill="#EA4335" />
              </svg>
              <span>Sign in with Google</span>
            </button>

            <button onClick={handleDemoLogin} className="demo-btn">
              <User size={16} style={{ marginRight: '8px' }} />
              <span>Simulated Quick Guest Sign-in</span>
            </button>
          </div>

          <p style={{ textAlign: 'center', marginTop: '24px', fontSize: '13px', color: 'var(--text-muted)' }}>
            {authMode === 'login' ? "Don't have an account? " : "Already have an account? "}
            <button onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError(''); }} className="auth-toggle">
              {authMode === 'login' ? 'Register' : 'Log In'}
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Sidebar Section */}
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <Bot className="text-red-500" size={28} />
            <span className="logo-text">mMARS RAG</span>
          </div>
        </div>

        <div className="sidebar-content">


          {/* Model Selection */}
          <div className="config-section">
            <h3>Model Configuration</h3>
            <div className="input-group">
              <span className="input-label">Active Brain</span>
              <select
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                className="text-input"
                style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
              >
                <option value="gemini-2.0-flash">Gemini 2.0 Flash (Default)</option>
                <option value="gemini-2.5-flash">Gemini 2.5 Flash (Experimental)</option>
                <option value="gemini-2.5-pro">Gemini 2.5 Pro (Experimental Advanced)</option>
                <option value="gemini-1.5-flash">Gemini 1.5 Flash (Legacy)</option>
                <option value="gemini-1.5-pro">Gemini 1.5 Pro (Legacy)</option>
              </select>
            </div>
            <div className="input-group">
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="input-label">Creativity (Temp)</span>
                <span className="input-label" style={{ color: 'var(--primary-color)' }}>{temperature}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                style={{ accentColor: 'var(--primary-color)', background: 'var(--border-color)' }}
              />
            </div>
          </div>

          {/* Sidebar file uploading dropzone */}
          <div className="config-section">
            <h3>Add Media or Docs</h3>
            <label className="upload-dropzone">
              <UploadCloud size={28} className="text-red-400" />
              <div>
                <p style={{ fontWeight: 600, color: 'var(--text-main)' }}>Upload Files</p>
                <p>PDF, XLSX, CSV, Audio, Images...</p>
              </div>
              <input
                type="file"
                multiple
                onChange={handleUpload}
                style={{ display: 'none' }}
                accept={SUPPORTED_FORMATS.map(f => `.${f}`).join(',')}
              />
            </label>

            {/* Compact list of loaded documents */}
            {files.length > 0 && (
              <div className="file-list-compact">
                <span className="input-label" style={{ marginTop: '12px' }}>Attached files ({files.length}):</span>
                {files.map(f => (
                  <div key={f.id} className="file-item-compact">
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', overflow: 'hidden' }}>
                      {f.status === 'processing' ? <div className="spinner" /> : getFileIcon(f.type)}
                      <span title={f.name}>{f.name}</span>
                    </div>
                    <button onClick={() => removeFile(f.id)} className="action-btn">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Past conversations list */}
          <div className="sidebar-conversations-section">
            <div className="sidebar-conversations-header">
              <h4>Research Sessions</h4>
              <button onClick={handleNewChat} className="new-chat-btn" title="Create New Session">
                <span>+ New</span>
              </button>
            </div>

            <div className="conversations-list">
              {chatSessions.length === 0 ? (
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
                  No sessions saved yet.
                </p>
              ) : (
                chatSessions.map(session => (
                  <div
                    key={session.id}
                    className={`conversation-item ${activeChatId === session.id ? 'active' : ''}`}
                    onClick={() => loadChatSession(session)}
                  >
                    <div className="conversation-info">
                      <span className="conversation-title" title={session.title}>
                        {session.title}
                      </span>
                      <span className="conversation-date">
                        {new Date(session.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <button
                      onClick={(e) => handleDeleteChat(e, session.id)}
                      className="action-btn"
                      title="Delete Session"
                      style={{ marginLeft: '8px' }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Main Workspace Area */}
      <div className="main-workspace">
        <div className="workspace-header">
          <div className="workspace-title">
            <h1>Multi-modal Research Center</h1>
            <p>Direct Browser RAG Client • Static HTML5</p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <div className="tab-navigation">
              <button
                className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
                onClick={() => setActiveTab('chat')}
              >
                Chat Workspace
              </button>
              <button
                className={`tab-btn ${activeTab === 'files' ? 'active' : ''}`}
                onClick={() => setActiveTab('files')}
              >
                File Board ({files.length})
              </button>
              <button
                className={`tab-btn ${activeTab === 'formats' ? 'active' : ''}`}
                onClick={() => setActiveTab('formats')}
              >
                Settings
              </button>
            </div>

            <button
              onClick={toggleTheme}
              className="theme-toggle-btn"
              title={theme === 'dark' ? "Switch to Light Mode" : "Switch to Dark Mode"}
              type="button"
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {/* User Profile avatar + logout */}
            {user && (
              <div className="user-profile-menu">
                {user.picture ? (
                  <img src={user.picture} alt={user.name} className="avatar" />
                ) : (
                  <div className="avatar">
                    {user.name ? user.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : 'UR'}
                  </div>
                )}
                <span style={{ fontSize: '13px', color: 'var(--text-main)', fontWeight: 500, marginRight: '4px' }}>
                  {user.name}
                </span>
                <button onClick={handleLogout} className="logout-btn" title="Sign Out">
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Global status banner */}
        {statusMessage.text && (
          <div style={{
            background: statusMessage.type === 'error' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
            borderBottom: `1px solid ${statusMessage.type === 'error' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
            color: statusMessage.type === 'error' ? '#EF4444' : '#10B981',
            padding: '10px 32px',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            {statusMessage.type === 'error' ? <AlertCircle size={14} /> : <CheckCircle size={14} />}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* Workspace views based on tab selection */}
        <div className="viewport-content">
          {activeTab === 'chat' && (
            <div className="chat-container">
              <div className="chat-history">
                {chatHistory.length === 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', gap: '16px' }}>
                    <Bot size={48} className="text-slate-600" />
                    <div style={{ textAlign: 'center' }}>
                      <p style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>Workspace Empty</p>
                      <p style={{ fontSize: '13px' }}>Upload document contexts to begin researching.</p>
                    </div>
                  </div>
                ) : (
                  chatHistory.map((msg, idx) => (
                    <div key={idx} className={`chat-message ${msg.role === 'user' ? 'user' : 'assistant'}`}>
                      <span className="message-sender">{msg.role === 'user' ? 'User' : 'mMARS Brain'}</span>
                      <div className="message-bubble">
                        {renderMessageContent(msg.content)}
                      </div>
                    </div>
                  ))
                )}
                {isGenerating && (
                  <div className="chat-message assistant">
                    <span className="message-sender">Thinking</span>
                    <div className="message-bubble" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div className="spinner" />
                      <span>
                        {retryCountdown !== null
                          ? `Rate limit hit. Retrying in ${retryCountdown}s...`
                          : 'mMARS is processing data...'}
                      </span>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Input Chat Box */}
              <form onSubmit={handleSend} className="chat-input-container">
                <div className="chat-input-bar">
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder={files.length > 0 ? "Ask a question about the attached documents..." : "Attached document files first to consult them..."}
                    className="chat-input"
                    disabled={isGenerating}
                  />
                </div>
                <button type="submit" className="send-btn" disabled={isGenerating || !inputValue.trim()}>
                  <Send size={18} />
                </button>
              </form>
            </div>
          )}

          {activeTab === 'files' && (
            <div style={{ height: '100%' }}>
              <h2>File Dashboard</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '24px' }}>Review extraction results and status for uploaded files.</p>

              {files.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>
                  <FolderOpen size={40} style={{ marginBottom: '12px' }} />
                  <p>No documents uploaded yet. Drop them in the sidebar zone.</p>
                </div>
              ) : (
                <div className="files-grid">
                  {files.map(f => (
                    <div key={f.id} className="file-card">
                      <div className="file-info">
                        {getFileIcon(f.type)}
                        <div className="file-details">
                          <span className="file-name" title={f.name}>{f.name}</span>
                          <span className="file-meta">{f.size} • .{f.type.toUpperCase()}</span>
                        </div>
                      </div>

                      {f.status === 'processing' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>
                          <div className="spinner" />
                          <span>Extracting text content...</span>
                        </div>
                      )}

                      {f.status === 'processed' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#10B981', fontSize: '12px' }}>
                          <CheckCircle size={12} />
                          <span>Loaded successfully</span>
                        </div>
                      )}

                      {f.status === 'error' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#EF4444', fontSize: '12px' }} title={f.error}>
                          <AlertCircle size={12} />
                          <span>Parsing failed</span>
                        </div>
                      )}

                      <div className="file-actions">
                        <button onClick={() => removeFile(f.id)} className="action-btn" title="Delete context">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'formats' && (
            <div>
              <h2>Supported System Layouts</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '24px' }}>List of configurations and scraping bindings supported client-side.</p>

              <div className="glass-card">
                <h3 style={{ marginBottom: '12px' }}>System Instruction Prompt</h3>
                <textarea
                  value={systemInstruction}
                  onChange={(e) => setSystemInstruction(e.target.value)}
                  className="text-input"
                  style={{ width: '100%', height: '100px', resize: 'none', background: 'rgba(0,0,0,0.2)' }}
                  placeholder="Provide instruction rules for Gemini context..."
                />
              </div>

              <div className="glass-card">
                <h3 style={{ marginBottom: '12px' }}>Client Format List</h3>
                <div className="badge-grid">
                  {SUPPORTED_FORMATS.map(f => (
                    <span key={f} className="format-badge">.{f.toUpperCase()}</span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
