const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const crawler = require('../services/crawlerService');
const { callLLM } = require('../services/llmService');
const memory = require('../services/memoryService');
const repo = require('../services/repoService');

// POST /api/research/crawl  { url }  - Crawl & analyze any website URL
router.post('/crawl', requireAuth, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL parameter is required' });
  if (typeof url !== 'string' || url.length > 500) {
    return res.status(400).json({ error: 'url must be a string under 500 characters' });
  }

  try {
    const scrapedData = await crawler.scrapeURL(url);

    const prompt = `Analyze this web page scraped for Master Nikhil:
URL: ${scrapedData.url}
Title: ${scrapedData.title}
Description: ${scrapedData.description}

Headings:
${scrapedData.headings.join('\n')}

Content Snippet:
${scrapedData.contentSnippet}

Provide a comprehensive analysis:
1. Executive Summary & Core Content
2. UI/UX & Frontend Components Structure
3. Key Technical & Strategic Insights for Master Nikhil`;

    const { text } = await callLLM({
      role: 'chat',
      messages: [{ role: 'system', content: prompt }],
    });

    res.json({
      url: scrapedData.url,
      title: scrapedData.title,
      headings: scrapedData.headings,
      analysis: text,
    });
  } catch (err) {
    res.status(500).json({ error: 'Web crawling failed', details: err.message });
  }
});

// POST /api/research/study-notes  { topic }  - Prepare late-night study notes & research reports
router.post('/study-notes', requireAuth, async (req, res) => {
  const { topic } = req.body;
  if (!topic) return res.status(400).json({ error: 'Topic is required' });
  if (typeof topic !== 'string' || topic.length > 500) {
    return res.status(400).json({ error: 'topic must be a string under 500 characters' });
  }

  try {
    const prompt = `You are Bob, Master Nikhil's personal research & study agent.
Master Nikhil has asked you to prepare comprehensive, high-yield study & research notes on:
"${topic}"

Format the report into clean Markdown:
- 📌 Key Concepts & Definitions
- 🎯 Core Principles & Architecture
- ⚡ Expected Exam Questions & High-Yield Answers
- 💡 Master Summary & Quick Revision Cheat-sheet`;

    const { text } = await callLLM({
      role: 'chat',
      messages: [{ role: 'system', content: prompt }],
      temperature: 0.3,
    });

    // Save report in user facts/memory
    await memory.addFact(req.userId, `[Research Report]: ${topic} - ${text.slice(0, 150)}...`);

    res.json({ topic, report: text });
  } catch (err) {
    res.status(500).json({ error: 'Research report generation failed', details: err.message });
  }
});

// POST /api/research/github  { username }  - Real GitHub profile + repos (no guessing)
router.post('/github', requireAuth, async (req, res) => {
  const username = (req.body.username || process.env.GITHUB_USERNAME || 'nikhilrawat2005').trim();
  if (typeof username !== 'string' || username.length > 100) {
    return res.status(400).json({ error: 'username must be a string under 100 characters' });
  }
  try {
    const [profile, repoList] = await Promise.all([
      repo.getUserProfile(username),
      repo.listUserRepos(username, 100),
    ]);
    if (profile.error || repoList.error) {
      return res.status(502).json({ error: profile.error || repoList.error, message: profile.message || repoList.message });
    }
    res.json({ profile, repos: repoList.repos, repoCount: repoList.count });
  } catch (err) {
    res.status(500).json({ error: 'GitHub profile fetch failed', details: err.message });
  }
});

module.exports = router;
