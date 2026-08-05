/* ═══════════════════════════════════════════════════════
   BOB — Frontend App
   Firebase Auth (client) + Backend API calls
═══════════════════════════════════════════════════════

   🔒 SECURITY: Firebase config is loaded from the backend
   (/api/config) at runtime — no API keys are hardcoded here.
   All secrets live in the server's .env file only.
═══════════════════════════════════════════════════════ */

// ── API base (same origin since Express serves both) ─
const API = '';

let auth = null;
let currentUser = null;
let idToken = null;
let currentSession = null;
let pendingFile = null;
let pendingPasteImage = null;
let currentPersona = 'bob'; // 'bob' | 'builder'

// ── DOM refs ─────────────────────────────────────────
const screens = {
  login:    document.getElementById('login-screen'),
  register: document.getElementById('register-screen'),
  app:      document.getElementById('app-screen'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ── Dynamic Firebase Initialization ──────────────────
async function initFirebaseApp() {
  try {
    const res = await fetch(API + '/api/config');
    if (!res.ok) throw new Error('Failed to load server configuration');
    const firebaseConfig = await res.json();
    
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    
    auth.onAuthStateChanged(async (user) => {
      if (user) {
        await handleAuthUser(user);
      } else {
        await handleSignOut();
      }
    });
  } catch (err) {
    console.error('Firebase config init error:', err);
    alert('Security / Config Error: Server configuration could not be loaded.');
  }
}

// Start initialization on DOM load
document.addEventListener('DOMContentLoaded', initFirebaseApp);

// ═══════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════

// Switch between login / register
document.getElementById('goto-register').addEventListener('click', e => { e.preventDefault(); showScreen('register'); });
document.getElementById('goto-login').addEventListener('click',    e => { e.preventDefault(); showScreen('login'); });

// Login
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  const btnText  = document.getElementById('login-btn-text');
  const spinner  = document.getElementById('login-spinner');

  errEl.classList.add('hidden');
  btnText.classList.add('hidden');
  spinner.classList.remove('hidden');
  document.getElementById('login-btn').disabled = true;

  try {
    await auth.signInWithEmailAndPassword(email, password);
    // onAuthStateChanged handles the rest
  } catch (err) {
    errEl.textContent = friendlyAuthError(err.code);
    errEl.classList.remove('hidden');
  } finally {
    btnText.classList.remove('hidden');
    spinner.classList.add('hidden');
    document.getElementById('login-btn').disabled = false;
  }
});

// Register
document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const errEl    = document.getElementById('reg-error');
  const btnText  = document.getElementById('reg-btn-text');
  const spinner  = document.getElementById('reg-spinner');

  errEl.classList.add('hidden');
  btnText.classList.add('hidden');
  spinner.classList.remove('hidden');
  document.getElementById('reg-btn').disabled = true;

  try {
    await auth.createUserWithEmailAndPassword(email, password);
  } catch (err) {
    errEl.textContent = friendlyAuthError(err.code);
    errEl.classList.remove('hidden');
  } finally {
    btnText.classList.remove('hidden');
    spinner.classList.add('hidden');
    document.getElementById('reg-btn').disabled = false;
  }
});

// Allowed Google / Login accounts list
const ALLOWED_EMAILS = [
  'nikhil2005114@gmail.com',
  'nikhilrawat42005@gmail.com',
  'nikhilrawat4112005@gmail.com',
  'nikhilrawat2005114@gmail.com'
];

// Google Sign-In
const googleBtn = document.getElementById('google-login-btn');
if (googleBtn) {
  googleBtn.addEventListener('click', async () => {
    const errEl = document.getElementById('login-error');
    errEl.classList.add('hidden');
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      await auth.signInWithPopup(provider);
    } catch (err) {
      errEl.textContent = friendlyAuthError(err.code) || err.message;
      errEl.classList.remove('hidden');
    }
  });
}

// Disable Inspect / Right Click / DevTools Shortcuts
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('keydown', (e) => {
  if (
    e.keyCode === 123 || // F12
    (e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 67)) || // Ctrl+Shift+I / J / C
    (e.ctrlKey && e.keyCode === 85) // Ctrl+U
  ) {
    e.preventDefault();
    return false;
  }
});

// Logout
document.getElementById('logout-btn').addEventListener('click', () => auth.signOut());

// Auth state handler — runs once per auth change (single source of truth)
async function handleAuthUser(user) {
  const email = (user.email || '').toLowerCase();

  if (!ALLOWED_EMAILS.includes(email)) {
    await auth.signOut();
    const errEl = document.getElementById('login-error');
    errEl.textContent = `Access Denied: ${email} is not authorized to use Bob.`;
    errEl.classList.remove('hidden');
    showScreen('login');
    return;
  }

  currentUser = user;
  idToken     = await user.getIdToken();

  // Refresh token every 50 min (expires at 60)
  setInterval(async () => { idToken = await user.getIdToken(true); }, 50 * 60 * 1000);

  // Update UI
  document.getElementById('user-email-label').textContent = email;
  document.getElementById('user-avatar').textContent      = email[0]?.toUpperCase() || 'U';

  showScreen('app');
  await initApp();
}

async function handleSignOut() {
  currentUser = null; idToken = null; currentSession = null;
  stopBackgroundPolling();
  showScreen('login');
}

async function initApp() {
  await loadSessions();
  await loadNotifications();
  fetchProactiveGreeting();
  startBackgroundPolling();
}

function friendlyAuthError(code) {
  const map = {
    'auth/invalid-email':          'Invalid email address.',
    'auth/user-not-found':         'No account found with this email.',
    'auth/wrong-password':         'Incorrect password.',
    'auth/email-already-in-use':   'An account with this email already exists.',
    'auth/weak-password':          'Password must be at least 6 characters.',
    'auth/too-many-requests':      'Too many attempts. Please try again later.',
    'auth/invalid-credential':     'Invalid email or password.',
    'auth/configuration-not-found':'Firebase not configured yet — check app.js firebaseConfig.',
  };
  return map[code] || 'Something went wrong. Please try again.';
}

// ═══════════════════════════════════════════════════════
// API HELPERS
// ═══════════════════════════════════════════════════════

async function apiFetch(path, options = {}, isRetry = false) {
  const res = await fetch(API + path, {
    ...options,
    headers: {
      'Authorization': `Bearer ${idToken}`,
      ...(options.headers || {}),
    }
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const errorMsg = data.error || `HTTP ${res.status}`;

    // Auto-refresh token and retry once if token is expired/invalid
    if ((res.status === 401 || errorMsg.includes('expired')) && !isRetry && currentUser) {
      try {
        console.log('Token expired. Refreshing token and retrying request...');
        idToken = await currentUser.getIdToken(true);
        return await apiFetch(path, options, true);
      } catch (refreshErr) {
        console.error('Failed to refresh token:', refreshErr);
      }
    }

    throw new Error(errorMsg);
  }
  return res.json();
}

// ═══════════════════════════════════════════════════════
// SESSIONS
// ═══════════════════════════════════════════════════════

async function loadSessions() {
  try {
    const url = currentPersona === 'builder' ? '/api/builder/sessions' : '/api/sessions';
    const { sessions } = await apiFetch(url);
    renderSessions(sessions || []);
  } catch (err) {
    console.error('loadSessions error:', err);
  }
}

// ═══════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════

async function loadNotifications() {
  try {
    const { notifications } = await apiFetch('/api/notifications');
    renderHqNotifications(notifications || []);
  } catch (err) {
    console.error('loadNotifications error:', err);
  }
}

function renderHqNotifications(notifications) {
  const strip = document.getElementById('hq-notifications');
  if (!strip) return;
  const recent = notifications.slice(0, 5);
  if (!recent.length) {
    strip.innerHTML = '';
    return;
  }

  strip.innerHTML = `
    <div class="hq-notif-head">🔔 Live Updates <span class="hq-notif-count">${notifications.length}</span></div>
    <div class="hq-notif-strip">
      ${recent.map(n => `
        <div class="hq-notif-card ${!n.read ? 'unread' : ''}" data-id="${n.id}">
          <div class="hq-notif-title">${escHtml(n.title)}</div>
          <div class="hq-notif-msg">${escHtml(n.message)}</div>
          <div class="hq-notif-actions">
            <button class="btn-notif-reply" data-id="${n.id}" data-snippet="${escHtml(n.promptSnippet || n.message)}">💬 Reply in Chat</button>
            <button class="btn-notif-del" data-id="${n.id}" title="Dismiss">✕</button>
          </div>
        </div>
      `).join('')}
      ${notifications.length > 5 ? `<button class="hq-notif-all" id="hq-notif-all">View all ${notifications.length} →</button>` : ''}
    </div>
  `;

  strip.querySelectorAll('.btn-notif-reply').forEach(btn => {
    btn.addEventListener('click', async () => {
      const notifId = btn.dataset.id;
      const snippet = btn.dataset.snippet;
      await apiFetch(`/api/notifications/${notifId}`, { method: 'DELETE' });
      closeViews();
      await createNewSession();
      const mi = document.getElementById('message-input');
      mi.value = snippet;
      mi.dispatchEvent(new Event('input'));
      await sendMessage();
      await loadNotifications();
      await loadSessions();
    });
  });

  strip.querySelectorAll('.btn-notif-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      await apiFetch(`/api/notifications/${btn.dataset.id}`, { method: 'DELETE' });
      await loadNotifications();
    });
  });

  const allBtn = strip.querySelector('#hq-notif-all');
  if (allBtn) allBtn.addEventListener('click', () => { showView('notifications'); loadNotificationsFull(); });
}

