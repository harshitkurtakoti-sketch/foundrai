require('dotenv').config();
const { initSchema } = require('./db');

async function migrate() {
  console.log('📦 Initializing / Migrating database schema...');
  try {
    await initSchema();
    console.log('🎉 Database migration complete!');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  }
}

migrate();
