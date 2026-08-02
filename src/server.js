require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const chatRoute = require('./routes/chat');
const sessionsRoute = require('./routes/sessions');
const memoryRoute = require('./routes/memory');
const filesRoute = require('./routes/files');
const researchRoute = require('./routes/research');
const secretVaultRoute = require('./routes/secretVault');
const notificationsRoute = require('./routes/notifications');

const app = express();

app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json({ limit: '2mb' }));

// Serve the frontend from public/
app.use(express.static(path.join(__dirname, '../public')));

// Health check — useful to verify the deploy is alive
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'bob-backend' }));

app.use('/api/chat', chatRoute);
app.use('/api/sessions', sessionsRoute);
app.use('/api/memory', memoryRoute);
app.use('/api/files', filesRoute);
app.use('/api/research', researchRoute);
app.use('/api/secret', secretVaultRoute);
app.use('/api/notifications', notificationsRoute);

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
