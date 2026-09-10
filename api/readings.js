// CRUD for the raw utility-usage readings behind the dashboard's charts and
// tables. Sits behind the same passcode gate as the dashboard itself — every
// request is rejected before it touches the database unless the session
// cookie checks out. Data lives in Postgres; the table is created and seeded
// on first use by ensureReady() (see lib/schema.js), so the live site never
// depends on a migration being run by hand.
//
//   GET    /api/readings                 -> { records: [...] }
//   POST   /api/readings                 -> body: a single reading, or { records: [...] } for bulk
//                                            (used by the "Add reading" modal and CSV import)
//   PUT    /api/readings?id=123          -> body: fields to update (typically { val })
//   DELETE /api/readings?id=123          -> delete one reading
//   DELETE /api/readings?ids=1,2,3       -> delete several at once (used by "Delete property")
const { getPool } = require('../lib/db');
const { ensureReady } = require('../lib/schema');
const { isAuthed } = require('../lib/auth');
const { redactDeep } = require('../lib/redact');

const FIELDS = ['prop', 'addr', 'meter', 'util', 'unit', 'vendor', 'ym', 'val', 'source'];

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(typeof req.body === 'string' ? req.body : '{}');
  } catch {
    return {};
  }
}

function validateRecord(r) {
  if (!r || typeof r !== 'object') return 'Reading must be an object';
  if (!r.prop || typeof r.prop !== 'string') return 'prop is required';
  if (!r.util || typeof r.util !== 'string') return 'util is required';
  if (!r.unit || typeof r.unit !== 'string') return 'unit is required';
  if (!r.ym || typeof r.ym !== 'string' || !/^\d{4}-\d{2}$/.test(r.ym)) return 'ym must be like "2026-01"';
  const val = Number(r.val);
  if (!Number.isFinite(val)) return 'val must be a number';
  return null;
}

function rowToRecord(row) {
  return {
    id: row.id,
    prop: row.prop,
    addr: row.addr,
    meter: row.meter,
    util: row.util,
    unit: row.unit,
    vendor: row.vendor,
    ym: row.ym,
    val: Number(row.val),
    source: row.source,
  };
}

async function insertOne(client, r) {
  const { rows } = await client.query(
    `INSERT INTO readings (prop, addr, meter, util, unit, vendor, ym, val, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [r.prop, r.addr || '', r.meter || '', r.util, r.unit, r.vendor || '', r.ym, Number(r.val), r.source || 'Yardi']
  );
  return rowToRecord(rows[0]);
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
      const { rows } = await pool.query('SELECT * FROM readings ORDER BY id');
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, records: rows.map(rowToRecord) }));
      return;
    }

    if (req.method === 'POST') {
      const body = readBody(req);
      // prop/addr/meter/vendor are all free text someone typed in (or pasted via CSV import) —
      // scrub before it's ever validated or written, not just on the way back out.
      const list = (Array.isArray(body.records) ? body.records : [body]).map(redactDeep);
      if (!list.length) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'No records provided' }));
        return;
      }
      for (const r of list) {
        const err = validateRecord(r);
        if (err) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: err }));
          return;
        }
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const created = [];
        for (const r of list) created.push(await insertOne(client, r));
        await client.query('COMMIT');
        res.statusCode = 201;
        res.end(JSON.stringify({ ok: true, records: created }));
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      return;
    }

    if (req.method === 'PUT') {
      const id = Number(req.query && req.query.id);
      if (!Number.isInteger(id)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'A numeric ?id= is required' }));
        return;
      }
      const body = redactDeep(readBody(req));
      const sets = [];
      const values = [];
      for (const f of FIELDS) {
        if (body[f] === undefined) continue;
        if (f === 'val') {
          const v = Number(body.val);
          if (!Number.isFinite(v)) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: 'val must be a number' }));
            return;
          }
          values.push(v);
        } else {
          values.push(String(body[f]));
        }
        sets.push(`${f} = $${values.length}`);
      }
      if (!sets.length) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'No updatable fields provided' }));
        return;
      }
      values.push(id);
      const { rows } = await pool.query(
        `UPDATE readings SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
        values
      );
      if (!rows.length) {
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false, error: 'Reading not found' }));
        return;
      }
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, record: rowToRecord(rows[0]) }));
      return;
    }

    if (req.method === 'DELETE') {
      const q = req.query || {};
      let ids = [];
      if (q.ids) {
        ids = String(q.ids)
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isInteger(n));
      } else if (q.id !== undefined) {
        const n = Number(q.id);
        if (Number.isInteger(n)) ids = [n];
      }
      if (!ids.length) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'A numeric ?id= or ?ids= is required' }));
        return;
      }
      const { rowCount } = await pool.query('DELETE FROM readings WHERE id = ANY($1::int[])', [ids]);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, deleted: rowCount }));
      return;
    }

    res.statusCode = 405;
    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
  } catch (err) {
    console.error('readings API error:', err);
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: 'Unexpected server error' }));
  }
};
