#!/usr/bin/env node
// Standalone seed script for manual/local use, e.g.:
//   DATABASE_URL=postgres://... node scripts/seed.js
//
// Loads the original dashboard data from data/seed-readings.json and
// data/seed-app-state.json — but ONLY into tables that are completely
// empty. If `readings` (or `app_state`) already has rows, this is a no-op
// for that table, so it can never overwrite real edits once real data
// exists. Run scripts/migrate.js first if the tables don't exist yet
// (though this script also creates them if needed).
//
// The live site does NOT depend on this being run — every API request
// does this same empty-check-and-seed itself on first use (see
// lib/schema.js). This script exists purely for manual/local convenience.
const { getPool } = require('../lib/db');
const { createTables, seedIfEmpty } = require('../lib/schema');

async function main() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await createTables(client);
    const before = await client.query('SELECT COUNT(*)::int AS n FROM readings');
    console.log(`readings currently has ${before.rows[0].n} row(s).`);
    await seedIfEmpty(client);
    const after = await client.query('SELECT COUNT(*)::int AS n FROM readings');
    console.log(`readings now has ${after.rows[0].n} row(s).`);
    const state = await client.query('SELECT COUNT(*)::int AS n FROM app_state');
    console.log(`app_state has ${state.rows[0].n} row(s).`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
