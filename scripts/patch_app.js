const fs = require('fs');
const path = require('path');

const appJsPath = path.join(__dirname, '..', 'public', 'app.js');
let app = fs.readFileSync(appJsPath, 'utf8');

// Replace renderLiveRadar and its buttons with rich hero controls and empty action buttons
const oldRenderLiveRadar = `function renderLiveRadar() {
  const body = document.getElementById('live-body');
  if (!liveDiscoveryCache.length) {
    body.innerHTML = \`
      <div class="empty-msg" style="padding: 40px 20px; text-align: center;">
        <div style="font-size: 32px; margin-bottom: 8px;">🏆</div>
        <div style="font-weight: 700; color: var(--text);">No Hackathons Discovered Yet</div>
        <div style="font-size: 12px; color: var(--text3); margin-top: 4px;">Click "🔍 Scan Now" above to crawl Devpost, Unstop & Devfolio for CSE events.</div>
      </div>
    \`;
    return;
  }

  const cardsHtml = liveDiscoveryCache.map(h => {
    const platformColors = {
      devpost: '#003E54',
      unstop: '#6c2bd9',
      devfolio: '#3770FF'
    };
    const pColor = platformColors[h.platform] || '#38bdf8';
    const deadline = h.registrationDeadline ? new Date(h.registrationDeadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'Open';
    const tags = (h.tags || []).slice(0, 3).map(t => \`<span style="font-size:10px; padding:2px 6px; border-radius:4px; background:rgba(56,189,248,0.12); color:#38bdf8;">\${escHtml(t)}</span>\`).join(' ');

    return \`
      <div class="hack-card" style="background:var(--surface); border:1px solid rgba(139, 92, 246, 0.2); border-radius:12px; padding:16px; margin-bottom:12px; transition:border-color 0.2s;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <span style="font-size:10px; font-weight:800; padding:2px 8px; border-radius:4px; background:\${pColor}30; color:\${pColor}; text-transform:uppercase;">\${escHtml(h.platform || 'CSE')}</span>
          <span style="font-size:11px; font-weight:700; color:#f59e0b;">⏱ \${escHtml(deadline)}</span>
        </div>
        <h3 style="font-size:16px; font-weight:800; color:var(--text); margin-bottom:6px; line-height:1.3;">\${escHtml(h.title)}</h3>
        <p style="font-size:13px; color:var(--text2); line-height:1.5; margin-bottom:10px;">\${escHtml(h.summary || '')}</p>
        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px;">
          \${tags}
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; padding-top:12px; border-top:1px solid rgba(255,255,255,0.06);">
          <div style="font-weight:800; font-size:13px; color:#facc15;">💰 \${escHtml(h.prize || 'Prizes & Swags')}</div>
          <div style="display:flex; gap:8px;">
            <a href="\${escHtml(h.link)}" target="_blank" rel="noopener noreferrer" class="btn-small" style="text-decoration:none; background:rgba(56,189,248,0.15); color:#38bdf8; border:1px solid rgba(56,189,248,0.3);">🔗 Register</a>
            <button class="btn-small btn-primary" data-live-save="\${h.id}" title="Transfer to Hackathons Workspace">📌 Save</button>
            <button class="btn-small" data-live-del="\${h.id}" style="background:rgba(244,63,94,0.15); color:#f43f5e; border:1px solid rgba(244,63,94,0.3);">✕ Dismiss</button>
          </div>
        </div>
      </div>
    \`;
  }).join('');

  body.innerHTML = \`<div style="max-width:800px; margin:0 auto;">\${cardsHtml}</div>\`;

  body.querySelectorAll('[data-live-save]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.liveSave;
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await apiFetch(\`/api/live/hackathon-discovery/\${id}/save\`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ participating: false }) });
        liveDiscoveryCache = liveDiscoveryCache.filter(x => String(x.id) !== String(id));
        renderLiveRadar();
        alert('✅ Hackathons Workspace me add ho gaya!');
      } catch (e) { alert(e.message); btn.disabled = false; btn.textContent = '📌 Save'; }
    });
  });

  body.querySelectorAll('[data-live-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.liveDel;
      try {
        await apiFetch(\`/api/live/hackathon-discovery/\${id}/dismiss\`, { method: 'POST' });
        liveDiscoveryCache = liveDiscoveryCache.filter(x => String(x.id) !== String(id));
        renderLiveRadar();
      } catch (e) { alert(e.message); }
    });
  });
}`;

