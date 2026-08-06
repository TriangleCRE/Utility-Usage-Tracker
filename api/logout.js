// Clears the session cookie so the visitor is signed out.
const COOKIE_NAME = 'tug_session';

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true }));
};
