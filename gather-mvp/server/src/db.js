const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

// Return BIGINT (e.g. COUNT/SUM) as JS numbers. Safe at our scale.
types.setTypeParser(20, (v) => Number(v));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function query(text, params) {
  return pool.query(text, params);
}

// Run fn(client) inside a transaction.
async function withTx(fn) {
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
}

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

module.exports = { pool, query, withTx, migrate };
