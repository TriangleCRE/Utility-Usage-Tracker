// Serves the dashboard for authenticated visitors, or redirects to the
// passcode login screen otherwise. The dashboard's HTML never leaves this
// function unless the session cookie's signature verifies against the
// PASSCODE secret. Usage/property data itself now lives in Postgres and is
// fetched client-side from /api/readings and /api/app-state, which sit
// behind this same passcode check (see lib/auth.js).
const fs = require('fs');
const path = require('path');
const { isAuthed } = require('../lib/auth');

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');

  const authed = isAuthed(req);

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