function renderSessions(sessions) {
  const list = document.getElementById('sessions-list');
  if (!sessions.length) {
    list.innerHTML = '<div class="empty-sessions">No chats yet</div>';
    return;
  }

  // Check if top session was updated within the last 24h for auto-pulse highlight
  const now = Date.now();

  list.innerHTML = sessions.map((s, idx) => {
    const isRecent = idx === 0 && (now - (s.updatedAt || 0)) < 24 * 60 * 60 * 1000;
    const titleLc = (s.title || '').toLowerCase();
    const isAutoActive = isRecent && (titleLc.includes('goal') || titleLc.includes('dsa'));
    return `
      <div class="session-item ${currentSession?.id === s.id ? 'active' : ''} ${isAutoActive ? 'auto-active' : ''}"
           data-id="${s.id}" data-title="${escHtml(s.title || 'Chat')}">
        <span class="session-title">${escHtml(s.title || 'Chat')}</span>
        <button class="btn-delete-session" data-id="${s.id}" title="Delete chat">🗑️</button>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.session-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('btn-delete-session')) return;
      selectSession({ id: el.dataset.id, title: el.dataset.title });
    });
  });

  list.querySelectorAll('.btn-delete-session').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const sessionId = btn.dataset.id;
      if (confirm('Delete this chat?')) {
        const delUrl = currentPersona === 'builder' ? `/api/builder/sessions/${sessionId}` : `/api/sessions/${sessionId}`;
        await apiFetch(delUrl, { method: 'DELETE' });
        if (currentSession?.id === sessionId) {
          currentSession = null;
          clearMessages();
          showWelcome();
          document.getElementById('chat-session-title').textContent = currentPersona === 'builder' ? 'Select a project' : 'Select a chat';
        }
        await loadSessions();
      }
    });
  });
}

async function selectSession(session) {
  closeViews();
  currentSession = session;
  document.getElementById('chat-session-title').textContent = session.title;
  document.getElementById('welcome-screen')?.remove();

  // Mark active
  document.querySelectorAll('.session-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === session.id);
  });

  clearMessages();
  await loadMessages(session.id);
}

async function fetchProactiveGreeting() {
  try {
    const { greeting } = await apiFetch('/api/chat/proactive-greeting');
    const welcomeEl = document.getElementById('welcome-screen');
    if (welcomeEl && greeting) {
      const p = welcomeEl.querySelector('p');
      if (p) p.textContent = greeting;
    }
  } catch (err) {
    console.error('Proactive greeting error:', err);
  }
}

async function createNewSession() {
  closeViews();
  // Builder persona: projects are created lazily on first message — just reset to welcome
  if (currentPersona === 'builder') {
    currentSession = null;
    clearMessages();
    showWelcome();
    document.getElementById('chat-session-title').textContent = 'Select a project';
    messageInput.focus();
    return;
  }
  try {
    const title    = 'New Chat ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const { session } = await apiFetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    await loadSessions();
    await selectSession(session);
  } catch (err) {
    console.error('createNewSession error:', err);
  }
}

document.getElementById('new-chat-btn').addEventListener('click', createNewSession);
document.getElementById('welcome-new-chat')?.addEventListener('click', createNewSession);

// ═══════════════════════════════════════════════════════
// MESSAGES
// ═══════════════════════════════════════════════════════

function clearMessages() {
  const c = document.getElementById('messages-container');
  c.innerHTML = '';
}

async function loadMessages(sessionId) {
  try {
    const url = currentPersona === 'builder' ? `/api/builder/sessions/${sessionId}/messages` : `/api/sessions/${sessionId}/messages`;
    const { messages } = await apiFetch(url);
    (messages || []).forEach(m => {
      if (currentPersona === 'builder') {
        appendMessage(m.role, m.content, false, m.sender || m.role);
      } else {
        appendMessage(m.role, m.content, false);
      }
    });
    scrollToBottom();
  } catch (err) {
    console.error('loadMessages error:', err);
  }
}

// ── File type metadata ──────────────────────────────
const FILE_TYPE_META = {
  // Spreadsheets
  csv:        { icon: '📊', label: 'CSV Spreadsheet',   ext: 'csv',  mime: 'text/csv' },
  tsv:        { icon: '📊', label: 'TSV Data',          ext: 'tsv',  mime: 'text/tab-separated-values' },
  // Documents
  markdown:   { icon: '📝', label: 'Markdown Document', ext: 'md',   mime: 'text/markdown' },
  md:         { icon: '📝', label: 'Markdown Document', ext: 'md',   mime: 'text/markdown' },
  text:       { icon: '📄', label: 'Text File',         ext: 'txt',  mime: 'text/plain' },
  txt:        { icon: '📄', label: 'Text File',         ext: 'txt',  mime: 'text/plain' },
  html:       { icon: '🌐', label: 'HTML Page',         ext: 'html', mime: 'text/html' },
  // Data / Config
  json:       { icon: '🔧', label: 'JSON Data',         ext: 'json', mime: 'application/json' },
  yaml:       { icon: '⚙️', label: 'YAML Config',       ext: 'yaml', mime: 'text/yaml' },
  yml:        { icon: '⚙️', label: 'YAML Config',       ext: 'yml',  mime: 'text/yaml' },
  xml:        { icon: '📋', label: 'XML Data',          ext: 'xml',  mime: 'application/xml' },
  toml:       { icon: '⚙️', label: 'TOML Config',       ext: 'toml', mime: 'text/plain' },
  env:        { icon: '🔐', label: 'Env Config',        ext: 'env',  mime: 'text/plain' },
  // Code
  python:     { icon: '🐍', label: 'Python Script',     ext: 'py',   mime: 'text/x-python' },
  py:         { icon: '🐍', label: 'Python Script',     ext: 'py',   mime: 'text/x-python' },
  javascript: { icon: '🟨', label: 'JavaScript',        ext: 'js',   mime: 'text/javascript' },
  js:         { icon: '🟨', label: 'JavaScript',        ext: 'js',   mime: 'text/javascript' },
  typescript: { icon: '🔷', label: 'TypeScript',        ext: 'ts',   mime: 'text/typescript' },
  ts:         { icon: '🔷', label: 'TypeScript',        ext: 'ts',   mime: 'text/typescript' },
  sql:        { icon: '🗃️', label: 'SQL Query',         ext: 'sql',  mime: 'text/plain' },
  bash:       { icon: '💻', label: 'Shell Script',      ext: 'sh',   mime: 'text/x-shellscript' },
  sh:         { icon: '💻', label: 'Shell Script',      ext: 'sh',   mime: 'text/x-shellscript' },
  cpp:        { icon: '⚡', label: 'C++ Program',       ext: 'cpp',  mime: 'text/x-c++src' },
  c:          { icon: '⚡', label: 'C Program',         ext: 'c',    mime: 'text/x-csrc' },
  java:       { icon: '☕', label: 'Java Program',      ext: 'java', mime: 'text/x-java-source' },
  css:        { icon: '🎨', label: 'CSS Stylesheet',    ext: 'css',  mime: 'text/css' },
  dockerfile: { icon: '🐳', label: 'Dockerfile',        ext: '',     mime: 'text/plain' },
  makefile:   { icon: '🔨', label: 'Makefile',          ext: '',     mime: 'text/plain' },
  rust:       { icon: '🦀', label: 'Rust Program',      ext: 'rs',   mime: 'text/plain' },
  go:         { icon: '🐹', label: 'Go Program',        ext: 'go',   mime: 'text/plain' },
  php:        { icon: '🐘', label: 'PHP Script',        ext: 'php',  mime: 'application/x-php' },
  kotlin:     { icon: '🟣', label: 'Kotlin Program',    ext: 'kt',   mime: 'text/plain' },
  swift:      { icon: '🍊', label: 'Swift Program',     ext: 'swift',mime: 'text/plain' },
};

// ── Background Polling Timer (30 sec) ────────────────
let pollInterval = null;
function startBackgroundPolling() {
  stopBackgroundPolling();
  // Poll every 30 seconds: check notifications + trigger scheduler tick
  pollInterval = setInterval(async () => {
    if (!currentUser) return;
    try {
      // Pings scheduler tick to process any due tasks in real-time
      await apiFetch('/api/scheduler/tick', { method: 'POST' }).catch(() => {});
      await loadNotifications();
    } catch (e) { /* silent */ }
  }, 30000);
}
function stopBackgroundPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = null;
}

// ── Parse Bob's message for downloadable file & schedule blocks ─
function parseFileBlocks(text) {
  // Match ```<lang> filename=<filename>\n<content>\n```, ```schedule\n{...}\n```,
  // ```chart\n{...}\n```, ```mermaid\n<diagram>\n```, ```builder\n{...}\n```, or ```hackathon\n{...}\n```
  const regex = /```(?:([\w.+-]+)[ \t]+filename=([^\n\r]+)|(schedule)|(chart)|(mermaid)|(builder)|(hackathon))[\n\r]?([\s\S]*?)```/g;
  const blocks = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    if (match[3] === 'schedule') {
      try {
        const data = JSON.parse(match[7].trim());
        blocks.push({ type: 'schedule', data });
      } catch {
        blocks.push({ type: 'text', content: match[0] });
      }
    } else if (match[4] === 'chart') {
      try {
        const data = JSON.parse(match[7].trim());
        blocks.push({ type: 'chart', data });
      } catch {
        blocks.push({ type: 'text', content: match[0] });
      }
    } else if (match[5] === 'mermaid') {
      blocks.push({ type: 'mermaid', source: match[7].trim() });
    } else if (match[6] === 'builder') {
      try {
        const data = JSON.parse(match[7].trim());
        if (!data.instruction || typeof data.instruction !== 'string' || !data.instruction.trim()) {
          blocks.push({ type: 'builder-invalid', raw: match[7].trim(), error: 'instruction is required (Bob ka builder block incomplete hai — instruction missing/empty)' });
        } else {
          blocks.push({ type: 'builder', data });
        }
      } catch {
        blocks.push({ type: 'builder-invalid', raw: match[7].trim(), error: 'invalid JSON builder block' });
      }
    } else {
      blocks.push({
        type:     'file',
        lang:     match[1].toLowerCase().trim(),
        filename: match[2].trim(),
        content:  match[7],
      });
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    blocks.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return blocks.length > 0 ? blocks : [{ type: 'text', content: text }];
}

// ── Create a schedule card element ───────────────────
function createScheduleCard(data) {
  const card = document.createElement('div');
  card.className = 'file-gen-card schedule-card';
  const fireDate = new Date(data.scheduledAt);
  const formattedTime = isNaN(fireDate.getTime())
    ? data.scheduledAt
    : fireDate.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

  card.innerHTML = `
    <div class="file-gen-header">
      <div class="file-gen-icon">⏰</div>
      <div class="file-gen-info">
        <div class="file-gen-name">Scheduled: ${escHtml(data.title || 'Bob Task')}</div>
        <div class="file-gen-meta">📅 ${escHtml(formattedTime)} ${data.repeat && data.repeat !== 'none' ? `&bull; Repeat: ${data.repeat}` : ''}</div>
      </div>
    </div>
    <div class="file-gen-actions">
      <div style="font-size: 11.5px; color: var(--text2); flex:1; align-self:center;">
        Bob will autonomously generate this message and send a notification at the scheduled time!
      </div>
    </div>
  `;
  return card;
}

// ── Create an interactive Hackathon detection card element ─
function createHackathonDetectedCard(data) {
  const card = document.createElement('div');
  card.className = 'hack-detected-card';
  const title = data.title || 'Untitled Hackathon';
  const prize = data.prize || 'Prize Pool specified';
  const link = data.link || '';
  const desc = data.description || '';

  card.innerHTML = `
    <div class="hack-detected-header">
      <div class="hack-detected-badge">🏆 HACKATHON DETECTED</div>
      <div class="hack-detected-title">${escHtml(title)}</div>
    </div>
    <div class="hack-detected-body">
      ${prize ? `<div class="hack-detected-meta">💰 <strong>Prize:</strong> ${escHtml(prize)}</div>` : ''}
      ${data.mode ? `<div class="hack-detected-meta">🏛 <strong>Mode:</strong> ${escHtml(data.mode)}</div>` : ''}
      ${desc ? `<div class="hack-detected-desc">${escHtml(desc)}</div>` : ''}
    </div>
    <div class="hack-detected-actions">
      <button class="btn-primary add-to-workspace-btn">➕ Add to Hackathon Workspace</button>
      ${link ? `<a href="${escHtml(link)}" target="_blank" rel="noopener" class="btn-secondary link-btn">🔗 Official Link</a>` : ''}
    </div>
  `;

  const btn = card.querySelector('.add-to-workspace-btn');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = '⏳ Adding to Workspace…';
    try {
      await apiFetch('/api/hackathons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: data.title,
          link: data.link,
          startDate: data.startDate,
          endDate: data.endDate,
          prize: data.prize,
          mode: data.mode,
          description: data.description,
          rules: data.rules,
          participating: true, // auto turn on participate so Bob remembers!
          tracking: true
        })
      });
      btn.textContent = '✅ Added to Workspace!';
      btn.style.background = 'var(--green)';
      btn.style.color = '#000';
      await loadHackathons();
    } catch (err) {
      alert('Error adding hackathon: ' + err.message);
      btn.disabled = false;
      btn.textContent = '➕ Add to Hackathon Workspace';
    }
  });

  return card;
}

// ── Create a chart card element (Chart.js inline render) ───
function createChartCard(chartData) {
  const card = document.createElement('div');
  card.className = 'chart-card';

  const type = (chartData.type || 'bar').toLowerCase();
  const datasets = (chartData.data && Array.isArray(chartData.data.datasets)) ? chartData.data.datasets : [];

  if (typeof Chart === 'undefined') {
    card.innerHTML = '<div class="chart-fallback">📊 Chart.js load nahi hua — internet connection check karo.</div>';
    return card;
  }
  if (!datasets.length) {
    card.innerHTML = '<div class="chart-fallback">⚠️ Chart data invalid — Bob ka chart format galat hai.</div>';
    return card;
  }

  // Toolbar: title (left) + Download PNG (right)
  const toolbar = document.createElement('div');
  toolbar.className = 'chart-title-row';
  const title = document.createElement('span');
  title.className = 'chart-title';
  title.textContent = chartData.title || '📊 Chart';
  toolbar.appendChild(title);
  const pngBtn = document.createElement('button');
  pngBtn.className = 'file-gen-download-btn';
  pngBtn.textContent = '⬇ PNG';
  pngBtn.title = 'Download chart as image';
  toolbar.appendChild(pngBtn);
  card.appendChild(toolbar);

  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  const canvas = document.createElement('canvas');
  wrap.appendChild(canvas);
  card.appendChild(wrap);

  // Client-side quick stats strip for the first numeric dataset
  const stats = computeQuickStats(datasets[0]);
  if (stats) {
    const strip = document.createElement('div');
    strip.className = 'chart-stats';
    strip.textContent = stats;
    card.appendChild(strip);
  }

  requestAnimationFrame(() => {
    try {
      new Chart(canvas.getContext('2d'), chartConfig(chartData));
    } catch (err) {
      card.innerHTML = '<div class="chart-fallback">⚠️ Chart render error: ' + escHtml(err.message) + '</div>';
    }
  });

  pngBtn.addEventListener('click', () => {
    try {
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = (chartData.title || 'chart').replace(/\s+/g, '_') + '.png';
      a.click();
      pngBtn.textContent = '✅ Saved!';
      setTimeout(() => { pngBtn.textContent = '⬇ PNG'; }, 1800);
    } catch (e) { /* ignore */ }
  });

  return card;
}

// ── Create a Mermaid diagram card (roadmap/flow/timeline) ───
function createMermaidCard(source) {
  const card = document.createElement('div');
  card.className = 'mermaid-card';
  const src = (source || '').trim();

  if (typeof mermaid === 'undefined') {
    card.innerHTML = '<div class="chart-fallback">🧭 Mermaid load nahi hua — internet connection check karo.</div>';
    return card;
  }
  if (!src) {
    card.innerHTML = '<div class="chart-fallback">⚠️ Diagram source empty.</div>';
    return card;
  }

  const toolbar = document.createElement('div');
  toolbar.className = 'chart-title-row';
  const title = document.createElement('span');
  title.className = 'chart-title';
  title.textContent = '🧭 Diagram / Roadmap';
  toolbar.appendChild(title);
  const pngBtn = document.createElement('button');
  pngBtn.className = 'file-gen-download-btn';
  pngBtn.textContent = '⬇ PNG';
  pngBtn.title = 'Download diagram as image';
  toolbar.appendChild(pngBtn);
  card.appendChild(toolbar);

  const wrap = document.createElement('div');
  wrap.className = 'mermaid-wrap';
  wrap.textContent = '⏳ Rendering diagram…';
  card.appendChild(wrap);

  const uid = 'mmd' + Date.now() + '_' + Math.floor(Math.random() * 99999);
  mermaid.initialize({ startOnLoad: false, theme: 'dark', fontFamily: 'Inter, sans-serif' });
  mermaid.render(uid, src)
    .then(({ svg }) => {
      wrap.innerHTML = svg;
      wrap.dataset.svg = svg;
      pngBtn.addEventListener('click', () => downloadSvgAsPng(svg, 'diagram'));
    })
    .catch(err => {
      wrap.innerHTML = `<div class="chart-fallback">⚠️ Diagram render error: ${escHtml(err.message)}</div><pre class="plain-code"><code>${escHtml(src)}</code></pre>`;
    });

  return card;
}

function downloadSvgAsPng(svgText, name) {
  try {
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = Math.max(1, Math.round(img.width * 2));
      canvas.height = Math.max(1, Math.round(img.height * 2));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0d0f14';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = (name || 'diagram').replace(/\s+/g, '_') + '.png';
      a.click();
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  } catch (e) { /* ignore */ }
}

function chartConfig(chartData) {
  const type = (chartData.type || 'bar').toLowerCase();
  const cfg = {
    type,
    data: chartData.data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#c9d1d9' } },
      },
    },
  };
  if (chartData.title) {
    cfg.options.plugins.title = { display: true, text: chartData.title, color: '#e2e8f0', font: { size: 13 } };
  }
  if (['bar', 'line', 'scatter', 'bubble'].includes(type)) {
    cfg.options.scales = {
      x: { ticks: { color: '#9ca3af' }, grid: { color: 'rgba(255,255,255,0.06)' } },
      y: { ticks: { color: '#9ca3af' }, grid: { color: 'rgba(255,255,255,0.06)' } },
    };
  }
  return cfg;
}

function computeQuickStats(dataset) {
  const data = (dataset && dataset.data) || [];
  const nums = data.filter(v => typeof v === 'number' && isFinite(v));
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const sum = nums.reduce((a, b) => a + b, 0);
  const mean = sum / nums.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const fmt = n => Math.round(n * 100) / 100;
  return `📈 ${dataset.label ? dataset.label + ': ' : ''}n=${nums.length} · total=${fmt(sum)} · avg=${fmt(mean)} · min=${fmt(sorted[0])} · max=${fmt(sorted[sorted.length - 1])} · median=${fmt(median)}`;
}

// ── Create a download card element ───────────────────
function createFileCard(lang, filename, content) {
  const meta = FILE_TYPE_META[lang] || { icon: '📁', label: lang.toUpperCase() + ' File', ext: lang, mime: 'text/plain' };
  // Determine final filename
  let finalName = filename;
  if (meta.ext && !filename.includes('.')) {
    finalName = filename + '.' + meta.ext;
  }
  // Handle special filenames like Dockerfile / Makefile
  if (lang === 'dockerfile' && !filename.includes('.')) finalName = 'Dockerfile';
  if (lang === 'makefile'   && !filename.includes('.')) finalName = 'Makefile';

  const lineCount = content.split('\n').length;
  const byteSize  = new TextEncoder().encode(content).length;

  const card = document.createElement('div');
  card.className = 'file-gen-card';
  card.innerHTML = `
    <div class="file-gen-header">
      <div class="file-gen-icon">${meta.icon}</div>
      <div class="file-gen-info">
        <div class="file-gen-name">${escHtml(finalName)}</div>
        <div class="file-gen-meta">${escHtml(meta.label)} &bull; ${lineCount} lines &bull; ${formatBytes(byteSize)}</div>
      </div>
      <button class="file-gen-preview-btn" title="Toggle preview">🙈</button>
    </div>
    <div class="file-gen-preview">
      ${buildFilePreview(lang, content)}
    </div>
    <div class="file-gen-actions">
      <button class="file-gen-download-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Download ${escHtml(finalName)}
      </button>
      <button class="file-gen-copy-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        Copy
      </button>
      <button class="file-gen-save-btn" title="Store this file in My Files (only when you click)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        Save to My Files
      </button>
    </div>
  `;

  // Preview toggle (expanded by default)
  card.querySelector('.file-gen-preview-btn').addEventListener('click', () => {
    const prev = card.querySelector('.file-gen-preview');
    prev.classList.toggle('hidden');
    card.querySelector('.file-gen-preview-btn').textContent = prev.classList.contains('hidden') ? '👁' : '🙈';
  });

  // Download
  card.querySelector('.file-gen-download-btn').addEventListener('click', () => {
    const blob = new Blob([content], { type: meta.mime });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = finalName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    // Animate button
    const btn = card.querySelector('.file-gen-download-btn');
    btn.textContent = '✅ Downloaded!';
    btn.style.background = 'rgba(34, 197, 94, 0.2)';
    btn.style.borderColor = '#22c55e';
    setTimeout(() => {
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download ${escHtml(finalName)}`;
      btn.style.background = '';
      btn.style.borderColor = '';
    }, 2500);
  });

  // Copy
  card.querySelector('.file-gen-copy-btn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(content);
      const btn = card.querySelector('.file-gen-copy-btn');
      btn.textContent = '✅ Copied!';
      setTimeout(() => {
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`;
      }, 1800);
    } catch (e) { /* ignore */ }
  });

  // Save to My Files (opt-in — only stores when Master clicks)
  card.querySelector('.file-gen-save-btn').addEventListener('click', async () => {
    const btn = card.querySelector('.file-gen-save-btn');
    if (btn.dataset.busy) return;
    btn.dataset.busy = '1';
    btn.textContent = '⏳ Saving…';
    const ok = await saveGeneratedFile(finalName, content, meta.mime);
    delete btn.dataset.busy;
    btn.textContent = ok ? '✅ Saved to My Files' : '⚠️ Save failed';
    if (ok) setTimeout(() => { btn.textContent = 'Save to My Files'; }, 3000);
  });

  return card;
}

// ── Render a rich live preview for a generated file ───
function buildFilePreview(lang, content) {
  const lines = content.trimEnd().split('\n');
  if (lang === 'csv' || lang === 'tsv') {
    const sep = lang === 'tsv' ? /\t/ : /,/;
    const rows = lines.slice(0, 9).map(l => l.split(sep).map(c => c.trim()));
    if (rows.length && rows.some(r => r.length > 0)) {
      const maxCols = Math.max(...rows.map(r => r.length));
      let t = '<table class="md-table"><thead><tr>';
      rows[0].forEach(c => { t += `<th>${escHtml(c)}</th>`; });
      t += '</tr></thead><tbody>';
      rows.slice(1).forEach(r => {
        t += '<tr>';
        for (let i = 0; i < maxCols; i++) t += `<td>${escHtml(r[i] || '')}</td>`;
        t += '</tr>';
      });
      t += '</tbody></table>';
      if (lines.length > 9) t += `<div class="file-preview-note">… +${lines.length - 9} more rows</div>`;
      return t;
    }
    return `<pre class="file-gen-code"><code>${escHtml(content.trimEnd())}</code></pre>`;
  }
  if (lang === 'json') {
    try {
      const pretty = JSON.stringify(JSON.parse(content), null, 2);
      const shown = pretty.length > 2500 ? pretty.slice(0, 2500) + '\n… (truncated)' : pretty;
      return `<pre class="file-gen-code"><code>${escHtml(shown)}</code></pre>`;
    } catch (e) {
      return `<pre class="file-gen-code"><code>${escHtml(content.trimEnd())}</code></pre>`;
    }
  }
  if (lang === 'markdown' || lang === 'md') {
    return `<div class="file-gen-md-preview">${renderTextContent(content.trim())}</div>`;
  }
  const shown = lines.slice(0, 40).join('\n');
  const extra = lines.length > 40 ? `\n… +${lines.length - 40} more lines` : '';
  return `<pre class="file-gen-code"><code>${escHtml(shown + extra)}</code></pre>`;
}

// ── Store a generated file into My Files (Firestore + Cloudinary) ───
async function saveGeneratedFile(name, content, mime) {
  try {
    const file = new File([content], name, { type: mime || 'text/plain' });
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(API + '/api/files/upload', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${idToken}` },
      body: formData,
    });
    return res.ok;
  } catch (err) {
    return false;
  }
}

