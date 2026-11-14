// Database: real Postgres (e.g. Supabase) when DATABASE_URL is set, otherwise local PGlite.
// PGlite is Postgres running inside Node: no Docker, no install, data saved in server/data/.
// Set GATHER_DB=memory for a throwaway in-memory database (used by tests).
const fs = require('fs');
const path = require('path');

// SUPABASE_DB_URL takes priority. Some hosts (e.g. Replit) reserve the name DATABASE_URL, so it can't be set there.
const databaseUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
const useRemote = Boolean(databaseUrl);
let query;
let withTx;
let close;
let exec; // run a multi-statement SQL string with no parameters

if (useRemote) {
  const { Pool, types } = require('pg');
  // Return BIGINT (COUNT/SUM) as JS numbers. The app relies on this.
  types.setTypeParser(20, (v) => Number(v));
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false }, // Supabase and most hosted Postgres require SSL
    max: 5,
  });
  query = (text, params) => pool.query(text, params);
  exec = (sql) => pool.query(sql);
  withTx = async (fn) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  };
  close = () => pool.end();
} else {
  const { PGlite } = require('@electric-sql/pglite');
  const dataDir = process.env.GATHER_DB === 'memory'
    ? undefined
    : process.env.GATHER_DB_DIR || path.join(__dirname, '..', 'data', 'pgdata');
  if (dataDir) fs.mkdirSync(path.dirname(dataDir), { recursive: true });
  const db = new PGlite(dataDir);
  query = (text, params) => db.query(text, params);
  exec = (sql) => db.exec(sql);
  withTx = (fn) => db.transaction((tx) => fn(tx));
  close = () => db.close();
}

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await exec(sql);
}

module.exports = { query, withTx, migrate, close, exec, useRemote };
