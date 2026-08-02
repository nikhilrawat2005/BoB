const { auth } = require('../config/firebase');

/**
 * Expects header: Authorization: Bearer <firebase-id-token>
 * The frontend gets this token after Firebase Auth login (signInWithEmailAndPassword, etc.)
 * On success, attaches req.userId (Firebase UID) so every route can scope data to that user.
 */
const ALLOWED_EMAILS = [
  'nikhil2005114@gmail.com',
  'nikhilrawat42005@gmail.com',
  'nikhilrawat4112005@gmail.com',
  'nikhilrawat2005114@gmail.com'
];

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization Bearer token' });
  }

  try {
    const decoded = await auth.verifyIdToken(token);
    const email = (decoded.email || '').toLowerCase();

    if (!ALLOWED_EMAILS.includes(email)) {
      return res.status(403).json({ error: 'Access Denied: Your account is not authorized.' });
    }

    req.userId = decoded.uid;
    req.userEmail = email;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token', details: err.message });
  }
}

module.exports = { requireAuth };
