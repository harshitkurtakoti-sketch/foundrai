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

async function test() {
  console.log('🔌 Connecting to Aiven PostgreSQL...');
  const client = await pool.connect();

  try {
    // 1. Basic connectivity
    const res = await client.query('SELECT NOW() as time, current_database() as db');
    console.log('✅ Connected! DB:', res.rows[0].db, '| Time:', res.rows[0].time);

    // 2. Create tables
    console.log('\n📦 Creating tables...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        uid           TEXT PRIMARY KEY,
        display_name  TEXT,
        email         TEXT,
        startup_idea  TEXT,
        industry      TEXT,
        stage         TEXT DEFAULT 'idea',
        ai_preferences TEXT,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS chats (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        uid        TEXT NOT NULL,
        title      TEXT DEFAULT 'New Session',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS chats_uid_idx ON chats(uid);

      CREATE TABLE IF NOT EXISTS messages (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        chat_id    UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        uid        TEXT NOT NULL,
        role       TEXT NOT NULL CHECK (role IN ('user','assistant','agent')),
        agent      TEXT,
        content    TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS messages_chat_idx ON messages(chat_id);
    `);
    console.log('✅ Tables created (or already exist)!');

    // 3. Verify tables exist
    const tables = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);
    console.log('\n📋 Tables in DB:');
    tables.rows.forEach(r => console.log('  -', r.table_name));

    console.log('\n🎉 Database is fully ready!');
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

test();