const newRenderLiveRadar = `function renderLiveRadar() {
  const body = document.getElementById('live-body');
  const isPaused = liveDiscoveryMeta.enabled === false;
  
  // Dynamic Hero Control Bar visible inside page body
  const heroBarHtml = \`
    <div style="background: rgba(139, 92, 246, 0.08); border: 1px solid rgba(139, 92, 246, 0.25); border-radius: 12px; padding: 14px 18px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
      <div>
        <div style="font-weight: 800; font-size: 15px; color: #c084fc; display: flex; align-items: center; gap: 8px;">
          <span>⚡ Autonomous Crawler Radar</span>
          <span style="font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 10px; background: \${isPaused ? 'rgba(245, 158, 11, 0.2)' : 'rgba(74, 222, 128, 0.2)'}; color: \${isPaused ? '#f59e0b' : '#4ade80'};">
            \${isPaused ? '⏸ PAUSED' : '🟢 ACTIVE (4-Day Interval)'}
          </span>
        </div>
        <div style="font-size: 12px; color: var(--text2); margin-top: 3px;">
          Scrapes real CSE hackathons from <strong>Devpost</strong>, <strong>Unstop</strong> & <strong>Devfolio</strong>.
        </div>
      </div>
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
        <button id="live-hero-to-ws" class="btn-small btn-secondary" title="Switch to Tracked Hackathons Workspace">🏆 My Hackathons</button>
        <button id="live-hero-toggle" class="btn-small" style="background: \${isPaused ? 'rgba(74, 222, 128, 0.15)' : 'rgba(245, 158, 11, 0.15)'}; color: \${isPaused ? '#4ade80' : '#f59e0b'}; border: 1px solid \${isPaused ? '#4ade80' : '#f59e0b'};">
          \${isPaused ? '▶ Resume Auto-Scan' : '⏸ Pause'}
        </button>
        <button id="live-hero-scan" class="btn-small btn-primary" style="font-weight: 700; box-shadow: 0 2px 10px rgba(56, 189, 248, 0.3);">
          🔍 Scan Now
        </button>
      </div>
    </div>
  \`;

  if (!liveDiscoveryCache.length) {
    body.innerHTML = \`
      <div style="max-width:800px; margin:0 auto;">
        \${heroBarHtml}
        <div class="empty-msg" style="padding: 50px 20px; text-align: center; background: var(--surface); border: 1px dashed rgba(139, 92, 246, 0.3); border-radius: 16px;">
          <div style="font-size: 40px; margin-bottom: 12px;">🛰️</div>
          <div style="font-weight: 800; font-size: 18px; color: var(--text);">No Hackathons in Discovery Radar</div>
          <div style="font-size: 13px; color: var(--text2); max-width: 460px; margin: 8px auto 20px; line-height: 1.5;">
            Bob automatically crawls Devpost, Unstop and Devfolio every 4 days. Click below to trigger an immediate live scan right now!
          </div>
          <button id="live-empty-scan-btn" class="btn-primary" style="padding: 10px 24px; font-size: 14px; font-weight: 800; box-shadow: 0 4px 15px rgba(56, 189, 248, 0.35);">
            🔍 Scan Hackathons Now
          </button>
        </div>
      </div>
    \`;

    document.getElementById('live-empty-scan-btn')?.addEventListener('click', triggerLiveScan);
    document.getElementById('live-hero-scan')?.addEventListener('click', triggerLiveScan);
    document.getElementById('live-hero-toggle')?.addEventListener('click', toggleLiveScan);
    document.getElementById('live-hero-to-ws')?.addEventListener('click', () => { showView('hackathons'); loadHackathons(); });
    return;
  }

  const cardsHtml = liveDiscoveryCache.map(h => {
    const platformColors = {
      devpost: '#003E54',
      unstop: '#6c2bd9',
      devfolio: '#3770FF'
    };
    const pColor = platformColors[h.platform] || '#38bdf8';
    const deadline = h.registrationDeadline ? new Date(h.registrationDeadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'Open';
    const tags = (h.tags || []).slice(0, 3).map(t => \`<span style="font-size:10px; padding:2px 6px; border-radius:4px; background:rgba(56,189,248,0.12); color:#38bdf8;">\${escHtml(t)}</span>\`).join(' ');

    return \`
      <div class="hack-card" style="background:var(--surface); border:1px solid rgba(139, 92, 246, 0.2); border-radius:12px; padding:16px; margin-bottom:12px; transition:border-color 0.2s;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <span style="font-size:10px; font-weight:800; padding:2px 8px; border-radius:4px; background:\${pColor}30; color:\${pColor}; text-transform:uppercase;">\${escHtml(h.platform || 'CSE')}</span>
          <span style="font-size:11px; font-weight:700; color:#f59e0b;">⏱ \${escHtml(deadline)}</span>
        </div>
        <h3 style="font-size:16px; font-weight:800; color:var(--text); margin-bottom:6px; line-height:1.3;">\${escHtml(h.title)}</h3>
        <p style="font-size:13px; color:var(--text2); line-height:1.5; margin-bottom:10px;">\${escHtml(h.summary || '')}</p>
        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px;">
          \${tags}
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; padding-top:12px; border-top:1px solid rgba(255,255,255,0.06);">
          <div style="font-weight:800; font-size:13px; color:#facc15;">💰 \${escHtml(h.prize || 'Prizes & Swags')}</div>
          <div style="display:flex; gap:8px;">
            <a href="\${escHtml(h.link)}" target="_blank" rel="noopener noreferrer" class="btn-small" style="text-decoration:none; background:rgba(56,189,248,0.15); color:#38bdf8; border:1px solid rgba(56,189,248,0.3);">🔗 Register</a>
            <button class="btn-small btn-primary" data-live-save="\${h.id}" title="Transfer to Hackathons Workspace">📌 Save to Workspace</button>
            <button class="btn-small" data-live-del="\${h.id}" style="background:rgba(244,63,94,0.15); color:#f43f5e; border:1px solid rgba(244,63,94,0.3);">✕ Dismiss</button>
          </div>
        </div>
      </div>
    \`;
  }).join('');

  body.innerHTML = \`<div style="max-width:800px; margin:0 auto;">\${heroBarHtml}\${cardsHtml}</div>\`;

  document.getElementById('live-hero-scan')?.addEventListener('click', triggerLiveScan);
  document.getElementById('live-hero-toggle')?.addEventListener('click', toggleLiveScan);
  document.getElementById('live-hero-to-ws')?.addEventListener('click', () => { showView('hackathons'); loadHackathons(); });

  body.querySelectorAll('[data-live-save]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.liveSave;
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await apiFetch(\`/api/live/hackathon-discovery/\${id}/save\`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ participating: false }) });
        liveDiscoveryCache = liveDiscoveryCache.filter(x => String(x.id) !== String(id));
        renderLiveRadar();
        alert('✅ Hackathons Workspace me transfer ho gaya! Click "🏆 My Hackathons" to view.');
      } catch (e) { alert(e.message); btn.disabled = false; btn.textContent = '📌 Save to Workspace'; }
    });
  });

  body.querySelectorAll('[data-live-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.liveDel;
      try {
        await apiFetch(\`/api/live/hackathon-discovery/\${id}/dismiss\`, { method: 'POST' });
        liveDiscoveryCache = liveDiscoveryCache.filter(x => String(x.id) !== String(id));
        renderLiveRadar();
      } catch (e) { alert(e.message); }
    });
  });
}

async function triggerLiveScan() {
  const scanBtns = [document.getElementById('live-scan-btn'), document.getElementById('live-hero-scan'), document.getElementById('live-empty-scan-btn')].filter(Boolean);
  scanBtns.forEach(b => { b.disabled = true; b.textContent = 'Scanning…'; });

  try {
    const res = await apiFetch('/api/live/hackathon-discovery/run', { method: 'POST' });
    if (res.skipped) {
      alert('Scan already scheduled soon. 4-day interval cycle is running.');
    } else {
      alert(\`✅ Live scan complete! Discovered \${res.added || 0} new hackathons across Devpost, Unstop & Devfolio.\`);
    }
    await loadLive();
  } catch (err) {
    alert('Scan failed: ' + err.message);
  } finally {
    scanBtns.forEach(b => { b.disabled = false; b.textContent = '🔍 Scan Now'; });
  }
}

async function toggleLiveScan() {
  const isPaused = liveDiscoveryMeta.enabled === false;
  try {
    await apiFetch('/api/live/hackathon-discovery/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: isPaused })
    });
    await loadLive();
  } catch (e) {
    alert(e.message);
  }
}`;

