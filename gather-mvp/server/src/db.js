// Local database: PGlite (real Postgres compiled to WASM) running inside Node.
// No Docker, no server to install, no accounts. Data is stored in server/data/ and survives restarts.
// Set GATHER_DB=memory for a throwaway in-memory database (used by tests).
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const dataDir = process.env.GATHER_DB === 'memory'
  ? undefined
  : process.env.GATHER_DB_DIR || path.join(__dirname, '..', 'data', 'pgdata');

if (dataDir) fs.mkdirSync(path.dirname(dataDir), { recursive: true });

const db = new PGlite(dataDir);

function query(text, params) {
  return db.query(text, params);
}

// Run fn(tx) inside a transaction. tx.query(text, params) works like query().
function withTx(fn) {
  return db.transaction((tx) => fn(tx));
}

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await db.exec(sql);
}

function close() {
  return db.close();
}

module.exports = { query, withTx, migrate, close };
