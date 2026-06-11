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
      return [...filtered, ...processedList];
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
    setFiles(prev => prev.filter(f => f.id !== id));
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

      // 4. Query backend with automatic rate limit retry mechanism
      let retries = 0;
      const maxRetries = 3;
      let success = false;
      let answer = '';

      while (retries < maxRetries && !success) {
        try {
          const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
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
          answer = data.answer;
          success = true;
        } catch (err) {
          console.error(`Attempt ${retries + 1} failed:`, err);
          
          const errMsg = err.message || '';
          const isRateLimitOrQuota = 
            errMsg.includes('429') || 
            errMsg.includes('503') || 
            errMsg.toLowerCase().includes('quota') || 
            errMsg.toLowerCase().includes('rate limit') || 
            errMsg.toLowerCase().includes('limit exceeded') ||
            errMsg.toLowerCase().includes('overloaded');

          if (isRateLimitOrQuota && retries < maxRetries - 1) {
            let delaySeconds = 5;
            const match = errMsg.match(/Please retry in (\d+(?:\.\d+)?)/i);
            if (match && match[1]) {
              delaySeconds = Math.ceil(parseFloat(match[1]));
            }
            
            // Limit max delay to 60 seconds to avoid blocking indefinitely
            if (delaySeconds > 60) {
              throw err;
            }

            for (let sec = delaySeconds; sec > 0; sec--) {
              setRetryCountdown(sec);
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
            setRetryCountdown(null);
            retries++;
          } else {
            throw err;
          }
        }
      }

      // Update history with response
      setChatHistory(prev => [...prev, { role: 'model', content: answer }]);
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
            <div style={{fontSize: '10px', color: 'var(--text-muted)', marginBottom: '6px', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px'}}>
              {language.toUpperCase() || 'CODE'}
            </div>
            <code>{code}</code>
          </pre>
        );
      }
      return <span key={idx} style={{whiteSpace: 'pre-wrap'}}>{part}</span>;
    });
  };

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
                style={{background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-color)', borderRadius: '8px'}}
              >
                <option value="gemini-2.0-flash">Gemini 2.0 Flash (Default)</option>
                <option value="gemini-2.5-flash">Gemini 2.5 Flash (Experimental)</option>
                <option value="gemini-2.5-pro">Gemini 2.5 Pro (Experimental Advanced)</option>
                <option value="gemini-1.5-flash">Gemini 1.5 Flash (Legacy)</option>
                <option value="gemini-1.5-pro">Gemini 1.5 Pro (Legacy)</option>
              </select>
            </div>
            <div className="input-group">
              <div style={{display: 'flex', justifyContent: 'space-between'}}>
                <span className="input-label">Creativity (Temp)</span>
                <span className="input-label" style={{color: 'var(--primary-color)'}}>{temperature}</span>
              </div>
              <input 
                type="range" 
                min="0" 
                max="1" 
                step="0.1" 
                value={temperature} 
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                style={{accentColor: 'var(--primary-color)', background: 'var(--border-color)'}}
              />
            </div>
          </div>

          {/* Sidebar file uploading dropzone */}
          <div className="config-section">
            <h3>Add Media or Docs</h3>
            <label className="upload-dropzone">
              <UploadCloud size={28} className="text-red-400" />
              <div>
                <p style={{fontWeight: 600, color: 'var(--text-main)'}}>Upload Files</p>
                <p>PDF, XLSX, CSV, Audio, Images...</p>
              </div>
              <input 
                type="file" 
                multiple 
                onChange={handleUpload} 
                style={{display: 'none'}}
                accept={SUPPORTED_FORMATS.map(f => `.${f}`).join(',')}
              />
            </label>

            {/* Compact list of loaded documents */}
            {files.length > 0 && (
              <div className="file-list-compact">
                <span className="input-label" style={{marginTop: '12px'}}>Attached files ({files.length}):</span>
                {files.map(f => (
                  <div key={f.id} className="file-item-compact">
                    <div style={{display: 'flex', gap: '8px', alignItems: 'center', overflow: 'hidden'}}>
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
        </div>
      </div>

      {/* Main Workspace Area */}
      <div className="main-workspace">
        <div className="workspace-header">
          <div className="workspace-title">
            <h1>Multi-modal Research Center</h1>
            <p>Direct Browser RAG Client • Static HTML5</p>
          </div>

          <div style={{display: 'flex', alignItems: 'center', gap: '16px'}}>
            <div className="tab-navigation">
              <button 
                className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
                onClick={() => setActiveTab('chat')}
              >
                💬 Chat Workspace
              </button>
              <button 
                className={`tab-btn ${activeTab === 'files' ? 'active' : ''}`}
                onClick={() => setActiveTab('files')}
              >
                📂 File Board ({files.length})
              </button>
              <button 
                className={`tab-btn ${activeTab === 'formats' ? 'active' : ''}`}
                onClick={() => setActiveTab('formats')}
              >
                ⚙️ System Formats
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
                  <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', gap: '16px'}}>
                    <Bot size={48} className="text-slate-600" />
                    <div style={{textAlign: 'center'}}>
                      <p style={{fontSize: '16px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px'}}>Workspace Empty</p>
                      <p style={{fontSize: '13px'}}>Provide your Google API Key and upload document contexts to begin researching.</p>
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
                    <div className="message-bubble" style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
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
            <div style={{height: '100%'}}>
              <h2>File Dashboard</h2>
              <p style={{color: 'var(--text-muted)', fontSize: '13px', marginBottom: '24px'}}>Review extraction results and status for uploaded files.</p>
              
              {files.length === 0 ? (
                <div style={{textAlign: 'center', padding: '60px', color: 'var(--text-muted)'}}>
                  <FolderOpen size={40} style={{marginBottom: '12px'}} />
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
                        <div style={{display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '12px'}}>
                          <div className="spinner" />
                          <span>Extracting text content...</span>
                        </div>
                      )}

                      {f.status === 'processed' && (
                        <div style={{display: 'flex', alignItems: 'center', gap: '4px', color: '#10B981', fontSize: '12px'}}>
                          <CheckCircle size={12} />
                          <span>Loaded successfully</span>
                        </div>
                      )}

                      {f.status === 'error' && (
                        <div style={{display: 'flex', alignItems: 'center', gap: '4px', color: '#EF4444', fontSize: '12px'}} title={f.error}>
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
              <p style={{color: 'var(--text-muted)', fontSize: '13px', marginBottom: '24px'}}>List of configurations and scraping bindings supported client-side.</p>
              
              <div className="glass-card">
                <h3 style={{marginBottom: '12px'}}>System Instruction Prompt</h3>
                <textarea 
                  value={systemInstruction}
                  onChange={(e) => setSystemInstruction(e.target.value)}
                  className="text-input"
                  style={{width: '100%', height: '100px', resize: 'none', background: 'rgba(0,0,0,0.2)'}}
                  placeholder="Provide instruction rules for Gemini context..."
                />
              </div>

              <div className="glass-card">
                <h3 style={{marginBottom: '12px'}}>Client Format List</h3>
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
