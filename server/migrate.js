'use strict';
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { normalizeEmail } = require('./validation');
(async () => {
  if (!process.env.DATABASE_URL) {
    console.log('No DATABASE_URL: using the built-in database, which is set up when the server starts.');
    return;
  }
  const { pool } = require('./db');
  const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    // Bootstrap the first admin. Existing pilots are not silently promoted.
    if (adminEmail) await client.query("INSERT INTO pilots(email, role) VALUES ($1, 'admin') ON CONFLICT(email) DO NOTHING", [adminEmail]);
    await client.query('COMMIT');
    console.log('Database ready. Bootstrap admin:', adminEmail || 'first pilot to sign in');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); await pool.end(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
