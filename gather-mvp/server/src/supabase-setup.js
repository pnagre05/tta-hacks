// One-time Supabase setup. Run with: npm run supabase:setup
//  1. creates the tables (schema.sql)
//  2. turns on Row Level Security on every public table, so Supabase's public API can't read them
//     (this server connects as the postgres role, which bypasses RLS, so the app is unaffected)
//  3. prints the tables with row counts
// Safe to run more than once.
require('dotenv').config();
const { query, migrate, close, useRemote } = require('./db');

async function main() {
  if (!useRemote) {
    console.log('DATABASE_URL is not set, so this is the local PGlite database. Nothing to do for Supabase.');
    return;
  }
  const { rows: info } = await query('SELECT current_database() AS db, current_user AS usr');
  console.log(`Connected to database "${info[0].db}" as "${info[0].usr}".`);

  await migrate();
  console.log('Schema applied.');

  const { rows: tables } = await query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
  );
  for (const { tablename } of tables) {
    await query(`ALTER TABLE public."${tablename}" ENABLE ROW LEVEL SECURITY`);
  }
  console.log(`Row Level Security enabled on ${tables.length} tables.`);

  const { rows: rls } = await query(
    "SELECT relname, relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY relname"
  );
  for (const { relname, relrowsecurity } of rls) {
    const { rows } = await query(`SELECT COUNT(*) AS n FROM public."${relname}"`);
    console.log(`  ${relname.padEnd(18)} rows: ${String(rows[0].n).padStart(4)}   RLS: ${relrowsecurity ? 'on' : 'OFF'}`);
  }
}

main()
  .catch((err) => {
    console.error('Setup failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => close());
