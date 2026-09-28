'use strict';
require('dotenv').config();

if (process.env.DATABASE_URL) {
  const fs = require('node:fs');
  const path = require('node:path');
  const { Pool } = require('pg');
  const { normalizeEmail } = require('./validation');
  // Tolerate a pasted `psql 'postgresql://...'` snippet or surrounding quotes.
  const url = process.env.DATABASE_URL.trim().replace(/^psql\s+/i, '').replace(/^(['"])(.*)\1$/, '$2');
  const raw = new Pool({
    connectionString: url,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
    max: 10,
    idleTimeoutMillis: 30000,
  });
  // Create the tables and bootstrap admin before the first query, whatever the start
  // command; if the database is unreachable, the next query tries again.
  async function setupSchema() {
    const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
    const client = await raw.connect();
    try {
      await client.query('BEGIN');
      await client.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
      // Bootstrap the first admin. Existing pilots are not silently promoted.
      if (adminEmail) await client.query("INSERT INTO pilots(email, role) VALUES ($1, 'admin') ON CONFLICT(email) DO NOTHING", [adminEmail]);
      await client.query('COMMIT');
      console.log('Database ready. Bootstrap admin:', adminEmail || 'first pilot to sign in');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally { client.release(); }
  }
  let ready;
  const setup = () => (ready ??= setupSchema().catch(err => { ready = undefined; throw err; }));
  const pool = {
    async connect() { await setup(); return raw.connect(); },
    end: () => raw.end(),
  };
  module.exports = { pool, query: async (sql, params) => { await setup(); return raw.query(sql, params); }, setup };
} else {
  // No DATABASE_URL: keep the data in this process's memory using pg-mem, a
  // lightweight PostgreSQL emulator (small enough for a 512 MB instance). The
  // data is lost whenever the server restarts.
  const fs = require('node:fs');
  const path = require('node:path');
  const { newDb, DataType } = require('pg-mem');
  const { normalizeEmail } = require('./validation');

  const mem = newDb();
  // Single process, and queries below already run one at a time.
  mem.public.registerFunction({ name: 'pg_advisory_xact_lock', args: [DataType.bigint], returns: DataType.text, implementation: () => '' });
  mem.public.none(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  const { Pool } = mem.adapters.createPg();
  const memPool = new Pool();
  const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
  const ready = (async () => {
    if (adminEmail) await memPool.query("INSERT INTO pilots(email, role) VALUES ($1, 'admin') ON CONFLICT(email) DO NOTHING", [adminEmail]);
    console.log(`Built-in database ready (in memory, lost on restart). Bootstrap admin: ${adminEmail || 'first pilot to sign in'}`);
  })();
  ready.catch(err => { console.error(err); process.exit(1); });

  // Queries and transactions take turns so a transaction never interleaves with other queries.
  let queue = ready;
  const acquire = () => {
    let release;
    const turn = new Promise(resolve => { release = resolve; });
    const acquired = queue.then(() => release);
    queue = queue.then(() => turn);
    return acquired;
  };
  // pg-mem does not parse row locks; they are unnecessary here since queries take turns.
  const run = (sql, params) => memPool.query(sql.replace(/\s+FOR UPDATE(\s+OF\s+\w+(\s*,\s*\w+)*)?\s*$/i, ''), params);
  const pool = {
    async connect() {
      const release = await acquire();
      return { query: run, release };
    },
    end: () => memPool.end(),
  };
  const query = async (sql, params) => {
    const client = await pool.connect();
    try { return await client.query(sql, params); } finally { client.release(); }
  };
  module.exports = { pool, query, setup: () => ready };
}