// ── Simple text → HTML (basic markdown + code blocks) ─
function renderTextContent(text) {
  // Escape HTML first
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // Protect code blocks + inline code so markdown inside them stays raw
  const stash = [];
  const stashToken = () => `\u0000STASH${stash.length - 1}\u0000`;
  const unstash = (s) => s.replace(/\u0000STASH(\d+)\u0000/g, (_, i) => stash[+i]);

  html = html.replace(/```[\w]*\n([\s\S]*?)```/g, (_, c) => {
    stash.push(`<pre class="plain-code"><code>${c.trimEnd()}</code></pre>`);
    return stashToken();
  });
  html = html.replace(/`([^`]+)`/g, (_, c) => {
    stash.push(`<code class="inline-code">${c}</code>`);
    return stashToken();
  });

  // Auto-link URLs (clickable) — runs after code stash so links inside code stay raw
  html = html.replace(/(https?:\/\/[^\s<>"']+)/g, (url) => {
    let clean = url.replace(/[.,;:!?]+$/, '');
    // Drop trailing closing brackets only if they aren't balanced by opens
    clean = clean.replace(/[)\]}]+$/, (m) => {
      const opens  = (clean.match(/[(\[{]/g) || []).length;
      const closes = (clean.match(/[)\]}]/g) || []).length;
      return closes > opens ? '' : m;
    });
    return `<a href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>`;
  });

  // Bold **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic *text*
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // Bullet + numbered lists (group consecutive items into one list)
  html = html.replace(/^(?:[-*] |\d+\. )(.+)$/gm, (line) => `<li>${line.replace(/^(?:[-*] |\d+\. )/, '')}</li>`);
  html = html.replace(/((?:<li>.*?<\/li>\n?)+)/g, '<ul>$1</ul>');
  html = html.replace(/<ul>([\s\S]*?)<\/ul>/g, (_, inner) => '<ul>' + inner.replace(/\n/g, '') + '</ul>');
  // Markdown tables (| a | b |) — grouped into styled <table>
  html = html.replace(/((?:^\|.*\|(?:\n|$))+)/gm, (tableBlock) => {
    const lines = tableBlock.trim().split('\n').filter(l => l.trim().startsWith('|') && l.trim().endsWith('|'));
    if (lines.length < 2) return tableBlock;
    const parseRow = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const header = parseRow(lines[0]);
    const sep    = parseRow(lines[1]);
    const isSep  = sep.length > 0 && sep.every(c => /^:?-{2,}:?$/.test(c));
    if (!isSep) return tableBlock;
    let out = '<table class="md-table"><thead><tr>';
    header.forEach(h => { out += `<th>${h}</th>`; });
    out += '</tr></thead><tbody>';
    lines.slice(2).forEach(line => {
      out += '<tr>';
      parseRow(line).forEach(c => { out += `<td>${c}</td>`; });
      out += '</tr>';
    });
    out += '</tbody></table>';
    return out;
  });
  // Line breaks (collapse 3+ blank lines so spacing stays tight)
  html = html.replace(/\n{3,}/g, '\n\n');
  html = html.replace(/\n/g, '<br>');

  return unstash(html);
}

function appendMessage(role, content, animate = true, sender = null) {
  const container = document.getElementById('messages-container');

  // Remove welcome screen if present
  const welcome = document.getElementById('welcome-screen');
  if (welcome) welcome.remove();

  const row = document.createElement('div');
  row.className = `message-row ${role}`;
  if (!animate) row.style.animation = 'none';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  if (sender === 'bob') bubble.classList.add('bob');

  if (role === 'assistant' && content) {
    // Parse for downloadable file blocks
    const blocks = parseFileBlocks(content);
    const hasFileBlocks = blocks.some(b => b.type === 'file');

    blocks.forEach(block => {
      if (block.type === 'file') {
        bubble.appendChild(createFileCard(block.lang, block.filename, block.content));
      } else if (block.type === 'schedule') {
        bubble.appendChild(createScheduleCard(block.data));
      } else if (block.type === 'chart') {
        bubble.appendChild(createChartCard(block.data));
      } else if (block.type === 'mermaid') {
        bubble.appendChild(createMermaidCard(block.source));
      } else if (block.type === 'builder') {
        bubble.appendChild(createBuilderDelegationCard(block.data));
      } else if (block.type === 'builder-invalid') {
        bubble.appendChild(createBuilderInvalidCard(block));
      } else if (block.type === 'hackathon') {
        bubble.appendChild(createHackathonDetectedCard(block.data));
      } else if (block.content && block.content.trim()) {
        const textDiv = document.createElement('div');
        textDiv.className = 'msg-text-content';
        textDiv.innerHTML = renderTextContent(block.content);
        bubble.appendChild(textDiv);
      }
    });

    // If only file cards (no accompanying text), add a tiny label above
    if (hasFileBlocks && blocks.filter(b => b.type === 'text' && b.content.trim()).length === 0) {
      const label = document.createElement('div');
      label.className = 'file-gen-label';
      label.textContent = '📁 File generated — ready to download:';
      bubble.insertBefore(label, bubble.firstChild);
    }
    // Add Speak Audio Button for Bob's responses
    const speakBtn = document.createElement('button');
    speakBtn.className = 'bubble-speak-btn';
    speakBtn.title = 'Listen to Bob (Hinglish)';
    speakBtn.innerHTML = '🔊 Listen';
    speakBtn.addEventListener('click', () => speakHinglishText(content, speakBtn));
    bubble.appendChild(speakBtn);

    // Auto-speak if TTS is enabled
    if (isTTSEnabled && animate && sender !== 'bob') {
      speakHinglishText(content, speakBtn);
    }
  } else {
    bubble.textContent = content;
  }

  row.appendChild(bubble);
  container.appendChild(row);
  scrollToBottom();
  return row;
}

// ── Bob → Builder delegation card ───────────────────
function createBuilderDelegationCard(data) {
  const card = document.createElement('div');
  card.className = 'builder-delegation-card';
  card.innerHTML = `
    <div class="file-gen-header">
      <div class="file-gen-icon">🏗️</div>
      <div class="file-gen-info">
        <div class="file-gen-name">Bob the Builder — ${escHtml(data.title || 'Project')}</div>
        <div class="file-gen-meta">Bob Builder ko de raha hai…</div>
      </div>
    </div>
    <div class="builder-delegation-body">⏳ Builder se baat ho rahi hai — jawab ka wait karo…</div>
  `;
  delegateToBuilder(data, card);
  return card;
}

function createBuilderInvalidCard(block) {
  const card = document.createElement('div');
  card.className = 'builder-delegation-card builder-invalid';
  card.innerHTML = `
    <div class="file-gen-header">
      <div class="file-gen-icon">⚠️</div>
      <div class="file-gen-info">
        <div class="file-gen-name">Builder delegation incomplete</div>
        <div class="file-gen-meta">Bob ka builder block adhoora tha</div>
      </div>
    </div>
    <div class="builder-delegation-body">❌ ${escHtml(block.error || 'invalid builder block')}. Builder ko kuch nahi bheja gaya. Bob se dobara kahna ki pura 'instruction' ke saath builder block bheje.</div>
  `;
  return card;
}

async function delegateToBuilder(data, card) {
  try {
    if (!data.instruction || typeof data.instruction !== 'string' || !data.instruction.trim()) {
      throw new Error('instruction is required');
    }
    const res = await apiFetch('/api/builder/delegate', {
      method: 'POST',
      body: JSON.stringify({
        title: data.title,
        instruction: data.instruction,
        sessionId: data.sessionId || null,
      }),
    });
    const out = await res.json();
    const body = card.querySelector('.builder-delegation-body');
    const meta = card.querySelector('.file-gen-meta');
    if (!res.ok) throw new Error(out.error || 'delegation failed');

    meta.textContent = '✅ Builder ne jawab de diya';
    body.innerHTML = '';
    const replyDiv = document.createElement('div');
    replyDiv.className = 'msg-text-content';
    const preview = out.reply.length > 700 ? out.reply.slice(0, 700) + '\n\n…' : out.reply;
    replyDiv.innerHTML = renderTextContent(preview);
    body.appendChild(replyDiv);

    const openBtn = document.createElement('button');
    openBtn.className = 'builder-open-btn';
    openBtn.textContent = '🗂️ Open in Builder';
    openBtn.addEventListener('click', () => {
      setPersona('builder');
      loadSessions();
      selectSession(out.sessionId);
    });
    body.appendChild(openBtn);
  } catch (err) {
    const body = card.querySelector('.builder-delegation-body');
    body.textContent = '⚠️ Builder delegation failed: ' + err.message;
  }
}

// ═══════════════════════════════════════════════════════
// HINGLISH VOICE SPEECH ENGINE (Web Speech API - 100% Free & Private)
// ═══════════════════════════════════════════════════════
let isTTSEnabled = true;
let currentUtterance = null;
let currentSpeechBtn = null;

const ttsBtn   = document.getElementById('tts-toggle-btn');
const ttsIcon  = document.getElementById('tts-icon');
const ttsLabel = document.getElementById('tts-label');

if (ttsBtn) {
  ttsBtn.addEventListener('click', () => {
    isTTSEnabled = !isTTSEnabled;
    if (!isTTSEnabled && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    ttsIcon.textContent  = isTTSEnabled ? '🔊' : '🔇';
    ttsLabel.textContent = isTTSEnabled ? 'Voice ON' : 'Voice OFF';
    ttsBtn.style.opacity = isTTSEnabled ? '1' : '0.6';
  });
}

function cleanTextForSpeech(rawText) {
  return rawText
    .replace(/```[\s\S]*?```/g, '') // strip code blocks
    .replace(/`([^`]+)`/g, '$1')     // inline code
    .replace(/[*_#~]/g, '')           // markdown formatting
    .replace(/(https?:\/\/[^\s]+)/g, '') // URLs
    .trim();
}

function speakHinglishText(text, btnElement = null) {
  if (!('speechSynthesis' in window)) return;

  // If this bubble is already speaking, treat the click as STOP — don't restart.
  if (btnElement && currentSpeechBtn === btnElement && window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    currentSpeechBtn = null;
    currentUtterance = null;
    btnElement.innerHTML = '🔊 Listen';
    return;
  }

  const speechText = cleanTextForSpeech(text);
  if (!speechText) return;

  window.speechSynthesis.cancel(); // stop previous speech

  const utterance = new SpeechSynthesisUtterance(speechText);
  currentUtterance = utterance;
  currentSpeechBtn = btnElement || null;

  // Rate & Pitch tuned for natural Hinglish conversational tone
  utterance.rate  = 1.05;
  utterance.pitch = 1.0;

  // Get available browser voices
  const voices = window.speechSynthesis.getVoices();

  // Smart Voice Picker: Preference: hi-IN (Hindi India) > en-IN (English India) > Default
  const hindiVoice = voices.find(v => v.lang === 'hi-IN' || v.lang === 'hi_IN');
  const indianEngVoice = voices.find(v => v.lang === 'en-IN' || v.lang === 'en_IN' || v.name.includes('India'));

  if (hindiVoice) {
    utterance.voice = hindiVoice;
    utterance.lang  = 'hi-IN';
  } else if (indianEngVoice) {
    utterance.voice = indianEngVoice;
    utterance.lang  = 'en-IN';
  } else {
    utterance.lang  = 'hi-IN'; // Fallback
  }

  if (btnElement) {
    btnElement.innerHTML = '⏹️ Stop';
    utterance.onend = () => { btnElement.innerHTML = '🔊 Listen'; if (currentSpeechBtn === btnElement) currentSpeechBtn = null; };
    utterance.onerror = () => { btnElement.innerHTML = '🔊 Listen'; if (currentSpeechBtn === btnElement) currentSpeechBtn = null; };
  }

  window.speechSynthesis.speak(utterance);
}

// Pre-load voices on browser ready
if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
  };
}

