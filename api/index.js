import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { users, chats } from './db.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Support base64 media uploads

const JWT_SECRET = process.env.JWT_SECRET || 'mmars-jwt-super-secret-key';

// Middleware to authenticate JWT tokens
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access Denied: No session token provided.' });
  }

  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Session expired or invalid token.' });
  }
};

// 1. Auth Endpoint: Register
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Please fill in all registration fields.' });
  }

  try {
    const existing = await users.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ error: 'An account with this email already exists.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = await users.insert({
      name,
      email: email.toLowerCase(),
      passwordHash,
      provider: 'local'
    });

    const token = jwt.sign(
      { id: newUser.id, email: newUser.email, name: newUser.name }, 
      JWT_SECRET, 
      { expiresIn: '7d' }
    );

    return res.status(201).json({ 
      token, 
      user: { id: newUser.id, name: newUser.name, email: newUser.email } 
    });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'Internal server error during registration.' });
  }
});

// 2. Auth Endpoint: Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Please provide email and password.' });
  }

  try {
    const user = await users.findOne({ email: email.toLowerCase() });
    if (!user || user.provider !== 'local') {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name }, 
      JWT_SECRET, 
      { expiresIn: '7d' }
    );

    return res.status(200).json({ 
      token, 
      user: { id: user.id, name: user.name, email: user.email } 
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error during login.' });
  }
});

// 3. Auth Endpoint: Google Sign-In
app.post('/api/auth/google', async (req, res) => {
  const { email, name, picture } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Missing Google credentials.' });
  }

  try {
    let user = await users.findOne({ email: email.toLowerCase() });
    if (!user) {
      user = await users.insert({
        name,
        email: email.toLowerCase(),
        picture,
        provider: 'google'
      });
    } else {
      // Sync Google picture and profile name
      user = await users.update({ email: email.toLowerCase() }, { name, picture, provider: 'google' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name }, 
      JWT_SECRET, 
      { expiresIn: '7d' }
    );

    return res.status(200).json({ 
      token, 
      user: { id: user.id, name: user.name, email: user.email, picture: user.picture } 
    });
  } catch (err) {
    console.error('Google Sign-In error:', err);
    return res.status(500).json({ error: 'Internal server error during Google authentication.' });
  }
});

// 4. Auth Endpoint: Me (Session validation)
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await users.findOne({ id: req.user.id });
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    return res.status(200).json({ 
      user: { id: user.id, name: user.name, email: user.email, picture: user.picture } 
    });
  } catch (err) {
    return res.status(500).json({ error: 'Server error validating session.' });
  }
});

// 5. GET Chats for authenticated user
app.get('/api/chats', authenticateToken, async (req, res) => {
  try {
    const userConversations = await chats.find({ userId: req.user.id });
    return res.status(200).json({ chats: userConversations });
  } catch (err) {
    console.error('Error fetching chats:', err);
    return res.status(500).json({ error: 'Server error retrieving conversation list.' });
  }
});

// 6. POST Save or update chat session
app.post('/api/chats', authenticateToken, async (req, res) => {
  const { id, title, chatHistory, files } = req.body;
  
  try {
    const savedChat = await chats.save({
      id,
      userId: req.user.id,
      title: title || 'Research Session',
      chatHistory: chatHistory || [],
      files: files || []
    });
    return res.status(200).json({ chat: savedChat });
  } catch (err) {
    console.error('Error saving chat:', err);
    return res.status(500).json({ error: 'Server error saving conversation history.' });
  }
});

// 7. DELETE Chat conversation
app.delete('/api/chats/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    await chats.delete({ id, userId: req.user.id });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error deleting chat:', err);
    return res.status(500).json({ error: 'Server error deleting conversation.' });
  }
});

// 8. POST Chat proxy (secured through JWT auth)
app.post('/api/chat', authenticateToken, async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ 
      error: 'Gemini API Key is not configured on the server. Please add your GEMINI_API_KEY variable to Vercel.' 
    });
  }

  const { parts, history, modelName, temperature, systemInstruction } = req.body;

  if (!parts || !modelName) {
    return res.status(400).json({ error: 'Missing required parameters (parts or modelName)' });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
      model: modelName,
      systemInstruction: systemInstruction 
    });

    const formattedHistory = [];
    if (history && Array.isArray(history)) {
      history.forEach(msg => {
        formattedHistory.push({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content }]
        });
      });
    }

    const chatSession = model.startChat({
      history: formattedHistory,
      generationConfig: {
        temperature: parseFloat(temperature) || 0.3,
      }
    });

    const result = await chatSession.sendMessage(parts);
    const answer = result.response.text();

    return res.status(200).json({ answer });
  } catch (err) {
    console.error('Gemini Backend error:', err);
    const errMsg = err.message || '';
    const isRateLimit = errMsg.includes('429') || 
                        errMsg.includes('503') ||
                        errMsg.toLowerCase().includes('quota') || 
                        errMsg.toLowerCase().includes('rate limit') || 
                        errMsg.toLowerCase().includes('limit exceeded') ||
                        errMsg.toLowerCase().includes('overloaded');
    
    const statusCode = isRateLimit ? 429 : 500;
    return res.status(statusCode).json({ error: errMsg || 'An error occurred during AI content generation.' });
  }
});

// Local Development Entry Point
const PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Express auth & storage backend listening on http://localhost:${PORT}`);
  });
}

export default app;
