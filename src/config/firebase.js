const admin = require('firebase-admin');

// Initializes Firebase Admin once, using env vars (never a committed JSON file).
// The private key comes from .env with literal "\n" — we convert those back to real newlines.
function initFirebase() {
  if (admin.apps.length) return admin;

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
const db = firebaseAdmin.firestore();
const auth = firebaseAdmin.auth();

module.exports = { firebaseAdmin, db, auth };