function showTypingIndicator() {
  const container = document.getElementById('messages-container');
  const row = document.createElement('div');
  row.className = 'message-row assistant';
  row.id = 'typing-row';
  row.innerHTML = `<div class="message-bubble"><div class="typing-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="typing-label">Bob is thinking…</span></div></div>`;
  container.appendChild(row);
  scrollToBottom();
}

function removeTypingIndicator() {
  const row = document.getElementById('typing-row');
  if (!row) return;
  row.classList.add('typing-fade');
  setTimeout(() => row.remove(), 260);
}

function scrollToBottom() {
  const c = document.getElementById('messages-container');
  requestAnimationFrame(() => {
    c.scrollTop = c.scrollHeight;
    setTimeout(() => { c.scrollTop = c.scrollHeight; }, 50);
  });
}

// ═══════════════════════════════════════════════════════
// SEND MESSAGE
// ═══════════════════════════════════════════════════════

const messageInput = document.getElementById('message-input');
const sendBtn      = document.getElementById('send-btn');

function adjustTextareaHeight(el, maxH = 180) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, maxH) + 'px';
}

function attachAutoResizeTextarea(id, sendFn) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', () => adjustTextareaHeight(el));
  el.addEventListener('paste', () => setTimeout(() => adjustTextareaHeight(el), 0));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendFn();
    }
  });
}

messageInput.addEventListener('input', () => {
  adjustTextareaHeight(messageInput);
  sendBtn.disabled = !messageInput.value.trim() && !pendingFile && !pendingPasteImage;
});

messageInput.addEventListener('paste', () => {
  setTimeout(() => adjustTextareaHeight(messageInput), 0);
});

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) sendMessage();
  }
});

// ── Paste Screenshot Support (Ctrl+V) ─────────────────
messageInput.addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;

  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      e.preventDefault(); // don't paste image as text
      const file = item.getAsFile();
      if (!file) return;

      pendingPasteImage = file;

      // Show image thumbnail preview
      const reader = new FileReader();
      reader.onload = (ev) => {
        const preview = document.getElementById('file-preview');
        preview.classList.remove('hidden');
        preview.innerHTML = `
          <div class="paste-img-preview">
            <img src="${ev.target.result}" alt="Screenshot preview" class="paste-thumb" />
            <div class="paste-img-info">
              <span class="file-type-badge">🖼️</span>
              <span>Screenshot pasted <span style="color:var(--text3)">(${formatBytes(file.size)})</span></span>
            </div>
            <button class="remove-file" id="remove-paste-btn">✕</button>
          </div>
        `;
        document.getElementById('remove-paste-btn').addEventListener('click', clearPastedImage);
        sendBtn.disabled = false;
      };
      reader.readAsDataURL(file);
      return; // only handle first image
    }
  }
});

function clearPastedImage() {
  pendingPasteImage = null;
  const preview = document.getElementById('file-preview');
  preview.classList.add('hidden');
  preview.innerHTML = '';
  sendBtn.disabled = !messageInput.value.trim() && !pendingFile;
}

sendBtn.addEventListener('click', sendMessage);

// ── Welcome screen suggestion chips ───────────────────
const WELCOME_SUGGESTIONS = [
  { icon: '📈', label: 'Aaj ka market batao' },
  { icon: '🌦️', label: 'Mumbai ka weather' },
  { icon: '🧠', label: 'Meri memory kya hai' },
  { icon: '🗓️', label: 'DSA roadmap banao' },
  { icon: '📊', label: 'Ek data chart banao' },
];
const BUILDER_SUGGESTIONS = [
  { icon: '🛒', label: 'E-commerce website ka plan banao' },
  { icon: '🏗️', label: 'Portfolio site architect karo' },
  { icon: '🍔', label: 'Food delivery app ka prompt pack banao' },
  { icon: '💳', label: 'SaaS dashboard project setup plan' },
  { icon: '🎨', label: 'UI polish master prompt banao' },
];
function renderWelcomeSuggestions() {
  const wrap = document.getElementById('welcome-suggestions');
  if (!wrap) return;
  wrap.innerHTML = '';
  const arr = currentPersona === 'builder' ? BUILDER_SUGGESTIONS : WELCOME_SUGGESTIONS;
  arr.forEach(s => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'welcome-chip';
    chip.innerHTML = `<span>${s.icon}</span> ${s.label}`;
    chip.addEventListener('click', () => {
      messageInput.value = s.label;
      sendBtn.disabled = false;
      sendMessage();
    });
    wrap.appendChild(chip);
  });
}
renderWelcomeSuggestions();

// ── Persona helpers (Bob ⇄ Builder) ───────────────────
function updateWelcomeText() {
  const title = document.getElementById('welcome-title');
  const sub   = document.getElementById('welcome-sub');
  const btn   = document.getElementById('welcome-new-chat');
  if (!title) return;
  if (currentPersona === 'builder') {
    title.textContent = "Hi, I'm Bob the Builder";
    sub.textContent = 'Your project planning & prompt-engineering side. Ek idea batao — Bob the Builder use architect karega, poora prompt pack likhega, aur step-by-step guide karega.';
    if (btn) btn.textContent = 'Start New Project';
  } else {
    title.textContent = "Hi, I'm Bob";
    sub.textContent = 'Your personal AI assistant with memory. Start a new chat or select one from the sidebar.';
    if (btn) btn.textContent = 'Start New Chat';
  }
}

function showWelcome() {
  const c = document.getElementById('messages-container');
  c.innerHTML = `
    <div class="welcome-screen" id="welcome-screen">
      <div class="welcome-orb"></div>
      <h1 id="welcome-title">Hi, I'm Bob</h1>
      <p id="welcome-sub">Your personal AI assistant with memory. Start a new chat or select one from the sidebar.</p>
      <button id="welcome-new-chat" class="btn-primary">Start New Chat</button>
      <div class="welcome-suggestions" id="welcome-suggestions"></div>
    </div>
  `;
  document.getElementById('welcome-new-chat').addEventListener('click', createNewSession);
  updateWelcomeText();
  renderWelcomeSuggestions();
}

function setPersona(p) {
  if (!p || currentPersona === p) return;
  currentPersona = p;
  document.body.classList.toggle('persona-builder', p === 'builder');
  document.querySelectorAll('.persona-btn').forEach(b => b.classList.toggle('active', b.dataset.persona === p));
  closeViews();
  currentSession = null;
  clearMessages();
  document.getElementById('chat-session-title').textContent = p === 'builder' ? 'Select a project' : 'Select a chat';
  document.getElementById('sidebar-session-label').textContent = p === 'builder' ? 'Builder Projects' : 'Chats';
  messageInput.placeholder = p === 'builder'
    ? 'Apna project describe karo — Bob the Builder architect + prompt pack banayega...'
    : 'Message Bob...';
  showWelcome();
  loadSessions();
  if (p === 'bob') {
    loadNotifications();
    fetchProactiveGreeting();
  }
}
document.querySelectorAll('.persona-btn').forEach(btn => {
  btn.addEventListener('click', () => setPersona(btn.dataset.persona));
});

async function sendMessage() {
  if (!currentSession) {
    if (currentPersona === 'bob') {
      await createNewSession();
      if (!currentSession) return;
    }
    // Builder: session is created lazily by /api/builder/chat
  }

  const text  = messageInput.value.trim();
  const model = document.getElementById('model-selector').value || undefined;

  if (!text && !pendingFile && !pendingPasteImage) return;

  // Collect image URLs to send to Bob for vision analysis (Bob persona only)
  const imageUrls = [];

  if (currentPersona === 'bob') {
    // Upload pasted screenshot if any
    if (pendingPasteImage) {
      const pasteUrl = await uploadImageFile(pendingPasteImage, 'pasted-screenshot');
      if (pasteUrl) imageUrls.push(pasteUrl);
      clearPastedImage();
    }

    // Upload attached file if any
    if (pendingFile) {
      const attachedUrl = await uploadPendingFile();
      if (attachedUrl && pendingFile && pendingFile.type.startsWith('image/')) {
        imageUrls.push(attachedUrl);
      }
    }
  }

  // If only an image was sent with no text, add a default prompt
  const finalText = text || (imageUrls.length ? 'Yeh screenshot dekho aur mujhe samjhao ismein kya hai.' : '');
  if (!finalText) return;

  // Clear input
  messageInput.value = '';
  messageInput.style.height = 'auto';
  sendBtn.disabled = true;
  messageInput.focus();

  // Show user message (with image indicator if applicable)
  const displayText = imageUrls.length
    ? (text ? `🖼️ [Screenshot attached]\n${text}` : '🖼️ [Screenshot] — Yeh dekho aur samjhao')
    : text;
  appendMessage('user', displayText);

  // Show typing
  showTypingIndicator();

  try {
    let data;
    if (currentPersona === 'builder') {
      const payload = { message: finalText };
      if (currentSession) payload.sessionId = currentSession.id;
      data = await apiFetch('/api/builder/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const title = data.title || data.projectType || 'Project';
      currentSession = { id: data.sessionId, title };
      document.getElementById('chat-session-title').textContent = title;
      await loadSessions();
    } else {
      const payload = { sessionId: currentSession.id, message: finalText, model };
      if (imageUrls.length) payload.imageUrls = imageUrls;
      if (collabMode) payload.collab = true;

      data = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (data.updatedTitle && currentSession) {
        currentSession.title = data.updatedTitle;
        document.getElementById('chat-session-title').textContent = data.updatedTitle;
        await loadSessions();
      }
    }

    removeTypingIndicator();
    appendMessage('assistant', data.reply);
  } catch (err) {
    removeTypingIndicator();
    appendMessage('assistant', `⚠️ Error: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════
// FILE UPLOAD
// ═══════════════════════════════════════════════════════

document.getElementById('file-upload-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  pendingFile = file;

  // Determine file type icon
  const type = file.type || '';
  const name = file.name.toLowerCase();
  let fileIcon = '📄';
  if (type.startsWith('image/'))           fileIcon = '🖼️';
  else if (type.startsWith('audio/'))      fileIcon = '🎵';
  else if (type.startsWith('video/'))      fileIcon = '🎬';
  else if (type.includes('pdf'))           fileIcon = '📕';
  else if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.xlsx') || name.endsWith('.xls'))
                                           fileIcon = '📊';
  else if (name.endsWith('.json'))         fileIcon = '🔧';
  else if (name.endsWith('.py'))           fileIcon = '🐍';
  else if (name.endsWith('.js') || name.endsWith('.ts')) fileIcon = '🟨';
  else if (name.endsWith('.html') || name.endsWith('.htm')) fileIcon = '🌐';
  else if (name.endsWith('.md'))           fileIcon = '📝';
  else if (name.endsWith('.sql'))          fileIcon = '🗃️';
  else if (name.endsWith('.cpp') || name.endsWith('.c') || name.endsWith('.java')) fileIcon = '⚡';
  else if (name.endsWith('.sh') || name.endsWith('.bash')) fileIcon = '💻';

  const preview = document.getElementById('file-preview');
  preview.classList.remove('hidden');
  preview.innerHTML = `
    <span class="file-type-badge">${fileIcon}</span>
    <span>${escHtml(file.name)} <span style="color:var(--text3)">(${formatBytes(file.size)})</span></span>
    <button class="remove-file" id="remove-file-btn">✕</button>
  `;
  document.getElementById('remove-file-btn').addEventListener('click', clearPendingFile);
  sendBtn.disabled = false;
});

function clearPendingFile() {
  pendingFile = null;
  document.getElementById('file-preview').classList.add('hidden');
  document.getElementById('file-upload-input').value = '';
  sendBtn.disabled = !messageInput.value.trim();
}

async function uploadPendingFile() {
  if (!currentSession || !pendingFile) return null;
  const file = pendingFile;
  clearPendingFile();
  return await uploadImageFile(file, file.name);
}

/**
 * Uploads any file (attached or pasted) to backend, returns the Cloudinary URL.
 * For images, the URL is passed to Bob for vision analysis.
 */
async function uploadImageFile(file, label) {
  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch(API + '/api/files/upload', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${idToken}` },
      body: formData,
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    const data = await res.json();
    // Return the URL so it can be sent to Bob for vision analysis
    return data.file && data.file.url ? data.file.url : null;
  } catch (err) {
    appendMessage('assistant', `⚠️ File upload failed: ${err.message}`, true);
    return null;
  }
}

// ═══════════════════════════════════════════════════════
// MEMORY PANEL
// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
// HQ / WORKSPACE VIEW ROUTER
// ═══════════════════════════════════════════════════════

function showView(name) {
  // Toggle OFF if clicking the view that is already active (back to chat so you can type)
  const activeView = document.querySelector('.view.active');
  const activeId = activeView ? activeView.id.replace('view-', '') : '';
  const next = (name && name === activeId) ? '' : (name || '');
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + next));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === next));
  return next;
}
function closeViews() { showView(''); }

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    const opened = showView(view);          // toggles off if same view re-clicked
    if (!opened) return;                    // just closed → back to chat
    if (view === 'hq') loadHQSummary();
    if (view === 'hackathons') loadHackathons();
    if (view === 'stalking') loadStalking();
    if (view === 'routines') loadRoutines();
    if (view === 'live') loadLive();
  });
});

document.querySelectorAll('.view-close').forEach(btn => btn.addEventListener('click', closeViews));
document.querySelectorAll('.view .side-panel').forEach(p => p.classList.remove('hidden'));

document.getElementById('sidebar-session-label').addEventListener('click', () => { closeViews(); document.getElementById('message-input').focus(); });

// ── Bob + Builder collaboration state ───────────────
// (toggled from the "Bob the Builder" HQ card)
let collabMode = localStorage.getItem('bob_collab_mode') === '1';
function setCollabMode(on) {
  collabMode = !!on;
  localStorage.setItem('bob_collab_mode', collabMode ? '1' : '0');
  document.body.classList.toggle('collab-on', collabMode);
}
window.setCollabMode = setCollabMode;

