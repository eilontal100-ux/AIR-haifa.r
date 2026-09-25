'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('./db');
const { normalizeEmail } = require('./validation');
(async () => {
  const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
  if (!adminEmail) throw new Error('Set ADMIN_EMAIL to one of the four allowed pilot email addresses');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    // Bootstrap the first admin. Existing pilots are not silently promoted.
    await client.query("INSERT INTO pilots(email, role) VALUES ($1, 'admin') ON CONFLICT(email) DO NOTHING", [adminEmail]);
    await client.query('COMMIT');
    console.log('Database ready. Bootstrap admin:', adminEmail);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); await pool.end(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
