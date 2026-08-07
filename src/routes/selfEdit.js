const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const se = require('../services/selfEditService');

// GET /api/self-edit — list edit history
router.get('/', requireAuth, async (req, res) => {
  try {
    const edits = await se.listEdits(req.userId);
    res.json({ edits });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/self-edit/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const edit = await se.getEdit(req.userId, req.params.id);
    if (!edit) return res.status(404).json({ error: 'Edit not found' });
    res.json({ edit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// FIX: route-level path whitelist + diff-size cap.
// Previously the ONLY protection against a bad self-edit path/size was
// selfEditService.isBlocked() — a deny-list buried in the service layer that
// applyEdit() and proposeEdit() call internally. There was no positive
// whitelist at the route boundary (so anything not explicitly denied was
// implicitly allowed) and no cap anywhere on how large a single edit's diff
// could be. This guard runs BEFORE the request ever reaches the service:
//   - file must match ALLOWED_PATH_PREFIXES (positive allow-list)
//   - the size of the proposed change (old+new content length) must be
//     under MAX_DIFF_CHARS
// This is independent of, and in addition to, the service-level isBlocked()
// check — either layer rejecting the request is enough to stop it.
function guardEditPayload(body) {
  const file = body && body.file;
  if (!se.isAllowedPath(file)) {
    return `Path not in self-edit allow-list: ${file || '(missing)'} (allowed prefixes: ${se.ALLOWED_PATH_PREFIXES.join(', ')})`;
  }
  const size = se.diffCharSize(body.oldCode, body.newCode);
  if (size > se.MAX_DIFF_CHARS) {
    return `Diff too large for self-edit: ${size} chars (max ${se.MAX_DIFF_CHARS})`;
  }
  return null;
}

// POST /api/self-edit/propose  { title, file, oldCode, newCode, category, reason }
router.post('/propose', requireAuth, async (req, res) => {
  try {
    const guardErr = guardEditPayload(req.body);
    if (guardErr) return res.status(400).json({ error: guardErr });
    const edit = await se.proposeEdit(req.userId, req.body);
    res.status(201).json({ edit });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/self-edit/run — Bob reviews the codebase and proposes edits (manual by default)
router.post('/run', requireAuth, async (req, res) => {
  try {
    const autoApply = Boolean(req.body.autoApply);
    res.json({ started: true });
    se.runSelfReview(req.userId, { autoApply }).catch(err => console.error('Self-review error:', err.message));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/self-edit/:id/approve — approve a manual edit (then apply separately)
router.post('/:id/approve', requireAuth, async (req, res) => {
  try {
    const edit = await se.setStatus(req.userId, req.params.id, 'approved');
    if (!edit) return res.status(404).json({ error: 'Edit not found' });
    res.json({ edit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/self-edit/:id/reject
router.post('/:id/reject', requireAuth, async (req, res) => {
  try {
    const edit = await se.setStatus(req.userId, req.params.id, 'rejected');
    if (!edit) return res.status(404).json({ error: 'Edit not found' });
    res.json({ edit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/self-edit/:id/apply — run the safety pipeline (auto or after approval)
router.post('/:id/apply', requireAuth, async (req, res) => {
  try {
    // Re-check the whitelist + diff cap against the STORED doc here too.
    // runSelfReview()'s autoApply path calls se.proposeEdit() directly (not the
    // /propose route above), so without this the route-level guard could be
    // skipped entirely for auto-applied self-edits. Re-validating right before
    // apply closes that gap regardless of how the edit was proposed.
    const existing = await se.getEdit(req.userId, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Edit not found' });
    const guardErr = guardEditPayload(existing);
    if (guardErr) return res.status(400).json({ error: guardErr });
    const edit = await se.applyEdit(req.userId, req.params.id);
    res.json({ edit });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