// Start a NEW Builder collaboration session. Bob the Builder asks the Master
// for the plan first — it won't proceed without explicit permission/input.
async function startBobBuilderCollab() {
  setCollabMode(true);
  closeViews();
  setPersona('builder');
  await createNewSession();           // fresh Builder project
  // Builder already has a welcome prompt that asks for the project idea;
  // the collab flag ensures Bob may delegate to Builder when useful.
}

// ── Generic app modal ────────────────────────────────
const appModal      = document.getElementById('app-modal');
const appModalTitle = document.getElementById('app-modal-title');
const appModalBody  = document.getElementById('app-modal-body');
function openModal(title, html) { appModalTitle.textContent = title; appModalBody.innerHTML = html; appModal.classList.remove('hidden'); }
function closeModal() { appModal.classList.add('hidden'); appModalBody.innerHTML = ''; }
document.getElementById('app-modal-close').addEventListener('click', closeModal);
appModal.addEventListener('click', (e) => { if (e.target === appModal) closeModal(); });

// ── Memory & Files are opened via the HQ cards ───────

// Monthly memory files
async function loadMonthlyFiles() {
  const list = document.getElementById('monthly-files-list');
  try {
    const data = await apiFetch('/api/memory/months');
    const files = (data.files || []).sort((a, b) => (a.id < b.id ? 1 : -1));
    if (!files.length) {
      list.innerHTML = '<div class="empty-msg">No monthly memory files yet. Har month end par locked file banegi.</div>';
      return;
    }
    list.innerHTML = files.map(f => `
      <div class="weekly-file-item">
        <div class="weekly-file-info">
          <div class="weekly-file-name">${escHtml(f.filename || ('Bob-Memory-' + f.id + '.md'))}</div>
          <div class="weekly-file-meta">${escHtml(f.id)} · ${new Date(f.createdAt).toLocaleDateString()}</div>
        </div>
        <button class="weekly-file-dl" data-id="${escHtml(f.id)}">⬇ Download</button>
      </div>
    `).join('');
    list.querySelectorAll('.weekly-file-dl').forEach(btn => {
      btn.addEventListener('click', () => downloadMonthlyFile(btn.dataset.id));
    });
  } catch (err) {
    list.innerHTML = `<div class="empty-msg">Error: ${escHtml(err.message)}</div>`;
  }
}

async function downloadMonthlyFile(monthId) {
  try {
    const res = await fetch(`${API}/api/memory/months/${monthId}/download`, {
      headers: { 'Authorization': `Bearer ${idToken}` },
    });
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Bob-Memory-${monthId}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (err) {
    alert('Failed to download: ' + err.message);
  }
}

document.getElementById('memory-refresh-btn').addEventListener('click', async () => {
  const btn = document.getElementById('memory-refresh-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Summarizing…';
  try {
    await apiFetch('/api/memory/refresh', { method: 'POST' });
    await loadFacts();
    await loadMonthlyFiles();
    btn.textContent = '✅ Done!';
    setTimeout(() => { btn.textContent = '🔄 Summarize my memory now'; btn.disabled = false; }, 2000);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = '🔄 Summarize my memory now';
    alert('Failed: ' + err.message);
  }
});

// Facts
async function loadFacts() {
  const list = document.getElementById('facts-list');
  try {
    const { facts } = await apiFetch('/api/memory/facts');
    if (!facts.length) { list.innerHTML = '<div class="empty-msg">No facts saved yet.</div>'; return; }
    list.innerHTML = facts.map(f => `
      <div class="fact-item">
        <span>${escHtml(f.text)}</span>
        <button class="fact-delete" data-id="${f.id}" title="Delete">✕</button>
      </div>
    `).join('');
    list.querySelectorAll('.fact-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteFact(btn.dataset.id));
    });
  } catch (err) {
    list.innerHTML = `<div class="empty-msg">Error: ${err.message}</div>`;
  }
}

document.getElementById('add-fact-btn').addEventListener('click', async () => {
  const input = document.getElementById('fact-input');
  const text  = input.value.trim();
  if (!text) return;
  try {
    await apiFetch('/api/memory/facts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    input.value = '';
    await loadFacts();
  } catch (err) {
    alert('Failed to add fact: ' + err.message);
  }
});

document.getElementById('fact-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('add-fact-btn').click();
});

async function deleteFact(id) {
  try {
    await apiFetch(`/api/memory/facts/${id}`, { method: 'DELETE' });
    await loadFacts();
  } catch (err) {
    alert('Failed to delete fact: ' + err.message);
  }
}

// Files
async function loadFiles() {
  const list = document.getElementById('files-list');
  try {
    const { files } = await apiFetch('/api/files');
    if (!files || !files.length) { list.innerHTML = '<div class="empty-msg">No files uploaded yet.</div>'; return; }
    list.innerHTML = files.map(f => `
      <div class="file-item">
        <a href="${f.url}" target="_blank" rel="noopener">${escHtml(f.originalName || f.publicId)}</a>
        <div class="file-meta">${f.resourceType} · ${formatBytes(f.sizeBytes)} · ${new Date(f.createdAt).toLocaleDateString()}</div>
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = `<div class="empty-msg">Error: ${err.message}</div>`;
  }
}

// ═══════════════════════════════════════════════════════
// SIDEBAR TOGGLE
// ═══════════════════════════════════════════════════════

const sidebar = document.getElementById('sidebar');
document.getElementById('sidebar-toggle').addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
});

// ═══════════════════════════════════════════════════════
// SECRET VAULT
// ═══════════════════════════════════════════════════════

const vaultPinScr  = document.getElementById('vault-pin-screen');
const vaultConScr  = document.getElementById('vault-content-screen');
const vaultDots    = document.querySelectorAll('#vault-pin-dots span');
const vaultErrEl   = document.getElementById('vault-pin-error');

let vaultPin        = '';
let vaultUnlocked   = false;

// ── Open / close vault workspace ─────────────────────
function openVaultPanel() {
  showView('vault');
  if (!vaultUnlocked) lockVault();
}
function closeVaultPanel() {
  closeViews();
  lockVault();
}

document.getElementById('close-vault').addEventListener('click', closeVaultPanel);
document.getElementById('close-vault-unlocked').addEventListener('click', closeVaultPanel);
document.getElementById('relock-vault-btn').addEventListener('click', lockVault);

function lockVault() {
  vaultPin = '';
  vaultUnlocked = false;
  vaultConScr.classList.add('hidden');
  vaultPinScr.classList.remove('hidden');
  resetPinDots();
  vaultErrEl.classList.add('hidden');
}

// ── PIN dots visual state ───────────────────────────
function resetPinDots() {
  vaultDots.forEach(d => { d.className = ''; });
}
function updatePinDots() {
  vaultDots.forEach((d, i) => {
    d.className = i < vaultPin.length ? 'filled' : '';
  });
}
function shakeErrorDots() {
  vaultDots.forEach(d => { d.className = 'error'; });
  setTimeout(resetPinDots, 600);
}

// ── Numpad clicks ────────────────────────────────────
document.querySelectorAll('.numpad-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const digit = btn.dataset.digit;

    if (digit === 'clear') {
      vaultPin = vaultPin.slice(0, -1);
      updatePinDots();
      vaultErrEl.classList.add('hidden');
      return;
    }

    if (digit === 'enter') {
      submitVaultPin();
      return;
    }

    if (vaultPin.length < 4) {
      vaultPin += digit;
      updatePinDots();
      // Auto-submit when 4 digits entered
      if (vaultPin.length === 4) {
        setTimeout(submitVaultPin, 150);
      }
    }
  });
});

// ── Submit PIN to backend ────────────────────────────
async function submitVaultPin() {
  if (vaultPin.length < 4) {
    vaultErrEl.textContent = 'Please enter a 4-digit PIN.';
    vaultErrEl.classList.remove('hidden');
    return;
  }

  try {
    await apiFetch('/api/secret/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: vaultPin }),
    });

    // Correct PIN
    vaultUnlocked = true;
    vaultPinScr.classList.add('hidden');
    vaultConScr.classList.remove('hidden');
    vaultErrEl.classList.add('hidden');
    await loadVaultChat();
  } catch (err) {
    // Wrong PIN
    shakeErrorDots();
    vaultErrEl.textContent = 'Incorrect PIN (Default: 2005). Try again.';
    vaultErrEl.classList.remove('hidden');
    vaultPin = '';
    setTimeout(() => {
      resetPinDots();
    }, 650);
  }
}

// ── Load & Manage Vault Private Chat ───────────────────
async function loadVaultChat() {
  const container = document.getElementById('vault-chat-messages');
  try {
    const { messages } = await apiFetch('/api/secret/chat', {
      headers: { 'X-Vault-Pin': vaultPin },
    });
    if (!messages || !messages.length) {
      container.innerHTML = '<div class="empty-msg">🤫 Private Secret Vault Chat active. Messages here are confidential and isolated from normal chats.</div>';
      return;
    }
    container.innerHTML = messages.map(m => `
      <div class="vault-msg-bubble ${m.role}">
        <div class="vault-msg-role">${m.role === 'user' ? 'Nikhil' : 'Bob (Private)'}</div>
        <div class="vault-msg-text">${escHtml(m.content)}</div>
      </div>
    `).join('');
    container.scrollTop = container.scrollHeight;
  } catch (err) {
    container.innerHTML = `<div class="empty-msg">Error loading secret chat: ${err.message}</div>`;
  }
}

document.getElementById('vault-send-btn').addEventListener('click', sendVaultMessage);
attachAutoResizeTextarea('vault-chat-input', sendVaultMessage);

async function sendVaultMessage() {
  const input = document.getElementById('vault-chat-input');
  const text = input.value.trim();
  if (!text) return;

  const container = document.getElementById('vault-chat-messages');
  input.value = '';
  input.style.height = 'auto';

  // Append user bubble immediately
  const userDiv = document.createElement('div');
  userDiv.className = 'vault-msg-bubble user';
  userDiv.innerHTML = `<div class="vault-msg-role">Nikhil</div><div class="vault-msg-text">${escHtml(text)}</div>`;
  container.appendChild(userDiv);
  container.scrollTop = container.scrollHeight;

  try {
    const data = await apiFetch('/api/secret/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Vault-Pin': vaultPin },
      body: JSON.stringify({ message: text }),
    });

    const botDiv = document.createElement('div');
    botDiv.className = 'vault-msg-bubble assistant';
    botDiv.innerHTML = `<div class="vault-msg-role">Bob (Private)</div><div class="vault-msg-text">${escHtml(data.reply)}</div>`;
    container.appendChild(botDiv);
    container.scrollTop = container.scrollHeight;
  } catch (err) {
    alert('Failed to send secret message: ' + err.message);
  }
}

document.getElementById('wipe-vault-chat-btn').addEventListener('click', async () => {
  if (!confirm('Are you sure you want to wipe all private secret chat history?')) return;
  try {
    await apiFetch('/api/secret/chat', { method: 'DELETE', headers: { 'X-Vault-Pin': vaultPin } });
    await loadVaultChat();
  } catch (err) {
    alert('Failed to wipe secret chat: ' + err.message);
  }
});

// ═══════════════════════════════════════════════════════
// HQ DASHBOARD
// ═══════════════════════════════════════════════════════

function fmtDate(ms) { return ms ? new Date(ms).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }

function hqCard(o) {
  const items = (o.items || []).map(i => `
    <div class="hq-item"><span class="status-dot ${i.dot || 'grey'}"></span><div class="hq-item-text"><span class="hq-item-title">${escHtml(i.text)}</span><span class="hq-item-sub">${escHtml(i.sub || '')}</span></div></div>
  `).join('');
  return `
    <div class="card ${o.color ? 'card-' + o.color : ''}" data-open="${escHtml(o.id)}">
      <div class="card-top">
        <div class="card-icon">${o.icon}</div>
        <span class="card-badge">${escHtml(o.badge || '')}</span>
      </div>
    <div class="card-title">${escHtml(o.title)}</div>
      <div class="card-meta">${escHtml(o.meta || '')}</div>
      ${items ? `<div class="card-items">${items}</div>` : ''}
    </div>
  `;
} 

async function loadHQSummary() {
  const grid = document.getElementById('hq-grid');
  grid.innerHTML = '<div class="empty-msg">Loading HQ…</div>';
  try {
    const data = await apiFetch('/api/hq/summary');
    renderHQ(data);
  } catch (err) {
    grid.innerHTML = `<div class="empty-msg">Error: ${escHtml(err.message)}</div>`;
  }
}

function renderHQ(data) {
  const c = data.cards || {};
  const grid = document.getElementById('hq-grid');
  const notifs = c.notifications || {};
  const hacks = c.hackathons || {};
  const stalks = c.stalking || {};
  const routs = c.routines || {};
  const facts = c.facts || [];
  const files = c.files || [];
  const months = c.months || [];

  const cards = [
    hqCard({ id: 'notifications', icon: '🔔', title: 'Notifications', color: (notifs.unread || 0) > 0 ? 'green' : 'grey', badge: `${notifs.unread || 0} unread`, meta: `total ${notifs.count || 0}`, items: (notifs.items || []).slice(0, 3).map(n => ({ text: n.title, sub: new Date(n.createdAt).toLocaleString(), dot: n.read ? 'grey' : 'green' })), action: 'Open Notification Center' }),
    hqCard({ id: 'hackathons', icon: '🏆', title: 'Hackathons', color: (hacks.active || 0) > 0 ? 'green' : 'amber', badge: `${hacks.count || 0}`, meta: `active ${hacks.active || 0} · tracking ${hacks.tracking || 0} · 🟢 ${hacks.participating || 0}`, items: (hacks.items || []).slice(0, 3).map(h => ({ text: h.title, sub: `${h.status} · ${fmtDate(h.endDate)}`, dot: h.statusColor })), action: 'Open Hackathon Workspace' }),
    hqCard({ id: 'stalking', icon: '🕵️', title: 'Stalking', color: (stalks.researching || 0) > 0 ? 'amber' : 'green', badge: `${stalks.count || 0}`, meta: `ready ${stalks.ready || 0} · researching ${stalks.researching || 0}`, items: (stalks.items || []).slice(0, 3).map(s => ({ text: s.name, sub: s.status, dot: s.status === 'ready' ? 'green' : (s.status === 'researching' ? 'amber' : 'grey') })), action: 'Open Stalking Workspace' }),
    hqCard({ id: 'routines', icon: '⏰', title: 'Routines', color: (routs.dueSoon || 0) > 0 ? 'green' : 'amber', badge: `${routs.active || 0} active`, meta: `total ${routs.count || 0} · due soon ${routs.dueSoon || 0}`, items: (routs.items || []).slice(0, 3).map(r => ({ text: r.title, sub: `${r.workspace || ''} · every ${r.intervalHours}h`, dot: r.active ? 'green' : 'grey' })), action: 'Open Routines Engine' }),
    hqCard({ id: 'vault', icon: '🔒', title: 'Secret Vault', color: 'amber', badge: 'private', meta: 'PIN protected · spacious workspace', items: [], action: 'Open Secret Vault' }),
    hqCard({ id: 'memory', icon: '🧠', title: 'Memory', color: 'green', badge: `${facts.length} facts`, meta: `months ${months.length}`, items: facts.slice(0, 3).map(f => ({ text: f.text, sub: '', dot: 'green' })), action: 'Open Memory Workspace' }),
    hqCard({ id: 'files', icon: '📁', title: 'Files', color: 'grey', badge: `${files.length}`, meta: 'uploaded files', items: files.slice(0, 3).map(f => ({ text: f.filename || f.id, sub: '', dot: 'grey' })), action: 'Open Files Workspace' }),
    hqCard({ id: 'live', icon: '📈', title: 'Live Pulse', color: 'green', badge: 'live', meta: 'weather · news · stocks', items: [], action: 'Open Live' }),
    hqCard({ id: 'builder', icon: '🏗️', title: 'Bob the Builder', color: 'amber', badge: collabMode ? 'ON' : 'off', meta: 'Builder collaboration · plan-confirm first', items: [], action: 'Start new project' }),
    hqCard({ id: 'selfedit', icon: '🧬', title: 'Self-Edit Engine', color: (c.selfEdits && c.selfEdits.pending) > 0 ? 'green' : 'grey', badge: `${(c.selfEdits && c.selfEdits.pending) || 0} pending`, meta: `applied ${(c.selfEdits && c.selfEdits.applied) || 0} · total ${(c.selfEdits && c.selfEdits.count) || 0}`, items: (c.selfEdits && c.selfEdits.items || []).slice(0, 3).map(e => ({ text: e.title, sub: `${e.file} · ${e.status}`, dot: e.status === 'applied' ? 'green' : (e.status === 'pending' ? 'amber' : 'grey') })), action: 'Open Self-Edit Engine' }),
  ];

  grid.innerHTML = `<div class="hq-grid-inner">${cards.join('')}</div>`;

  grid.querySelectorAll('[data-open]').forEach(card => {
    card.addEventListener('click', () => openHqCard(card.dataset.open));
  });
}

function openHqCard(id) {
  if (id === 'notifications') { showView('notifications'); loadNotificationsFull(); loadNotifications(); return; }
  if (id === 'vault') { openVaultPanel(); return; }
  if (id === 'memory') { showView('memory'); loadFacts(); loadMonthlyFiles(); return; }
  if (id === 'files') { showView('files'); loadFiles(); return; }
  if (id === 'builder') { startBobBuilderCollab(); return; }
  if (id === 'selfedit') { showView('selfedit'); loadSelfEdits(); return; }
  if (id === 'hackathons') { showView('hackathons'); loadHackathons(); return; }
  if (id === 'stalking') { showView('stalking'); loadStalking(); return; }
  if (id === 'routines') { showView('routines'); loadRoutines(); return; }
  if (id === 'live') { showView('live'); loadLive(); return; }
  if (id === 'hq') { showView('hq'); loadHQSummary(); return; }
}

// ═══════════════════════════════════════════════════════
// NOTIFICATION CENTER (pop-out page)
// ═══════════════════════════════════════════════════════

async function loadNotificationsFull() {
  const list = document.getElementById('notifications-full');
  try {
    const { notifications } = await apiFetch('/api/notifications');
    if (!notifications.length) { list.innerHTML = '<div class="empty-msg">No notifications yet.</div>'; return; }
    list.innerHTML = notifications.map(n => `
      <div class="notif-card ${!n.read ? 'unread' : ''}" data-id="${n.id}">
        <div class="notif-card-head">
          <span class="notif-card-title">${escHtml(n.title)}</span>
          <span class="notif-card-time">${new Date(n.createdAt).toLocaleString()}</span>
        </div>
        <div class="notif-card-msg">${escHtml(n.message)}</div>
        <div class="notif-actions">
          <button class="btn-notif-reply" data-id="${n.id}" data-snippet="${escHtml(n.promptSnippet || n.message)}">💬 Reply in Chat</button>
          <button class="btn-notif-del" data-id="${n.id}">✕ Delete</button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.btn-notif-reply').forEach(btn => btn.addEventListener('click', async () => {
      const notifId = btn.dataset.id;
      const snippet = btn.dataset.snippet;
      await apiFetch(`/api/notifications/${notifId}`, { method: 'DELETE' });
      closeViews();
      await createNewSession();
      const mi = document.getElementById('message-input');
      mi.value = snippet;
      mi.dispatchEvent(new Event('input'));
      await sendMessage();
      await loadNotifications();
      await loadSessions();
      await loadNotificationsFull();
    }));

    list.querySelectorAll('.btn-notif-del').forEach(btn => btn.addEventListener('click', async () => {
      await apiFetch(`/api/notifications/${btn.dataset.id}`, { method: 'DELETE' });
      await loadNotifications();
      await loadNotificationsFull();
    }));
  } catch (err) {
    list.innerHTML = `<div class="empty-msg">Error: ${escHtml(err.message)}</div>`;
  }
}

