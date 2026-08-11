// ---------------------------------------------------------------------------
// Bob the Builder — Memory Service
// Completely separate Firestore namespace from Bob's personal data:
//   users/{uid}/builderSessions/{sessionId}                      → {title, projectType, createdAt, updatedAt, notes[]}
//   users/{uid}/builderSessions/{sessionId}/messages/{msgId}     → {role, content, createdAt}
//   users/{uid}/builderProjects/{sessionId}                      → {name, type, files[], createdAt, updatedAt}
// Project-based memory = notes[] per session + generated Prompt Pack files.
// ---------------------------------------------------------------------------
const { db } = require('../config/firebase');

const MAX_CHUNK = 400;

function coll(userId) {
  return db.collection('users').doc(userId).collection('builderSessions');
}

function msgColl(userId, sessionId) {
  return coll(userId).doc(sessionId).collection('messages');
}

// ── Sessions ────────────────────────────────────────────────
async function createBuilderSession(userId, { title = 'New Project', projectType = null } = {}) {
  const ref = coll(userId).doc();
  const now = Date.now();
  await ref.set({ title, projectType: projectType || null, createdAt: now, updatedAt: now, notes: [] });
  return { id: ref.id, title, projectType: projectType || null };
}

async function updateBuilderSessionTitle(userId, sessionId, title) {
  await coll(userId).doc(sessionId).set({ title, updatedAt: Date.now() }, { merge: true });
}

async function updateBuilderSessionProjectType(userId, sessionId, projectType) {
  await coll(userId).doc(sessionId).set({ projectType, updatedAt: Date.now() }, { merge: true });
}

async function listBuilderSessions(userId, limit = 30) {
  const snap = await coll(userId).orderBy('updatedAt', 'desc').limit(limit).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getBuilderSession(userId, sessionId) {
  const doc = await coll(userId).doc(sessionId).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

async function deleteBuilderSession(userId, sessionId) {
  const messages = await msgColl(userId, sessionId).get();
  const batches = [];
  for (const m of messages.docs) {
    if (batches.length === 0 || batches[batches.length - 1].size >= MAX_CHUNK) batches.push(db.batch());
    batches[batches.length - 1].delete(m.ref);
  }
  for (const b of batches) await b.commit();
  await coll(userId).doc(sessionId).delete();
}

// ── Messages ────────────────────────────────────────────────
// sender: 'user' | 'builder' | 'bob'  (bob = Bob sent this message into the Builder chat)
async function addBuilderMessage(userId, sessionId, role, content, sender = null) {
  const ref = msgColl(userId, sessionId).doc();
  const now = Date.now();
  await ref.set({ role, content, sender: sender || role, createdAt: now });
  await coll(userId).doc(sessionId).set({ updatedAt: now }, { merge: true });
  return { id: ref.id, role, content, sender: sender || role, createdAt: now };
}

async function getBuilderMessages(userId, sessionId, limit = 40) {
  const snap = await msgColl(userId, sessionId).orderBy('createdAt', 'asc').limitToLast(limit).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Project-based memory (notes + pack files) ───────────────
async function addBuilderNote(userId, sessionId, note) {
  await coll(userId).doc(sessionId).set(
    { notes: db.FieldValue.arrayUnion(note.trim()), updatedAt: Date.now() },
    { merge: true }
  );
}

async function getBuilderNotes(userId, sessionId) {
  const session = await getBuilderSession(userId, sessionId);
  return session && Array.isArray(session.notes) ? session.notes : [];
}

const JSZip = require('jszip');

async function saveBuilderProject(userId, sessionId, { name, type = null, files = [] }) {
  const now = Date.now();
  const ref = db.collection('users').doc(userId).collection('builderProjects').doc(sessionId);
  await ref.set({
    name: name || 'Untitled Project',
    type: type || null,
    files: files.slice(0, 50),
    createdAt: now,
    updatedAt: now,
  }, { merge: true });
  return { id: sessionId, name, type };
}

async function getBuilderProject(userId, sessionId) {
  const doc = await db.collection('users').doc(userId).collection('builderProjects').doc(sessionId).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

async function listBuilderProjects(userId, limit = 30) {
  const snap = await db.collection('users').doc(userId).collection('builderProjects')
    .orderBy('updatedAt', 'desc').limit(limit).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function generateProjectZip(userId, sessionId) {
  const project = await getBuilderProject(userId, sessionId);
  if (!project || !Array.isArray(project.files) || !project.files.length) {
    throw new Error('Project files not found for this session');
  }

  const zip = new JSZip();
  const folderName = (project.name || 'builder_project').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  const folder = zip.folder(folderName);

  for (const f of project.files) {
    if (f && f.name && f.content != null) {
      const cleanPath = String(f.name).replace(/^\/+/, '');
      folder.file(cleanPath, String(f.content));
    }
  }

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return { buffer, filename: `${folderName}.zip` };
}

module.exports = {
  createBuilderSession, updateBuilderSessionTitle, updateBuilderSessionProjectType,
  listBuilderSessions, getBuilderSession, deleteBuilderSession,
  addBuilderMessage, getBuilderMessages,
  addBuilderNote, getBuilderNotes,
  saveBuilderProject, getBuilderProject, listBuilderProjects, generateProjectZip,
};
