'use strict';
require('dotenv').config();

if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
    max: 10,
    idleTimeoutMillis: 30000,
  });
  module.exports = { pool, query: (sql, params) => pool.query(sql, params) };
} else {
  // No DATABASE_URL: run PostgreSQL inside this process (PGlite). Data is kept in
  // DATA_DIR if set (e.g. a mounted disk); otherwise it lives in memory and is
  // lost whenever the server restarts.
  const fs = require('node:fs');
  const path = require('node:path');
  const { PGlite } = require('@electric-sql/pglite');
  const { normalizeEmail } = require('./validation');

  const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
  if (!adminEmail) throw new Error('Set ADMIN_EMAIL to one of the four allowed pilot email addresses');
  const dataDir = process.env.DATA_DIR;
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const db = new PGlite(dataDir || undefined);

  const ready = (async () => {
    await db.waitReady;
    await db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    await db.query("INSERT INTO pilots(email, role) VALUES ($1, 'admin') ON CONFLICT(email) DO NOTHING", [adminEmail]);
    console.log(`Built-in database ready (${dataDir ? `stored in ${dataDir}` : 'in memory, lost on restart'}). Bootstrap admin: ${adminEmail}`);
  })();
  ready.catch(err => { console.error(err); process.exit(1); });

  // PGlite has a single connection, so queries and transactions take turns.
  let queue = ready;
  const acquire = () => {
    let release;
    const turn = new Promise(resolve => { release = resolve; });
    const acquired = queue.then(() => release);
    queue = queue.then(() => turn);
    return acquired;
  };
  const pool = {
    async connect() {
      const release = await acquire();
      return { query: (sql, params) => db.query(sql, params), release };
    },
    end: () => db.close(),
  };
  const query = async (sql, params) => {
    const client = await pool.connect();
    try { return await client.query(sql, params); } finally { client.release(); }
  };
  module.exports = { pool, query };
}
