'use strict';
require('dotenv').config();
// Optional: the server also sets up the database on its own when it starts.
if (!process.env.DATABASE_URL) {
  console.log('No DATABASE_URL: using the built-in database, which is set up when the server starts.');
} else {
  const { pool, setup } = require('./db');
  setup()
    .catch(err => console.error('Database setup failed (the server will retry when it starts):', err.message))
    .finally(() => pool.end());
}
