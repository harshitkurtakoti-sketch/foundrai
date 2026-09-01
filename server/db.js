const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let pgPool = null;
let useLocalDb = false;

// Path for local file-based database fallback
const DATA_DIR = path.join(__dirname, 'data');
const LOCAL_DB_PATH = path.join(DATA_DIR, 'db.json');

function getLocalData() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(LOCAL_DB_PATH)) {
    const initialData = {
      users: [],
      chats: [],
      messages: []
    };
    fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(initialData, null, 2), 'utf-8');
    return initialData;
  }
  try {
    const content = fs.readFileSync(LOCAL_DB_PATH, 'utf-8');
    return JSON.parse(content || '{"users":[],"chats":[],"messages":[]}');
  } catch {
    return { users: [], chats: [], messages: [] };
  }
}

function saveLocalData(data) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Executes queries against the local JSON store when PostgreSQL is offline or unconfigured
 */
async function localQuery(sql, params = []) {
  const data = getLocalData();
  const cleanSql = sql.replace(/\s+/g, ' ').trim();

  // 1. SELECT id FROM users WHERE email = $1
  if (/^SELECT\s+id\s+FROM\s+users\s+WHERE\s+email\s*=\s*\$1/i.test(cleanSql)) {
    const email = (params[0] || '').toLowerCase();
    const user = data.users.find(u => (u.email || '').toLowerCase() === email);
    return { rows: user ? [{ id: user.id }] : [] };
  }

  // 2. SELECT * FROM users WHERE email = $1
  if (/^SELECT\s+\*\s+FROM\s+users\s+WHERE\s+email\s*=\s*\$1/i.test(cleanSql)) {
    const email = (params[0] || '').toLowerCase();
    const user = data.users.find(u => (u.email || '').toLowerCase() === email);
    return { rows: user ? [{ ...user }] : [] };
  }

  // 3. SELECT * FROM users WHERE google_id = $1
  if (/^SELECT\s+\*\s+FROM\s+users\s+WHERE\s+google_id\s*=\s*\$1/i.test(cleanSql)) {
    const gid = params[0];
    const user = data.users.find(u => u.google_id === gid);
    return { rows: user ? [{ ...user }] : [] };
  }

  // 4. SELECT ... FROM users WHERE id = $1
  if (/^SELECT\s+.+\s+FROM\s+users\s+WHERE\s+id\s*=\s*\$1/i.test(cleanSql)) {
    const id = params[0];
    const user = data.users.find(u => u.id === id);
    if (!user) return { rows: [] };
    const { password_hash, ...safe } = user;
    return { rows: [safe] };
  }

  // 5. INSERT INTO users (email, password_hash, display_name)
  if (/^INSERT\s+INTO\s+users\s*\(email,\s*password_hash,\s*display_name\)/i.test(cleanSql)) {
    const [email, password_hash, display_name] = params;
    const newUser = {
      id: crypto.randomUUID(),
      email: (email || '').toLowerCase(),
      password_hash,
      google_id: null,
      display_name: display_name || email.split('@')[0],
      avatar_url: null,
      startup_idea: null,
      industry: null,
      stage: 'idea',
      ai_preferences: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    data.users.push(newUser);
    saveLocalData(data);
    const { password_hash: _, ...safeUser } = newUser;
    return { rows: [safeUser] };
  }

  // 6. INSERT INTO users (email, google_id, display_name, avatar_url)
  if (/^INSERT\s+INTO\s+users\s*\(email,\s*google_id,\s*display_name,\s*avatar_url\)/i.test(cleanSql)) {
    const [email, google_id, display_name, avatar_url] = params;
    const newUser = {
      id: crypto.randomUUID(),
      email: (email || '').toLowerCase(),
      password_hash: null,
      google_id,
      display_name,
      avatar_url,
      startup_idea: null,
      industry: null,
      stage: 'idea',
      ai_preferences: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    data.users.push(newUser);
    saveLocalData(data);
    return { rows: [newUser] };
  }

  // 7. UPDATE users SET display_name ... WHERE id = $6
  if (/^UPDATE\s+users\s+SET/i.test(cleanSql)) {
    const [display_name, startup_idea, industry, stage, ai_preferences, id] = params;
    const idx = data.users.findIndex(u => u.id === id);
    if (idx !== -1) {
      data.users[idx] = {
        ...data.users[idx],
        display_name: display_name !== undefined ? display_name : data.users[idx].display_name,
        startup_idea: startup_idea !== undefined ? startup_idea : data.users[idx].startup_idea,
        industry: industry !== undefined ? industry : data.users[idx].industry,
        stage: stage !== undefined ? stage : data.users[idx].stage,
        ai_preferences: ai_preferences !== undefined ? ai_preferences : data.users[idx].ai_preferences,
        updated_at: new Date().toISOString()
      };
      saveLocalData(data);
      const { password_hash: _, ...safeUser } = data.users[idx];
      return { rows: [safeUser] };
    }
    return { rows: [] };
  }

  // 8. SELECT * FROM chats WHERE user_id = $1 ORDER BY created_at DESC
  if (/^SELECT\s+\*\s+FROM\s+chats\s+WHERE\s+user_id\s*=\s*\$1/i.test(cleanSql)) {
    const userId = params[0];
    const userChats = data.chats
      .filter(c => c.user_id === userId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { rows: userChats };
  }

  // 9. INSERT INTO chats (user_id, title) VALUES ($1, $2) RETURNING *
  if (/^INSERT\s+INTO\s+chats/i.test(cleanSql)) {
    const [user_id, title] = params;
    const newChat = {
      id: crypto.randomUUID(),
      user_id,
      title: title || 'New Session',
      created_at: new Date().toISOString()
    };
    data.chats.push(newChat);
    saveLocalData(data);
    return { rows: [newChat] };
  }

  // 10. DELETE FROM chats WHERE id = $1 AND user_id = $2
  if (/^DELETE\s+FROM\s+chats\s+WHERE\s+id\s*=\s*\$1\s+AND\s+user_id\s*=\s*\$2/i.test(cleanSql)) {
    const [id, userId] = params;
    const initialLen = data.chats.length;
    data.chats = data.chats.filter(c => !(c.id === id && c.user_id === userId));
    data.messages = data.messages.filter(m => m.chat_id !== id);
    saveLocalData(data);
    return { rowCount: initialLen - data.chats.length };
  }

  // 11. SELECT id FROM chats WHERE id = $1 AND user_id = $2
  if (/^SELECT\s+id\s+FROM\s+chats\s+WHERE\s+id\s*=\s*\$1\s+AND\s+user_id\s*=\s*\$2/i.test(cleanSql)) {
    const [id, userId] = params;
    const chat = data.chats.find(c => c.id === id && c.user_id === userId);
    return { rows: chat ? [{ id: chat.id }] : [] };
  }

  // 12. SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC
  if (/^SELECT\s+\*\s+FROM\s+messages\s+WHERE\s+chat_id\s*=\s*\$1/i.test(cleanSql)) {
    const chatId = params[0];
    const msgs = data.messages
      .filter(m => m.chat_id === chatId)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return { rows: msgs };
  }

  // 13. INSERT INTO messages (chat_id, user_id, role, agent, content)
  if (/^INSERT\s+INTO\s+messages/i.test(cleanSql)) {
    const [chat_id, user_id, role, agent, content] = params;
    const newMsg = {
      id: crypto.randomUUID(),
      chat_id,
      user_id,
      role,
      agent: agent || null,
      content,
      created_at: new Date().toISOString()
    };
    data.messages.push(newMsg);
    saveLocalData(data);
    return { rows: [newMsg] };
  }

  return { rows: [], rowCount: 0 };
}

// Unified pool proxy
const pool = {
  async query(sql, params = []) {
    if (useLocalDb || !pgPool) {
      return localQuery(sql, params);
    }
    try {
      return await pgPool.query(sql, params);
    } catch (err) {
      console.warn('PostgreSQL query error, attempting local fallback:', err.message);
      return localQuery(sql, params);
    }
  },
  async connect() {
    if (useLocalDb || !pgPool) {
      return {
        query: (sql, params) => localQuery(sql, params),
        release: () => {}
      };
    }
    return await pgPool.connect();
  }
};

/**
 * Initializes Database Schema or fallback store
 */
async function initSchema() {
  if (process.env.DATABASE_URL) {
    try {
      const { Pool } = require('pg');
      pgPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
        connectionTimeoutMillis: 4000
      });

      const client = await pgPool.connect();
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          email          TEXT UNIQUE NOT NULL,
          password_hash  TEXT,
          google_id      TEXT UNIQUE,
          display_name   TEXT,
          avatar_url     TEXT,
          startup_idea   TEXT,
          industry       TEXT,
          stage          TEXT DEFAULT 'idea',
          ai_preferences TEXT,
          created_at     TIMESTAMPTZ DEFAULT NOW(),
          updated_at     TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS chats (
          id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title      TEXT DEFAULT 'New Session',
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS chats_user_idx ON chats(user_id);

        CREATE TABLE IF NOT EXISTS messages (
          id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          chat_id    UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
          user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role       TEXT NOT NULL CHECK (role IN ('user','assistant','agent')),
          agent      TEXT,
          content    TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS messages_chat_idx ON messages(chat_id);
      `);
      client.release();
      console.log('✅ Connected to PostgreSQL database.');
      return;
    } catch (err) {
      console.warn('⚠️  PostgreSQL connection failed:', err.message);
      console.log('📦 Switching to embedded local JSON storage (server/data/db.json).');
      useLocalDb = true;
    }
  } else {
    console.log('ℹ️  No DATABASE_URL provided. Using embedded local JSON storage (server/data/db.json).');
    useLocalDb = true;
  }

  getLocalData();
  console.log('✅ Local database initialized.');
}

module.exports = { pool, initSchema };
