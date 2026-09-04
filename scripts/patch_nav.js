const fs = require('fs');
const path = require('path');

const indexHtmlPath = path.join(__dirname, '..', 'public', 'index.html');
let html = fs.readFileSync(indexHtmlPath, 'utf8');

// 1. In #view-hackathons .view-header-actions, add ⚡ Hackathon Radar discovery button
const target1 = '<button id="paste-hack-btn" class="btn-small btn-secondary" title="Paste complete hackathon details/announcement to auto-parse">📋 Paste Info</button>';
const replace1 = '<button id="open-radar-btn" class="btn-small" style="background: rgba(139, 92, 246, 0.2); color: #c084fc; border: 1px solid #c084fc; font-weight: 700;" title="Explore & Discover new hackathons across Devpost, Unstop & Devfolio">⚡ Hackathon Radar</button>\n              <button id="paste-hack-btn" class="btn-small btn-secondary" title="Paste complete hackathon details/announcement to auto-parse">📋 Paste Info</button>';

if (!html.includes(target1)) {
  console.error('target1 not found');
  process.exit(1);
}
html = html.replace(target1, replace1);

// 2. Also in view-live header, add a quick link back to Hackathons Workspace
const target2 = '<button id="live-toggle-btn" class="btn-small" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid #f59e0b;">⏸ Pause</button>';
const replace2 = '<button id="live-to-ws-btn" class="btn-small btn-secondary" title="View tracked / participating hackathons">🏆 My Workspace</button>\n              <button id="live-toggle-btn" class="btn-small" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid #f59e0b;">⏸ Pause</button>';

if (!html.includes(target2)) {
  console.error('target2 not found');
  process.exit(1);
}
html = html.replace(target2, replace2);

fs.writeFileSync(indexHtmlPath, html, 'utf8');
console.log('Successfully updated index.html with cross-workspace navigation!');
