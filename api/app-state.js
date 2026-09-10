// Key/value store for everything about the dashboard that isn't a reading
// row: takeaways, resolved-flag state, per-property notes, and the static
// reference content (quality notes, reconciliation notes, next steps).
// These fields are heterogeneous by nature (a takeaway looks nothing like
// the resolved-flags map), so rather than a wide, mostly-null table this is
// a simple id/key + JSONB value table — one row per key. Sits behind the
// same passcode gate as /api/readings.
//
//   GET /api/app-state         -> { takeaways, quality, recon, nextsteps, resolved, notes }
//   PUT /api/app-state         -> body: { key, value } — upserts one key (e.g. "takeaways")
const { getPool } = require('../lib/db');
const { ensureReady, DEFAULT_APP_STATE } = require('../lib/schema');
const { isAuthed } = require('../lib/auth');
const { redactDeep } = require('../lib/redact');

const ALLOWED_KEYS = new Set(Object.keys(DEFAULT_APP_STATE));

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(typeof req.body === 'string' ? req.body : '{}');
  } catch {
    return {};
  }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json');

  if (!isAuthed(req)) {
    res.statusCode = 401;
    res.end(JSON.stringify({ ok: false, error: 'Not authenticated' }));
    return;
  }

  const pool = getPool();
  try {
    await ensureReady(pool);
  } catch (err) {
    console.error('Database setup failed:', err);
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: 'Database is not available' }));
    return;
  }

  try {
    if (req.method === 'GET') {
      const { rows } = await pool.query('SELECT key, value FROM app_state');
      const out = { ...DEFAULT_APP_STATE };
      for (const row of rows) out[row.key] = row.value;
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, state: out }));
      return;
    }

    if (req.method === 'PUT') {
      const body = readBody(req);
      const { key, value } = body;
      if (!ALLOWED_KEYS.has(key)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: `key must be one of: ${[...ALLOWED_KEYS].join(', ')}` }));
        return;
      }
      if (value === undefined) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'value is required' }));
        return;
      }
      // Takeaways, notes, and resolved-flag notes are all free text someone typed into a
      // modal — scrub before it's ever written, not just on the way back out.
      const cleanValue = redactDeep(value);
      await pool.query(
        `INSERT INTO app_state (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, JSON.stringify(cleanValue)]
      );
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, key, value: cleanValue }));
      return;
    }

    res.statusCode = 405;
    res.setHeader('Allow', 'GET, PUT');
    res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
  } catch (err) {
    console.error('app-state API error:', err);
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: 'Unexpected server error' }));
  }
};