// ═══════════════════════════════════════════════════════
// HACKATHON WORKSPACE (3-col)
// ═══════════════════════════════════════════════════════

let hackathonsCache = [];
let currentHack = null;

async function loadHackathons() {
  try {
    const { hackathons } = await apiFetch('/api/hackathons');
    hackathonsCache = hackathons || [];
    renderHackList();
    if (hackathonsCache.length) {
      if (!currentHack) {
        selectHack(hackathonsCache[0].id);
      } else {
        const fresh = hackathonsCache.find(h => String(h.id) === String(currentHack.id));
        if (fresh) {
          selectHack(fresh.id);
        } else {
          selectHack(hackathonsCache[0].id);
        }
      }
    }
  } catch (err) {
    console.error('loadHackathons error:', err);
  }
}

function getCountdownBadge(h) {
  const now = Date.now();
  if (h.status === 'ended' || (h.endDate && h.endDate < now)) {
    if (!h.endDate) return `<span class="hack-countdown ended">🏁 Ended</span>`;
    const daysAgo = Math.floor((now - h.endDate) / (1000 * 60 * 60 * 24));
    return `<span class="hack-countdown ended">🏁 Ended ${daysAgo > 0 ? daysAgo + 'd ago' : 'today'}</span>`;
  }

  // Live hackathon
  if (h.status === 'live' || (h.startDate && h.startDate <= now && h.endDate && h.endDate >= now)) {
    const msLeft = h.endDate - now;
    const days = Math.floor(msLeft / (1000 * 60 * 60 * 24));
    const hrs = Math.floor((msLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    return `<span class="hack-countdown live">🟢 Live! Ends in ${days > 0 ? days + 'd ' : ''}${hrs}h</span>`;
  }

  // Upcoming hackathon
  if (h.startDate && h.startDate > now) {
    const msToStart = h.startDate - now;
    const days = Math.floor(msToStart / (1000 * 60 * 60 * 24));
    const hrs = Math.floor((msToStart % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    return `<span class="hack-countdown upcoming">⏳ Starts in ${days > 0 ? days + 'd ' : ''}${hrs}h</span>`;
  }

  if (h.endDate) {
    const msLeft = h.endDate - now;
    const days = Math.floor(msLeft / (1000 * 60 * 60 * 24));
    return `<span class="hack-countdown active">🗓 ${days}d left</span>`;
  }

  return `<span class="hack-countdown active">🟢 Active</span>`;
}

function renderHackList() {
  const list = document.getElementById('hack-list');
  if (!hackathonsCache.length) {
    list.innerHTML = `
      <div class="empty-msg">
        <p>🏆 No hackathons yet.</p>
        <p style="font-size:12px; opacity:0.8; margin-top:4px;">Main Bob chat me hackathon details paste karo ya "＋ Add Hackathon" button use karo!</p>
      </div>`;
    return;
  }

  // Smart sort: Live/Active Participating -> Upcoming -> Ended (bottom)
  const sorted = [...hackathonsCache].sort((a, b) => {
    const score = (item) => {
      const isEnded = item.status === 'ended' || (item.endDate && item.endDate < Date.now());
      if (isEnded) return 1000;
      if (item.status === 'live' && item.participating) return 1;
      if (item.participating) return 2;
      if (item.status === 'live') return 3;
      return 10;
    };
    const diff = score(a) - score(b);
    if (diff !== 0) return diff;
    return (a.endDate || 0) - (b.endDate || 0);
  });

  const activeHacks = sorted.filter(h => h.status !== 'ended' && (!h.endDate || h.endDate >= Date.now()));
  const endedHacks = sorted.filter(h => h.status === 'ended' || (h.endDate && h.endDate < Date.now()));

  const renderItem = (h) => {
    const sel = currentHack?.id === h.id ? ' selected' : '';
    const countdown = getCountdownBadge(h);
    const isEnded = h.status === 'ended' || (h.endDate && h.endDate < Date.now());
    return `
      <div class="ws-item${sel}${isEnded ? ' item-ended' : ''}" data-id="${h.id}">
        <div class="ws-item-row">
          <span class="status-dot ${h.statusColor || 'grey'}"></span>
          <span class="ws-item-title">${escHtml(h.title)}</span>
        </div>
        <div class="ws-item-meta-row">
          ${countdown}
          <span class="ws-item-sub">${escHtml(h.source || 'manual')}${h.prize ? ' · 💰 ' + escHtml(h.prize) : ''}</span>
        </div>
        <div class="ws-item-actions">
          <label class="ws-toggle" title="Participating → Bob AI Chat Context">
            <input type="checkbox" ${h.participating ? 'checked' : ''} data-act="participating" /> <span>🟢 Participate</span>
          </label>
          <label class="ws-toggle" title="Auto-track routine">
            <input type="checkbox" ${h.tracking ? 'checked' : ''} data-act="tracking" /> <span>🔁 Track</span>
          </label>
          <button class="ws-del" data-id="${h.id}" title="Delete">🗑</button>
        </div>
      </div>`;
  };

  let html = activeHacks.map(renderItem).join('');

  if (endedHacks.length) {
    html += `
      <div class="ws-section-divider">
        <span>🏁 Attempted / Past Hackathons (${endedHacks.length})</span>
      </div>
      ${endedHacks.map(renderItem).join('')}
    `;
  }

  list.innerHTML = html;

  list.querySelectorAll('.ws-item').forEach(el => el.addEventListener('click', (e) => {
    if (e.target.closest('button') || e.target.closest('input')) return;
    selectHack(el.dataset.id);
  }));

  list.querySelectorAll('.ws-toggle input').forEach(inp => inp.addEventListener('change', async () => {
    const item = inp.closest('.ws-item');
    const body = {}; body[inp.dataset.act] = inp.checked;
    try {
      await apiFetch(`/api/hackathons/${item.dataset.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      await loadHackathons();
    } catch (err) { alert(err.message); await loadHackathons(); }
  }));

  list.querySelectorAll('.ws-del').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Delete this hackathon?')) return;
    await apiFetch(`/api/hackathons/${btn.dataset.id}`, { method: 'DELETE' });
    if (currentHack?.id === btn.dataset.id) { currentHack = null; resetHackChat(); }
    await loadHackathons();
  }));
}

async function selectHack(id) {
  currentHack = hackathonsCache.find(h => String(h.id) === String(id)) || null;
  renderHackList();
  if (!currentHack) return;
  document.getElementById('hack-chat-header').innerHTML = `<span>${escHtml(currentHack.title)}</span><span class="ws-chat-header-status ${currentHack.statusColor || 'grey'}">${currentHack.status}</span>`;
  document.getElementById('hack-chat-input').disabled = false;
  document.getElementById('hack-chat-input').placeholder = `${escHtml(currentHack.title)} ke baare me kuch pucho…`;
  document.getElementById('hack-send-btn').disabled = false;
  const hint = document.getElementById('hack-chat-hint');
  if (hint) hint.classList.add('hidden');
  renderHackKnowledge(currentHack);
  await loadHackChat(id);
  document.getElementById('hack-chat-input').focus();
}

function resetHackChat() {
  document.getElementById('hack-chat-header').innerHTML = '<span>Select a hackathon or describe a new one below</span>';
  document.getElementById('hack-chat-messages').innerHTML = '<div class="empty-msg">💬 Koi hackathon describe karo — Bob list me add kar dega. Ya left me se select karo.</div>';
  document.getElementById('hack-chat-input').disabled = false;
  document.getElementById('hack-chat-input').placeholder = 'Hackathon describe karo ya left me se select karo…';
  document.getElementById('hack-send-btn').disabled = false;
  const hint = document.getElementById('hack-chat-hint');
  if (hint) hint.classList.remove('hidden');
  document.getElementById('hack-knowledge').innerHTML = '<div class="empty-msg">Right side me hackathon ka knowledge panel khulega.</div>';
}

// 📋 Paste complete hackathon info / announcement button handler
document.getElementById('paste-hack-btn')?.addEventListener('click', () => {
  openModal('📋 Paste Hackathon Announcement / Info', `
    <div class="modal-form">
      <p style="font-size:12px; color:var(--text2); margin:0;">WhatsApp, LinkedIn ya website se poora hackathon text paste karo — Bob khud dates, prizes, rules parse kar lega!</p>
      <textarea id="paste-hack-text" rows="8" placeholder="Example:\n🚀 ViCodathon 2026 – India's AI-First Vibe Coding Hackathon\n🏆 Prize Pool up to ₹20,000\n📅 Deadline: 6 August 2026\n🔗 Register Now: https://www.abtalks.in/..."></textarea>
      <button id="paste-hack-submit" class="btn-primary" style="width:100%;">⚡ Auto-Parse & Add Hackathon</button>
    </div>
  `);

  document.getElementById('paste-hack-submit').addEventListener('click', async () => {
    const rawText = document.getElementById('paste-hack-text').value.trim();
    if (!rawText) { alert('Please paste hackathon details text first.'); return; }
    const submitBtn = document.getElementById('paste-hack-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Parsing with AI…';
    try {
      const { parsed } = await apiFetch('/api/hackathons/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText })
      });
      await apiFetch('/api/hackathons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...parsed,
          participating: true,
          tracking: true
        })
      });
      closeModal();
      await loadHackathons();
    } catch (err) {
      alert('Parse failed: ' + err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = '⚡ Auto-Parse & Add Hackathon';
    }
  });
});

function renderHackKnowledge(h) {
  const el = document.getElementById('hack-knowledge');
  const k = h.knowledge || {};
  el.innerHTML = `
    <div class="ws-kb-block"><div class="ws-kb-label">📝 Problem Statement</div><div>${escHtml(k.summary || h.description || '—')}</div></div>
    <div class="ws-kb-block"><div class="ws-kb-label">🗓 Dates</div><div>${escHtml((k.dates || []).join(' · ') || (fmtDate(h.startDate) + ' → ' + fmtDate(h.endDate)))}</div></div>
    <div class="ws-kb-block"><div class="ws-kb-label">💰 Prize</div><div>${escHtml((k.prizes || []).join(' · ') || h.prize || '—')}</div></div>
    <div class="ws-kb-block"><div class="ws-kb-label">🏛 Mode</div><div>${escHtml(k.mode || h.mode || 'unknown')}</div></div>
    ${(k.rules || []).length ? `<div class="ws-kb-block"><div class="ws-kb-label">📜 Rules</div><div>${k.rules.map(r => escHtml(r)).join('<br/>')}</div></div>` : ''}
    ${(k.eligibility || []).length ? `<div class="ws-kb-block"><div class="ws-kb-label">🎓 Eligibility</div><div>${k.eligibility.map(r => escHtml(r)).join('<br/>')}</div></div>` : ''}
    ${(k.winners || []).length ? `<div class="ws-kb-block"><div class="ws-kb-label">🏅 Past Winners</div><div>${k.winners.map(r => escHtml(r)).join('<br/>')}</div></div>` : ''}
    ${(k.links || []).length ? `<div class="ws-kb-block"><div class="ws-kb-label">🔗 Sources</div><div>${k.links.map(l => `<a href="${escHtml(l)}" target="_blank" rel="noopener">${escHtml(l)}</a>`).join('<br/>')}</div></div>` : ''}
    <button class="btn-small" id="re-scrape-hack" style="width:100%;">🔄 Re-scrape Knowledge</button>
  `;
  const rs = document.getElementById('re-scrape-hack');
  if (rs) rs.addEventListener('click', async () => {
    rs.disabled = true; rs.textContent = '⏳ Scraping…';
    // Client-side safety timeout — unlock button after 30s regardless
    const safetyTimer = setTimeout(() => {
      if (rs && rs.textContent === '⏳ Scraping…') {
        rs.disabled = false;
        rs.textContent = '🔄 Re-scrape Knowledge';
      }
    }, 30000);
    try {
      await apiFetch(`/api/hackathons/${h.id}/scrape`, { method: 'POST' });
      clearTimeout(safetyTimer);
      rs.textContent = '✅ Done!';
      await loadHackathons();
      // loadHackathons re-renders the section so 'rs' is detached — that's fine
    } catch (err) {
      clearTimeout(safetyTimer);
      alert('Scrape failed: ' + err.message);
      rs.disabled = false;
      rs.textContent = '🔄 Re-scrape Knowledge';
    }
  });
}

async function loadHackChat(id) {
  const el = document.getElementById('hack-chat-messages');
  try {
    const { messages } = await apiFetch(`/api/hackathons/${id}/chat`);
    renderWsChat(el, messages, 'hack');
  } catch (err) { el.innerHTML = `<div class="empty-msg">${escHtml(err.message)}</div>`; }
}

document.getElementById('hack-send-btn').addEventListener('click', sendHackMessage);
attachAutoResizeTextarea('hack-chat-input', sendHackMessage);

async function sendHackMessage() {
  const input = document.getElementById('hack-chat-input');
  const text = input.value.trim(); if (!text) return;
  input.value = ''; input.style.height = 'auto'; input.disabled = true;
  const el = document.getElementById('hack-chat-messages');
  appendWsMsg(el, 'user', 'Nikhil', text);

  if (!currentHack) {
    // No hackathon selected → parse text with AI, then create in DB, then select
    const loadingMsg = document.createElement('div');
    loadingMsg.className = 'ws-msg assistant';
    loadingMsg.innerHTML = '<div class="ws-msg-role">Bob 🏆</div><div class="ws-msg-text">⏳ Hackathon details parse kar raha hu…</div>';
    el.appendChild(loadingMsg); el.scrollTop = el.scrollHeight;
    try {
      // Step 1: AI extracts structured fields from raw text
      const { parsed } = await apiFetch('/api/hackathons/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rawText: text }) });

      // Step 2: Save to DB (parse only extracts, doesn't save)
      const { hackathon } = await apiFetch('/api/hackathons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: parsed.title || 'Untitled Hackathon',
          link: parsed.link || '',
          startDate: parsed.startDate || null,
          endDate: parsed.endDate || null,
          prize: parsed.prize || '',
          mode: parsed.mode || 'online',
          description: parsed.description || text.slice(0, 300),
          rules: parsed.rules || [],
          tracking: true
        })
      });

      el.removeChild(loadingMsg);
      await loadHackathons();
      await selectHack(String(hackathon.id));
      appendWsMsg(el, 'assistant', 'Bob 🏆', `✅ "${hackathon.title}" list me add ho gaya! Ab tum directly iske baare me chat kar sakte ho. Left me dikhe ga.\n\n📅 Dates: ${hackathon.startDate ? new Date(hackathon.startDate).toLocaleDateString() : '?'} → ${hackathon.endDate ? new Date(hackathon.endDate).toLocaleDateString() : '?'}\n💰 Prize: ${hackathon.prize || '—'}`);
    } catch (err) {
      try { el.removeChild(loadingMsg); } catch(_) {}
      appendWsMsg(el, 'assistant', 'Bob 🏆', '⚠️ ' + err.message);
    }
    input.disabled = false; input.focus();
    return;
  }

  // Hackathon selected → normal workspace chat
  const loadingMsg = document.createElement('div');
  loadingMsg.className = 'ws-msg assistant';
  loadingMsg.innerHTML = '<div class="ws-msg-role">Bob 🏆</div><div class="ws-msg-text">⏳ Thinking…</div>';
  el.appendChild(loadingMsg); el.scrollTop = el.scrollHeight;

  try {
    const data = await apiFetch(`/api/hackathons/${currentHack.id}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }) });
    try { el.removeChild(loadingMsg); } catch(_) {}
    appendWsMsg(el, 'assistant', 'Bob 🏆', data.reply);

    // ── Knowledge auto-updated from pasted announcement ──────────────
    if (data.knowledgeUpdated) {
      // Show a flash badge on the last assistant message
      const lastMsg = el.querySelector('.ws-msg.assistant:last-child .ws-msg-text');
      if (lastMsg) {
        const badge = document.createElement('div');
        badge.style.cssText = 'margin-top:8px;padding:4px 10px;background:rgba(74,222,128,0.15);border:1px solid rgba(74,222,128,0.4);border-radius:6px;font-size:11px;color:#4ade80;display:inline-block;';
        badge.textContent = '📚 Knowledge panel updated from your paste!';
        lastMsg.appendChild(badge);
      }
      // Refresh knowledge panel without full list reload
      try {
        const { hackathon } = await apiFetch(`/api/hackathons/${currentHack.id}`);
        // Update the cache entry
        const idx = hackathonsCache.findIndex(h => String(h.id) === String(currentHack.id));
        if (idx !== -1) hackathonsCache[idx] = hackathon;
        currentHack = hackathon;
        renderHackKnowledge(hackathon);
      } catch(_) {}
    }
  } catch (err) {
    try { el.removeChild(loadingMsg); } catch(_) {}
    appendWsMsg(el, 'assistant', 'Bob 🏆', '⚠️ ' + err.message);
  }
  input.disabled = false; input.focus();
}

function openAddHackathonModal() {
  openModal('➕ Add Hackathon', `
    <div class="modal-form">
      <label>Title *<input id="mk-title" type="text" placeholder="Smart India Hackathon 2026" /></label>
      <label>Link<input id="mk-link" type="url" placeholder="https://unstop.com/..." /></label>
      <div class="modal-row">
        <label>Start Date<input id="mk-start" type="date" /></label>
        <label>End Date<input id="mk-end" type="date" /></label>
      </div>
      <div class="modal-row">
        <label class="modal-check"><input id="mk-participating" type="checkbox" /> 🟢 Participating</label>
        <label class="modal-check"><input id="mk-tracking" type="checkbox" checked /> 🔁 Auto-track (3-day routine)</label>
      </div>
      <button id="mk-save" class="btn-primary" style="width:100%;">Save Hackathon</button>
    </div>`);
  document.getElementById('mk-save').addEventListener('click', async () => {
    const title = document.getElementById('mk-title').value.trim();
    if (!title) { alert('Title required'); return; }
    const body = {
      title,
      link: document.getElementById('mk-link').value.trim(),
      startDate: document.getElementById('mk-start').value ? new Date(document.getElementById('mk-start').value).getTime() : null,
      endDate: document.getElementById('mk-end').value ? new Date(document.getElementById('mk-end').value).getTime() : null,
      participating: document.getElementById('mk-participating').checked,
      tracking: document.getElementById('mk-tracking').checked,
    };
    try {
      await apiFetch('/api/hackathons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      closeModal();
      await loadHackathons();
    } catch (err) { alert(err.message); }
  });
}

document.getElementById('add-hack-btn')?.addEventListener('click', openAddHackathonModal);
document.getElementById('add-hack-btn-sidebar')?.addEventListener('click', openAddHackathonModal);

// ═══════════════════════════════════════════════════════
// STALKING WORKSPACE
// ═══════════════════════════════════════════════════════

let stalkCache = [];
let currentStalk = null;

async function loadStalking() {
  try {
    const { profiles } = await apiFetch('/api/stalking');
    stalkCache = profiles || [];
    renderStalkList();
  } catch (err) { console.error('loadStalking error:', err); }
}

function renderStalkList() {
  const list = document.getElementById('stalk-list');
  if (!stalkCache.length) { list.innerHTML = '<div class="empty-msg">No profiles yet. Add one to start deep-dive.</div>'; return; }
  list.innerHTML = stalkCache.map(p => `
    <div class="ws-item${currentStalk?.id === p.id ? ' selected' : ''}" data-id="${p.id}">
      <div class="ws-item-row">
        <span class="status-dot ${p.status === 'ready' ? 'green' : (p.status === 'researching' ? 'amber' : 'grey')}"></span>
        <span class="ws-item-title">${escHtml(p.name)}</span>
      </div>
      <div class="ws-item-sub">${escHtml(p.link || '')} · ${p.status}</div>
      <div class="ws-item-actions">
        ${p.status !== 'researching' ? `<button class="ws-re-research" data-id="${p.id}">🔍 Re-Research</button>` : '<span class="ws-researching">⏳ researching…</span>'}
        <button class="ws-del" data-id="${p.id}" title="Delete">🗑</button>
      </div>
    </div>`).join('');

  list.querySelectorAll('.ws-item').forEach(el => el.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    selectStalk(el.dataset.id);
  }));

  list.querySelectorAll('.ws-del').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Delete this profile?')) return;
    await apiFetch(`/api/stalking/${btn.dataset.id}`, { method: 'DELETE' });
    if (currentStalk?.id === btn.dataset.id) { currentStalk = null; resetStalkChat(); }
    await loadStalking();
  }));

  list.querySelectorAll('.ws-re-research').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = '⏳…';
    try {
      await apiFetch(`/api/stalking/${btn.dataset.id}/research`, { method: 'POST' });
      const p = stalkCache.find(x => String(x.id) === String(btn.dataset.id));
      if (p) p.status = 'researching';
      renderStalkList();
      setTimeout(loadStalking, 20000);
    } catch (err) { alert(err.message); }
  }));
}

