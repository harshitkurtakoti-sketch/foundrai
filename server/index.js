require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const bcrypt  = require('bcrypt');
const { pool, initSchema } = require('./db');
const { signToken, requireAuth } = require('./middleware/auth');

const app  = express();
const PORT = process.env.PORT || 4000;
const SALT_ROUNDS = 12;

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// ── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date() }));

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

/** POST /auth/signup — create a new account with email + password */
app.post('/auth/signup', async (req, res) => {
  const { email, password, display_name } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    // Check if email already exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3) RETURNING id, email, display_name, startup_idea, industry, stage, ai_preferences, created_at`,
      [email.toLowerCase(), password_hash, display_name || email.split('@')[0]]
    );

    const user  = rows[0];
    const token = signToken(user);
    res.status(201).json({ token, user });
  } catch (err) {
    console.error('POST /auth/signup error:', err);
    res.status(500).json({ error: 'Server error during signup' });
  }
});

/** POST /auth/login — sign in with email + password */
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = rows[0];

    if (!user.password_hash) {
      return res.status(401).json({ error: 'This account uses Google sign-in. Please sign in with Google.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken(user);
    // Return user without sensitive fields
    const { password_hash, google_id, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (err) {
    console.error('POST /auth/login error:', err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

/** GET /auth/me — get current logged-in user from token */
app.get('/auth/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, email, display_name, avatar_url, startup_idea, industry, stage, ai_preferences, created_at FROM users WHERE id = $1',
      [req.userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('GET /auth/me error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PROFILE / AI CONTEXT ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

/** PUT /profile — update AI context (startup idea, industry, stage, preferences) */
app.put('/profile', requireAuth, async (req, res) => {
  const { display_name, startup_idea, industry, stage, ai_preferences } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE users SET
        display_name   = COALESCE($1, display_name),
        startup_idea   = COALESCE($2, startup_idea),
        industry       = COALESCE($3, industry),
        stage          = COALESCE($4, stage),
        ai_preferences = COALESCE($5, ai_preferences),
        updated_at     = NOW()
       WHERE id = $6
       RETURNING id, email, display_name, avatar_url, startup_idea, industry, stage, ai_preferences`,
      [display_name, startup_idea, industry, stage, ai_preferences, req.userId]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('PUT /profile error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CHAT SESSION ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

/** GET /chats — list all chat sessions for the user (newest first) */
app.get('/chats', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM chats WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.userId]
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /chats error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/** POST /chats — create a new chat session */
app.post('/chats', requireAuth, async (req, res) => {
  const { title } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO chats (user_id, title) VALUES ($1, $2) RETURNING *',
      [req.userId, title || 'New Session']
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('POST /chats error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/** PUT /chats/:id — rename a chat session */
app.put('/chats/:id', requireAuth, async (req, res) => {
  const { title } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE chats SET title = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
      [title, req.params.id, req.userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Chat not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('PUT /chats/:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/** DELETE /chats/:id — delete a chat and all messages */
app.delete('/chats/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM chats WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /chats/:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGE ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

/** GET /chats/:id/messages — load all messages in a session */
app.get('/chats/:id/messages', requireAuth, async (req, res) => {
  try {
    const chatCheck = await pool.query(
      'SELECT id FROM chats WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (chatCheck.rows.length === 0) return res.status(403).json({ error: 'Forbidden' });

    const { rows } = await pool.query(
      'SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /chats/:id/messages error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/** POST /chats/:id/messages — save a message */
app.post('/chats/:id/messages', requireAuth, async (req, res) => {
  const { role, agent, content } = req.body;
  if (!role || !content) return res.status(400).json({ error: 'role and content are required' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO messages (chat_id, user_id, role, agent, content)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.id, req.userId, role, agent || null, content]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('POST /chats/:id/messages error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Startup ───────────────────────────────────────────────────────────────────
async function start() {
  await initSchema();
  app.listen(PORT, () => {
    console.log(`🚀 FounderAI API running on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