if (!app.includes('function renderLiveRadar()')) {
  console.error('renderLiveRadar not found');
  process.exit(1);
}

app = app.replace(oldRenderLiveRadar, newRenderLiveRadar);

// Also attach event listeners for header buttons if present
const oldBtnSetup = `document.getElementById('live-scan-btn')?.addEventListener('click', async (e) => {
  const btn = e.target;
  btn.disabled = true; btn.textContent = 'Scanning…';
  try {
    const res = await apiFetch('/api/live/hackathon-discovery/run', { method: 'POST' });
    if (res.skipped) {
      alert(\`Scan scheduled soon. 4-day interval cycle active.\`);
    } else {
      alert(\`✅ Scan complete! Found \${res.added || 0} new hackathons.\`);
    }
    await loadLive();
  } catch (err) { alert('Scan failed: ' + err.message); }
  finally { btn.disabled = false; btn.textContent = '🔍 Scan Now'; }
});

document.getElementById('live-toggle-btn')?.addEventListener('click', async (e) => {
  const btn = e.target;
  const isPaused = liveDiscoveryMeta.enabled === false;
  btn.disabled = true;
  try {
    await apiFetch('/api/live/hackathon-discovery/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: isPaused })
    });
    await loadLive();
  } catch (e) { alert(e.message); }
  finally { btn.disabled = false; }
});`;

const newBtnSetup = `document.getElementById('live-scan-btn')?.addEventListener('click', triggerLiveScan);
document.getElementById('live-toggle-btn')?.addEventListener('click', toggleLiveScan);
document.getElementById('live-to-ws-btn')?.addEventListener('click', () => { showView('hackathons'); loadHackathons(); });
document.getElementById('open-radar-btn')?.addEventListener('click', () => { showView('live'); loadLive(); });`;

if (app.includes(oldBtnSetup)) {
  app = app.replace(oldBtnSetup, newBtnSetup);
}

fs.writeFileSync(appJsPath, app, 'utf8');
console.log('Successfully updated app.js with prominent live radar hero & navigation!');