async function selectStalk(id) {
  const p = stalkCache.find(x => String(x.id) === String(id)) || null;
  currentStalk = p;
  renderStalkList();
  if (!p) return;
  try {
    const { profile } = await apiFetch(`/api/stalking/${id}`);
    const prof = profile || p;
    currentStalk = prof;
    renderProfileCard(prof);
    document.getElementById('stalk-chat-input').disabled = false;
    document.getElementById('stalk-chat-input').placeholder = `${escHtml(prof.name)} ke baare me kuch pucho…`;
    document.getElementById('stalk-send-btn').disabled = false;
    const { messages } = await apiFetch(`/api/stalking/${id}/chat`);
    renderWsChat(document.getElementById('stalk-chat-messages'), messages, 'stalk');
  } catch (err) {
    document.getElementById('stalk-chat-messages').innerHTML = `<div class="empty-msg">${escHtml(err.message)}</div>`;
  }
}

function resetStalkChat() {
  document.getElementById('stalk-profile-card').innerHTML = '<div class="empty-msg">Kisi person ka naam + LinkedIn/GitHub URL do ya left me se select karo.</div>';
  document.getElementById('stalk-chat-messages').innerHTML = '';
  document.getElementById('stalk-chat-input').disabled = false;
  document.getElementById('stalk-chat-input').placeholder = 'Person ka naam aur LinkedIn/GitHub URL do, ya left me se select karo…';
  document.getElementById('stalk-send-btn').disabled = false;
}

function renderProfileCard(p) {
  const d = p.profileData || {};
  const el = document.getElementById('stalk-profile-card');
  el.innerHTML = `
    <div class="profile-card">
      <div class="profile-head">
        <div class="profile-avatar">${escHtml((p.name || '?')[0].toUpperCase())}</div>
        <div>
          <div class="profile-name">${escHtml(p.name)}</div>
          <div class="profile-headline">${escHtml(d.headline || '')}</div>
          <div class="profile-meta">${escHtml(d.location || '')}</div>
        </div>
      </div>
      ${d.bio ? `<div class="profile-sec"><div class="profile-sec-title">Bio</div><div>${escHtml(d.bio)}</div></div>` : ''}
      ${(d.tech || []).length ? `<div class="profile-sec"><div class="profile-sec-title">Tech Stack</div><div class="tech-chips">${d.tech.map(t => `<span class="tech-chip">${escHtml(t)}</span>`).join('')}</div></div>` : ''}
      ${(d.summary || []).length ? `<div class="profile-sec"><div class="profile-sec-title">Deep-Dive Summary</div><div>${d.summary.map(s => `<div class="profile-bullet">• ${escHtml(s)}</div>`).join('')}</div></div>` : ''}
      ${(d.links || []).length ? `<div class="profile-sec"><div class="profile-sec-title">Links</div><div class="profile-links">${d.links.map(l => `<a href="${escHtml(l)}" target="_blank" rel="noopener">${escHtml(l)}</a>`).join(' · ')}</div></div>` : ''}
      ${(d.socials || []).length ? `<div class="profile-sec"><div class="profile-sec-title">Socials</div><div>${d.socials.map(s => escHtml(s)).join(' · ')}</div></div>` : ''}
      ${(d.analyzedRepos || []).length ? `<div class="profile-sec"><div class="profile-sec-title">GitHub Repos</div><div>${d.analyzedRepos.map(r => `<div class="repo-row"><span class="repo-name">${escHtml(r.full_name || '')}</span><span class="repo-status ${escHtml(r.status || '')}">${escHtml(r.status || '')}</span></div>`).join('')}</div></div>` : ''}
      <div class="profile-foot">Last researched: ${d.lastResearchAt ? new Date(d.lastResearchAt).toLocaleString() : 'never'}</div>
    </div>`;
}

document.getElementById('stalk-send-btn').addEventListener('click', sendStalkMessage);
attachAutoResizeTextarea('stalk-chat-input', sendStalkMessage);

