// Verifies a submitted passcode against the PASSCODE environment variable.
// The passcode itself is never sent to, or exposed in, the browser — only a
// signed session cookie is returned on success. On failure this responds
// with a generic error and nothing about the real passcode is revealed.
const crypto = require('crypto');

const COOKIE_NAME = 'tug_session';

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

// Constant-time comparison that also avoids leaking the passcode's length.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
    return;
  }

  const secret = process.env.PASSCODE;
  if (!secret) {
    console.error('PASSCODE environment variable is not configured');
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: 'Server is not configured' }));
    return;
  }

  let body = req.body;
  if (!body || typeof body !== 'object') {
    try {
      body = JSON.parse(typeof body === 'string' ? body : '{}');
    } catch {
      body = {};
    }
  }
  const passcode = typeof body.passcode === 'string' ? body.passcode.trim() : '';

  if (!passcode || !safeEqual(passcode, secret)) {
    res.statusCode = 401;
    res.end(JSON.stringify({ ok: false, error: 'Incorrect passcode' }));
    return;
  }

  const payload = String(Date.now());
  const token = `${payload}.${sign(payload, secret)}`;
  // No Max-Age/Expires: the cookie lives for the browser session. HttpOnly +
  // Secure keep it out of reach of front-end JS and plain-HTTP snooping.
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`);
  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true }));
};
