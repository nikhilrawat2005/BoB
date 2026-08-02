const { db } = require('../config/firebase');

/**
 * Firestore layout:
 * users/{userId}/sessions/{sessionId}         -> { title, createdAt, updatedAt }
 * users/{userId}/sessions/{sessionId}/messages/{messageId} -> { role, content, createdAt }
 * users/{userId}/facts/{factId}               -> { text, createdAt }
 */

async function createSession(userId, title = 'New chat') {
  const ref = db.collection('users').doc(userId).collection('sessions').doc();
  const now = Date.now();
  await ref.set({ title, createdAt: now, updatedAt: now });
  return { id: ref.id, title, createdAt: now, updatedAt: now };
}

async function updateSessionTitle(userId, sessionId, title) {
  const sessionRef = db.collection('users').doc(userId).collection('sessions').doc(sessionId);
  await sessionRef.set({ title }, { merge: true });
}

async function listSessions(userId) {
  const snap = await db
    .collection('users').doc(userId)
    .collection('sessions')
    .orderBy('updatedAt', 'desc')
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function addMessage(userId, sessionId, role, content) {
  const sessionRef = db.collection('users').doc(userId).collection('sessions').doc(sessionId);
  const msgRef = sessionRef.collection('messages').doc();
  const now = Date.now();
  await msgRef.set({ role, content, createdAt: now });
  await sessionRef.set({ updatedAt: now }, { merge: true });
  return { id: msgRef.id, role, content, createdAt: now };
}

async function getRecentMessages(userId, sessionId, limit = 20) {
  const snap = await db
    .collection('users').doc(userId)
    .collection('sessions').doc(sessionId)
    .collection('messages')
    .orderBy('createdAt', 'asc')
    .limitToLast(limit)
    .get();
  return snap.docs.map(d => d.data());
}

async function addFact(userId, text) {
  const ref = db.collection('users').doc(userId).collection('facts').doc();
  const now = Date.now();
  await ref.set({ text, createdAt: now });
  return { id: ref.id, text, createdAt: now };
}

async function listFacts(userId) {
  const snap = await db.collection('users').doc(userId).collection('facts').orderBy('createdAt', 'asc').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function deleteFact(userId, factId) {
  await db.collection('users').doc(userId).collection('facts').doc(factId).delete();
}

async function saveWeeklySummary(userId, weekId, summaryData) {
  const ref = db.collection('users').doc(userId).collection('weeklySummaries').doc(weekId);
  const now = Date.now();
  await ref.set({ ...summaryData, weekId, updatedAt: now }, { merge: true });
  return { weekId, ...summaryData, updatedAt: now };
}

async function listWeeklySummaries(userId, limit = 5) {
  const snap = await db
    .collection('users').doc(userId)
    .collection('weeklySummaries')
    .orderBy('updatedAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function addSecretNote(userId, noteText, eventDate = null) {
  const ref = db.collection('users').doc(userId).collection('secretVault').doc();
  const now = Date.now();
  await ref.set({ noteText, eventDate, createdAt: now });
  return { id: ref.id, noteText, eventDate, createdAt: now };
}

async function listSecretNotes(userId) {
  const snap = await db.collection('users').doc(userId).collection('secretVault').orderBy('createdAt', 'desc').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function deleteSecretNote(userId, noteId) {
  await db.collection('users').doc(userId).collection('secretVault').doc(noteId).delete();
}

async function addNotification(userId, title, message, type = 'reminder', promptSnippet = '') {
  const ref = db.collection('users').doc(userId).collection('notifications').doc();
  const now = Date.now();
  const notif = { id: ref.id, title, message, type, promptSnippet, read: false, createdAt: now };
  await ref.set(notif);
  return notif;
}

async function listNotifications(userId, limit = 20) {
  const snap = await db
    .collection('users').doc(userId)
    .collection('notifications')
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function deleteSession(userId, sessionId) {
  const ref = db.collection('users').doc(userId).collection('sessions').doc(sessionId);
  // Delete all messages inside session
  const msgsSnap = await ref.collection('messages').get();
  const batch = db.batch();
  msgsSnap.docs.forEach(doc => batch.delete(doc.ref));
  batch.delete(ref);
  await batch.commit();
}

async function markNotificationRead(userId, notifId) {
  await db.collection('users').doc(userId).collection('notifications').doc(notifId).set({ read: true }, { merge: true });
}

async function deleteNotification(userId, notifId) {
  await db.collection('users').doc(userId).collection('notifications').doc(notifId).delete();
}

module.exports = {
  createSession,
  updateSessionTitle,
  listSessions,
  deleteSession,
  addMessage,
  getRecentMessages,
  addFact,
  listFacts,
  deleteFact,
  saveWeeklySummary,
  listWeeklySummaries,
  addSecretNote,
  listSecretNotes,
  deleteSecretNote,
  addNotification,
  listNotifications,
  markNotificationRead,
  deleteNotification
};
