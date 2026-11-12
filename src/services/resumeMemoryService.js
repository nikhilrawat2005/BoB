const { db } = require('../config/firebase');

/**
 * resumeMemoryService.js
 * 
 * Manages persistent historical audit memory for user resumes in Firestore:
 * - Scoped by userId (users/{userId}/resume_audits/{auditId})
 * - Tracks ATS score progression over time (previous score, delta, timestamp)
 * - Stores executive verdicts, identified gaps, and fixed areas
 */

async function saveAuditRecord(userId, auditData) {
  if (!db || !userId) {
    console.warn('[resumeMemoryService] Firestore db or userId missing; skipping history save.');
    return null;
  }

  try {
    const auditsRef = db.collection('users').doc(userId).collection('resume_audits');
    
    // Fetch last recent audit to compute score delta
    const lastAuditSnap = await auditsRef.orderBy('createdAt', 'desc').limit(1).get();
    let previousAudit = null;
    let scoreDelta = 0;

    if (!lastAuditSnap.empty) {
      previousAudit = lastAuditSnap.docs[0].data();
      if (previousAudit && typeof previousAudit.overallAtsScore === 'number') {
        scoreDelta = auditData.overallAtsScore - previousAudit.overallAtsScore;
      }
    }

    const docData = {
      filename: auditData.filename || 'resume.pdf',
      overallAtsScore: auditData.overallAtsScore,
      targetScore: auditData.targetScore || 75,
      performanceTier: auditData.performanceTier,
      isAtsCompliant: auditData.isAtsCompliant,
      scoreBreakdown: auditData.scoreBreakdown,
      issuesCount: (auditData.deterministicIssues || []).length,
      issues: auditData.deterministicIssues || [],
      positivePoints: (auditData.positivePoints || []).map(p => p.detail || p),
      sectionsAudited: auditData.sectionsAudited || [],
      bulletPointAudits: auditData.bulletPointAudits || [],
      missingKeywords: auditData.missingKeywordsAnalysis || {},
      executiveSummary: auditData.executiveSummary || {},
      scoreDelta,
      previousScore: previousAudit ? previousAudit.overallAtsScore : null,
      previousDate: previousAudit ? previousAudit.createdAt : null,
      createdAt: new Date().toISOString(),
      timestamp: Date.now()
    };

    const docRef = await auditsRef.add(docData);
    console.log(`[resumeMemoryService] Saved audit #${docRef.id} for user ${userId}. Score: ${docData.overallAtsScore} (Delta: ${scoreDelta > 0 ? '+' + scoreDelta : scoreDelta})`);

    return {
      id: docRef.id,
      ...docData
    };
  } catch (err) {
    console.error('[resumeMemoryService] Failed to save audit record:', err.message);
    return null;
  }
}

async function getAuditHistory(userId, limit = 10) {
  if (!db || !userId) return [];

  try {
    const auditsRef = db.collection('users').doc(userId).collection('resume_audits');
    const snap = await auditsRef.orderBy('createdAt', 'desc').limit(limit).get();

    return snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  } catch (err) {
    console.error('[resumeMemoryService] Failed to fetch audit history:', err.message);
    return [];
  }
}

module.exports = {
  saveAuditRecord,
  getAuditHistory
};
