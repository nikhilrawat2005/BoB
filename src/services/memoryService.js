const { db, firebaseAdmin } = require('../config/firebase');

/**
 * Firestore layout:
 * users/{userId}/sessions/{sessionId}         -> { title, createdAt, updatedAt }
 * users/{userId}/sessions/{sessionId}/messages/{messageId} -> { role, content, createdAt }
 * users/{userId}/facts/{factId}               -> { text, createdAt }
 * users/{userId}/memoryMonths/{monthId}       -> { monthId, chunks: [{ts, points}], updatedAt, lastChunkTs, finalized?, closedAt? }
 * users/{userId}/monthlyFiles/{monthId}       -> { filename, content, mime, monthId, createdAt }
 */

async function createSession(userId, title = 'New chat', type = 'chat') {
  const ref = db.collection('users').doc(userId).collection('sessions').doc();
  const now = Date.now();
  await ref.set({ title, type, createdAt: now, updatedAt: now });
  return { id: ref.id, title, type, createdAt: now, updatedAt: now };
}

async function updateSessionTitle(userId, sessionId, title) {
  const sessionRef = db.collection('users').doc(userId).collection('sessions').doc(sessionId);
  await sessionRef.set({ title }, { merge: true });
}

async function listSessions(userId, type = null) {
  let query = db.collection('users').doc(userId).collection('sessions');
  if (type) {
    query = query.where('type', '==', type);
  }
  const snap = await query.orderBy('updatedAt', 'desc').get();
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

// Adds a fact only if an identical one doesn't already exist (case-insensitive).
// Returns null when skipped — used by auto-extraction paths to avoid duplicates.
async function addFactUnique(userId, text) {
  const snap = await db.collection('users').doc(userId).collection('facts').get();
  const needle = String(text).trim().toLowerCase();
  const exists = snap.docs.some(d => (String(d.data().text || '').trim().toLowerCase() === needle));
  if (exists) return null;
  return addFact(userId, text);
}

async function listFacts(userId) {
  const snap = await db.collection('users').doc(userId).collection('facts').orderBy('createdAt', 'asc').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function deleteFact(userId, factId) {
  await db.collection('users').doc(userId).collection('facts').doc(factId).delete();
}

async function updateFact(userId, factId, text) {
  const ref = db.collection('users').doc(userId).collection('facts').doc(factId);
  const now = Date.now();
  await ref.set({ text, updatedAt: now }, { merge: true });
  return { id: factId, text, updatedAt: now };
}

async function consolidateAllMemory(userId) {
  const existingFacts = await listFacts(userId);
  const seenTexts = new Set(existingFacts.map(f => String(f.text || '').trim().toLowerCase()));
  const addedPoints = [];

  try {
    const snapMonths = await db.collection('users').doc(userId).collection('memoryMonths').get();
    for (const doc of snapMonths.docs) {
      const data = doc.data() || {};
      const chunks = data.chunks || [];
      for (const chunk of chunks) {
        const rawPoints = String(chunk.points || '');
        const lines = rawPoints
          .split(/\r?\n/)
          .map(l => l.replace(/^[-*•\d.)\s]+/, '').trim())
          .filter(Boolean);

        for (const line of lines) {
          if (line.length > 3 && !seenTexts.has(line.toLowerCase())) {
            seenTexts.add(line.toLowerCase());
            const newFact = await addFact(userId, line);
            addedPoints.push(newFact);
          }
        }
      }
    }
  } catch (err) {
    console.error('[Memory] Error consolidating monthly chunks:', err.message);
  }

  const allFacts = await listFacts(userId);
  return {
    totalFacts: allFacts.length,
    newlyImported: addedPoints.length,
    facts: allFacts,
  };
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

// ─────────────────────────────────────────────────────────
// MONTHLY MEMORY (append-only chunks — nothing is overwritten)
// ─────────────────────────────────────────────────────────

async function getMessagesSince(userId, sessionId, afterTs, limit = 50) {
  const snap = await db
    .collection('users').doc(userId)
    .collection('sessions').doc(sessionId)
    .collection('messages')
    .orderBy('createdAt', 'asc')
    .startAfter(afterTs)
    .limit(limit)
    .get();
  return snap.docs.map(d => d.data());
}

async function saveMonthlyChunk(userId, monthId, points) {
  const ref = db.collection('users').doc(userId).collection('memoryMonths').doc(monthId);
  const now = Date.now();
  const chunk = { ts: now, points };
  await ref.set(
    {
      monthId,
      chunks: firebaseAdmin.firestore.FieldValue.arrayUnion(chunk),
      updatedAt: now,
      lastChunkTs: now,
    },
    { merge: true }
  );
  return { monthId, chunk, updatedAt: now };
}

async function getMonthMemory(userId, monthId) {
  const doc = await db.collection('users').doc(userId).collection('memoryMonths').doc(monthId).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

async function listMonthMemory(userId, limit = 12) {
  const snap = await db
    .collection('users').doc(userId)
    .collection('memoryMonths')
    .orderBy('updatedAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function finalizeMonth(userId, monthId) {
  await db
    .collection('users').doc(userId)
    .collection('memoryMonths').doc(monthId)
    .set({ finalized: true, closedAt: Date.now() }, { merge: true });
}

async function saveMonthlyFile(userId, monthId, fileData) {
  const ref = db.collection('users').doc(userId).collection('monthlyFiles').doc(monthId);
  const now = Date.now();
  await ref.set({ ...fileData, monthId, createdAt: now });
  return { id: monthId, ...fileData, createdAt: now };
}

async function listMonthlyFiles(userId, limit = 12) {
  const snap = await db
    .collection('users').doc(userId)
    .collection('monthlyFiles')
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getMonthlyFile(userId, monthId) {
  const doc = await db.collection('users').doc(userId).collection('monthlyFiles').doc(monthId).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

async function getMonthMemoryText(userId, monthId) {
  const month = await getMonthMemory(userId, monthId);
  if (!month || !month.chunks || !month.chunks.length) return null;
  return month.chunks
    .slice()
    .sort((a, b) => (a.ts || 0) - (b.ts || 0))
    .map(c => c.points)
    .filter(Boolean)
    .join('\n');
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

async function addVaultMessage(userId, role, content) {
  const ref = db.collection('users').doc(userId).collection('vaultMessages').doc();
  const msg = { id: ref.id, role, content, createdAt: Date.now() };
  await ref.set(msg);
  return msg;
}

async function getVaultMessages(userId, limit = 50) {
  const snap = await db.collection('users').doc(userId).collection('vaultMessages').orderBy('createdAt', 'asc').limit(limit).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function clearVaultMessages(userId) {
  await deleteAllInCollection(db.collection('users').doc(userId).collection('vaultMessages'));
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
  // Delete all messages inside session (chunked — batch max is 500 ops)
  await deleteAllInCollection(ref.collection('messages'));
  await ref.delete();
}

async function deleteAllInCollection(collectionRef, chunkSize = 400) {
  const snap = await collectionRef.get();
  const refs = snap.docs.map(d => d.ref);
  for (let i = 0; i < refs.length; i += chunkSize) {
    const batch = db.batch();
    refs.slice(i, i + chunkSize).forEach(r => batch.delete(r));
    await batch.commit();
  }
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
  addFactUnique,
  listFacts,
  deleteFact,
  updateFact,
  consolidateAllMemory,
  saveWeeklySummary,
  listWeeklySummaries,
  getMessagesSince,
  saveMonthlyChunk,
  getMonthMemory,
  listMonthMemory,
  finalizeMonth,
  saveMonthlyFile,
  listMonthlyFiles,
  getMonthlyFile,
  getMonthMemoryText,
  addSecretNote,
  listSecretNotes,
  deleteSecretNote,
  addNotification,
  listNotifications,
  markNotificationRead,
  deleteNotification,
  addVaultMessage,
  getVaultMessages,
  clearVaultMessages,
};
