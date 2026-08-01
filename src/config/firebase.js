const admin = require('firebase-admin');

// Initializes Firebase Admin once, using env vars (never a committed JSON file).
// The private key comes from .env with literal "\n" — we convert those back to real newlines.
// If FIREBASE_PROJECT_ID is not set, initialization is skipped with a warning so the
// server can still start (health check, LLM-only routes work without Firebase).
function initFirebase() {
  if (admin.apps.length) return admin;

  if (!process.env.FIREBASE_PROJECT_ID) {
    console.warn(
      '[firebase] WARNING: FIREBASE_PROJECT_ID not set — Firebase Admin not initialised. ' +
      'Memory, auth, and file routes will be unavailable until you add Firebase env vars.'
    );
    return null;
  }

  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });

  return admin;
}

const firebaseAdmin = initFirebase();

// db and auth will be null when Firebase is not configured —
// any route that calls them will get a runtime error with a descriptive message.
const db   = firebaseAdmin ? firebaseAdmin.firestore() : null;
const auth = firebaseAdmin ? firebaseAdmin.auth()      : null;

module.exports = { firebaseAdmin, db, auth };
