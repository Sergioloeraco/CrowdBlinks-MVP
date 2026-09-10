const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const res = await client.query('SELECT 1');
    console.log('✅ Supabase keepalive OK:', res.rows);
  } catch (err) {
    console.error('❌ Supabase keepalive FAILED:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();