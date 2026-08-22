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

function formatISTDate(epochMs) {
  const d = new Date(epochMs || Date.now());
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

async function addMessage(userId, sessionId, role, content) {
  const sessionRef = db.collection('users').doc(userId).collection('sessions').doc(sessionId);
  const msgRef = sessionRef.collection('messages').doc();
  const now = Date.now();
  const timeFormatted = formatISTDate(now);
  const msgData = { role, content, createdAt: now, timestamp: timeFormatted };
  await msgRef.set(msgData);
  await sessionRef.set({ updatedAt: now }, { merge: true });
  return { id: msgRef.id, ...msgData };
}

async function getRecentMessages(userId, sessionId, limit = 20) {
  const snap = await db
    .collection('users').doc(userId)
    .collection('sessions').doc(sessionId)
    .collection('messages')
    .orderBy('createdAt', 'asc')
    .limitToLast(limit)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Session-Level Rolling Weekly Summaries
 * users/{userId}/sessions/{sessionId}/summaries/{summaryId}
 */
async function saveSessionWeeklySummary(userId, sessionId, weekKey, summaryText, meta = {}) {
  const ref = db.collection('users').doc(userId).collection('sessions').doc(sessionId).collection('summaries').doc(weekKey);
  const now = Date.now();
  const data = {
    weekKey,
    summaryText,
    updatedAt: now,
    timestamp: formatISTDate(now),
    mergedThroughTs: meta.mergedThroughTs || now,
    messageCount: meta.messageCount || 0,
    cycleIndex: meta.cycleIndex || 1,
  };
  await ref.set(data, { merge: true });
  // Also store on session doc for fast single-read lookup
  await db.collection('users').doc(userId).collection('sessions').doc(sessionId).set({
    latestSummary: summaryText,
    latestSummaryWeek: weekKey,
    latestSummaryTs: now,
  }, { merge: true });
  return data;
}

async function getSessionLatestSummary(userId, sessionId) {
  const sessDoc = await db.collection('users').doc(userId).collection('sessions').doc(sessionId).get();
  if (sessDoc.exists && sessDoc.data()?.latestSummary) {
    return {
      summaryText: sessDoc.data().latestSummary,
      weekKey: sessDoc.data().latestSummaryWeek,
      ts: sessDoc.data().latestSummaryTs,
    };
  }
  const snap = await db.collection('users').doc(userId).collection('sessions').doc(sessionId).collection('summaries').orderBy('updatedAt', 'desc').limit(1).get();
  if (snap.empty) return null;
  return snap.docs[0].data();
}

async function listSessionSummaries(userId, sessionId) {
  const snap = await db.collection('users').doc(userId).collection('sessions').doc(sessionId).collection('summaries').orderBy('updatedAt', 'asc').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}


const VALID_CATEGORIES = ['habits', 'main', 'hackathons', 'stalker', 'vault', 'builder'];

function detectCategory(text, explicitCategory) {
  if (explicitCategory && VALID_CATEGORIES.includes(explicitCategory)) {
    return explicitCategory;
  }
  const t = String(text || '').toLowerCase().trim();
  if (
    t.startsWith('[habit/preference]') ||
    t.startsWith('[habit]') ||
    t.startsWith('[preference]') ||
    t.includes('prefers ') ||
    t.includes('habit/preference') ||
    t.includes('habits / preferences')
  ) {
    return 'habits';
  }
  if (
    t.includes('hackathon') ||
    t.includes('devpost') ||
    t.includes('unstop') ||
    t.includes('problem statement') ||
    t.includes('hackathon rules') ||
    t.includes('team member') ||
    t.includes('submission deadline')
  ) {
    return 'hackathons';
  }
  if (
    t.includes('stalker') ||
    t.includes('target profile') ||
    t.includes('crawled') ||
    t.includes('profiles to be stored') ||
    t.includes('profiles are:')
  ) {
    return 'stalker';
  }
  if (
    t.includes('secret vault') ||
    t.includes('vault') ||
    t.includes('passcode') ||
    t.includes('confidential') ||
    t.includes('private key') ||
    t.includes('secret:') ||
    t.includes('pin:')
  ) {
    return 'vault';
  }
  if (
    t.includes('builder') ||
    t.includes('codebase') ||
    t.includes('architecture') ||
    t.includes('vibecoding') ||
    t.includes('backend') ||
    t.includes('frontend') ||
    t.includes('tech stack') ||
    t.includes('learning dsa') ||
    t.includes('data structures and algorithms') ||
    t.includes('system setup')
  ) {
    return 'builder';
  }
  return 'main';
}

async function addFact(userId, text, category = null, options = {}) {
  const ref = db.collection('users').doc(userId).collection('facts').doc();
  const now = Date.now();
  const cat = detectCategory(text, category);
  const defaultTitle = cat === 'stalker' ? 'Stalker Intelligence' : cat === 'hackathons' ? 'Hackathons' : cat === 'habits' ? 'Habits & Preferences' : 'Main Memory';
  const sourceTitle = options.sourceTitle || defaultTitle;
  const sourceType = options.sourceType || (cat === 'stalker' ? 'stalker' : cat === 'hackathons' ? 'hackathon' : 'chat');
  const sessionId = options.sessionId || null;

  const factData = {
    text: String(text).trim(),
    category: cat,
    sourceTitle: String(sourceTitle).trim(),
    sourceType,
    sessionId,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(factData);
  return { id: ref.id, ...factData };
}

// Adds a fact only if an identical one doesn't already exist (case-insensitive).
// Returns null when skipped — used by auto-extraction paths to avoid duplicates.
async function addFactUnique(userId, text, category = null, options = {}) {
  const snap = await db.collection('users').doc(userId).collection('facts').get();
  const needle = String(text).trim().toLowerCase();
  const exists = snap.docs.some(d => (String(d.data().text || '').trim().toLowerCase() === needle));
  if (exists) return null;
  return addFact(userId, text, category, options);
}

async function syncSessionFactTitles(userId, sessionId, newTitle) {
  if (!userId || !sessionId || !newTitle) return;
  try {
    const snap = await db.collection('users').doc(userId).collection('facts').where('sessionId', '==', sessionId).get();
    if (snap.empty) return;
    const batch = db.batch();
    const now = Date.now();
    snap.docs.forEach(doc => {
      batch.set(doc.ref, { sourceTitle: String(newTitle).trim(), updatedAt: now }, { merge: true });
    });
    await batch.commit();
  } catch (err) {
    console.error('[Memory] syncSessionFactTitles error:', err.message);
  }
}

async function getDynamicScopedMemory(userId, options = {}) {
  const [all, latestSummaryData] = await Promise.all([
    listFacts(userId),
    options.sessionId ? getSessionLatestSummary(userId, options.sessionId) : Promise.resolve(null),
  ]);

  const habits = all.filter(f => (f.category || 'main') === 'habits');

  let scoped = [];
  const activeSessionId = options.sessionId;
  const activeTitle = (options.sessionTitle || '').toLowerCase().trim();

  if (activeSessionId) {
    scoped = all.filter(f => f.sessionId === activeSessionId || (activeTitle && f.sourceTitle && f.sourceTitle.toLowerCase().trim() === activeTitle && f.category !== 'habits'));
  } else if (options.category) {
    scoped = all.filter(f => (f.category || 'main') === options.category);
  } else if (activeTitle) {
    scoped = all.filter(f => f.sourceTitle && f.sourceTitle.toLowerCase().trim() === activeTitle && f.category !== 'habits');
  }

  return {
    habits,
    scoped,
    rollingSummary: latestSummaryData ? latestSummaryData.summaryText : null,
    allCount: all.length,
  };
}


async function listFacts(userId) {
  const snap = await db.collection('users').doc(userId).collection('facts').orderBy('createdAt', 'asc').get();
  return snap.docs.map(d => {
    const data = d.data() || {};
    const text = data.text || '';
    const category = detectCategory(text, data.category);
    const defaultTitle = category === 'stalker' ? 'Stalker Intelligence' : category === 'hackathons' ? 'Hackathons' : category === 'habits' ? 'Habits & Preferences' : 'Main Memory';
    return {
      id: d.id,
      text,
      category,
      sourceTitle: data.sourceTitle || defaultTitle,
      sourceType: data.sourceType || (category === 'stalker' ? 'stalker' : category === 'hackathons' ? 'hackathon' : 'chat'),
      sessionId: data.sessionId || null,
      createdAt: data.createdAt || 0,
      updatedAt: data.updatedAt || data.createdAt || 0,
    };
  });
}

async function deleteFact(userId, factId) {
  await db.collection('users').doc(userId).collection('facts').doc(factId).delete();
}

async function updateFact(userId, factId, text, category = null, options = {}) {
  const ref = db.collection('users').doc(userId).collection('facts').doc(factId);
  const now = Date.now();
  const cat = detectCategory(text, category);
  const updateData = { text: String(text).trim(), category: cat, updatedAt: now };
  if (options.sourceTitle) updateData.sourceTitle = String(options.sourceTitle).trim();
  if (options.sourceType) updateData.sourceType = options.sourceType;
  if (options.sessionId !== undefined) updateData.sessionId = options.sessionId;
  await ref.set(updateData, { merge: true });
  return { id: factId, ...updateData };
}

async function updateFactCategory(userId, factId, category) {
  if (!VALID_CATEGORIES.includes(category)) {
    throw new Error(`Invalid category: ${category}`);
  }
  const ref = db.collection('users').doc(userId).collection('facts').doc(factId);
  const now = Date.now();
  await ref.set({ category, updatedAt: now }, { merge: true });
  return { id: factId, category, updatedAt: now };
}

/**
 * Bulk saves / replaces all facts of a specific category from raw lines/points
 */
async function saveCategoryFacts(userId, category, points) {
  if (!VALID_CATEGORIES.includes(category)) {
    throw new Error(`Invalid category: ${category}`);
  }
  
  // Clean points array
  const cleanPoints = (Array.isArray(points) ? points : String(points || '').split(/\r?\n/))
    .map(p => p.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter(p => p.length > 0);

  // Fetch all existing facts
  const existingFacts = await listFacts(userId);
  
  // Find docs that currently belong to this category
  const toDelete = existingFacts.filter(f => f.category === category);
  
  // Delete old docs of this category
  const batchSize = 100;
  for (let i = 0; i < toDelete.length; i += batchSize) {
    const chunk = toDelete.slice(i, i + batchSize);
    const batch = db.batch();
    chunk.forEach(f => {
      batch.delete(db.collection('users').doc(userId).collection('facts').doc(f.id));
    });
    await batch.commit();
  }

  // Insert new points
  const now = Date.now();
  const defaultTitle = category === 'stalker' ? 'Stalker Intelligence' : category === 'hackathons' ? 'Hackathons' : category === 'habits' ? 'Habits & Preferences' : 'Main Memory';
  const added = [];
  for (let i = 0; i < cleanPoints.length; i += batchSize) {
    const chunk = cleanPoints.slice(i, i + batchSize);
    const batch = db.batch();
    chunk.forEach((pt, idx) => {
      let finalPoint = pt;
      // Auto-tag habits if not already tagged
      if (category === 'habits' && !finalPoint.toLowerCase().startsWith('[habit/preference]')) {
        finalPoint = `[Habit/Preference]: ${finalPoint}`;
      }
      const ref = db.collection('users').doc(userId).collection('facts').doc();
      const docData = {
        text: finalPoint,
        category,
        sourceTitle: defaultTitle,
        sourceType: category === 'stalker' ? 'stalker' : category === 'hackathons' ? 'hackathon' : 'chat',
        sessionId: null,
        createdAt: now + i + idx,
        updatedAt: now + i + idx,
      };
      batch.set(ref, docData);
      added.push({ id: ref.id, ...docData });
    });
    await batch.commit();
  }

  const updatedAll = await listFacts(userId);
  return {
    category,
    savedCount: added.length,
    facts: updatedAll,
  };
}

/**
 * Bulk saves / replaces facts for a specific Page / SourceTitle within a category
 */
async function savePageFacts(userId, { category = 'main', sourceTitle, sourceType = 'chat', sessionId = null, points }) {
  const cat = detectCategory('', category);
  const title = String(sourceTitle || '').trim() || (cat === 'stalker' ? 'Stalker Intelligence' : cat === 'hackathons' ? 'Hackathons' : 'Main Memory');
  
  const cleanPoints = (Array.isArray(points) ? points : String(points || '').split(/\r?\n/))
    .map(p => p.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter(p => p.length > 0);

  const existingFacts = await listFacts(userId);
  const toDelete = existingFacts.filter(f => f.sourceTitle.toLowerCase() === title.toLowerCase());

  const batchSize = 100;
  for (let i = 0; i < toDelete.length; i += batchSize) {
    const chunk = toDelete.slice(i, i + batchSize);
    const batch = db.batch();
    chunk.forEach(f => {
      batch.delete(db.collection('users').doc(userId).collection('facts').doc(f.id));
    });
    await batch.commit();
  }

  const now = Date.now();
  const added = [];
  for (let i = 0; i < cleanPoints.length; i += batchSize) {
    const chunk = cleanPoints.slice(i, i + batchSize);
    const batch = db.batch();
    chunk.forEach((pt, idx) => {
      let finalPoint = pt;
      if (cat === 'habits' && !finalPoint.toLowerCase().startsWith('[habit/preference]')) {
        finalPoint = `[Habit/Preference]: ${finalPoint}`;
      }
      const ref = db.collection('users').doc(userId).collection('facts').doc();
      const docData = {
        text: finalPoint,
        category: cat,
        sourceTitle: title,
        sourceType,
        sessionId,
        createdAt: now + i + idx,
        updatedAt: now + i + idx,
      };
      batch.set(ref, docData);
      added.push({ id: ref.id, ...docData });
    });
    await batch.commit();
  }

  const updatedAll = await listFacts(userId);
  return {
    sourceTitle: title,
    category: cat,
    savedCount: added.length,
    facts: updatedAll,
  };
}

/**
 * Bulk saves all facts organized by category map: { habits: [...], main: [...], ... }
 */
async function saveAllFactsBulk(userId, factsByCategory) {
  for (const cat of VALID_CATEGORIES) {
    if (factsByCategory && Array.isArray(factsByCategory[cat])) {
      await saveCategoryFacts(userId, cat, factsByCategory[cat]);
    }
  }
  const updatedAll = await listFacts(userId);
  return { success: true, totalFacts: updatedAll.length, facts: updatedAll };
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

async function getUnifiedMemoryHub(userId) {
  const [facts, stalkerSnap, hackathonSnap] = await Promise.all([
    listFacts(userId),
    db.collection('users').doc(userId).collection('stalkingProfiles').orderBy('createdAt', 'desc').get().catch(() => ({ docs: [] })),
    db.collection('users').doc(userId).collection('hackathons').orderBy('createdAt', 'desc').get().catch(() => ({ docs: [] })),
  ]);

  const stalkerProfiles = stalkerSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const hackathons = hackathonSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Count insights inside profiles & hackathons for richer metrics
  let stalkerInsightCount = 0;
  stalkerProfiles.forEach(p => {
    const summary = p.profileData?.summary || [];
    stalkerInsightCount += Array.isArray(summary) ? summary.length : 0;
  });

  let hackathonRuleCount = 0;
  hackathons.forEach(h => {
    const rules = h.rules || [];
    hackathonRuleCount += Array.isArray(rules) ? rules.length : 0;
  });

  const stalkerFactsCount = facts.filter(f => f.category === 'stalker').length;
  const hackathonFactsCount = facts.filter(f => f.category === 'hackathons').length;

  const counts = {
    habits: facts.filter(f => f.category === 'habits').length,
    builder: facts.filter(f => f.category === 'builder').length,
    main: facts.filter(f => f.category === 'main').length,
    vault: facts.filter(f => f.category === 'vault').length,
    stalker: stalkerFactsCount + stalkerProfiles.length + stalkerInsightCount,
    hackathons: hackathonFactsCount + hackathons.length + hackathonRuleCount,
  };

  return {
    facts,
    stalkerProfiles,
    hackathons,
    counts,
  };
}

async function deleteProfileInsight(userId, profId, insightText) {
  const profRef = db.collection('users').doc(userId).collection('stalkingProfiles').doc(profId);
  const snap = await profRef.get();
  if (!snap.exists) return false;
  const data = snap.data() || {};
  const pd = data.profileData || {};
  const summary = (pd.summary || []).filter(item => String(item).trim() !== String(insightText).trim());
  await profRef.set({ profileData: { ...pd, summary }, updatedAt: Date.now() }, { merge: true });
  return true;
}

async function addProfileInsight(userId, profId, insightText) {
  const profRef = db.collection('users').doc(userId).collection('stalkingProfiles').doc(profId);
  const snap = await profRef.get();
  if (!snap.exists) return false;
  const data = snap.data() || {};
  const pd = data.profileData || {};
  const summary = pd.summary || [];
  if (!summary.includes(insightText.trim())) {
    summary.push(insightText.trim());
  }
  await profRef.set({ profileData: { ...pd, summary }, updatedAt: Date.now() }, { merge: true });
  return true;
}

async function deleteHackathonRule(userId, hackId, ruleText) {
  const hackRef = db.collection('users').doc(userId).collection('hackathons').doc(hackId);
  const snap = await hackRef.get();
  if (!snap.exists) return false;
  const data = snap.data() || {};
  const rules = (data.rules || []).filter(r => String(r).trim() !== String(ruleText).trim());
  await hackRef.set({ rules, updatedAt: Date.now() }, { merge: true });
  return true;
}

async function addHackathonRule(userId, hackId, ruleText) {
  const hackRef = db.collection('users').doc(userId).collection('hackathons').doc(hackId);
  const snap = await hackRef.get();
  if (!snap.exists) return false;
  const data = snap.data() || {};
  const rules = data.rules || [];
  if (!rules.includes(ruleText.trim())) {
    rules.push(ruleText.trim());
  }
  await hackRef.set({ rules, updatedAt: Date.now() }, { merge: true });
  return true;
}

module.exports = {
  createSession,
  updateSessionTitle,
  syncSessionFactTitles,
  getDynamicScopedMemory,
  listSessions,
  deleteSession,
  addMessage,
  getRecentMessages,
  addFact,
  addFactUnique,
  listFacts,
  deleteFact,
  updateFact,
  updateFactCategory,
  saveCategoryFacts,
  savePageFacts,
  saveAllFactsBulk,
  detectCategory,
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
  getUnifiedMemoryHub,
  deleteProfileInsight,
  addProfileInsight,
  deleteHackathonRule,
  addHackathonRule,
  saveSessionWeeklySummary,
  getSessionLatestSummary,
  listSessionSummaries,
};

