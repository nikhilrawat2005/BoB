require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const chatRoute          = require('./routes/chat');
const sessionsRoute      = require('./routes/sessions');
const memoryRoute        = require('./routes/memory');
const filesRoute         = require('./routes/files');
const researchRoute      = require('./routes/research');
const secretVaultRoute   = require('./routes/secretVault');
const notificationsRoute = require('./routes/notifications');
const schedulerRoute     = require('./routes/scheduler');
const liveRoute          = require('./routes/live');
const builderRoute       = require('./routes/builder');
const hackathonsRoute    = require('./routes/hackathons');
const stalkingRoute      = require('./routes/stalking');
const routinesRoute      = require('./routes/routines');
const hqRoute            = require('./routes/hq');
const selfEditRoute      = require('./routes/selfEdit');
const keysRoute          = require('./routes/keys');
const seoRoute           = require('./routes/seo');

const app = express();

app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json({ limit: '2mb' }));

// Minimal security headers (no extra dependency)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Serve the frontend from public/
app.use(express.static(path.join(__dirname, '../public')));

// Health check — useful to verify the deploy is alive
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'bob-backend' }));

// Config endpoint — serves Firebase client config from env vars.
// This keeps API keys OUT of the committed frontend JS file.
app.get('/api/config', (req, res) => {
  const cfg = {
    apiKey:            process.env.FIREBASE_CLIENT_API_KEY,
    authDomain:        process.env.FIREBASE_AUTH_DOMAIN,
    projectId:         process.env.FIREBASE_PROJECT_ID,
    storageBucket:     process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId:             process.env.FIREBASE_APP_ID,
  };
  // Only expose if the key is actually configured
  if (!cfg.apiKey) {
    return res.status(503).json({ error: 'Firebase client config not set in environment.' });
  }
  res.json(cfg);
});

// Secure endpoint for authorized accounts to set/update their password and get instant custom token
const { auth: adminAuth } = require('./config/firebase');
const ALLOWED_EMAILS = String(process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

app.post('/api/auth/set-password', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password || password.length < 6) {
      return res.status(400).json({ error: 'Valid email and password (minimum 6 characters) required.' });
    }
    const cleanEmail = email.trim().toLowerCase();
    if (!ALLOWED_EMAILS.includes(cleanEmail)) {
      return res.status(403).json({ error: 'Access Denied: Email is not in authorized list.' });
    }
    
    if (!adminAuth) {
      return res.status(500).json({ error: 'Firebase Admin not initialized on server.' });
    }

    let userRecord;
    try {
      userRecord = await adminAuth.getUserByEmail(cleanEmail);
      await adminAuth.updateUser(userRecord.uid, { password });
    } catch (userErr) {
      if (userErr.code === 'auth/user-not-found') {
        userRecord = await adminAuth.createUser({ email: cleanEmail, password });
      } else {
        throw userErr;
      }
    }

    const customToken = await adminAuth.createCustomToken(userRecord.uid);
    res.json({ success: true, customToken, message: 'Password set successfully.' });
  } catch (err) {
    console.error('[auth] Set password error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.use('/api/chat',          chatRoute);
app.use('/api/sessions',      sessionsRoute);
app.use('/api/memory',        memoryRoute);
app.use('/api/files',         filesRoute);
app.use('/api/research',      researchRoute);
app.use('/api/secret',        secretVaultRoute);
app.use('/api/notifications', notificationsRoute);
app.use('/api/scheduler',     schedulerRoute);
app.use('/api/live',          liveRoute);
app.use('/api/builder',       builderRoute);
app.use('/api/hackathons',    hackathonsRoute);
app.use('/api/stalking',      stalkingRoute);
app.use('/api/routines',      routinesRoute);
app.use('/api/hq',            hqRoute);
app.use('/api/self-edit',     selfEditRoute);
app.use('/api/keys',          keysRoute);
app.use('/api/seo',           seoRoute);

// 404 handler for unknown API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Catch-all error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;

// Vercel imports this file as a serverless function (module.exports = app),
// but app.listen also lets it run standalone locally with `npm run dev`.
if (require.main === module) {
  app.listen(PORT, () => console.log(`Bob backend running on port ${PORT}`));
}

module.exports = app;
