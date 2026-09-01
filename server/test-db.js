require('dotenv').config();
const { pool, initSchema } = require('./db');

async function test() {
  console.log('🔌 Checking Database connection & schema...');
  try {
    await initSchema();
    const res = await pool.query('SELECT id FROM users LIMIT 1');
    console.log('✅ Query test successful. Users query returned:', res.rows.length, 'records.');
    console.log('🎉 Database is fully ready!');
  } catch (err) {
    console.error('❌ Database test error:', err.message);
  }
}

test();
