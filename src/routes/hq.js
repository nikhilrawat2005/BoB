const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const hacks = require('../services/hackathonService');
const stalk = require('../services/stalkingService');
const routines = require('../services/routineService');
const memory = require('../services/memoryService');
const memoryManager = require('../services/memoryManager');

// GET /api/hq/summary — aggregate dashboard data for the Bob HQ home page.
router.get('/summary', requireAuth, async (req, res) => {
  try {
    const [hackathons, profiles, routineList, notifications, facts, months, files] = await Promise.all([
      hacks.listHackathons(req.userId),
      stalk.listProfiles(req.userId),
      routines.listRoutines(req.userId),
      memory.listNotifications(req.userId, 10),
      memory.listFacts(req.userId),
      memory.listMonthMemory(req.userId, 6),
      memory.listMonthlyFiles(req.userId, 6),
    ]);

    const cards = {
      hackathons: {
        count: hackathons.length,
        active: hackathons.filter(h => h.status !== 'ended').length,
        participating: hackathons.filter(h => h.participating || h.pastParticipation).length,
        tracking: hackathons.filter(h => h.tracking).length,
        items: hackathons.map(h => ({
          id: h.id, title: h.title, status: h.status, statusColor: h.statusColor,
          tracking: h.tracking, participating: h.participating, pastParticipation: h.pastParticipation,
          endDate: h.endDate, source: h.source, link: h.link,
        })),
      },
      stalking: {
        count: profiles.length,
        ready: profiles.filter(p => p.status === 'ready').length,
        researching: profiles.filter(p => p.status === 'researching').length,
        items: profiles.map(p => ({ id: p.id, name: p.name, status: p.status, link: p.link, headline: p.profileData?.headline || null, tech: p.profileData?.tech || [] })),
      },
      routines: {
        count: routineList.length,
        active: routineList.filter(r => r.active).length,
        dueSoon: routineList.filter(r => r.active && r.nextRunAt && r.nextRunAt - Date.now() < 24 * 3600 * 1000).length,
        items: routineList.map(r => ({ id: r.id, title: r.title, workspace: r.workspace, active: r.active, intervalHours: r.intervalHours, nextRunAt: r.nextRunAt, lastRunAt: r.lastRunAt })),
      },
      notifications: {
        count: notifications.length,
        unread: notifications.filter(n => !n.read).length,
      },
      facts: facts.length,
      months: months.length,
      files: files.length,
      labels: { facts, months, files },
    };

    res.json({ cards });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
