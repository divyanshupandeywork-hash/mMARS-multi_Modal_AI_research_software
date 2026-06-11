import fs from 'fs';
import path from 'path';

// Check environment to determine persistence directory.
// On Vercel (serverless production), writing to local directories is blocked,
// so we fall back to /tmp (ephemeral storage). Locally we write to a stable "data" directory.
const DATA_DIR = process.env.NODE_ENV === 'production' ? '/tmp' : path.join(process.cwd(), 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const USERS_PATH = path.join(DATA_DIR, 'users.json');
const CHATS_PATH = path.join(DATA_DIR, 'chats.json');

// Helper to read database file
const loadFile = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data || '[]');
  } catch (err) {
    console.error(`Error loading database file from ${filePath}:`, err);
    return [];
  }
};

// Helper to write database file
const saveFile = (filePath, data) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`Error saving database file to ${filePath}:`, err);
    return false;
  }
};

// Database interfaces for users
export const users = {
  find: async () => {
    return loadFile(USERS_PATH);
  },
  findOne: async (query) => {
    const list = loadFile(USERS_PATH);
    return list.find(item => {
      for (const key in query) {
        if (item[key] !== query[key]) return false;
      }
      return true;
    });
  },
  insert: async (doc) => {
    const list = loadFile(USERS_PATH);
    const newDoc = { 
      id: Math.random().toString(36).substring(7), 
      ...doc, 
      createdAt: new Date().toISOString() 
    };
    list.push(newDoc);
    saveFile(USERS_PATH, list);
    return newDoc;
  },
  update: async (query, updateDoc) => {
    const list = loadFile(USERS_PATH);
    const itemIdx = list.findIndex(item => {
      for (const key in query) {
        if (item[key] !== query[key]) return false;
      }
      return true;
    });
    if (itemIdx === -1) return null;
    list[itemIdx] = { 
      ...list[itemIdx], 
      ...updateDoc, 
      updatedAt: new Date().toISOString() 
    };
    saveFile(USERS_PATH, list);
    return list[itemIdx];
  }
};

// Database interfaces for chats
export const chats = {
  find: async (query) => {
    const list = loadFile(CHATS_PATH);
    return list.filter(item => {
      for (const key in query) {
        if (item[key] !== query[key]) return false;
      }
      return true;
    }).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)); // Sort by newest
  },
  findOne: async (query) => {
    const list = loadFile(CHATS_PATH);
    return list.find(item => {
      for (const key in query) {
        if (item[key] !== query[key]) return false;
      }
      return true;
    });
  },
  save: async (doc) => {
    const list = loadFile(CHATS_PATH);
    const now = new Date().toISOString();
    
    if (doc.id) {
      const idx = list.findIndex(item => item.id === doc.id);
      if (idx !== -1) {
        list[idx] = { 
          ...list[idx], 
          ...doc, 
          updatedAt: now 
        };
        saveFile(CHATS_PATH, list);
        return list[idx];
      }
    }
    
    const newDoc = { 
      id: doc.id || Math.random().toString(36).substring(7), 
      ...doc, 
      createdAt: now, 
      updatedAt: now 
    };
    list.push(newDoc);
    saveFile(CHATS_PATH, list);
    return newDoc;
  },
  delete: async (query) => {
    const list = loadFile(CHATS_PATH);
    const filtered = list.filter(item => {
      for (const key in query) {
        if (item[key] === query[key]) return false;
      }
      return true;
    });
    saveFile(CHATS_PATH, filtered);
    return true;
  }
};
