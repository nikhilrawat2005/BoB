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
    renderNotifications(notifications || []);
  } catch (err) {
    console.error('loadNotifications error:', err);
  }
}

function renderNotifications(notifications) {
  const list = document.getElementById('notifications-list');
  const badge = document.getElementById('notif-count-badge');

  const unreadCount = notifications.filter(n => !n.read).length;
  if (unreadCount > 0) {
    badge.textContent = unreadCount;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  if (!notifications.length) {
    list.innerHTML = '<div class="empty-sessions">No notifications right now</div>';
    return;
  }

  list.innerHTML = notifications.map(n => `
    <div class="notif-item ${!n.read ? 'unread' : ''}" data-id="${n.id}">
      <div class="notif-title">🔔 ${escHtml(n.title)}</div>
      <div class="notif-msg">${escHtml(n.message)}</div>
      <div class="notif-time">${new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      <div class="notif-actions">
        <button class="btn-notif-reply" data-id="${n.id}" data-snippet="${escHtml(n.promptSnippet || n.message)}">💬 Reply in Chat</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.btn-notif-reply').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const notifId = btn.dataset.id;
      const snippet = btn.dataset.snippet;
      // Delete notification so it disappears immediately from notification panel once converted to chat
      await apiFetch(`/api/notifications/${notifId}`, { method: 'DELETE' });
      await createNewSession();
      const msgInput = document.getElementById('message-input');
      msgInput.value = snippet;
      msgInput.dispatchEvent(new Event('input'));
      await sendMessage();
      await loadNotifications();
      await loadSessions();
    });
  });
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
  // ```chart\n{...}\n```, ```mermaid\n<diagram>\n```, or ```builder\n{...}\n```
  const regex = /```(?:([\w.+-]+)[ \t]+filename=([^\n\r]+)|(schedule)|(chart)|(mermaid)|(builder))[\n\r]([\s\S]*?)```/g;
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
        blocks.push({ type: 'builder', data });
      } catch {
        blocks.push({ type: 'text', content: match[0] });
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

async function delegateToBuilder(data, card) {
  try {
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

  const speechText = cleanTextForSpeech(text);
  if (!speechText) return;

  window.speechSynthesis.cancel(); // stop previous speech

  const utterance = new SpeechSynthesisUtterance(speechText);
  currentUtterance = utterance;

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
    utterance.onend = () => { btnElement.innerHTML = '🔊 Listen'; };
    utterance.onerror = () => { btnElement.innerHTML = '🔊 Listen'; };
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

messageInput.addEventListener('input', () => {
  // Auto-grow textarea
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + 'px';
  // Enable send button if there's text OR a pending image/file
  sendBtn.disabled = !messageInput.value.trim() && !pendingFile && !pendingPasteImage;
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
  closeAllPanels();
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

const memoryPanel = document.getElementById('memory-panel');
const filesPanel  = document.getElementById('files-panel');
const backdrop    = document.getElementById('panel-backdrop');

function openPanel(panel) {
  panel.classList.remove('hidden');
  setTimeout(() => panel.classList.add('open'), 10);
  backdrop.classList.remove('hidden');
}
function closeAllPanels() {
  [memoryPanel, filesPanel].forEach(p => { p.classList.remove('open'); setTimeout(() => p.classList.add('hidden'), 300); });
  backdrop.classList.add('hidden');
}

backdrop.addEventListener('click', closeAllPanels);
document.getElementById('close-memory').addEventListener('click', closeAllPanels);
document.getElementById('close-files').addEventListener('click',  closeAllPanels);

document.getElementById('toggle-memory-btn').addEventListener('click', async () => {
  openPanel(memoryPanel);
  await loadFacts();
  await loadMonthlyFiles();
});

document.getElementById('toggle-files-btn').addEventListener('click', async () => {
  openPanel(filesPanel);
  await loadFiles();
});

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

const vaultPanel   = document.getElementById('vault-panel');
const vaultPinScr  = document.getElementById('vault-pin-screen');
const vaultConScr  = document.getElementById('vault-content-screen');
const vaultDots    = document.querySelectorAll('#vault-pin-dots span');
const vaultErrEl   = document.getElementById('vault-pin-error');
const vaultBtn     = document.getElementById('toggle-vault-btn');

let vaultPin        = '';
let vaultUnlocked   = false;

// ── Open / close vault panel ─────────────────────────
function openVaultPanel() {
  vaultPanel.classList.remove('hidden');
  setTimeout(() => vaultPanel.classList.add('open'), 10);
  backdrop.classList.remove('hidden');
}
function closeVaultPanel() {
  vaultPanel.classList.remove('open');
  setTimeout(() => {
    vaultPanel.classList.add('hidden');
    // Reset to PIN screen after close for security
    lockVault();
  }, 300);
  backdrop.classList.add('hidden');
}

function lockVault() {
  vaultPin = '';
  vaultUnlocked = false;
  vaultConScr.classList.add('hidden');
  vaultPinScr.classList.remove('hidden');
  resetPinDots();
  vaultErrEl.classList.add('hidden');
}

// Override closeAllPanels to also handle vault
const _originalCloseAll = closeAllPanels;
function closeAllPanelsWithVault() {
  _originalCloseAll();
  vaultPanel.classList.remove('open');
  setTimeout(() => {
    vaultPanel.classList.add('hidden');
    lockVault();
  }, 300);
}
backdrop.removeEventListener('click', closeAllPanels);
backdrop.addEventListener('click', closeAllPanelsWithVault);

vaultBtn.addEventListener('click', () => {
  // Close other panels first
  memoryPanel.classList.remove('open');
  filesPanel.classList.remove('open');
  setTimeout(() => { memoryPanel.classList.add('hidden'); filesPanel.classList.add('hidden'); }, 300);
  openVaultPanel();
});

document.getElementById('close-vault').addEventListener('click', closeVaultPanel);
document.getElementById('close-vault-unlocked').addEventListener('click', closeVaultPanel);
document.getElementById('relock-vault-btn').addEventListener('click', lockVault);

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
document.getElementById('vault-chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendVaultMessage();
});

async function sendVaultMessage() {
  const input = document.getElementById('vault-chat-input');
  const text = input.value.trim();
  if (!text) return;

  const container = document.getElementById('vault-chat-messages');
  input.value = '';

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