async function sendStalkMessage() {
  const input = document.getElementById('stalk-chat-input');
  const text = input.value.trim(); if (!text) return;
  input.value = ''; input.style.height = 'auto'; input.disabled = true;
  const el = document.getElementById('stalk-chat-messages');
  appendWsMsg(el, 'user', 'Nikhil', text);

  if (!currentStalk) {
    // No profile selected → treat as "add new person" via description
    const loadingMsg = document.createElement('div');
    loadingMsg.className = 'ws-msg assistant';
    loadingMsg.innerHTML = '<div class="ws-msg-role">Bob 🕵️</div><div class="ws-msg-text">⏳ Profile create kar raha hu…</div>';
    el.appendChild(loadingMsg); el.scrollTop = el.scrollHeight;
    try {
      // Extract name and link from the text using a simple heuristic
      const urlMatch = text.match(/https?:\/\/[^\s]+/);
      const link = urlMatch ? urlMatch[0] : null;
      // Name: first words before URL or whole text (max 60 chars)
      const name = text.replace(link || '', '').replace(/[\-–:|,]/g, ' ').trim().split('\n')[0].substring(0, 60) || 'Unknown';
      const { profile } = await apiFetch('/api/stalking', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name || text.substring(0,60), link, notes: text }) });
      el.removeChild(loadingMsg);
      await loadStalking();
      await selectStalk(String(profile.id));
      appendWsMsg(el, 'assistant', 'Bob 🕵️', `✅ "${profile.name}" profile list me add ho gaya! Research background me chal raha hai. Ab tum directly iske baare me chat kar sakte ho.`);
    } catch (err) {
      try { el.removeChild(loadingMsg); } catch(_) {}
      appendWsMsg(el, 'assistant', 'Bob 🕵️', '⚠️ ' + err.message + '\n\nTip: Name aur LinkedIn/GitHub URL dena zaroori hai, jaise: "Rahul Sharma - https://linkedin.com/in/rahul"');
    }
    input.disabled = false; input.focus();
    return;
  }

  // Profile selected → normal workspace chat
  try {
    const data = await apiFetch(`/api/stalking/${currentStalk.id}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }) });
    appendWsMsg(el, 'assistant', 'Bob 🕵️', data.reply);
  } catch (err) { appendWsMsg(el, 'assistant', 'Bob', '⚠️ ' + err.message); }
  input.disabled = false; input.focus();
}

document.getElementById('add-stalk-btn').addEventListener('click', () => {
  openModal('🕵️ Add Profile', `
    <div class="modal-form">
      <label>Name *<input id="sk-name" type="text" placeholder="Rahul Sharma" /></label>
      <label>LinkedIn / Site Link<input id="sk-link" type="url" placeholder="https://linkedin.com/in/..." /></label>
      <label>Notes<textarea id="sk-notes" rows="3" placeholder="Kuch bhi pehle se pata ho…"></textarea></label>
      <button id="sk-save" class="btn-primary" style="width:100%;">Start Deep-Dive</button>
    </div>`);
  document.getElementById('sk-save').addEventListener('click', async () => {
    const name = document.getElementById('sk-name').value.trim();
    if (!name) { alert('Name required'); return; }
    try {
      await apiFetch('/api/stalking', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, link: document.getElementById('sk-link').value.trim(), notes: document.getElementById('sk-notes').value.trim() }) });
      closeModal();
      await loadStalking();
    } catch (err) { alert(err.message); }
  });
});

// ═══════════════════════════════════════════════════════
// ROUTINES ENGINE
// ═══════════════════════════════════════════════════════

async function loadRoutines() {
  const grid = document.getElementById('routines-grid');
  try {
    const { routines } = await apiFetch('/api/routines');
    if (!routines.length) { grid.innerHTML = '<div class="empty-msg">No routines yet. Ek routine banao — Bob khud prompt karega aur workspace me output dega.</div>'; return; }
    grid.innerHTML = routines.map(r => `
      <div class="routine-item ${r.active ? '' : 'routine-off'}">
        <div class="routine-head">
          <span class="routine-title">${escHtml(r.title)}</span>
          <span class="routine-ws">${escHtml(r.workspace || 'custom')}</span>
        </div>
        <div class="routine-prompt">${escHtml(r.prompt)}</div>
        <div class="routine-meta">every ${r.intervalHours}h · next ${r.nextRunAt ? new Date(r.nextRunAt).toLocaleString() : '—'}</div>
        <div class="routine-actions">
          <button class="btn-small" data-act="run" data-id="${r.id}">▶ Run Now</button>
          <button class="btn-small" data-act="toggle" data-id="${r.id}">${r.active ? '⏸ Pause' : '▶ Activate'}</button>
          <button class="btn-small" data-act="del" data-id="${r.id}" style="background:rgba(239,68,68,0.15);color:var(--red);">🗑 Delete</button>
        </div>
      </div>`).join('');

    grid.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', async () => {
      const { act, id } = btn.dataset;
      try {
        if (act === 'run') { btn.textContent = '⏳…'; await apiFetch(`/api/routines/${id}/run`, { method: 'POST' }); }
        if (act === 'toggle') { const r = routines.find(x => String(x.id) === String(id)); await apiFetch(`/api/routines/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !r.active }) }); }
        if (act === 'del') { if (!confirm('Delete routine?')) return; await apiFetch(`/api/routines/${id}`, { method: 'DELETE' }); }
        await loadRoutines();
      } catch (err) { alert(err.message); }
    }));
  } catch (err) { grid.innerHTML = `<div class="empty-msg">Error: ${escHtml(err.message)}</div>`; }
}

document.getElementById('add-routine-btn').addEventListener('click', () => {
  openModal('⏰ New Routine', `
    <div class="modal-form">
      <label>Title *<input id="rt-title" type="text" placeholder="Secret Vault Review" /></label>
      <label>Prompt (Bob khud ye krega) *<textarea id="rt-prompt" rows="4" placeholder="Secret vault me kya-changes hain, kya batana hai…"></textarea></label>
      <div class="modal-row">
        <label>Interval (hours)<input id="rt-interval" type="number" value="72" min="1" /></label>
        <label>Workspace
          <select id="rt-ws">
            <option value="vault">🔒 Vault</option>
            <option value="hackathon">🏆 Hackathons</option>
            <option value="stalking">🕵️ Stalking</option>
            <option value="market">📈 Market</option>
            <option value="habit">📝 Habit</option>
            <option value="bob">🧠 Bob</option>
            <option value="custom">✨ Custom</option>
          </select>
        </label>
      </div>
      <button id="rt-save" class="btn-primary" style="width:100%;">Create Routine</button>
    </div>`);
  document.getElementById('rt-save').addEventListener('click', async () => {
    const title = document.getElementById('rt-title').value.trim();
    const prompt = document.getElementById('rt-prompt').value.trim();
    if (!title || !prompt) { alert('Title and prompt required'); return; }
    try {
      await apiFetch('/api/routines', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, prompt, intervalHours: parseInt(document.getElementById('rt-interval').value) || 72, workspace: document.getElementById('rt-ws').value }) });
      closeModal();
      await loadRoutines();
    } catch (err) { alert(err.message); }
  });
});

// ═══════════════════════════════════════════════════════
// LIVE PULSE
// ═══════════════════════════════════════════════════════

async function loadLive() {
  const body = document.getElementById('live-body');
  body.innerHTML = '<div class="empty-msg">Loading live data…</div>';
  try {
    const [weather, news, stocks] = await Promise.allSettled([
      apiFetch('/api/live/weather'),
      apiFetch('/api/live/news?limit=5'),
      apiFetch('/api/live/stocks'),
    ]);
    let html = '';

    if (weather.status === 'fulfilled') {
      const w = weather.value;
      const c = w.current || {};
      const d = w.daily || {};
      const box = (icon, label, value) => `<div class="wx-box"><div class="wx-ico">${icon}</div><div class="wx-val">${escHtml(String(value ?? '—'))}</div><div class="wx-lbl">${escHtml(label)}</div></div>`;
      const cond = c.weather_code != null ? (c.weather_code === 0 ? '☀️ Clear' : (String(c.weather_code).startsWith('1') ? '🌤 Partly' : (String(c.weather_code).startsWith('2') ? '⛈ Thunder' : (String(c.weather_code).startsWith('3') ? '🌧 Rain' : (String(c.weather_code).startsWith('4') ? '❄️ Snow' : '🌫 Mist'))))) : '—';
      html += `
        <div class="live-card"><div class="live-card-title">🌤 Weather · ${escHtml(w.city || '')}</div>
          <div class="live-card-body">
            <div class="live-weather-grid">
              ${box('🌡️', 'Temp', c.temperature_2m != null ? `${c.temperature_2m}°C` : '—')}
              ${box(cond.split(' ')[0], 'Condition', cond.split(' ')[1] || cond)}
              ${box('💧', 'Humidity', c.relative_humidity_2m != null ? `${c.relative_humidity_2m}%` : '—')}
              ${box('🌬️', 'Wind', c.wind_speed_10m != null ? `${c.wind_speed_10m} km/h` : '—')}
            </div>
            ${(d.temperature_2m_max && d.temperature_2m_min) ? `<div class="wx-range">Today: max ${escHtml(String(d.temperature_2m_max[0]))}°C · min ${escHtml(String(d.temperature_2m_min[0]))}°C</div>` : ''}
          </div>
        </div>`;
    }

    if (news.status === 'fulfilled') {
      const headlines = news.value.headlines || [];
      html += `<div class="live-card"><div class="live-card-title">📰 News</div><div class="live-card-body">${headlines.map(n => `<div class="live-news"><a href="${escHtml(n.link || '#')}" target="_blank" rel="noopener">${escHtml(n.title || '')}</a></div>`).join('') || '<div class="empty-msg">No news</div>'}</div></div>`;
    }

    if (stocks.status === 'fulfilled') {
      const quotes = stocks.value.quotes || [];
      html += `<div class="live-card"><div class="live-card-title">📊 Stocks</div><div class="live-card-body">${quotes.map(q => `<div class="live-stock"><span>${escHtml(q.symbol)} — ${escHtml(q.name || '')}</span><span class="${q.changePct >= 0 ? 'pos' : 'neg'}">${q.price} (${q.changePct >= 0 ? '+' : ''}${q.changePct}%)</span></div>`).join('') || '<div class="empty-msg">No quotes</div>'}</div></div>`;
    }

    if (!html) html = '<div class="empty-msg">Live data unavailable right now.</div>';
    body.innerHTML = `<div class="live-grid-inner">${html}</div>`;
  } catch (err) { body.innerHTML = `<div class="empty-msg">Error: ${escHtml(err.message)}</div>`; }
}

// ── Shared workspace chat helpers ─────────────────────
function renderWsChat(el, messages, tag) {
  if (!messages || !messages.length) { el.innerHTML = '<div class="empty-msg">Is workspace me abhi koi baat nahi hui. Pehla message bhejo — context totally isolated hai.</div>'; return; }
  el.innerHTML = messages.map(m => wsMsgHTML(m.role, m.role === 'user' ? 'Nikhil' : (tag === 'hack' ? 'Bob 🏆' : 'Bob 🕵️'), m.content)).join('');
  el.scrollTop = el.scrollHeight;
}
function wsMsgHTML(role, author, text) { return `<div class="ws-msg ${role}"><div class="ws-msg-role">${escHtml(author)}</div><div class="ws-msg-text">${escHtml(text)}</div></div>`; }
function appendWsMsg(el, role, author, text) { el.insertAdjacentHTML('beforeend', wsMsgHTML(role, author, text)); el.scrollTop = el.scrollHeight; }


// ═══════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024)       return bytes + ' B';
  if (bytes < 1048576)    return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// -------------------------------------------------------
// SELF-EDIT ENGINE (view)
// -------------------------------------------------------

async function loadSelfEdits() {
  const list = document.getElementById('selfedit-list');
  try {
    const { edits } = await apiFetch('/api/self-edit');
    if (!edits.length) { list.innerHTML = '<div class="empty-msg">Abhi koi self-edit proposal nahi. "Bob improve yourself" bolo, ya review run karo.</div>'; return; }
    list.innerHTML = edits.map(e => `
      <div class="selfedit-card ${e.status}">
        <div class="selfedit-head">
          <span class="selfedit-title">${escHtml(e.title)}</span>
          <span class="selfedit-status status-${escHtml(e.status)}">${escHtml(e.status)}${e.type === 'manual' ? ' · manual' : ''}</span>
        </div>
        <div class="selfedit-file">📄 ${escHtml(e.file)}</div>
        ${e.reason ? `<div class="selfedit-reason">${escHtml(e.reason)}</div>` : ''}
        ${e.diff ? `<pre class="selfedit-diff">${escHtml(e.diff)}</pre>` : ''}
        ${e.error ? `<div class="selfedit-error">Error: ${escHtml(e.error)}</div>` : ''}
        ${e.gitLog ? `<div class="selfedit-git">${escHtml(e.gitLog)}</div>` : ''}
        <div class="selfedit-actions">
          ${e.status === 'pending' && e.type === 'manual' ? `<button class="btn-small" data-se-approve="${e.id}">✔ Approve</button>` : ''}
          ${e.status === 'pending' || e.status === 'approved' ? `<button class="btn-small" data-se-apply="${e.id}">🚀 Apply</button>` : ''}
          ${e.status === 'pending' ? `<button class="btn-small btn-danger" data-se-reject="${e.id}">✕ Reject</button>` : ''}
          ${e.status === 'failed' ? `<button class="btn-small" data-se-retry="${e.id}">🔁 Retry apply</button>` : ''}
        </div>
      </div>
    `).join('');

    list.querySelectorAll('[data-se-approve]').forEach(b => b.addEventListener('click', async () => {
      await apiFetch(`/api/self-edit/${b.dataset.seApprove}/approve`, { method: 'POST' });
      await loadSelfEdits();
    }));
    list.querySelectorAll('[data-se-apply]').forEach(b => b.addEventListener('click', async () => {
      const btn = b; btn.disabled = true; btn.textContent = '⏳ Applying…';
      try {
        await apiFetch(`/api/self-edit/${b.dataset.seApply}/apply`, { method: 'POST' });
        await loadSelfEdits();
      } catch (err) {
        btn.disabled = false; btn.textContent = '🚀 Apply';
        alert('Apply failed: ' + err.message);
      }
    }));
    list.querySelectorAll('[data-se-reject]').forEach(b => b.addEventListener('click', async () => {
      await apiFetch(`/api/self-edit/${b.dataset.seReject}/reject`, { method: 'POST' });
      await loadSelfEdits();
    }));
    list.querySelectorAll('[data-se-retry]').forEach(b => b.addEventListener('click', async () => {
      await apiFetch(`/api/self-edit/${b.dataset.seRetry}/apply`, { method: 'POST' });
      await loadSelfEdits();
    }));
  } catch (err) {
    list.innerHTML = `<div class="empty-msg">Error: ${escHtml(err.message)}</div>`;
  }
}

document.addEventListener('click', async (e) => {
  if (e.target && e.target.id === 'selfedit-run-btn') {
    e.target.disabled = true; e.target.textContent = '🧪 Running review…';
    try {
      await apiFetch('/api/self-edit/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    } catch (err) { console.error('self-edit run:', err.message); }
    setTimeout(async () => {
      e.target.disabled = false; e.target.textContent = '🧪 Run review now';
      await loadSelfEdits();
    }, 4000);
  }
});
