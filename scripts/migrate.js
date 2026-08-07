#!/usr/bin/env node
// Standalone schema-only migration for manual/local use, e.g.:
//   DATABASE_URL=postgres://... node scripts/migrate.js
//
// Creates the `readings` and `app_state` tables if they don't exist yet.
// Does NOT load seed data — see scripts/seed.js for that.
//
// The live site does NOT depend on this being run — every API request
// creates these same tables itself on first use (see lib/schema.js). This
// script is just a convenience for provisioning a fresh database ahead of
// time, or for local development.
const { getPool } = require('../lib/db');
const { createTables } = require('../lib/schema');

async function main() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    console.log('Creating tables (if they do not already exist)...');
    await createTables(client);
    console.log('Schema is up to date.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
