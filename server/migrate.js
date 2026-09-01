require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
      }
    : {
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5432', 10),
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || '',
        database: process.env.PGDATABASE || 'foundrai',
        ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
      }
);

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🗑️  Dropping old tables...');
    await client.query(`
      DROP TABLE IF EXISTS messages CASCADE;
      DROP TABLE IF EXISTS chats CASCADE;
      DROP TABLE IF EXISTS profiles CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
    `);
    console.log('✅ Old tables dropped.');

    console.log('📦 Creating new schema...');
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

    // Verify
    const tables = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name;
    `);
    console.log('✅ New tables created:');
    tables.rows.forEach(r => console.log('  -', r.table_name));
    console.log('\n🎉 Migration complete!');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
