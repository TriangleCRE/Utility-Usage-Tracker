// Serves the dashboard for authenticated visitors, or redirects to the
// passcode login screen otherwise. The dashboard's HTML (including all
// embedded property/usage data) never leaves this function unless the
// session cookie's signature verifies against the PASSCODE secret.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const COOKIE_NAME = 'tug_session';
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // server-side backstop (browser cookie has no Max-Age, so it dies with the browser session too)

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

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');

  const secret = process.env.PASSCODE;
  const token = req.cookies && req.cookies[COOKIE_NAME];
  const authed = !!secret && verifyToken(token, secret);

  if (!authed) {
    res.statusCode = 302;
    res.setHeader('Location', '/login.html?from=%2F');
    res.end();
    return;
  }

  const html = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
};
