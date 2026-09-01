const { Pool } = require('pg');

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      }
    : {
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5432', 10),
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || '',
        database: process.env.PGDATABASE || 'foundrai',
        ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      }
);

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err);
});

/**
 * Run the initial schema migration — creates all tables if they don't exist.
 */
async function initSchema() {
  const client = await pool.connect();
  try {
    await client.query(`
      -- Users table (core auth + AI context all in one)
      CREATE TABLE IF NOT EXISTS users (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email          TEXT UNIQUE NOT NULL,
        password_hash  TEXT,                      -- NULL for Google-only accounts
        google_id      TEXT UNIQUE,               -- NULL for email accounts
        display_name   TEXT,
        avatar_url     TEXT,
        startup_idea   TEXT,
        industry       TEXT,
        stage          TEXT DEFAULT 'idea',       -- idea | mvp | growth | scale
        ai_preferences TEXT,
        created_at     TIMESTAMPTZ DEFAULT NOW(),
        updated_at     TIMESTAMPTZ DEFAULT NOW()
      );

      -- Chat sessions per user
      CREATE TABLE IF NOT EXISTS chats (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title      TEXT DEFAULT 'New Session',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS chats_user_idx ON chats(user_id);

      -- Messages per chat session
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
    console.log('✅ Database schema ready.');
  } catch (err) {
    console.error('❌ Schema init failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, initSchema };
