const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const res = await client.query(`
      insert into public._keepalive_heartbeat (id, pinged_at)
      values (1, now())
      on conflict (id) do update set pinged_at = now()
      returning pinged_at;
    `);
    console.log('✅ Supabase keepalive OK (write):', res.rows);
  } catch (err) {
    console.error('❌ Supabase keepalive FAILED:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();