// scripts/supabase-keepalive.js
async function main() {
  const url = `${process.env.SUPABASE_URL}/rest/v1/_keepalive_heartbeat?on_conflict=id`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify([{ id: 1, pinged_at: new Date().toISOString() }]),
  });

  if (!res.ok) {
    console.error('❌ Supabase keepalive FAILED:', res.status, await res.text());
    process.exit(1);
  }
  console.log('✅ Supabase keepalive OK (REST write):', await res.json());
}

main();