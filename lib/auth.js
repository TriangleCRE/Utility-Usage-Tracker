// Shared passcode-gate session verification, used by api/gate.js (which
// serves the dashboard HTML) and every data API route below it — the same
// signed-cookie check gates both, so the new endpoints sit behind the
// existing login wall rather than beside or in front of it.
const crypto = require('crypto');

const COOKIE_NAME = 'tug_session';
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function verifyToken(token, secret) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = sign(payload, secret);
  const sigBuf = Buffer.from(sig, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return false;
  }

  const issuedAt = Number(payload);
  if (!Number.isFinite(issuedAt)) return false;
  if (Date.now() - issuedAt > SESSION_MAX_AGE_MS) return false;

  return true;
}

// Parses the session cookie straight from the header so this works whether
// or not the request already went through a cookie-parsing middleware.
function readCookie(req, name) {
  if (req.cookies && req.cookies[name] !== undefined) return req.cookies[name];
  const header = req.headers && req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

function isAuthed(req) {
  const secret = process.env.PASSCODE;
  if (!secret) return false;
  const token = readCookie(req, COOKIE_NAME);
  return verifyToken(token, secret);
}

module.exports = { isAuthed, COOKIE_NAME };
