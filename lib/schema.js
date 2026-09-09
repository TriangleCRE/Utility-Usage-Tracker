// Self-healing schema + seed setup. Every API request calls ensureReady()
// first: it creates the tables if they don't exist yet, and — only when a
// table is completely empty — loads the one-time seed data. Once real rows
// exist the seed step never runs again, so this can never clobber real
// edits. This means the live site never depends on anyone remembering to
// run a migration by hand; scripts/migrate.js and scripts/seed.js exist
// only as an optional manual/local alternative that calls these same
// functions.
const seedReadings = require('../data/seed-readings.json');
const seedAppState = require('../data/seed-app-state.json');

// Postgres advisory lock key — arbitrary, just needs to be consistent so
// concurrent cold-starts serialize around the same lock instead of racing
// to seed twice.
const ADVISORY_LOCK_KEY = 837451;

const CREATE_READINGS_SQL = `
  CREATE TABLE IF NOT EXISTS readings (
    id SERIAL PRIMARY KEY,
    prop TEXT NOT NULL,
    addr TEXT NOT NULL DEFAULT '',
    meter TEXT NOT NULL DEFAULT '',
    util TEXT NOT NULL,
    unit TEXT NOT NULL,
    vendor TEXT NOT NULL DEFAULT '',
    ym TEXT NOT NULL,
    val DOUBLE PRECISION NOT NULL,
    source TEXT NOT NULL DEFAULT 'Yardi'
  )
`;
const CREATE_READINGS_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_readings_prop ON readings (prop)
`;
// Runs against a table that may already exist from before "source" was tracked — ADD COLUMN
// IF NOT EXISTS is a no-op once applied, and the DEFAULT backfills every pre-existing row (all
// of which came from Yardi, the dashboard's only source before Prism/Next Century) for free.
const ADD_SOURCE_COLUMN_SQL = `
  ALTER TABLE readings ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'Yardi'
`;

const CREATE_APP_STATE_SQL = `
  CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL
  )
`;

// Keys that should exist in app_state after seeding. quality/recon/nextsteps
// are reference content with no edit UI; takeaways/resolved/notes are
// mutated through the dashboard.
const DEFAULT_APP_STATE = {
  takeaways: seedAppState.takeaways,
  quality: seedAppState.quality,
  recon: seedAppState.recon,
  nextsteps: seedAppState.nextsteps,
  resolved: {},
  notes: {},
};

let readyPromise = null;

// Called by every API request. Cached in-process so a warm serverless
// instance doesn't re-check on every request, but never cache a failure —
// a transient DB hiccup on one request shouldn't permanently mark the
// instance "ready".
async function ensureReady(pool) {
  if (!readyPromise) {
    readyPromise = doEnsureReady(pool).catch((err) => {
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}

async function doEnsureReady(pool) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    try {
      await createTables(client);
      await seedIfEmpty(client);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

// Schema only — no seeding. Used by scripts/migrate.js and internally by
// ensureReady().
async function createTables(client) {
  await client.query(CREATE_READINGS_SQL);
  await client.query(ADD_SOURCE_COLUMN_SQL);
  await client.query(CREATE_READINGS_INDEX_SQL);
  await client.query(CREATE_APP_STATE_SQL);
}

// Loads seed data into whichever tables are completely empty. Safe to call
// repeatedly — once a table has any rows (real data), this is a no-op for
// it forever. Used by scripts/seed.js and internally by ensureReady().
async function seedIfEmpty(client) {
  const { rows: readingsCount } = await client.query('SELECT COUNT(*)::int AS n FROM readings');
  if (readingsCount[0].n === 0 && seedReadings.length) {
    await seedReadingsTable(client);
  }

  const { rows: stateCount } = await client.query('SELECT COUNT(*)::int AS n FROM app_state');
  if (stateCount[0].n === 0) {
    await seedAppStateTable(client);
  }
}

async function seedReadingsTable(client) {
  await client.query('BEGIN');
  try {
    const cols = ['prop', 'addr', 'meter', 'util', 'unit', 'vendor', 'ym', 'val', 'source'];
    const chunkSize = 500;
    for (let i = 0; i < seedReadings.length; i += chunkSize) {
      const chunk = seedReadings.slice(i, i + chunkSize);
      const values = [];
      const placeholders = chunk.map((r, idx) => {
        const base = idx * cols.length;
        values.push(r.prop, r.addr || '', r.meter || '', r.util, r.unit, r.vendor || '', r.ym, r.val, r.source || 'Yardi');
        return '(' + cols.map((_, j) => `$${base + j + 1}`).join(',') + ')';
      });
      await client.query(
        `INSERT INTO readings (${cols.join(',')}) VALUES ${placeholders.join(',')}`,
        values
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function seedAppStateTable(client) {
  await client.query('BEGIN');
  try {
    for (const [key, value] of Object.entries(DEFAULT_APP_STATE)) {
      await client.query(
        'INSERT INTO app_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
        [key, JSON.stringify(value)]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

module.exports = {
  ensureReady,
  createTables,
  seedIfEmpty,
  DEFAULT_APP_STATE,
};
