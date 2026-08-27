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
    
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
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
  'nikhilrawat2005114@gmail.com',
  'nikhilrawat2005@gmail.com'
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

  // Mobile App Auth Bridge: if opened from mobile with ?mobile=1, redirect token back to mobile app
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('mobile') === '1') {
    const customScheme = urlParams.get('redirect') || 'bobmobile://auth';
    window.location.href = `${customScheme}?token=${encodeURIComponent(idToken)}&email=${encodeURIComponent(email)}`;
    return;
  }

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

/**
 * Triggers a browser download for a URL (blob:, data: or same-origin).
 *
 * BUGFIX: five call sites used to build a detached <a> and call a.click() on it
 * without ever inserting it into the document. Chrome tolerates that; Firefox
 * requires the element to be in the DOM for a synthetic click to start a
 * download, so those downloads silently did nothing there. Centralising the
 * append/click/remove dance means the mistake can't come back.
 */
function triggerDownload(url, filename, revokeAfterMs) {
  const a = document.createElement('a');
  a.href = url;
  if (filename) a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  if (revokeAfterMs) setTimeout(() => URL.revokeObjectURL(url), revokeAfterMs);
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
// NOTIFICATIONS (Cleaned / Disabled)
// ═══════════════════════════════════════════════════════

async function loadNotifications() {
  // Notifications view/card removed from HQ
}

function renderHqNotifications() {
  // Strip removed from HQ
}

function renderSessions(sessions) {
  const list = document.getElementById('sessions-list');
  
  // Filter out hackathon (🏆), stalker (🕵️) and SEO (🔍) workspace chats from main sidebar
  const normalSessions = (sessions || []).filter(s => {
    if (s.type === 'hackathon' || s.type === 'stalker' || s.type === 'seo') return false;
    const title = s.title || '';
    if (title.startsWith('🏆') || title.startsWith('🕵️') || title.startsWith('🔍')) return false;
    return true;
  });

  if (!normalSessions.length) {
    list.innerHTML = '<div class="empty-sessions">No chats yet</div>';
    return;
  }

  // Check if top session was updated within the last 24h for auto-pulse highlight
  const now = Date.now();

  list.innerHTML = normalSessions.map((s, idx) => {
    const isRecent = idx === 0 && (now - (s.updatedAt || 0)) < 24 * 60 * 60 * 1000;
    const titleLc = (s.title || '').toLowerCase();
    const isAutoActive = isRecent && (titleLc.includes('goal') || titleLc.includes('dsa'));
    return `
      <div class="session-item ${currentSession?.id === s.id ? 'active' : ''} ${isAutoActive ? 'auto-active' : ''}"
           data-id="${s.id}" data-title="${escHtml(s.title || 'Chat')}">
        <span class="session-title">${escHtml(s.title || 'Chat')}</span>
        <button class="btn-rename-session" data-id="${s.id}" data-title="${escHtml(s.title || 'Chat')}" title="Rename chat">✏️</button>
        <button class="btn-delete-session" data-id="${s.id}" title="Delete chat">🗑️</button>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.session-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('btn-delete-session') || e.target.classList.contains('btn-rename-session')) return;
      selectSession({ id: el.dataset.id, title: el.dataset.title });
    });
  });

  list.querySelectorAll('.btn-rename-session').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await renameSession(btn.dataset.id, btn.dataset.title);
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
          const topbarRenameBtn = document.getElementById('btn-rename-current-session');
          if (topbarRenameBtn) topbarRenameBtn.style.display = 'none';
        }
        await loadSessions();
      }
    });
  });
}

async function renameSession(sessionId, currentTitle = '') {
  const newTitle = prompt('Enter new chat name:', currentTitle || '');
  if (!newTitle || !newTitle.trim() || newTitle.trim() === currentTitle) return;
  const cleanTitle = newTitle.trim();

  try {
    const url = currentPersona === 'builder' ? `/api/builder/sessions/${sessionId}` : `/api/sessions/${sessionId}`;
    await apiFetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: cleanTitle }),
    });

    if (currentSession && currentSession.id === sessionId) {
      currentSession.title = cleanTitle;
      const titleEl = document.getElementById('chat-session-title');
      if (titleEl) titleEl.textContent = cleanTitle;
    }
    await loadSessions();
    if (typeof loadFacts === 'function') {
      loadFacts().catch(() => {});
    }
  } catch (err) {
    alert('Failed to rename: ' + err.message);
  }
}

// Topbar rename button listener
const topbarRenameCurrentSessionBtn = document.getElementById('btn-rename-current-session');
if (topbarRenameCurrentSessionBtn) {
  topbarRenameCurrentSessionBtn.addEventListener('click', () => {
    if (currentSession && currentSession.id) {
      renameSession(currentSession.id, currentSession.title);
    }
  });
}

async function selectSession(session) {
  closeViews();
  if (typeof closeMobileSidebar === 'function') closeMobileSidebar();
  currentSession = session;
  document.getElementById('chat-session-title').textContent = session.title;
  const topbarRenameBtn = document.getElementById('btn-rename-current-session');
  if (topbarRenameBtn) topbarRenameBtn.style.display = 'inline-flex';
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
  if (typeof closeMobileSidebar === 'function') closeMobileSidebar();
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
    const res = await apiFetch(url);
    const messages = res.messages || [];
    const project = res.project || null;

    messages.forEach(m => {
      const timeStr = m.timestamp || (m.createdAt ? new Date(m.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '');
      if (currentPersona === 'builder') {
        appendMessage(m.role, m.content, false, m.sender || m.role, timeStr);
      } else {
        appendMessage(m.role, m.content, false, null, timeStr);
      }
    });


    if (currentPersona === 'builder' && project && Array.isArray(project.files) && project.files.length) {
      renderProjectHeaderCard(sessionId, project);
    }
    scrollToBottom();
  } catch (err) {
    console.error('loadMessages error:', err);
  }
}

async function downloadProjectZip(sessionId, projectName) {
  try {
    const user = auth.currentUser;
    const token = user ? await user.getIdToken() : '';
    const res = await fetch(`/api/builder/projects/${sessionId}/zip`, {
      headers: { Authorization: token ? `Bearer ${token}` : '' }
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || errJson.details || 'Zip generation failed');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    triggerDownload(url, `${(projectName || 'builder_project').replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`);
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('ZIP Download failed: ' + err.message);
  }
}

function renderProjectHeaderCard(sessionId, project) {
  const container = document.getElementById('messages-container');
  if (!container) return;
  const existing = container.querySelector('.builder-project-banner-card');
  if (existing) existing.remove();

  const card = document.createElement('div');
  card.className = 'builder-project-banner-card';
  card.style.cssText = 'background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 12px; padding: 14px 18px; margin: 10px 0 18px 0; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;';

  const titleText = escHtml(project.name || 'Builder Project');
  const fileCount = (project.files || []).length;

  card.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px;">
      <span style="font-size: 24px;">🏗️</span>
      <div>
        <div style="font-weight: 700; color: var(--text-main, #f3f4f6); font-size: 15px;">${titleText}</div>
        <div style="font-size: 12px; color: var(--text-sub, #9ca3af); font-weight: 500;">${fileCount} Codebase Files Generated</div>
      </div>
    </div>
    <button class="download-zip-btn" style="background: #f59e0b; color: #000; border: none; font-weight: 700; padding: 9px 18px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 8px; font-size: 13px; transition: all 0.2s ease;">
      📦 Download Full Codebase (.zip)
    </button>
  `;

  card.querySelector('.download-zip-btn').addEventListener('click', () => {
    downloadProjectZip(sessionId, project.name);
  });

  container.insertBefore(card, container.firstChild);
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
  // ```chart\n{...}\n```, ```mermaid\n<diagram>\n```, ```builder\n{...}\n```,
  // ```hackathon\n{...}\n```, or ```filespec\n{...}\n``` (real .xlsx/.docx/.pdf/.pptx spec)
  const regex = /```(?:([\w.+-]+)?[ \t]+(?:filename|file)=["']?([^"'\n\r]+)["']?|([\w.+-]+)[:\/]([^\n\r]+)|(schedule)|(chart)|(mermaid)|(builder)|(hackathon)|(filespec))[\n\r]?([\s\S]*?)```/gi;
  const blocks = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }

    const lang1 = match[1];
    const filename1 = match[2];
    const lang2 = match[3];
    const filename2 = match[4];
    const isSchedule = match[5] === 'schedule';
    const isChart = match[6] === 'chart';
    const isMermaid = match[7] === 'mermaid';
    const isBuilder = match[8] === 'builder';
    const isHackathon = match[9] === 'hackathon';
    const isFilespec = match[10] === 'filespec';
    const blockContent = (match[11] || '').trim();

    const lang = lang1 || lang2;
    const filename = filename1 || filename2;

    if (isSchedule) {
      try {
        const data = JSON.parse(blockContent);
        blocks.push({ type: 'schedule', data });
      } catch {
        blocks.push({ type: 'text', content: match[0] });
      }
    } else if (isChart) {
      try {
        const data = JSON.parse(blockContent);
        blocks.push({ type: 'chart', data });
      } catch {
        blocks.push({ type: 'text', content: match[0] });
      }
    } else if (isMermaid) {
      blocks.push({ type: 'mermaid', source: blockContent });
    } else if (isBuilder) {
      try {
        const data = JSON.parse(blockContent);
        if (!data.instruction || typeof data.instruction !== 'string' || !data.instruction.trim()) {
          blocks.push({ type: 'builder-invalid', raw: blockContent, error: 'instruction is required (Bob ka builder block incomplete hai — instruction missing/empty)' });
        } else {
          blocks.push({ type: 'builder', data });
        }
      } catch {
        blocks.push({ type: 'builder-invalid', raw: blockContent, error: 'invalid JSON builder block' });
      }
    } else if (isHackathon) {
      try {
        const data = JSON.parse(blockContent);
        blocks.push({ type: 'hackathon', data });
      } catch {
        blocks.push({ type: 'text', content: match[0] });
      }
    } else if (isFilespec) {
      try {
        const data = JSON.parse(blockContent);
        if (!data.format || !data.filename) {
          blocks.push({ type: 'text', content: match[0] });
        } else {
          blocks.push({ type: 'filespec', data });
        }
      } catch {
        blocks.push({ type: 'text', content: match[0] });
      }
    } else if (filename && filename.trim()) {
      blocks.push({
        type:     'file',
        lang:     (lang || 'text').toLowerCase().trim(),
        filename: filename.trim().replace(/^["']|["']$/g, ''),
        content:  match[11] || '',
      });
    } else {
      blocks.push({ type: 'text', content: match[0] });
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    blocks.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return blocks.length > 0 ? blocks : [{ type: 'text', content: text }];
}

// ── Create a REAL Office/PDF file download card (xlsx/docx/pdf/pptx) ──
// Unlike createFileCard() above (which builds a Blob straight from LLM
// text — correct for csv/md/json/code but NOT for binary formats), this
// card sends the LLM's `filespec` JSON to the backend, which builds a
// genuine binary file with ExcelJS/docx/pdfkit/pptxgenjs and returns a
// real Cloudinary URL. The download button downloads THAT URL's bytes —
// nothing here ever turns the spec JSON directly into a Blob.
const FILESPEC_META = {
  xlsx: { icon: '📊', label: 'Excel Workbook' },
  docx: { icon: '📝', label: 'Word Document' },
  pdf:  { icon: '📕', label: 'PDF Document' },
  pptx: { icon: '📽️', label: 'PowerPoint Presentation' },
};

function createFilespecCard(spec) {
  const meta = FILESPEC_META[spec.format] || { icon: '📁', label: (spec.format || 'FILE').toUpperCase() };
  const filename = spec.filename && spec.filename.includes('.')
    ? spec.filename
    : `${spec.filename || 'download'}.${spec.format}`;

  const card = document.createElement('div');
  card.className = 'file-gen-card';
  card.innerHTML = `
    <div class="file-gen-header">
      <div class="file-gen-icon">${meta.icon}</div>
      <div class="file-gen-info">
        <div class="file-gen-name">${escHtml(filename)}</div>
        <div class="file-gen-meta">${escHtml(meta.label)} &bull; generated by Bob</div>
      </div>
    </div>
    <div class="file-gen-actions">
      <button class="file-gen-download-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Generate &amp; Download ${escHtml(filename)}
      </button>
    </div>
  `;

  const btn = card.querySelector('.file-gen-download-btn');
  btn.addEventListener('click', async () => {
    if (btn.dataset.busy) return;
    btn.dataset.busy = '1';
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '⏳ Building real file…';

    try {
      // 1. Ask the backend to build the real binary and store it.
      const { file } = await apiFetch('/api/files/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: spec.format, filename, spec }),
      });

      // 2. Fetch the actual bytes from the returned Cloudinary URL and
      //    trigger a normal browser download — no text-Blob involved.
      btn.innerHTML = '⏳ Downloading…';
      const fileRes = await fetch(file.url);
      if (!fileRes.ok) throw new Error(`Could not fetch generated file (HTTP ${fileRes.status})`);
      const blob = await fileRes.blob();
      const url = URL.createObjectURL(blob);
      triggerDownload(url, file.originalName || filename, 2000);

      btn.innerHTML = '✅ Downloaded!';
      btn.style.background = 'rgba(34, 197, 94, 0.2)';
      btn.style.borderColor = '#22c55e';
      setTimeout(() => {
        btn.innerHTML = originalHtml;
        btn.style.background = '';
        btn.style.borderColor = '';
        btn.dataset.busy = '';
      }, 2500);
    } catch (err) {
      console.error('[filespec] generation/download failed:', err);
      btn.innerHTML = '❌ Failed — retry';
      btn.style.background = 'rgba(var(--red-rgb), 0.2)';
      btn.style.borderColor = 'var(--red)';
      setTimeout(() => {
        btn.innerHTML = originalHtml;
        btn.style.background = '';
        btn.style.borderColor = '';
        btn.dataset.busy = '';
      }, 3000);
    }
  });

  return card;
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
      triggerDownload(canvas.toDataURL('image/png'), (chartData.title || 'chart').replace(/\s+/g, '_') + '.png');      pngBtn.textContent = '✅ Saved!';
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
      triggerDownload(canvas.toDataURL('image/png'), (name || 'diagram').replace(/\s+/g, '_') + '.png');
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

  const fileContent = String(content || '');
  const lineCount = fileContent.split('\n').length;
  const byteSize  = new TextEncoder().encode(fileContent).length;

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
    triggerDownload(url, finalName, 2000);
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

  // ── Markdown links [text](url) → clickable <a> — MUST run before plain URL auto-linker
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, linkText, url) => {
    // Strip any accidental trailing punctuation from URL
    const cleanUrl = url.replace(/[.,;:!?%3C%3E]+$/, '').replace(/%3C.*$/, '').replace(/\)+$/, (m) => {
      const opens  = (url.match(/\(/g) || []).length;
      const closes = (url.match(/\)/g) || []).length;
      return closes > opens ? '' : m;
    });
    // Stash immediately so the auto-linker below never re-processes this <a> tag
    stash.push(`<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="md-link">${linkText}</a>`);
    return stashToken();
  });

  // Auto-link bare URLs (clickable) — runs after Markdown link step so [text](url) is already consumed
  html = html.replace(/(https?:\/\/[^\s<>"'(\[]+)/g, (url) => {
    // Skip if this URL is already inside an href (already linked by Markdown pass)
    let clean = url.replace(/[.,;:!?]+$/, '');
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

function appendMessage(role, content, animate = true, sender = null, timeStr = null) {
  const container = document.getElementById('messages-container');

  // Remove welcome screen if present
  const welcome = document.getElementById('welcome-screen');
  if (welcome) welcome.remove();

  const row = document.createElement('div');
  row.className = `message-row ${role}`;
  if (!animate) row.style.animation = 'none';

  const bubbleWrapper = document.createElement('div');
  bubbleWrapper.className = 'message-bubble-wrapper';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  if (sender === 'bob') bubble.classList.add('bob');

  if (role === 'assistant' && content) {
    // Parse for downloadable file blocks
    const blocks = parseFileBlocks(content);
    const hasFileBlocks = blocks.some(b => b.type === 'file' || b.type === 'filespec');

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
      } else if (block.type === 'filespec') {
        bubble.appendChild(createFilespecCard(block.data));
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

    // ── GitHub Direct Link Buttons ──────────────────────────────
    const ghLinkRe = /\[([^\]]+)\]\((https?:\/\/github\.com\/[^)\s]+)\)/g;
    const ghLinks = [];
    let ghMatch;
    while ((ghMatch = ghLinkRe.exec(content)) !== null) {
      const label = ghMatch[1].trim();
      let url = ghMatch[2].replace(/[.,;:!?%3C%3E]+$/, '').replace(/%3C.*$/, '');
      if (!ghLinks.find(l => l.url === url)) ghLinks.push({ label, url });
    }
    if (ghLinks.length > 0) {
      const linkStrip = document.createElement('div');
      linkStrip.className = 'gh-link-strip';
      ghLinks.forEach(({ label, url }) => {
        const btn = document.createElement('a');
        btn.href = url;
        btn.target = '_blank';
        btn.rel = 'noopener noreferrer';
        btn.className = 'gh-link-btn';
        const repoPath = url.replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
        btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;margin-top:1px"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12"/></svg><span>${escHtml(repoPath)}</span>`;
        linkStrip.appendChild(btn);
      });
      bubble.appendChild(linkStrip);
    }
    // ────────────────────────────────────────────────────────────

    // Auto-speak if TTS is enabled
    if (isTTSEnabled && animate && sender !== 'bob') {
      speakHinglishText(content, speakBtn);
    }
  } else {
    bubble.textContent = content;
  }

  bubbleWrapper.appendChild(bubble);

  // Timestamp badge under message
  const nowDisplayTime = timeStr || new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const timeBadge = document.createElement('div');
  timeBadge.className = 'message-time-badge';
  timeBadge.textContent = nowDisplayTime;
  bubbleWrapper.appendChild(timeBadge);

  row.appendChild(bubbleWrapper);
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
    // Strip all emojis & pictographic unicode (they sound ridiculous when spoken)
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')  // Supplemental symbols, Emoji
    .replace(/[\u{2600}-\u{27BF}]/gu, '')    // Misc symbols, Dingbats
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '') // All emoji ranges
    .replace(/[\u{200D}\u{FE0F}]/gu, '')     // ZWJ & variation selectors
    .replace(/\s{2,}/g, ' ')                 // Collapse extra spaces left by removed emojis
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

let pendingHackPasteImage = null;
let pendingStalkPasteImage = null;

function setupPasteImageSupport(textareaId, previewId, setPendingFn, clearFn) {
  const ta = document.getElementById(textareaId);
  if (!ta) return;
  ta.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        setPendingFn(file);
        const reader = new FileReader();
        reader.onload = (ev) => {
          const preview = document.getElementById(previewId);
          preview.classList.remove('hidden');
          preview.innerHTML = `
            <div class="paste-img-preview">
              <img src="${ev.target.result}" alt="Screenshot preview" class="paste-thumb" />
              <div class="paste-img-info">
                <span class="file-type-badge">🖼️</span>
                <span>Screenshot pasted <span style="color:var(--text3)">(${formatBytes(file.size)})</span></span>
              </div>
              <button class="remove-file">✕</button>
            </div>
          `;
          preview.querySelector('.remove-file').addEventListener('click', clearFn);
        };
        reader.readAsDataURL(file);
        return;
      }
    }
  });
}

setupPasteImageSupport('hack-chat-input', 'hack-file-preview', (f) => { pendingHackPasteImage = f; }, clearPastedHackImage);
setupPasteImageSupport('stalk-chat-input', 'stalk-file-preview', (f) => { pendingStalkPasteImage = f; }, clearPastedStalkImage);

/**
 * BUGFIX: this function was referenced twice — as the '#remove-paste-btn' click
 * handler above, and inside sendMessage() after a pasted image is sent — but it
 * was never defined. Both call sites threw `ReferenceError: clearPastedImage is
 * not defined`, so pasting a screenshot and clicking ✕ did nothing, and sending
 * one aborted sendMessage mid-flight. The hack/stalk equivalents below existed;
 * only the main chat one was missing.
 *
 * The `!pendingFile` guard matches the siblings: the chat preview strip is shared
 * between a pasted screenshot and an attached file, so we must not blank it while
 * the other one is still pending.
 */
function clearPastedImage() {
  pendingPasteImage = null;
  const p = document.getElementById('file-preview');
  if (p && !pendingFile && !pendingStorageFile) {
    p.classList.add('hidden');
    p.innerHTML = '';
  }
}

function clearPastedHackImage() {
  pendingHackPasteImage = null;
  const p = document.getElementById('hack-file-preview');
  if (p && !pendingHackFile) { p.classList.add('hidden'); p.innerHTML = ''; }
}

function clearPastedStalkImage() {
  pendingStalkPasteImage = null;
  const p = document.getElementById('stalk-file-preview');
  if (p && !pendingStalkFile) { p.classList.add('hidden'); p.innerHTML = ''; }
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
  // NEW: non-image attachments (PDF/DOCX/txt/...) — previously these were
  // uploaded to Cloudinary but their upload result was thrown away because
  // only image URLs were ever added to the outgoing payload. Bob never
  // received any reference to the file, so he had no choice but to guess
  // at its contents from the filename alone.
  const documents = [];

  if (currentPersona === 'bob') {
    // Upload pasted screenshot if any
    if (pendingPasteImage) {
      const pasteUrl = await uploadImageFile(pendingPasteImage, 'pasted-screenshot');
      if (pasteUrl) imageUrls.push(pasteUrl);
      clearPastedImage();
    }

    // Attach file chosen from Storage (No re-upload needed)
    if (pendingStorageFile) {
      const isImg = pendingStorageFile.resourceType === 'image' || (pendingStorageFile.originalName || '').match(/\.(jpg|jpeg|png|gif|webp)$/i);
      if (isImg && pendingStorageFile.url) {
        imageUrls.push(pendingStorageFile.url);
      } else {
        documents.push({
          id: pendingStorageFile.id || pendingStorageFile._id,
          url: pendingStorageFile.url,
          name: pendingStorageFile.originalName || pendingStorageFile.publicId || 'Storage File',
          extractedText: pendingStorageFile.extractedText || '',
          textExtracted: !!pendingStorageFile.textExtracted,
          extractionError: pendingStorageFile.extractionError || null,
        });
      }
      clearPendingStorageFile();
    }

    // Upload newly attached file from disk if any
    if (pendingFile) {
      const isImage = pendingFile.type.startsWith('image/');
      const uploadedRecord = await uploadPendingFile();
      if (uploadedRecord) {
        if (isImage) {
          imageUrls.push(uploadedRecord.url);
        } else {
          // Forward the real extracted text (from fileService/documentReaderService
          // on the backend) so Bob answers from the document's actual content
          // instead of hallucinating from just the filename.
          documents.push({
            id: uploadedRecord.id,
            url: uploadedRecord.url,
            name: uploadedRecord.originalName,
            extractedText: uploadedRecord.extractedText || '',
            textExtracted: !!uploadedRecord.textExtracted,
            extractionError: uploadedRecord.extractionError || null,
});
}
      }
    }

  }

  // If only an image/document was sent with no text, add a default prompt
  const finalText = text
    || (imageUrls.length ? 'Yeh screenshot dekho aur mujhe samjhao ismein kya hai.' : '')
    || (documents.length ? 'Is document ko dekho aur mujhe samjhao ismein kya hai.' : '');
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
      if (documents.length) payload.documents = documents;
      if (collabMode) payload.collab = true;

      data = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (data.updatedTitle && currentSession) {
        currentSession.title = data.updatedTitle;
        const titleEl = document.getElementById('chat-session-title');
        if (titleEl) titleEl.textContent = data.updatedTitle;
        const activeItem = document.querySelector(`.session-item[data-id="${currentSession.id}"]`);
        if (activeItem) {
          activeItem.dataset.title = data.updatedTitle;
          const titleSpan = activeItem.querySelector('.session-title');
          if (titleSpan) titleSpan.textContent = data.updatedTitle;
        }
        await loadSessions();
        if (typeof loadFacts === 'function') {
          loadFacts().catch(() => {});
        }
      }
    }

    removeTypingIndicator();
    appendMessage('assistant', data.reply);

    // Surface which model actually ran. `routing` is non-empty ONLY when the
    // server shifted off the requested model — e.g. an image attached while
    // DeepSeek (text-only) was picked, or a prompt too big for its context.
    if (data.model) {
      const selEl = document.getElementById('model-selector');
      const shifted = Array.isArray(data.routing) && data.routing.length > 0;
      if (selEl) {
        selEl.title = shifted
          ? `Auto-switched to ${data.model} — ${data.routing.join(' | ')}`
          : `Preferred model — Bob auto-switches if it can't handle your input (images, huge docs). Last used: ${data.model}`;
      }
      if (shifted) console.info('[Bob] model auto-switched →', data.model, data.routing);
    }
  } catch (err) {
    removeTypingIndicator();
    appendMessage('assistant', `⚠️ Error: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════
// FILE UPLOAD
// ═══════════════════════════════════════════════════════

function setupFileInputHandlers(inputId, previewId, clearFn) {
  const inputEl = document.getElementById(inputId);
  if (!inputEl) return;
  inputEl.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    let icon = '📄';
    const type = file.type || '', name = file.name.toLowerCase();
    if (type.startsWith('image/')) icon = '🖼️';
    else if (type.startsWith('audio/')) icon = '🎵';
    else if (type.startsWith('video/')) icon = '🎬';
    else if (type.includes('pdf')) icon = '📕';
    else if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.xlsx') || name.endsWith('.xls')) icon = '📊';
    else if (name.endsWith('.json') || name.endsWith('.py') || name.endsWith('.js') || name.endsWith('.ts')) icon = '💻';

    const preview = document.getElementById(previewId);
    preview.classList.remove('hidden');
    preview.innerHTML = `
      <span class="file-type-badge">${icon}</span>
      <span>${escHtml(file.name)} <span style="color:var(--text3)">(${formatBytes(file.size)})</span></span>
      <button class="remove-file">✕</button>
    `;
    preview.querySelector('.remove-file').addEventListener('click', () => clearFn(previewId, inputId));
  });
}

let pendingHackFile = null;
let pendingStalkFile = null;

let pendingStorageFile = null;

function renderAttachedPreview(icon, title, subtitle, onRemove) {
  const preview = document.getElementById('file-preview');
  preview.classList.remove('hidden');
  preview.innerHTML = `
    <span class="file-type-badge">${icon}</span>
    <span>${escHtml(title)} <span style="color:var(--text3)">(${subtitle})</span></span>
    <button class="remove-file" id="remove-file-btn">✕</button>
  `;
  document.getElementById('remove-file-btn').addEventListener('click', onRemove);
  sendBtn.disabled = false;
}

function clearPendingStorageFile() {
  pendingStorageFile = null;
  document.getElementById('file-preview').classList.add('hidden');
  sendBtn.disabled = !messageInput.value.trim() && !pendingFile;
}

function clearPendingFile() {
  pendingFile = null;
  // Always reset the input, otherwise re-picking the SAME file fires no
  // 'change' event and the attachment silently fails to re-attach.
  const input = document.getElementById('file-upload-input');
  if (input) input.value = '';

  if (pendingStorageFile) {
    // A storage file is also selected — keep showing that instead of blanking
    // the shared preview strip.
    setStorageFileSelected(pendingStorageFile);
    return;
  }
  // Don't hide the strip if a pasted screenshot is still waiting in it.
  if (!pendingPasteImage) {
    document.getElementById('file-preview').classList.add('hidden');
  }
  sendBtn.disabled = !messageInput.value.trim() && !pendingPasteImage;
}

function setStorageFileSelected(file) {
  pendingStorageFile = file;
  pendingFile = null;
  document.getElementById('file-upload-input').value = '';
  const name = file.originalName || file.publicId || 'Storage Document';
  const icon = getFileIcon(name, file.resourceType);
  const size = formatBytes(file.sizeBytes || 0);
  const badge = file.textExtracted ? '📁 Storage (AI-Ready)' : '📁 Storage (Asset)';
  renderAttachedPreview(icon, name, `${size} • ${badge}`, clearPendingStorageFile);
  closeStorageFilePicker();
}

// ── Storage File Picker Modal Functions ─────────────────
async function openStorageFilePicker() {
  const modal = document.getElementById('storage-file-picker-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  
  const searchInput = document.getElementById('storage-picker-search');
  if (searchInput) {
    searchInput.value = '';
    searchInput.focus();
  }

  renderStoragePickerList();
  
  try {
    await loadFiles();
    renderStoragePickerList();
  } catch (e) {
    console.warn('Storage files refresh:', e.message);
  }
}

function closeStorageFilePicker() {
  const modal = document.getElementById('storage-file-picker-modal');
  if (modal) modal.classList.add('hidden');
}

function renderStoragePickerList() {
  const listEl = document.getElementById('storage-picker-list');
  const searchInput = document.getElementById('storage-picker-search');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
  if (!listEl) return;

  let files = allUploadedFiles || [];
  if (query) {
    files = files.filter(f => {
      const name = (f.originalName || f.publicId || '').toLowerCase();
      const ext = (f.extractedText || '').toLowerCase();
      return name.includes(query) || ext.includes(query);
    });
  }

  if (!files.length) {
    listEl.innerHTML = `
      <div style="text-align:center; padding:30px 10px; color:var(--text3);">
        <div style="font-size:32px; margin-bottom:8px;">📁</div>
        <p style="margin:0; font-size:13px;">${allUploadedFiles.length === 0 ? 'No files stored in Vault yet. Upload a file once first!' : 'No matching files found.'}</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = `
    <div class="storage-picker-grid">
      ${files.map(f => {
        const fileId = f.id || f._id || f.publicId;
        const name = f.originalName || f.publicId || 'Untitled File';
        const icon = getFileIcon(name, f.resourceType);
        const size = formatBytes(f.sizeBytes || 0);
        const status = f.textExtracted ? '🤖 AI-Readable Document' : '📦 Asset / Media';
        return `
          <div class="storage-picker-card" data-picker-id="${escHtml(String(fileId))}">
            <div class="storage-picker-card-left">
              <span class="storage-picker-icon">${icon}</span>
              <div style="min-width:0; flex:1;">
                <div class="storage-picker-title" title="${escHtml(name)}">${escHtml(name)}</div>
                <div class="storage-picker-sub">${size} • ${status}</div>
              </div>
            </div>
            <button type="button" class="storage-picker-select-btn">Select</button>
          </div>
        `;
      }).join('')}
    </div>
  `;

  listEl.querySelectorAll('.storage-picker-card').forEach(card => {
    card.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const fileId = card.dataset.pickerId;
      const file = (allUploadedFiles || []).find(f => String(f.id || f._id || f.publicId) === String(fileId));
      if (file) {
        setStorageFileSelected(file);
      }
    });
  });
}

// Bind Storage Button click
document.getElementById('storage-files-btn')?.addEventListener('click', (e) => {
  e.preventDefault();
  openStorageFilePicker();
});
document.getElementById('storage-file-picker-close')?.addEventListener('click', (e) => {
  e.preventDefault();
  closeStorageFilePicker();
});
document.getElementById('storage-file-picker-backdrop')?.addEventListener('click', (e) => {
  e.preventDefault();
  closeStorageFilePicker();
});
document.getElementById('storage-picker-cancel-btn')?.addEventListener('click', (e) => {
  e.preventDefault();
  closeStorageFilePicker();
});
document.getElementById('storage-picker-search')?.addEventListener('input', () => renderStoragePickerList());


document.getElementById('file-upload-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  pendingFile = file;
  pendingStorageFile = null; // Prioritize fresh upload if user picked file from disk

  const type = file.type || '';
  const name = file.name.toLowerCase();
  let fileIcon = '📄';
  if (type.startsWith('image/'))           fileIcon = '🖼️';
  else if (type.startsWith('audio/'))      fileIcon = '🎵';
  else if (type.startsWith('video/'))      fileIcon = '🎬';
  else if (type.includes('pdf'))           fileIcon = '📕';
  else if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.xlsx') || name.endsWith('.xls')) fileIcon = '📊';
  else if (name.endsWith('.json'))         fileIcon = '🔧';
  else if (name.endsWith('.py'))           fileIcon = '🐍';
  else if (name.endsWith('.js') || name.endsWith('.ts')) fileIcon = '🟨';
  else if (name.endsWith('.html') || name.endsWith('.htm')) fileIcon = '🌐';
  else if (name.endsWith('.md'))           fileIcon = '📝';
  else if (name.endsWith('.sql'))          fileIcon = '🗃️';
  else if (name.endsWith('.cpp') || name.endsWith('.c') || name.endsWith('.java')) fileIcon = '⚡';
  else if (name.endsWith('.sh') || name.endsWith('.bash')) fileIcon = '💻';

  renderAttachedPreview(fileIcon, file.name, formatBytes(file.size), clearPendingFile);
});


document.getElementById('hack-file-upload-input')?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  pendingHackFile = file;
  let icon = file.type.startsWith('image/') ? '🖼️' : '📄';
  const preview = document.getElementById('hack-file-preview');
  preview.classList.remove('hidden');
  preview.innerHTML = `
    <span class="file-type-badge">${icon}</span>
    <span>${escHtml(file.name)} <span style="color:var(--text3)">(${formatBytes(file.size)})</span></span>
    <button class="remove-file" id="remove-hack-file-btn">✕</button>
  `;
  document.getElementById('remove-hack-file-btn').addEventListener('click', clearPendingHackFile);
});

document.getElementById('stalk-file-upload-input')?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  pendingStalkFile = file;
  let icon = file.type.startsWith('image/') ? '🖼️' : '📄';
  const preview = document.getElementById('stalk-file-preview');
  preview.classList.remove('hidden');
  preview.innerHTML = `
    <span class="file-type-badge">${icon}</span>
    <span>${escHtml(file.name)} <span style="color:var(--text3)">(${formatBytes(file.size)})</span></span>
    <button class="remove-file" id="remove-stalk-file-btn">✕</button>
  `;
  document.getElementById('remove-stalk-file-btn').addEventListener('click', clearPendingStalkFile);
});

// NOTE: clearPendingFile() is defined once, near clearPendingStorageFile().
// There used to be a second, simpler copy of it right here — and because
// function declarations hoist, THIS one silently overwrote the earlier one,
// which meant the "keep the storage file selected" branch up there was
// unreachable dead code. Removing the duplicate restores that behaviour.

function clearPendingHackFile() {
  pendingHackFile = null;
  const p = document.getElementById('hack-file-preview');
  if (p) { p.classList.add('hidden'); p.innerHTML = ''; }
  const inp = document.getElementById('hack-file-upload-input');
  if (inp) inp.value = '';
}

function clearPendingStalkFile() {
  pendingStalkFile = null;
  const p = document.getElementById('stalk-file-preview');
  if (p) { p.classList.add('hidden'); p.innerHTML = ''; }
  const inp = document.getElementById('stalk-file-upload-input');
  if (inp) inp.value = '';
}

async function uploadPendingFile() {
  if (!currentSession || !pendingFile) return null;
  const file = pendingFile;
  clearPendingFile();
  return await uploadFileRecord(file);
}

/**
 * Uploads any file (attached or pasted) to backend, returns the FULL file
 * record (url, originalName, extractedText, textExtracted, ...) — not just
 * the URL — so callers can decide what to do with images vs. documents.
 */
async function uploadFileRecord(file) {
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
    return data.file || null;
  } catch (err) {
    appendMessage('assistant', `⚠️ File upload failed: ${err.message}`, true);
    return null;
  }
}

// Back-compat thin wrapper: older call sites just want the URL (e.g. pasted
// screenshots for vision analysis).
async function uploadImageFile(file, label) {
  const record = await uploadFileRecord(file);
  return record ? record.url : null;
}

// ═══════════════════════════════════════════════════════
// MEMORY PANEL
// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
// HQ / WORKSPACE VIEW ROUTER
// ═══════════════════════════════════════════════════════

function showView(name) {
  if (typeof closeMobileSidebar === 'function') closeMobileSidebar();
  // Toggle OFF if clicking the view that is already active (back to chat so you can type)
  const activeView = document.querySelector('.view.active');
  const activeId = activeView ? activeView.id.replace('view-', '') : '';
  const next = (name && name === activeId) ? '' : (name || '');
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + next));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === next));
  return next;
}
function closeViews() { showView(''); if (keysRefreshTimer) { clearInterval(keysRefreshTimer); keysRefreshTimer = null; } }

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
    triggerDownload(url, `Bob-Memory-${monthId}.md`, 2000);
  } catch (err) {
    alert('Failed to download: ' + err.message);
  }
}

// ═══════════════════════════════════════════════════════
// MEMORY HUB: CARDS, CATEGORY VIEW & BULK DOCUMENT EDITOR
// ═══════════════════════════════════════════════════════

const MEMORY_CATEGORIES = {
  habits: {
    key: 'habits',
    title: 'Habits & Preferences',
    tag: '[Habit/Preference]',
    icon: '🎯',
    desc: 'Working habits, communication tone, coding preferences & active personal goals',
    emptyMsg: 'No habits or preferences recorded yet.',
  },
  main: {
    key: 'main',
    title: 'Main Memory',
    tag: '[Main]',
    icon: '🧠',
    desc: 'Core profile facts, resume, life context & verified personal background',
    emptyMsg: 'No core memory facts recorded yet.',
  },
  hackathons: {
    key: 'hackathons',
    title: 'Hackathons',
    tag: '[Hackathons]',
    icon: '🏆',
    desc: 'Competitions, problem statements, teams, rules & pitches',
    emptyMsg: 'No hackathon knowledge recorded yet.',
  },
  stalker: {
    key: 'stalker',
    title: 'Stalker Intelligence',
    tag: '[Stalker]',
    icon: '🕵️',
    desc: 'Target profiles, social handles (IG, LinkedIn, GitHub), and crawled research',
    emptyMsg: 'No stalker profiles or research data recorded yet.',
  },
  vault: {
    key: 'vault',
    title: 'Secret Vault',
    tag: '[Vault]',
    icon: '🔒',
    desc: 'Protected notes, confidential keys & secure memory pointers',
    emptyMsg: 'No secret vault memories recorded yet.',
  },
  builder: {
    key: 'builder',
    title: 'Builder & Codebase',
    tag: '[Builder]',
    icon: '🛠️',
    desc: 'Vibecoding setups, architecture notes, tech stacks & DSA progress',
    emptyMsg: 'No builder or codebase knowledge recorded yet.',
  },
};

let allMemoryFacts = [];
let activeMemoryCat = 'all';
let activeDocEditCat = 'all';

function showMemorySubview(name) {
  const dashEl = document.getElementById('memory-dashboard-view');
  const catEl  = document.getElementById('memory-category-view');
  const docEl  = document.getElementById('memory-document-view');

  if (dashEl) dashEl.classList.toggle('hidden', name !== 'dashboard');
  if (catEl)  catEl.classList.toggle('hidden', name !== 'category');
  if (docEl)  docEl.classList.toggle('hidden', name !== 'document');
}

// ── Consolidate Memory Button ────────────────────────────
const memoryConsolidateBtn = document.getElementById('memory-consolidate-btn');
if (memoryConsolidateBtn) {
  memoryConsolidateBtn.addEventListener('click', async () => {
    memoryConsolidateBtn.disabled = true;
    memoryConsolidateBtn.textContent = '⏳ Combining all stored memories…';
    try {
      const res = await apiFetch('/api/memory/consolidate', { method: 'POST' });
      await loadFacts();
      memoryConsolidateBtn.textContent = `✅ Combined! (${res.newlyImported || 0} imported)`;
      setTimeout(() => {
        memoryConsolidateBtn.textContent = '📦 Combine & Import';
        memoryConsolidateBtn.disabled = false;
      }, 3000);
    } catch (err) {
      memoryConsolidateBtn.disabled = false;
      memoryConsolidateBtn.textContent = '📦 Combine & Import';
      alert('Failed: ' + err.message);
    }
  });
}

// ── All Memory Document Editor Button ────────────────────
const memoryAllDocBtn = document.getElementById('memory-all-doc-btn');
if (memoryAllDocBtn) {
  memoryAllDocBtn.addEventListener('click', () => {
    openDocumentEditor('all');
  });
}

// ── Global Search in Dashboard ───────────────────────────
const memoryGlobalSearch = document.getElementById('memory-global-search');
if (memoryGlobalSearch) {
  memoryGlobalSearch.addEventListener('input', () => {
    renderMemoryCardsGrid(memoryGlobalSearch.value.trim().toLowerCase());
  });
}

let cachedSessions = [];
let cachedHackathons = [];
let cachedStalkerProfiles = [];

// ── Load & Distribute Facts (Unified Memory Hub) ─────────
async function loadFacts() {
  const totalCountEl = document.getElementById('facts-total-count');
  try {
    const unifiedRes = await apiFetch('/api/memory/unified').catch(() => null);
    if (unifiedRes && unifiedRes.facts) {
      allMemoryFacts = unifiedRes.facts || [];
      cachedStalkerProfiles = unifiedRes.stalkerProfiles || [];
      cachedHackathons = unifiedRes.hackathons || [];
    } else {
      // Fallback
      const [factsRes, hackRes, stalkRes] = await Promise.all([
        apiFetch('/api/memory/facts'),
        apiFetch('/api/hackathons').catch(() => ({ hackathons: [] })),
        apiFetch('/api/stalking').catch(() => ({ profiles: [] })),
      ]);
      allMemoryFacts = factsRes.facts || [];
      cachedHackathons = hackRes.hackathons || [];
      cachedStalkerProfiles = stalkRes.profiles || [];
    }

    const sessRes = await apiFetch('/api/sessions').catch(() => ({ sessions: [] }));
    cachedSessions = (sessRes.sessions || []).filter(s => !s.title?.startsWith('🏆') && !s.title?.startsWith('🕵️') && !s.title?.startsWith('🔍'));

    let totalPoints = allMemoryFacts.length;
    cachedStalkerProfiles.forEach(p => {
      totalPoints += (p.profileData?.summary?.length || 0);
    });
    cachedHackathons.forEach(h => {
      totalPoints += (h.rules?.length || 0);
    });

    if (totalCountEl) totalCountEl.textContent = totalPoints;

    renderMemoryCardsGrid();

    // If currently inside category view, re-render it
    const catEl = document.getElementById('memory-category-view');
    if (catEl && !catEl.classList.contains('hidden')) {
      renderCategoryFactsList();
    }
  } catch (err) {
    console.error('Error loading unified memory facts:', err);
  }
}

// ── Render 6 Category Cards Grid ─────────────────────────
function renderMemoryCardsGrid(filterQuery = '') {
  const grid = document.getElementById('memory-cards-grid');
  if (!grid) return;

  const cardKeys = Object.keys(MEMORY_CATEGORIES);

  grid.innerHTML = cardKeys.map(key => {
    const cat = MEMORY_CATEGORIES[key];
    let catFacts = allMemoryFacts.filter(f => (f.category || 'main') === key);

    let count = catFacts.length;
    let previews = [];

    if (key === 'stalker') {
      const stalkerInsights = [];
      cachedStalkerProfiles.forEach(p => {
        const pd = p.profileData || {};
        if (p.name) stalkerInsights.push(`🎯 Target: ${p.name}${pd.headline ? ` — ${pd.headline}` : ''}`);
        (pd.summary || []).slice(0, 1).forEach(s => stalkerInsights.push(`💡 ${s}`));
      });
      count = catFacts.length + stalkerInsights.length;
      previews = [...stalkerInsights.slice(0, 2), ...catFacts.map(f => f.text).slice(0, 2)].slice(0, 2).map(t => ({ text: t }));
    } else if (key === 'hackathons') {
      const hackPointers = [];
      cachedHackathons.forEach(h => {
        hackPointers.push(`🏆 ${h.title || 'Hackathon'}${h.prize ? ` (Prize: ${h.prize})` : ''}`);
        (h.rules || []).slice(0, 1).forEach(r => hackPointers.push(`📜 Rule: ${r}`));
      });
      count = catFacts.length + hackPointers.length;
      previews = [...hackPointers.slice(0, 2), ...catFacts.map(f => f.text).slice(0, 2)].slice(0, 2).map(t => ({ text: t }));
    } else {
      if (filterQuery) {
        catFacts = catFacts.filter(f => (f.text || '').toLowerCase().includes(filterQuery));
      }
      count = catFacts.length;
      previews = catFacts.slice(0, 2);
    }

    return `
      <div class="memory-card" id="mem-card-${key}">
        <div>
          <div class="memory-card-header">
            <div class="memory-card-title-group">
              <div class="memory-card-icon">${cat.icon}</div>
              <div>
                <div class="memory-card-name">${escHtml(cat.title)}</div>
                <span class="memory-card-count-badge">${count} point${count === 1 ? '' : 's'}</span>
              </div>
            </div>
          </div>
          <div class="memory-card-desc">${escHtml(cat.desc)}</div>
          <div class="memory-card-preview">
            ${previews.length > 0
              ? previews.map(p => `<div class="memory-card-preview-item" title="${escHtml(p.text)}">${escHtml(p.text)}</div>`).join('')
              : `<div class="memory-card-preview-empty">${escHtml(cat.emptyMsg)}</div>`
            }
          </div>
        </div>
        <div class="memory-card-actions">
          <button class="memory-card-btn-open" data-open-cat="${key}">📂 Open Card</button>
          <button class="memory-card-btn-icon" data-doc-cat="${key}" title="Edit as Document Page">📝 Edit Page</button>
          <button class="memory-card-btn-icon" data-copy-cat="${key}" title="Copy Card Content">📋 Copy</button>
        </div>
      </div>
    `;
  }).join('');

  // Attach card action listeners
  grid.querySelectorAll('[data-open-cat]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openCategoryView(btn.dataset.openCat);
    });
  });

  grid.querySelectorAll('.memory-card').forEach(card => {
    card.addEventListener('click', () => {
      const key = card.id.replace('mem-card-', '');
      openCategoryView(key);
    });
  });

  grid.querySelectorAll('[data-doc-cat]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDocumentEditor(btn.dataset.docCat);
    });
  });

  grid.querySelectorAll('[data-copy-cat]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyCategoryFacts(btn.dataset.copyCat, btn);
    });
  });
}

// ── Category Detail View ─────────────────────────────────
function openCategoryView(catKey) {
  activeMemoryCat = catKey || 'habits';
  showMemorySubview('category');

  const cat = MEMORY_CATEGORIES[activeMemoryCat] || {
    title: 'All Memory Points',
    icon: '📝',
  };

  const titleEl = document.getElementById('cat-view-title');
  const iconEl  = document.getElementById('cat-view-icon');
  const inputEl = document.getElementById('fact-input');

  if (titleEl) titleEl.textContent = cat.title;
  if (iconEl)  iconEl.textContent  = cat.icon;
  if (inputEl) inputEl.placeholder = `Add a new point to ${cat.title}...`;

  // Update tabs active state
  document.querySelectorAll('#memory-cat-tabs .cat-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cat === activeMemoryCat);
  });

  renderCategoryFactsList();
}

let activeDocEditPage = null;

function getPageIcon(type, category) {
  if (type === 'stalker' || category === 'stalker') return '🕵️';
  if (type === 'hackathon' || category === 'hackathons') return '🏆';
  if (type === 'chat') return '💬';
  if (category === 'habits') return '🎯';
  if (category === 'vault') return '🔒';
  if (category === 'builder') return '🛠️';
  return '🧠';
}

function renderCategoryFactsList() {
  const list = document.getElementById('facts-list');
  const countEl = document.getElementById('cat-view-count');
  const filterCountEl = document.getElementById('cat-filter-count');
  const searchInput = document.getElementById('cat-fact-search');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

  if (!list) return;

  // ═══════════════════════════════════════════════════════════════════════
  // 1. STALKER INTELLIGENCE VIEW (Unified Deep Research & Chat Points)
  // ═══════════════════════════════════════════════════════════════════════
  if (activeMemoryCat === 'stalker') {
    let profiles = cachedStalkerProfiles || [];
    if (query) {
      profiles = profiles.filter(p => 
        (p.name || '').toLowerCase().includes(query) || 
        (p.profileData?.headline || '').toLowerCase().includes(query) ||
        (p.profileData?.summary || []).some(s => s.toLowerCase().includes(query))
      );
    }

    if (countEl) countEl.textContent = `${profiles.length} targets researched`;
    if (filterCountEl) filterCountEl.textContent = query ? `(${profiles.length} matching)` : '';

    if (!profiles.length && !allMemoryFacts.filter(f => f.category === 'stalker').length) {
      list.innerHTML = `<div class="empty-msg">No stalker profiles researched yet. Create a target in Stalker Workspace or add a memory point above!</div>`;
      return;
    }

    list.innerHTML = `
      <div class="memory-pages-container">
        ${profiles.map(p => {
          const pd = p.profileData || {};
          const insights = pd.summary || [];
          const techList = pd.tech || [];
          const targetFacts = allMemoryFacts.filter(f => 
            (f.category === 'stalker' && (f.sourceTitle || '').toLowerCase() === (p.name || '').toLowerCase()) ||
            (p.chatSessionId && f.sessionId === p.chatSessionId)
          );

          return `
            <div class="memory-entity-card" id="stalker-mem-card-${p.id}">
              <div class="memory-entity-header">
                <div class="memory-entity-identity">
                  <div class="memory-entity-avatar">🕵️</div>
                  <div>
                    <div class="memory-entity-title">
                      ${escHtml(p.name)}
                      ${p.link ? `<a href="${escHtml(p.link)}" target="_blank" class="memory-entity-link" title="Open Link">↗ ${escHtml(p.link)}</a>` : ''}
                    </div>
                    ${pd.headline ? `<div class="memory-entity-headline">${escHtml(pd.headline)}</div>` : ''}
                    <div class="memory-entity-meta">
                      ${pd.location && pd.location !== 'unknown' ? `<span>📍 ${escHtml(pd.location)}</span>` : ''}
                      ${pd.githubHandle ? `<span>🐙 GitHub: @${escHtml(pd.githubHandle)}</span>` : ''}
                    </div>
                  </div>
                </div>
                <div class="memory-page-actions">
                  <button class="btn-small btn-open-stalker-ws" data-prof-id="${p.id}" style="background:rgba(var(--cyan-rgb),0.15); border:1px solid rgba(var(--cyan-rgb),0.3); color:var(--cyan);">💬 Stalker Workspace</button>
                  <button class="btn-small btn-add-target-fact" data-prof-id="${p.id}" data-target-name="${escHtml(p.name)}" style="background:var(--surface2); border:1px solid var(--border2); color:var(--text);">＋ Add Insight</button>
                </div>
              </div>

              ${techList.length ? `
                <div class="memory-entity-tech-row">
                  <strong style="font-size:11px; color:var(--text3); margin-right:4px;">TECH / SKILLS:</strong>
                  ${techList.map(t => `<span class="memory-entity-tech-pill">${escHtml(t)}</span>`).join('')}
                </div>
              ` : ''}

              <!-- Deep Research Insights List with Individual Delete/Prune -->
              <div class="memory-entity-insights">
                <div class="memory-entity-section-title">
                  <span>🧠 Deep Research Insights (${insights.length})</span>
                </div>
                ${insights.length ? insights.map((ins) => `
                  <div class="memory-insight-item">
                    <span class="memory-insight-text">• ${escHtml(ins)}</span>
                    <div class="memory-insight-actions">
                      <button class="fact-delete btn-delete-stalker-insight" data-prof-id="${p.id}" data-insight="${escHtml(ins)}" title="Delete this insight from memory">✕</button>
                    </div>
                  </div>
                `).join('') : `<div style="font-size:12px; color:var(--text3);">No summary insights captured yet.</div>`}
              </div>

              <!-- Chat Discussion Notes & Linked Facts -->
              ${targetFacts.length ? `
                <div style="margin-top:4px;">
                  <div class="memory-entity-section-title" style="margin-bottom:6px;">
                    <span>💬 Chat Strategy Points & Notes (${targetFacts.length})</span>
                  </div>
                  <div class="memory-page-facts-list">
                    ${targetFacts.map(f => `
                      <div class="fact-item" id="fact-item-${f.id}">
                        <span class="fact-cat-badge">🕵️</span>
                        <span class="fact-text" id="fact-text-${f.id}">${escHtml(f.text)}</span>
                        <div class="fact-item-actions" id="fact-actions-${f.id}">
                          <button class="fact-edit-btn" data-id="${f.id}" title="Edit this point">✏️</button>
                          <button class="fact-delete" data-id="${f.id}" title="Delete this point">✕</button>
                        </div>
                      </div>
                    `).join('')}
                  </div>
                </div>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;

    // Listeners for Stalker Memory View
    list.querySelectorAll('.btn-open-stalker-ws').forEach(btn => {
      btn.addEventListener('click', () => {
        const profId = btn.dataset.profId;
        switchTab('stalking');
        if (typeof openProfileDetails === 'function') openProfileDetails(profId);
      });
    });

    list.querySelectorAll('.btn-delete-stalker-insight').forEach(btn => {
      btn.addEventListener('click', async () => {
        const profId = btn.dataset.profId;
        const insightText = btn.dataset.insight;
        if (!confirm('Are you sure you want to delete this insight from memory?')) return;
        try {
          await apiFetch('/api/memory/stalker-insight/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profId, insightText }),
          });
          await loadFacts();
        } catch (err) {
          alert('Failed to delete insight: ' + err.message);
        }
      });
    });

    list.querySelectorAll('.btn-add-target-fact').forEach(btn => {
      btn.addEventListener('click', async () => {
        const profId = btn.dataset.profId;
        const targetName = btn.dataset.targetName;
        const newText = prompt(`Add a new insight/point for target "${targetName}":`);
        if (!newText || !newText.trim()) return;
        try {
          await apiFetch('/api/memory/stalker-insight/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profId, insightText: newText.trim() }),
          });
          await loadFacts();
        } catch (err) {
          alert('Failed to add insight: ' + err.message);
        }
      });
    });

    attachFactActionListeners(list);
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. HACKATHONS INTELLIGENCE VIEW (Rules, Deadlines, & Chat Strategy)
  // ═══════════════════════════════════════════════════════════════════════
  if (activeMemoryCat === 'hackathons') {
    let hackathons = cachedHackathons || [];
    if (query) {
      hackathons = hackathons.filter(h => 
        (h.title || '').toLowerCase().includes(query) || 
        (h.description || '').toLowerCase().includes(query) ||
        (h.rules || []).some(r => r.toLowerCase().includes(query))
      );
    }

    if (countEl) countEl.textContent = `${hackathons.length} hackathons tracked`;
    if (filterCountEl) filterCountEl.textContent = query ? `(${hackathons.length} matching)` : '';

    if (!hackathons.length && !allMemoryFacts.filter(f => f.category === 'hackathons').length) {
      list.innerHTML = `<div class="empty-msg">No hackathons tracked yet. Add one in Hackathons Workspace or add a memory point above!</div>`;
      return;
    }

    list.innerHTML = `
      <div class="memory-pages-container">
        ${hackathons.map(h => {
          const rules = h.rules || [];
          const status = h.status || 'active';
          const badgeClass = status === 'live' ? 'memory-badge-live' : status === 'upcoming' ? 'memory-badge-upcoming' : 'memory-badge-ended';
          const hackFacts = allMemoryFacts.filter(f => 
            (f.category === 'hackathons' && (f.sourceTitle || '').toLowerCase() === (h.title || '').toLowerCase()) ||
            (h.chatSessionId && f.sessionId === h.chatSessionId)
          );

          const fmtDate = ts => ts ? new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
          const startStr = fmtDate(h.startDate);
          const endStr = fmtDate(h.endDate);

          return `
            <div class="memory-entity-card" id="hack-mem-card-${h.id}">
              <div class="memory-entity-header">
                <div class="memory-entity-identity">
                  <div class="memory-entity-avatar">🏆</div>
                  <div>
                    <div class="memory-entity-title">
                      ${escHtml(h.title)}
                      <span class="${badgeClass}">${escHtml(status.toUpperCase())}</span>
                      ${h.link ? `<a href="${escHtml(h.link)}" target="_blank" class="memory-entity-link" title="Open Link">↗ ${escHtml(h.link)}</a>` : ''}
                    </div>
                    ${h.prize ? `<div style="font-size:12px; color:#34d399; font-weight:600; margin-top:2px;">💰 Prize: ${escHtml(h.prize)}</div>` : ''}
                    <div class="memory-entity-meta">
                      ${startStr || endStr ? `<span>📅 ${startStr || 'Now'} – ${endStr || 'TBD'}</span>` : ''}
                      ${h.mode ? `<span>🌐 Mode: ${escHtml(h.mode)}</span>` : ''}
                    </div>
                  </div>
                </div>
                <div class="memory-page-actions">
                  <button class="btn-small btn-open-hack-chat" data-hack-id="${h.id}" style="background:rgba(245,158,11,0.15); border:1px solid rgba(245,158,11,0.3); color:#fbbf24;">💬 Hackathon Chat</button>
                  <button class="btn-small btn-add-hack-rule" data-hack-id="${h.id}" data-hack-title="${escHtml(h.title)}" style="background:var(--surface2); border:1px solid var(--border2); color:var(--text);">＋ Add Rule/Note</button>
                </div>
              </div>

              ${h.description ? `
                <div style="font-size:13px; color:var(--text2); line-height:1.45;">
                  ${escHtml(h.description)}
                </div>
              ` : ''}

              <!-- Rules & Constraints List with Individual Delete/Prune -->
              <div class="memory-entity-insights">
                <div class="memory-entity-section-title">
                  <span>📜 Rules & Requirements (${rules.length})</span>
                </div>
                ${rules.length ? rules.map((r) => `
                  <div class="memory-insight-item">
                    <span class="memory-insight-text">• ${escHtml(r)}</span>
                    <div class="memory-insight-actions">
                      <button class="fact-delete btn-delete-hack-rule" data-hack-id="${h.id}" data-rule="${escHtml(r)}" title="Delete this rule from memory">✕</button>
                    </div>
                  </div>
                `).join('') : `<div style="font-size:12px; color:var(--text3);">No explicit rules saved yet.</div>`}
              </div>

              <!-- Chat Discussion Notes & Linked Facts -->
              ${hackFacts.length ? `
                <div style="margin-top:4px;">
                  <div class="memory-entity-section-title" style="margin-bottom:6px;">
                    <span>💬 Strategy & Discussion Points (${hackFacts.length})</span>
                  </div>
                  <div class="memory-page-facts-list">
                    ${hackFacts.map(f => `
                      <div class="fact-item" id="fact-item-${f.id}">
                        <span class="fact-cat-badge">🏆</span>
                        <span class="fact-text" id="fact-text-${f.id}">${escHtml(f.text)}</span>
                        <div class="fact-item-actions" id="fact-actions-${f.id}">
                          <button class="fact-edit-btn" data-id="${f.id}" title="Edit this point">✏️</button>
                          <button class="fact-delete" data-id="${f.id}" title="Delete this point">✕</button>
                        </div>
                      </div>
                    `).join('')}
                  </div>
                </div>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;

    // Listeners for Hackathons Memory View
    list.querySelectorAll('.btn-open-hack-chat').forEach(btn => {
      btn.addEventListener('click', () => {
        const hackId = btn.dataset.hackId;
        switchTab('hackathons');
        if (typeof openHackathonChat === 'function') openHackathonChat(hackId);
      });
    });

    list.querySelectorAll('.btn-delete-hack-rule').forEach(btn => {
      btn.addEventListener('click', async () => {
        const hackId = btn.dataset.hackId;
        const ruleText = btn.dataset.rule;
        if (!confirm('Are you sure you want to delete this rule from memory?')) return;
        try {
          await apiFetch('/api/memory/hackathon-rule/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hackId, ruleText }),
          });
          await loadFacts();
        } catch (err) {
          alert('Failed to delete rule: ' + err.message);
        }
      });
    });

    list.querySelectorAll('.btn-add-hack-rule').forEach(btn => {
      btn.addEventListener('click', async () => {
        const hackId = btn.dataset.hackId;
        const hackTitle = btn.dataset.hackTitle;
        const newText = prompt(`Add a new rule or note for "${hackTitle}":`);
        if (!newText || !newText.trim()) return;
        try {
          await apiFetch('/api/memory/hackathon-rule/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hackId, ruleText: newText.trim() }),
          });
          await loadFacts();
        } catch (err) {
          alert('Failed to add rule: ' + err.message);
        }
      });
    });

    attachFactActionListeners(list);
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. HABITS, BUILDER, VAULT & MAIN MEMORY VIEWS (Grouped Pages)
  // ═══════════════════════════════════════════════════════════════════════
  let items = allMemoryFacts;
  if (activeMemoryCat !== 'all') {
    items = items.filter(f => (f.category || 'main') === activeMemoryCat);
  }

  if (countEl) countEl.textContent = `${items.length} points`;

  if (query) {
    items = items.filter(f => (f.text || '').toLowerCase().includes(query) || (f.sourceTitle || '').toLowerCase().includes(query));
    if (filterCountEl) filterCountEl.textContent = `(${items.length} matching)`;
  } else {
    if (filterCountEl) filterCountEl.textContent = '';
  }

  // Group facts by Page (sourceTitle) & Entity Cards
  const pageMap = new Map();

  if (activeMemoryCat === 'main') {
    cachedSessions.forEach(s => {
      const title = s.title || `Chat ${s.id.slice(-5)}`;
      pageMap.set(title.toLowerCase(), {
        title,
        type: 'chat',
        category: 'main',
        sessionId: s.id,
        facts: [],
      });
    });
  } else if (activeMemoryCat === 'habits') {
    pageMap.set('habits & preferences', {
      title: 'Habits & Preferences',
      type: 'habits',
      category: 'habits',
      facts: [],
    });
  }

  items.forEach(f => {
    const fCat = f.category || 'main';
    const rawTitle = (f.sourceTitle || '').trim();
    const defaultTitle = fCat === 'habits' ? 'Habits & Preferences' : 'General Profile & Background';
    let pageTitle = rawTitle || defaultTitle;
    if (fCat === 'main' && (pageTitle === 'Main Memory' || !rawTitle)) {
      pageTitle = 'General Profile & Background';
    }

    const key = pageTitle.toLowerCase();
    if (!pageMap.has(key)) {
      pageMap.set(key, {
        title: pageTitle,
        type: f.sourceType || 'chat',
        category: fCat,
        sessionId: f.sessionId || null,
        facts: [],
      });
    }
    pageMap.get(key).facts.push(f);
  });

  const pages = Array.from(pageMap.values());

  if (!pages.length) {
    list.innerHTML = `<div class="empty-msg">No chats or memory pages found. Add a point above to start!</div>`;
    return;
  }

  list.innerHTML = `
    <div class="memory-pages-container">
      ${pages.map(page => {
        const pageIcon = getPageIcon(page.type, page.category);
        const hasFacts = page.facts.length > 0;
        return `
          <div class="memory-page-box" data-page-title="${escHtml(page.title)}">
            <div class="memory-page-header">
              <div class="memory-page-title-group">
                <span style="font-size:16px;">${pageIcon}</span>
                <span class="memory-page-title">${escHtml(page.title)}</span>
                <span class="memory-page-type-tag ${page.type}">${escHtml(page.type)}</span>
                <span class="cat-count-pill">${page.facts.length} point${page.facts.length === 1 ? '' : 's'}</span>
              </div>
              <div class="memory-page-actions">
                <button class="btn-small btn-edit-page" data-cat="${activeMemoryCat}" data-page="${escHtml(page.title)}" title="Edit page as document">📝 Edit Page</button>
                <button class="btn-small btn-add-to-page" data-cat="${activeMemoryCat}" data-page="${escHtml(page.title)}" data-session-id="${page.sessionId || ''}" title="Add point to this page" style="background:var(--surface2); border:1px solid var(--border2); color:var(--text);">＋ Add</button>
                <button class="btn-small btn-copy-page" data-page="${escHtml(page.title)}" title="Copy page content" style="background:var(--surface2); border:1px solid var(--border2); color:var(--text);">📋 Copy</button>
              </div>
            </div>
            <div class="memory-page-facts-list">
              ${hasFacts
                ? page.facts.map(f => {
                    const fCat = f.category || 'main';
                    const catMeta = MEMORY_CATEGORIES[fCat] || { icon: '📝', title: 'Main' };
                    return `
                      <div class="fact-item" id="fact-item-${f.id}">
                        <span class="fact-cat-badge" title="Category: ${catMeta.title}">${catMeta.icon}</span>
                        <span class="fact-text" id="fact-text-${f.id}">${escHtml(f.text)}</span>
                        <div class="fact-item-actions" id="fact-actions-${f.id}">
                          <select class="fact-cat-select" data-id="${f.id}" title="Move to another category card">
                            ${Object.keys(MEMORY_CATEGORIES).map(k => `
                              <option value="${k}" ${k === fCat ? 'selected' : ''}>${MEMORY_CATEGORIES[k].icon} ${MEMORY_CATEGORIES[k].title}</option>
                            `).join('')}
                          </select>
                          <button class="fact-edit-btn" data-id="${f.id}" title="Edit this point">✏️</button>
                          <button class="fact-delete" data-id="${f.id}" title="Delete this point">✕</button>
                        </div>
                      </div>
                    `;
                  }).join('')
                : (page.latestSummary
                    ? ''
                    : `<div class="memory-card-preview-empty" style="padding:12px 16px; color:var(--text-muted); font-size:13px;">No explicit memory points saved yet. <a href="javascript:void(0)" class="quick-add-link" data-page="${escHtml(page.title)}" data-session-id="${page.sessionId || ''}" style="color:var(--primary); font-weight:600; text-decoration:underline;">＋ Add key takeaway</a></div>`)
              }
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;


  // Page Action Listeners
  list.querySelectorAll('.btn-edit-page').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDocumentEditor(btn.dataset.cat, btn.dataset.page);
    });
  });

  list.querySelectorAll('.quick-add-link, .btn-add-to-page').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const pageTitle = btn.dataset.page;
      const sessId = btn.dataset.sessionId || null;
      const pointText = prompt(`Add a new memory point to "${pageTitle}":`);
      if (!pointText || !pointText.trim()) return;
      try {
        await apiFetch('/api/memory/facts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: pointText.trim(),
            category: activeMemoryCat !== 'all' ? activeMemoryCat : null,
            sourceTitle: pageTitle,
            sourceType: activeMemoryCat === 'stalker' ? 'stalker' : activeMemoryCat === 'hackathons' ? 'hackathon' : 'chat',
            sessionId: sessId,
          }),
        });
        await loadFacts();
      } catch (err) {
        alert('Failed to add point: ' + err.message);
      }
    });
  });

  list.querySelectorAll('.btn-copy-page').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pageTitle = btn.dataset.page;
      const pageFacts = allMemoryFacts.filter(f => (f.sourceTitle || '').toLowerCase() === pageTitle.toLowerCase());
      const text = pageFacts.map(f => f.text).join('\n');
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = '✅ Copied';
        setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000);
      });
    });
  });

  attachFactActionListeners(list);
}

function attachFactActionListeners(container) {
  if (!container) return;

  // Category relocate select listener
  container.querySelectorAll('.fact-cat-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const factId = sel.dataset.id;
      const newCat = sel.value;
      try {
        await apiFetch(`/api/memory/facts/${factId}/category`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category: newCat }),
        });
        await loadFacts();
      } catch (err) {
        alert('Failed to change category: ' + err.message);
      }
    });
  });

  // Delete listener
  container.querySelectorAll('.fact-delete:not(.btn-delete-stalker-insight):not(.btn-delete-hack-rule)').forEach(btn => {
    btn.addEventListener('click', () => deleteFact(btn.dataset.id));
  });

  // Inline edit listener
  container.querySelectorAll('.fact-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const itemEl = document.getElementById(`fact-item-${id}`);
      const textEl = document.getElementById(`fact-text-${id}`);
      const actionsEl = document.getElementById(`fact-actions-${id}`);
      if (!textEl || !actionsEl || !itemEl) return;
      const currentText = textEl.textContent.trim();

      textEl.style.display = 'none';
      actionsEl.style.display = 'none';

      const editWrap = document.createElement('div');
      editWrap.id = `fact-edit-wrap-${id}`;
      editWrap.style.display = 'flex';
      editWrap.style.gap = '6px';
      editWrap.style.flex = '1';
      editWrap.style.alignItems = 'center';
      editWrap.innerHTML = `
        <input class="fact-edit-input" id="fact-input-${id}" value="${escHtml(currentText)}" />
        <button class="fact-save-btn" id="fact-save-${id}">Save</button>
        <button class="fact-cancel-btn" id="fact-cancel-${id}">Cancel</button>
      `;

      itemEl.appendChild(editWrap);

      const inputEl = document.getElementById(`fact-input-${id}`);
      inputEl.focus();

      const saveEdit = async () => {
        const newText = inputEl.value.trim();
        if (!newText) return;
        try {
          await apiFetch(`/api/memory/facts/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: newText }),
          });
          await loadFacts();
        } catch (err) {
          alert('Failed to update: ' + err.message);
        }
      };

      document.getElementById(`fact-save-${id}`).addEventListener('click', saveEdit);
      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveEdit();
        if (e.key === 'Escape') renderCategoryFactsList();
      });
      document.getElementById(`fact-cancel-${id}`).addEventListener('click', () => {
        editWrap.remove();
        textEl.style.display = '';
        actionsEl.style.display = '';
      });
    });
  });
}

// ── Navigation Listeners ─────────────────────────────────
const backToCardsBtn = document.getElementById('memory-back-to-cards-btn');
if (backToCardsBtn) {
  backToCardsBtn.addEventListener('click', () => {
    showMemorySubview('dashboard');
  });
}

const catFactSearch = document.getElementById('cat-fact-search');
if (catFactSearch) {
  catFactSearch.addEventListener('input', () => {
    renderCategoryFactsList();
  });
}

// Category Tabs Click
const memoryCatTabs = document.getElementById('memory-cat-tabs');
if (memoryCatTabs) {
  memoryCatTabs.querySelectorAll('.cat-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      openCategoryView(btn.dataset.cat);
    });
  });
}

// Add Fact Button
const addFactBtn = document.getElementById('add-fact-btn');
if (addFactBtn) {
  addFactBtn.addEventListener('click', async () => {
    const input = document.getElementById('fact-input');
    let text = input.value.trim();
    if (!text) return;

    // If in habits view and not prefixed, add tag
    if (activeMemoryCat === 'habits' && !text.toLowerCase().startsWith('[habit/preference]')) {
      text = `[Habit/Preference]: ${text}`;
    }

    const defaultTitle = activeMemoryCat === 'stalker' ? 'Stalker Intelligence' : activeMemoryCat === 'hackathons' ? 'Hackathons' : activeMemoryCat === 'habits' ? 'Habits & Preferences' : (currentSession?.title || 'Main Memory');

    try {
      await apiFetch('/api/memory/facts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          category: activeMemoryCat !== 'all' ? activeMemoryCat : null,
          sourceTitle: defaultTitle,
          sourceType: activeMemoryCat === 'stalker' ? 'stalker' : activeMemoryCat === 'hackathons' ? 'hackathon' : 'chat',
          sessionId: currentSession?.id || null,
        }),
      });
      input.value = '';
      await loadFacts();
    } catch (err) {
      alert('Failed to add point: ' + err.message);
    }
  });
}

const factInputEl = document.getElementById('fact-input');
if (factInputEl) {
  factInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const addBtn = document.getElementById('add-fact-btn');
      if (addBtn) addBtn.click();
    }
  });
}

async function deleteFact(id) {
  try {
    await apiFetch(`/api/memory/facts/${id}`, { method: 'DELETE' });
    await loadFacts();
  } catch (err) {
    alert('Failed to delete point: ' + err.message);
  }
}

// ── Full-Page Document Editor ────────────────────────────
function openDocumentEditor(targetCat, pageTitle = null) {
  activeDocEditCat = targetCat || 'habits';
  activeDocEditPage = pageTitle || null;
  showMemorySubview('document');

  const titleEl = document.getElementById('doc-editor-title');
  const textarea = document.getElementById('doc-editor-textarea');

  let targetFacts = allMemoryFacts;
  let catTitle = 'All Memory Database';

  if (activeDocEditPage) {
    catTitle = `📄 Page: ${activeDocEditPage}`;
    targetFacts = allMemoryFacts.filter(f => (f.sourceTitle || '').toLowerCase() === activeDocEditPage.toLowerCase());
  } else if (activeDocEditCat !== 'all') {
    const cat = MEMORY_CATEGORIES[activeDocEditCat] || { title: activeDocEditCat, icon: '📝' };
    catTitle = `${cat.icon} ${cat.title}`;
    targetFacts = allMemoryFacts.filter(f => (f.category || 'main') === activeDocEditCat);
  }

  if (titleEl) titleEl.textContent = `📝 Document Editor: ${catTitle}`;

  // Populate textarea with plain lines
  const lines = targetFacts.map(f => f.text || '').filter(Boolean);
  textarea.value = lines.join('\n');

  updateDocStats();
  textarea.focus();
}

function updateDocStats() {
  const textarea = document.getElementById('doc-editor-textarea');
  const linesEl  = document.getElementById('doc-stats-lines');
  const charsEl  = document.getElementById('doc-stats-chars');

  if (!textarea) return;
  const content = textarea.value;
  const lines = content.split('\n').filter(l => l.trim().length > 0);

  if (linesEl) linesEl.textContent = `Lines/Points: ${lines.length}`;
  if (charsEl) charsEl.textContent = `Characters: ${content.length}`;
}

const docTextarea = document.getElementById('doc-editor-textarea');
if (docTextarea) {
  docTextarea.addEventListener('input', updateDocStats);
}

// Document Editor Back Button
const docBackBtn = document.getElementById('doc-back-btn');
if (docBackBtn) {
  docBackBtn.addEventListener('click', () => {
    if (activeDocEditCat === 'all' && !activeDocEditPage) {
      showMemorySubview('dashboard');
    } else {
      openCategoryView(activeDocEditCat);
    }
  });
}

// Document Copy Button
const docCopyBtn = document.getElementById('doc-copy-btn');
if (docCopyBtn) {
  docCopyBtn.addEventListener('click', () => {
    const textarea = document.getElementById('doc-editor-textarea');
    const toast = document.getElementById('doc-copy-toast');
    if (!textarea) return;

    navigator.clipboard.writeText(textarea.value).then(() => {
      if (toast) {
        toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 2500);
      }
    }).catch(err => {
      alert('Copy failed: ' + err.message);
    });
  });
}

// Document Clean Lines Button
const docCleanBtn = document.getElementById('doc-clean-btn');
if (docCleanBtn) {
  docCleanBtn.addEventListener('click', () => {
    const textarea = document.getElementById('doc-editor-textarea');
    if (!textarea) return;
    const cleanLines = textarea.value
      .split(/\r?\n/)
      .map(l => l.replace(/^[-*•\d.)\s]+/, '').trim())
      .filter(l => l.length > 0);
    textarea.value = cleanLines.join('\n');
    updateDocStats();
  });
}

// Document Save Button
const docSaveBtn = document.getElementById('doc-save-btn');
if (docSaveBtn) {
  docSaveBtn.addEventListener('click', async () => {
    const textarea = document.getElementById('doc-editor-textarea');
    if (!textarea) return;

    docSaveBtn.disabled = true;
    docSaveBtn.textContent = '⏳ Saving All Points…';

    const points = textarea.value
      .split(/\r?\n/)
      .map(l => l.replace(/^[-*•\d.)\s]+/, '').trim())
      .filter(l => l.length > 0);

    try {
      if (activeDocEditPage) {
        await apiFetch('/api/memory/page', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: activeDocEditCat !== 'all' ? activeDocEditCat : 'main',
            sourceTitle: activeDocEditPage,
            sourceType: activeDocEditCat === 'stalker' ? 'stalker' : activeDocEditCat === 'hackathons' ? 'hackathon' : 'chat',
            points,
          }),
        });
      } else if (activeDocEditCat === 'all') {
        await apiFetch('/api/memory/bulk-category', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category: 'main', points }),
        });
      } else {
        await apiFetch('/api/memory/bulk-category', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category: activeDocEditCat, points }),
        });
      }

      await loadFacts();
      docSaveBtn.textContent = '✅ Saved Successfully!';

      setTimeout(() => {
        docSaveBtn.disabled = false;
        docSaveBtn.textContent = '💾 Save All Changes';
        if (activeDocEditCat === 'all' && !activeDocEditPage) {
          showMemorySubview('dashboard');
        } else {
          openCategoryView(activeDocEditCat);
        }
      }, 1000);
    } catch (err) {
      docSaveBtn.disabled = false;
      docSaveBtn.textContent = '💾 Save All Changes';
      alert('Save failed: ' + err.message);
    }
  });
}

// Category Detail Bulk Edit & Copy All Buttons
const catDocEditBtn = document.getElementById('cat-doc-edit-btn');
if (catDocEditBtn) {
  catDocEditBtn.addEventListener('click', () => {
    openDocumentEditor(activeMemoryCat);
  });
}

const catCopyAllBtn = document.getElementById('cat-copy-all-btn');
if (catCopyAllBtn) {
  catCopyAllBtn.addEventListener('click', () => {
    copyCategoryFacts(activeMemoryCat, catCopyAllBtn);
  });
}

function copyCategoryFacts(catKey, triggerBtn) {
  let facts = allMemoryFacts;
  if (catKey !== 'all') {
    facts = facts.filter(f => (f.category || 'main') === catKey);
  }
  const text = facts.map(f => f.text || '').filter(Boolean).join('\n');
  navigator.clipboard.writeText(text).then(() => {
    const orig = triggerBtn ? triggerBtn.textContent : '';
    if (triggerBtn) {
      triggerBtn.textContent = '✅ Copied!';
      setTimeout(() => { triggerBtn.textContent = orig; }, 2000);
    }
  }).catch(err => {
    alert('Copy failed: ' + err.message);
  });
}

// ═══════════════════════════════════════════════════════
// FILE VAULT & STORAGE WORKSPACE
// ═══════════════════════════════════════════════════════

let allUploadedFiles = [];
let activeFileFilter = 'all';
let activePreviewFile = null;

function getFileExtension(filename) {
  const parts = String(filename || '').split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

function getFileIcon(filename, resourceType) {
  const ext = getFileExtension(filename);
  if (['pdf'].includes(ext)) return '📄';
  if (['doc', 'docx'].includes(ext)) return '📝';
  if (['xls', 'xlsx', 'csv', 'tsv'].includes(ext)) return '📊';
  if (['ppt', 'pptx'].includes(ext)) return '📑';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'ico'].includes(ext) || resourceType === 'image') return '🖼️';
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac'].includes(ext)) return '🎵';
  if (['mp4', 'webm', 'mov', 'mkv'].includes(ext) || resourceType === 'video') return '🎬';
  if (['js', 'ts', 'jsx', 'tsx', 'py', 'cpp', 'c', 'java', 'cs', 'go', 'rs', 'php', 'swift', 'kt', 'sql', 'sh', 'bash', 'css', 'html', 'json', 'xml', 'yaml', 'yml'].includes(ext)) return '💻';
  if (['txt', 'md', 'toml'].includes(ext)) return '📋';
  return '📁';
}

function getFileCategory(filename, resourceType) {
  const ext = getFileExtension(filename);
  if (['pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt', 'md'].includes(ext)) return 'docs';
  if (['xls', 'xlsx', 'csv', 'tsv'].includes(ext)) return 'sheets';
  if (['js', 'ts', 'jsx', 'tsx', 'py', 'cpp', 'c', 'java', 'cs', 'go', 'rs', 'php', 'swift', 'kt', 'sql', 'sh', 'bash', 'css', 'html', 'json', 'xml', 'yaml', 'yml'].includes(ext)) return 'code';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp3', 'wav', 'ogg', 'm4a', 'mp4', 'webm', 'mov'].includes(ext) || resourceType === 'image' || resourceType === 'video') return 'media';
  return 'docs';
}

async function loadFiles() {
  const totalEl    = document.getElementById('file-stat-total');
  const storageEl  = document.getElementById('file-stat-storage');
  const countAllEl = document.getElementById('tab-count-all');
  const readableEl = document.getElementById('file-stat-readable');
  const assetsEl   = document.getElementById('file-stat-assets');

  try {
    const { files } = await apiFetch('/api/files');
    allUploadedFiles = files || [];

    const readableCount = allUploadedFiles.filter(f => f.textExtracted).length;
    const assetsCount   = allUploadedFiles.length - readableCount;

    if (totalEl)    totalEl.textContent    = allUploadedFiles.length;
    if (countAllEl) countAllEl.textContent = allUploadedFiles.length;
    if (readableEl) readableEl.textContent = readableCount;
    if (assetsEl)   assetsEl.textContent   = assetsCount;

    const totalBytes = allUploadedFiles.reduce((acc, f) => acc + (Number(f.sizeBytes) || 0), 0);
    if (storageEl) storageEl.textContent = formatBytes(totalBytes);

    renderFilesGrid();
  } catch (err) {
    const grid = document.getElementById('files-grid-list');
    if (grid) grid.innerHTML = `<div class="empty-msg">Error loading files: ${err.message}</div>`;
  }
}


function renderFilesGrid() {
  const grid = document.getElementById('files-grid-list');
  const searchInput = document.getElementById('file-vault-search');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

  if (!grid) return;

  let items = allUploadedFiles;

  if (activeFileFilter !== 'all') {
    items = items.filter(f => getFileCategory(f.originalName || f.publicId, f.resourceType) === activeFileFilter);
  }

  if (query) {
    items = items.filter(f => {
      const name = (f.originalName || f.publicId || '').toLowerCase();
      const ext  = (f.extractedText || '').toLowerCase();
      return name.includes(query) || ext.includes(query);
    });
  }

  if (!items.length) {
    grid.innerHTML = '<div class="empty-msg" style="grid-column: 1 / -1;">No files found matching your filter. Upload one above!</div>';
    return;
  }

  grid.innerHTML = items.map(f => {
    const name = f.originalName || f.publicId || 'Untitled File';
    const ext  = getFileExtension(name);
    const icon = getFileIcon(name, f.resourceType);
    const size = formatBytes(f.sizeBytes || 0);
    const date = f.createdAt ? new Date(f.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    const snippet = f.extractedText ? f.extractedText.slice(0, 120).trim() : '';

    const usefulBadge = f.textExtracted
      ? `<span class="file-card-badge file-card-badge--useful">🤖 AI-Readable</span>`
      : `<span class="file-card-badge file-card-badge--media">📦 Asset</span>`;
    const extBadge = ext ? `<span class="file-card-ext-badge">.${ext.toUpperCase()}</span>` : '';

    return `
      <div class="file-card" id="file-card-${f.id}">
        <div class="file-card-body">
          <div class="file-card-top">
            <div class="file-card-icon-box">${icon}</div>
            <div style="flex:1; min-width:0;">
              <div class="file-card-name" title="${escHtml(name)}">${escHtml(name)}</div>
              <div class="file-card-meta">
                ${extBadge}
                <span>${size}</span>
                <span>•</span>
                <span>${date}</span>
              </div>
              <div class="file-card-badges">${usefulBadge}</div>
            </div>
          </div>
          ${snippet ? `<div class="file-card-preview-snippet">${escHtml(snippet)}…</div>` : ''}
        </div>
        <div class="file-card-actions">
          <button class="file-action-btn file-action-btn--open" data-open-id="${f.id}" title="Open file in browser">
            <span class="file-action-icon">🌐</span><span class="file-action-label">Open</span>
          </button>
          <button class="file-action-btn file-action-btn--download" data-download-id="${f.id}" title="Download file">
            <span class="file-action-icon">⬇️</span><span class="file-action-label">Download</span>
          </button>
          <button class="file-action-btn file-action-btn--delete" data-delete-id="${f.id}" title="Delete permanently">
            <span class="file-action-icon">🗑️</span><span class="file-action-label">Delete</span>
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Attach Open listeners (Streams file directly with inline disposition so PDFs render natively)
  grid.querySelectorAll('[data-open-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await openStoredFile(btn.dataset.openId, 'view');
    });
  });

  // Attach Download listeners (Streams file directly with attachment disposition)
  grid.querySelectorAll('[data-download-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await openStoredFile(btn.dataset.downloadId, 'download');
    });
  });

  // Attach delete listeners
  grid.querySelectorAll('[data-delete-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const file = allUploadedFiles.find(f => f.id === btn.dataset.deleteId);
      if (file) deleteUploadedFile(file.id, file.originalName || 'file');
    });
  });

  // BUGFIX: openFilePreviewModal() existed but nothing ever called it, so
  // clicking a file card's name/icon/snippet did absolutely nothing — the whole
  // preview modal was unreachable dead code. Wire the card body to it.
  grid.querySelectorAll('.file-card-body').forEach(body => {
    body.addEventListener('click', () => {
      const card = body.closest('.file-card');
      if (!card) return;
      const id = card.id.replace(/^file-card-/, '');
      const file = allUploadedFiles.find(f => f.id === id);
      if (file) openFilePreviewModal(file);
    });
  });
}

/**
 * BUGFIX — this is the main reason "files don't open".
 *
 * Open/Download used to inline the module-level `idToken` into the URL. That
 * variable is set once at login and only refreshed by a 50-minute setInterval,
 * which the browser suspends on background/sleeping tabs. Firebase ID tokens
 * expire after 60 minutes, so the very common case — leave the app open, come
 * back later, click Open — produced a brand new tab containing the raw text
 * `{"error":"Invalid or expired token"}`. Unlike every other request, these two
 * paths bypassed apiFetch(), so they never got its 401-refresh-and-retry.
 *
 * Minting a fresh token immediately before navigating removes the whole class of
 * failure. getIdToken() serves the cached token when it is still valid and
 * silently refreshes it when it is not, so this is cheap.
 */
async function freshIdToken() {
  const user = (auth && auth.currentUser) ? auth.currentUser : currentUser;
  if (!user) throw new Error('You are signed out. Please sign in again.');
  const token = await user.getIdToken();
  // Keep the shared variable in sync so other callers benefit too.
  idToken = token;
  return token;
}

/**
 * Opens (mode 'view') or downloads (mode 'download') a stored file through the
 * authenticated proxy route, always with a freshly-minted token.
 */
async function openStoredFile(fileId, mode) {
  if (!fileId) return;
  try {
    const token = await freshIdToken();
    const url = `${API}/api/files/${encodeURIComponent(fileId)}/${mode}?token=${encodeURIComponent(token)}`;

    if (mode === 'download') {
      triggerDownload(url);
    } else {
      const win = window.open(url, '_blank', 'noopener');
      if (!win) alert('Your browser blocked the new tab. Please allow pop-ups for this site.');
    }
  } catch (err) {
    alert(`Could not open the file: ${err.message}`);
  }
}

// ── File Preview Modal ───────────────────────────────────
function openFilePreviewModal(file) {
  activePreviewFile = file;
  const modal = document.getElementById('file-preview-modal');
  const iconEl = document.getElementById('modal-file-icon');
  const nameEl = document.getElementById('modal-file-name');
  const metaEl = document.getElementById('modal-file-meta');
  const statusEl = document.getElementById('modal-extract-status');
  const bodyEl = document.getElementById('modal-preview-body');
  const dlLink = document.getElementById('modal-download-link');
  const openLink = document.getElementById('modal-open-link');

  if (!modal) return;

  const name = file.originalName || file.publicId || 'File Preview';
  const icon = getFileIcon(name, file.resourceType);
  const size = formatBytes(file.sizeBytes || 0);
  const date = file.createdAt ? new Date(file.createdAt).toLocaleString() : '';

  if (iconEl) iconEl.textContent = icon;
  if (nameEl) nameEl.textContent = name;
  if (metaEl) metaEl.textContent = `${file.resourceType || 'file'} · ${size} · Uploaded ${date}`;

  if (statusEl) {
    if (file.textExtracted) {
      statusEl.textContent = `✅ Text content extracted & accessible in Bob's AI memory`;
      statusEl.style.color = 'var(--green)';
    } else {
      statusEl.textContent = `ℹ️ Binary / Media asset`;
      statusEl.style.color = 'var(--text3)';
    }
  }

  // BUGFIX: these used to be `dlLink.href = file.url` with no guard, so a record
  // missing a url produced href="undefined" and a 404. They also pointed at the
  // raw public Cloudinary URL, where `download` is ignored (cross-origin) and the
  // asset has no file extension, so the browser got octet-stream with no
  // filename. They are now <button> elements routed through our authenticated
  // proxy, which sets a proper Content-Type and Content-Disposition.
  if (dlLink) {
    dlLink.onclick = () => openStoredFile(file.id, 'download');
  }
  if (openLink) {
    openLink.onclick = () => openStoredFile(file.id, 'view');
  }

  // Populate preview body
  if (bodyEl) {
    const ext = getFileExtension(name);
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'ico'].includes(ext) || file.resourceType === 'image') {
      // escHtml the URL — it lands inside a quoted attribute.
      bodyEl.innerHTML = file.url
        ? `<img src="${escHtml(file.url)}" alt="${escHtml(name)}" />`
        : `<div style="padding:40px 20px; text-align:center; color:var(--text3);">Image preview unavailable (no stored URL).</div>`;
    } else if (file.extractedText) {
      const shownChars = file.extractedText.length;
      // listFiles() returns only the first slice of long documents, so report the
      // real total rather than implying the snippet is the whole file.
      const totalChars = typeof file.extractedTextLength === 'number' ? file.extractedTextLength : shownChars;
      const note = file.extractedTextTruncated
        ? `📄 Extracted content — showing first ${shownChars.toLocaleString()} of ${totalChars.toLocaleString()} characters`
        : `📄 Extracted Document Content (${totalChars.toLocaleString()} characters)`;
      bodyEl.innerHTML = `
        <div style="margin-bottom:8px; font-size:12px; color:var(--text3);">${escHtml(note)}</div>
        <div class="file-preview-text-block">${escHtml(file.extractedText)}</div>
      `;
    } else {
      const reason = file.extractionError
        ? escHtml(file.extractionError)
        : 'This file type does not support direct text preview. You can open it in a new browser tab or download it directly.';
      bodyEl.innerHTML = `
        <div style="text-align:center; padding: 40px 20px; color:var(--text2);">
          <div style="font-size:48px; margin-bottom:12px;">${icon}</div>
          <div style="font-size:15px; font-weight:600; margin-bottom:6px;">${escHtml(name)}</div>
          <p style="font-size:13px; color:var(--text3); max-width:400px; margin:0 auto 16px;">${reason}</p>
          <button type="button" class="btn-small btn-accent" id="modal-body-open-btn">🌐 Open in Browser</button>
        </div>
      `;
      const bodyOpenBtn = document.getElementById('modal-body-open-btn');
      if (bodyOpenBtn) bodyOpenBtn.addEventListener('click', () => openStoredFile(file.id, 'view'));
    }
  }

  modal.classList.remove('hidden');
}

function closeFilePreviewModal() {
  const modal = document.getElementById('file-preview-modal');
  if (modal) modal.classList.add('hidden');
  activePreviewFile = null;
}

const modalCloseBtn = document.getElementById('modal-preview-close');
if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeFilePreviewModal);

const modalBackdrop = document.getElementById('file-preview-backdrop');
if (modalBackdrop) modalBackdrop.addEventListener('click', closeFilePreviewModal);

const modalDeleteBtn = document.getElementById('modal-delete-btn');
if (modalDeleteBtn) {
  modalDeleteBtn.addEventListener('click', () => {
    if (activePreviewFile) {
      deleteUploadedFile(activePreviewFile.id, activePreviewFile.originalName || 'file');
    }
  });
}

// ── Delete File Handler ──────────────────────────────────
async function deleteUploadedFile(fileId, fileName) {
  if (!confirm(`Are you sure you want to delete "${fileName}"?\nThis will remove it from Bob's storage permanently.`)) {
    return;
  }
  try {
    await apiFetch(`/api/files/${fileId}`, { method: 'DELETE' });
    closeFilePreviewModal();
    await loadFiles();
  } catch (err) {
    alert('Failed to delete file: ' + err.message);
  }
}

// ── Search & Filter Tabs Listeners ───────────────────────
const fileVaultSearch = document.getElementById('file-vault-search');
if (fileVaultSearch) {
  fileVaultSearch.addEventListener('input', () => renderFilesGrid());
}

const fileFilterTabs = document.getElementById('file-filter-tabs');
if (fileFilterTabs) {
  fileFilterTabs.querySelectorAll('.file-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      fileFilterTabs.querySelectorAll('.file-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFileFilter = btn.dataset.filter || 'all';
      renderFilesGrid();
    });
  });
}

const fileVaultRefreshBtn = document.getElementById('file-vault-refresh-btn');
if (fileVaultRefreshBtn) {
  fileVaultRefreshBtn.addEventListener('click', () => loadFiles());
}

// ── Upload Handlers ──────────────────────────────────────
const fileVaultUploadInput = document.getElementById('file-vault-upload-input');
const fileVaultUploadBtn   = document.getElementById('file-vault-upload-btn');
const dropzoneSelectBtn    = document.getElementById('dropzone-select-btn');
const fileDropzone         = document.getElementById('file-dropzone');
const dropzoneProgress     = document.getElementById('dropzone-upload-progress');

if (fileVaultUploadBtn && fileVaultUploadInput) {
  fileVaultUploadBtn.addEventListener('click', () => fileVaultUploadInput.click());
}

if (dropzoneSelectBtn && fileVaultUploadInput) {
  dropzoneSelectBtn.addEventListener('click', () => fileVaultUploadInput.click());
}

async function handleFileUploadProcess(file) {
  if (!file) return;
  if (dropzoneProgress) dropzoneProgress.classList.remove('hidden');

  try {
    const uploaded = await uploadFileRecord(file);
    if (uploaded) {
      await loadFiles();
    }
  } catch (err) {
    alert('Upload error: ' + err.message);
  } finally {
    if (dropzoneProgress) dropzoneProgress.classList.add('hidden');
    if (fileVaultUploadInput) fileVaultUploadInput.value = '';
  }
}

if (fileVaultUploadInput) {
  fileVaultUploadInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleFileUploadProcess(file);
  });
}

// Drag and drop on dropzone
if (fileDropzone) {
  fileDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    fileDropzone.classList.add('dragover');
  });

  fileDropzone.addEventListener('dragleave', () => {
    fileDropzone.classList.remove('dragover');
  });

  fileDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    fileDropzone.classList.remove('dragover');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFileUploadProcess(file);
  });
}

// ═══════════════════════════════════════════════════════
// SIDEBAR TOGGLE & RESPONSIVE MOBILE DRAWER
// ═══════════════════════════════════════════════════════

const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');

function closeMobileSidebar() {
  if (sidebar) {
    sidebar.classList.remove('mobile-open');
  }
  if (sidebarOverlay) {
    sidebarOverlay.classList.remove('active');
  }
}
window.closeMobileSidebar = closeMobileSidebar;

function toggleSidebar() {
  if (!sidebar) return;
  if (window.innerWidth <= 768) {
    const isOpen = sidebar.classList.toggle('mobile-open');
    if (sidebarOverlay) sidebarOverlay.classList.toggle('active', isOpen);
  } else {
    sidebar.classList.toggle('collapsed');
  }
}

document.getElementById('sidebar-toggle')?.addEventListener('click', toggleSidebar);

if (sidebarOverlay) {
  sidebarOverlay.addEventListener('click', closeMobileSidebar);
}

// ── Workspace Mobile Segmented Tabs (<= 1024px) ─────────
function setWorkspaceTab(viewName, tabName) {
  const viewEl = document.getElementById(`view-${viewName}`);
  if (!viewEl) return;
  const ws = viewEl.querySelector('.hack-workspace');
  if (ws) ws.dataset.activeTab = tabName;
  const tabBtns = viewEl.querySelectorAll('.ws-mobile-tabs .ws-tab-btn');
  tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
}

document.querySelectorAll('#hack-mobile-tabs .ws-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => setWorkspaceTab('hackathons', btn.dataset.tab));
});

document.querySelectorAll('#stalk-mobile-tabs .ws-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => setWorkspaceTab('stalking', btn.dataset.tab));
});

// ── Workspace Left-Panel Toggles (☰ next to workspace title) ──────────────
document.getElementById('hack-panel-toggle')?.addEventListener('click', () => {
  document.querySelector('#view-hackathons .hack-workspace')?.classList.toggle('list-collapsed');
});
document.getElementById('stalk-panel-toggle')?.addEventListener('click', () => {
  document.querySelector('#view-stalking .hack-workspace')?.classList.toggle('list-collapsed');
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
  const titleEl = document.querySelector('#view-hq .view-title');
  const subEl = document.querySelector('#view-hq .view-sub');

  // ── Builder HQ: totally separate from Bob HQ ──
  // Builder persona me koi Bob card nahi dikhega. Builder ke apne cards yahan
  // render hote hain (proper working setup, ek-ek karke banenge).
  if (currentPersona === 'builder') {
    if (titleEl) titleEl.textContent = '🏗️ Builder HQ';
    if (subEl) subEl.textContent = 'Builder workspace — development tools aur audiences ke cards.';

    const builderCards = [
      hqCard({ id: 'seo', icon: '🔍', title: 'SEO Working', color: 'amber', badge: 'V1', meta: 'website audit · score · fix recommendations', items: [], action: '' }),
    ];

    grid.innerHTML = `<div class="hq-grid-inner">${builderCards.join('')}</div>`;
    grid.querySelectorAll('[data-open]').forEach(card => {
      card.addEventListener('click', () => openHqCard(card.dataset.open));
    });
    return;
  }

  if (titleEl) titleEl.textContent = '🏠 Bob HQ';
  if (subEl) subEl.textContent = 'Interconnected headquarters — saare modules ek nazar me, har ek ka apna alag mind.';

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
  const hacks = c.hackathons || {};
  const stalks = c.stalking || {};
  const routs = c.routines || {};
  const facts = c.facts || [];
  const files = c.files || [];
  const months = c.months || [];

  const cards = [
    hqCard({ id: 'keys', icon: '🔑', title: 'Keys Limit', color: 'amber', badge: 'OpenRouter', meta: 'key health · auto-refresh', items: [], action: 'Open Keys Management' }),
    hqCard({ id: 'hackathons', icon: '🏆', title: 'Hackathons', color: (hacks.active || 0) > 0 ? 'green' : 'amber', badge: `${hacks.count || 0}`, meta: `active ${hacks.active || 0} · tracking ${hacks.tracking || 0} · 🟢 ${hacks.participating || 0}`, items: (hacks.items || []).slice(0, 3).map(h => ({ text: h.title, sub: `${h.status} · ${fmtDate(h.endDate)}`, dot: h.statusColor })), action: 'Open Hackathon Workspace' }),
    hqCard({ id: 'stalking', icon: '🕵️', title: 'Stalking', color: (stalks.researching || 0) > 0 ? 'amber' : 'green', badge: `${stalks.count || 0}`, meta: `ready ${stalks.ready || 0} · researching ${stalks.researching || 0}`, items: (stalks.items || []).slice(0, 3).map(s => ({ text: s.name, sub: s.status, dot: s.status === 'ready' ? 'green' : (s.status === 'researching' ? 'amber' : 'grey') })), action: 'Open Stalking Workspace' }),
    hqCard({ id: 'routines', icon: '⏰', title: 'Routines', color: (routs.dueSoon || 0) > 0 ? 'green' : 'amber', badge: `${routs.active || 0} active`, meta: `total ${routs.count || 0} · due soon ${routs.dueSoon || 0}`, items: (routs.items || []).slice(0, 3).map(r => ({ text: r.title, sub: `${r.workspace || ''} · every ${r.intervalHours}h`, dot: r.active ? 'green' : 'grey' })), action: 'Open Routines Engine' }),
    hqCard({ id: 'vault', icon: '🔒', title: 'Secret Vault', color: 'amber', badge: 'private', meta: 'PIN protected · spacious workspace', items: [], action: 'Open Secret Vault' }),
    hqCard({ id: 'memory', icon: '🧠', title: 'Memory', color: 'green', badge: `${facts.length} facts`, meta: `months ${months.length}`, items: facts.slice(0, 3).map(f => ({ text: f.text, sub: '', dot: 'green' })), action: 'Open Memory Workspace' }),
    hqCard({ id: 'files', icon: '📁', title: 'Files', color: 'grey', badge: `${files.length}`, meta: 'uploaded files', items: files.slice(0, 3).map(f => ({ text: f.filename || f.id, sub: '', dot: 'grey' })), action: 'Open Files Workspace' }),
    hqCard({ id: 'live', icon: '📈', title: 'Live Pulse', color: 'green', badge: 'live', meta: 'weather · news · stocks', items: [], action: 'Open Live' }),
    hqCard({ id: 'builder', icon: '🏗️', title: 'Bob the Builder', color: 'amber', badge: collabMode ? 'ON' : 'off', meta: 'Builder collaboration · plan-confirm first', items: [], action: 'Start new project' }),
  ];

  grid.innerHTML = `<div class="hq-grid-inner">${cards.join('')}</div>`;

  grid.querySelectorAll('[data-open]').forEach(card => {
    card.addEventListener('click', () => openHqCard(card.dataset.open));
  });
}

function openHqCard(id) {
  if (id === 'keys') {
    showView('keys');
    loadKeys();
    if (keysRefreshTimer) clearInterval(keysRefreshTimer);
    keysRefreshTimer = setInterval(loadKeys, 60000);
    return;
  }
  if (id === 'vault') { openVaultPanel(); return; }
  if (id === 'memory') { showView('memory'); showMemorySubview('dashboard'); loadFacts(); loadMonthlyFiles(); return; }
  if (id === 'files') { showView('files'); loadFiles(); return; }
  if (id === 'builder') { startBobBuilderCollab(); return; }
  if (id === 'hackathons') { showView('hackathons'); loadHackathons(); return; }
  if (id === 'stalking') { showView('stalking'); loadStalking(); return; }
  if (id === 'seo') { showView('seo'); loadSeoSites(); return; }
  if (id === 'routines') { showView('routines'); loadRoutines(); return; }
  if (id === 'live') { showView('live'); loadLive(); return; }
  if (id === 'hq') { showView('hq'); loadHQSummary(); return; }
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
  const tabCountEl = document.getElementById('hack-tab-count');
  if (tabCountEl) tabCountEl.textContent = hackathonsCache.length;
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

  // On mobile/tablet screens, auto switch to chat tab if currently on list
  if (window.innerWidth <= 1024) {
    const ws = document.querySelector('#view-hackathons .hack-workspace');
    if (ws && ws.dataset.activeTab === 'list') {
      setWorkspaceTab('hackathons', 'chat');
    }
  }

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
    ${k.eligibility && String(k.eligibility).trim() ? `<div class="ws-kb-block"><div class="ws-kb-label">🎓 Eligibility</div><div>${escHtml(Array.isArray(k.eligibility) ? k.eligibility.join(', ') : k.eligibility)}</div></div>` : ''}
    ${k.teamSize ? `<div class="ws-kb-block"><div class="ws-kb-label">👥 Team Size</div><div>${escHtml(k.teamSize)}</div></div>` : ''}
    ${k.winners && String(k.winners).trim() ? `<div class="ws-kb-block"><div class="ws-kb-label">🏅 Past Winners</div><div>${escHtml(Array.isArray(k.winners) ? k.winners.join(', ') : k.winners)}</div></div>` : ''}
    ${(k.links || []).length ? `<div class="ws-kb-block"><div class="ws-kb-label">🔗 Sources</div><div>${k.links.map(l => `<a href="${escHtml(l)}" target="_blank" rel="noopener">${escHtml(l)}</a>`).join('<br/>')}</div></div>` : ''}
    ${k.fromText ? `<div style="font-size:11px;color:var(--text3);margin-top:4px;">📋 Updated from pasted text</div>` : ''}
    ${k.scrapedAt ? `<div style="font-size:11px;color:var(--text3);">🕐 Last updated: ${new Date(k.scrapedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}</div>` : ''}
    <button class="btn-small" id="re-scrape-hack" style="width:100%;margin-top:8px;">🔄 Re-scrape Knowledge</button>
    <button class="btn-small" id="paste-knowledge-btn" style="width:100%;margin-top:4px;opacity:0.85;">📋 Paste Announcement → Update</button>
  `;

  // ── Re-scrape button ──────────────────────────────────────────
  const rs = document.getElementById('re-scrape-hack');
  if (rs) rs.addEventListener('click', async () => {
    const hackId = h.id;
    rs.disabled = true; rs.textContent = '⏳ Scraping…';
    const safetyTimer = setTimeout(() => {
      const btn = document.getElementById('re-scrape-hack');
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Re-scrape Knowledge'; }
    }, 30000);
    try {
      // Use the response directly — no need to reload everything
      const { hackathon: updated } = await apiFetch(`/api/hackathons/${hackId}/scrape`, { method: 'POST' });
      clearTimeout(safetyTimer);
      // Update cache + currentHack + re-render panel in-place
      const idx = hackathonsCache.findIndex(x => String(x.id) === String(hackId));
      if (idx !== -1) hackathonsCache[idx] = updated;
      if (currentHack && String(currentHack.id) === String(hackId)) currentHack = updated;
      renderHackKnowledge(updated); // ← re-render panel immediately with fresh data
    } catch (err) {
      clearTimeout(safetyTimer);
      alert('Scrape failed: ' + err.message);
      const btn = document.getElementById('re-scrape-hack');
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Re-scrape Knowledge'; }
    }
  });

  // ── Paste-text → knowledge button ────────────────────────────
  const pb = document.getElementById('paste-knowledge-btn');
  if (pb) pb.addEventListener('click', () => {
    const hackId = h.id;
    openModal('📋 Paste Announcement → Update Knowledge', `
      <div class="modal-form">
        <p style="font-size:12px;color:var(--text2);margin:0 0 8px;">WhatsApp / LinkedIn / website se hackathon announcement paste karo — Bob knowledge panel update kar dega bina scraping ke!</p>
        <textarea id="paste-kb-text" rows="8" placeholder="🚀 ViCodathon 2026...&#10;Prize ₹20,000&#10;Aug 7-9 2026..."></textarea>
        <button id="paste-kb-submit" class="btn-primary" style="width:100%;">⚡ Update Knowledge</button>
      </div>
    `);
    document.getElementById('paste-kb-submit').addEventListener('click', async () => {
      const rawText = document.getElementById('paste-kb-text').value.trim();
      if (!rawText) { alert('Kuch paste karo pehle!'); return; }
      const btn = document.getElementById('paste-kb-submit');
      btn.disabled = true; btn.textContent = '⏳ Parsing…';
      try {
        const { hackathon: updated } = await apiFetch(`/api/hackathons/${hackId}/knowledge-from-text`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: rawText })
        });
        closeModal();
        const idx = hackathonsCache.findIndex(x => String(x.id) === String(hackId));
        if (idx !== -1) hackathonsCache[idx] = updated;
        if (currentHack && String(currentHack.id) === String(hackId)) currentHack = updated;
        renderHackKnowledge(updated);
      } catch (err) {
        alert('Failed: ' + err.message);
        btn.disabled = false; btn.textContent = '⚡ Update Knowledge';
      }
    });
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
  let text = input.value.trim();
  const fileToUpload = pendingHackFile || pendingHackPasteImage;
  if (!text && !fileToUpload) return;

  if (fileToUpload) {
    const uploadedRecord = await uploadFileRecord(fileToUpload);
    if (uploadedRecord) {
      const fileName = uploadedRecord.originalName || fileToUpload.name || 'file';
      const fileUrl = uploadedRecord.url || '';
      const extracted = uploadedRecord.extractedText ? `\n\n[File Content: ${uploadedRecord.extractedText.slice(0, 3000)}]` : '';
      text = text ? `📄 Attached File: ${fileName} (${fileUrl})\n${text}${extracted}` : `📄 Attached File: ${fileName} (${fileUrl})${extracted}`;
    }
    clearPendingHackFile();
    clearPastedHackImage();
  }

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
// SEO WORKSPACE (3-col)
// ═══════════════════════════════════════════════════════

let seoSitesCache = [];
let currentSeoSite = null;

function seoScoreColor(score) {
  if (typeof score !== 'number') return '#888';
  if (score >= 70) return '#4ade80';
  if (score >= 50) return '#fbbf24';
  return '#f87171';
}

function seoScoreClass(score) {
  if (typeof score !== 'number') return 'grey';
  if (score >= 70) return 'green';
  if (score >= 50) return 'amber';
  return 'grey';
}

async function loadSeoSites() {
  try {
    const { sites } = await apiFetch('/api/seo');
    seoSitesCache = sites || [];
  } catch (err) {
    console.error('loadSeoSites error:', err);
    seoSitesCache = [];
  }
  renderSeoList();
  if (seoSitesCache.length) {
    if (!currentSeoSite || !seoSitesCache.some(s => String(s.id) === String(currentSeoSite.id))) {
      await selectSeo(seoSitesCache[0].id);
    } else {
      await selectSeo(currentSeoSite.id);
    }
  } else {
    resetSeoChat();
  }
}

function renderSeoList() {
  const tabCountEl = document.getElementById('seo-tab-count');
  if (tabCountEl) tabCountEl.textContent = seoSitesCache.length;
  const list = document.getElementById('seo-list');
  if (!seoSitesCache.length) {
    list.innerHTML = `<div class="empty-msg">🔍 Abhi koi website add nahi hui. Upar URL daal kar basic SEO audit chalao.</div>`;
    return;
  }
  list.innerHTML = seoSitesCache.map(s => {
    const score = s.lastScore;
    const sel = currentSeoSite && String(currentSeoSite.id) === String(s.id) ? ' selected' : '';
    const dot = typeof score !== 'number' ? 'grey' : score >= 70 ? 'green' : score >= 50 ? 'amber' : 'red';
    return `
      <div class="ws-item${sel}" data-id="${s.id}">
        <div class="ws-item-row">
          <span class="status-dot ${dot}"></span>
          <span class="ws-item-title">${escHtml(s.domain || s.url)}</span>
        </div>
        <div class="ws-item-meta-row">
          <span class="ws-item-sub">${escHtml(s.url)}</span>
        </div>
        <div class="ws-item-actions">
          <span style="font-size:11px;color:var(--text2);font-weight:600;">${typeof score === 'number' ? '📈 ' + score + '/100' : '— not audited'}</span>
          <button class="ws-del" data-id="${s.id}" title="Delete website">🗑</button>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.ws-item[data-id]').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.ws-del')) return;
      selectSeo(item.dataset.id);
    });
  });
  list.querySelectorAll('.ws-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this website audit?')) return;
      try {
        await apiFetch('/api/seo/' + btn.dataset.id, { method: 'DELETE' });
        if (currentSeoSite && String(currentSeoSite.id) === String(btn.dataset.id)) resetSeoChat();
        await loadSeoSites();
      } catch (err) { alert('Delete failed: ' + err.message); }
    });
  });
}

function resetSeoChat() {
  currentSeoSite = null;
  const header = document.getElementById('seo-chat-header');
  if (header) header.innerHTML = `<span>Select a site to open its SEO chat</span>`;
  const msgs = document.getElementById('seo-chat-messages');
  if (msgs) msgs.innerHTML = `<div class="empty-msg">👈 Koi website chuno — uski SEO audit discuss karo.</div>`;
  const input = document.getElementById('seo-chat-input');
  if (input) { input.disabled = true; input.placeholder = 'Pehle koi website select karo…'; }
  const sendBtn = document.getElementById('seo-send-btn');
  if (sendBtn) sendBtn.disabled = true;
  const audit = document.getElementById('seo-audit');
  if (audit) audit.innerHTML = `<div class="empty-msg">Right side me website ka SEO score + issues + recommendations khulega.</div>`;
}

async function selectSeo(id) {
  const site = seoSitesCache.find(s => String(s.id) === String(id));
  if (!site) return;
  currentSeoSite = site;
  renderSeoList();

  if (window.innerWidth <= 1024) {
    const ws = document.querySelector('#view-seo .hack-workspace');
    if (ws && ws.dataset.activeTab === 'list') setWorkspaceTab('seo', 'chat');
  }

  const score = site.lastScore;
  const header = document.getElementById('seo-chat-header');
  if (header) header.innerHTML = `<span>🔍 ${escHtml(site.domain || site.url)}</span>${typeof score === 'number' ? `<span class="ws-chat-header-status ${seoScoreClass(score)}">${score}/100</span>` : ''}`;

  const input = document.getElementById('seo-chat-input');
  if (input) { input.disabled = false; input.placeholder = 'SEO fixes ke baare me poochho…'; }
  const sendBtn = document.getElementById('seo-send-btn');
  if (sendBtn) sendBtn.disabled = false;

  renderSeoAudit(site);
  await loadSeoChat(id);
  if (input) input.focus();
}

let lastSeoPlan = null;

function seoSparkline(history) {
  const pts = (Array.isArray(history) ? history : []).map(h => h.score).filter(n => typeof n === 'number');
  if (pts.length < 2) return '';
  const min = Math.min(...pts), max = Math.max(...pts);
  const range = (max - min) || 1;
  const w = 200, h = 32;
  const step = w / (pts.length - 1);
  const coords = pts.map((p, i) => `${(i * step).toFixed(1)},${(h - 4 - ((p - min) / range) * (h - 8)).toFixed(1)}`).join(' ');
  return `<svg width="100%" viewBox="0 0 ${w} ${h}" style="display:block;margin-top:6px;"><polyline points="${coords}" fill="none" stroke="var(--amber)" stroke-width="2"/></svg><div style="font-size:10px;color:var(--text3);text-align:center;margin-top:2px;">${pts.join(' → ')}</div>`;
}

function seoDownloadBlob(name, content, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 600);
}

function seoExportSite(site, fmt) {
  const a = site.audit || {};
  const safeDomain = (site.domain || site.url || 'site').replace(/[^a-zA-Z0-9._-]/g, '_');
  if (fmt === 'json') {
    seoDownloadBlob(`seo-audit-${safeDomain}.json`,
      JSON.stringify({ domain: site.domain, url: site.url, generatedAt: new Date().toISOString(), score: a.score, breakdown: a.breakdown || {}, issues: a.issues || [], recommendations: a.recommendations || [], signals: a.signals || {}, techNotes: a.techNotes || {}, history: site.history || [] }, null, 2),
      'application/json');
  } else {
    const rows = [];
    rows.push(['SEO AUDIT EXPORT']);
    rows.push(['domain', site.domain, 'url', site.url, 'score', a.score]);
    rows.push([]);
    rows.push(['breakdown', 'score']);
    Object.entries(a.breakdown || {}).forEach(([k, v]) => rows.push([k, v]));
    rows.push([]);
    rows.push(['severity', 'category', 'issue']);
    (a.issues || []).forEach(i => rows.push([i.severity, i.category, i.text]));
    rows.push([]);
    rows.push(['priority', 'issue', 'fix']);
    (a.recommendations || []).forEach(r => rows.push([r.priority, r.issue, r.fix]));
    seoDownloadBlob(`seo-audit-${safeDomain}.csv`, rows.map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
  }
}

async function openSeoFixPlan(siteId) {
  const btn = document.getElementById('seo-fp-gen');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating…'; }
  try {
    const { plan } = await apiFetch('/api/seo/' + siteId + '/fixplan');
    lastSeoPlan = plan;
    renderSeoFixPlan(plan);
  } catch (err) {
    alert('Fix plan failed: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🛠 Generate Fix Plan'; }
  }
}

function renderSeoFixPlan(plan) {
  const meta = document.getElementById('seo-fp-meta');
  const art = document.getElementById('seo-fp-artifacts');
  const gEl = document.getElementById('seo-fp-guidelines');
  const artObj = plan.artifacts || {};
  const items = [
    { key: 'robotsTxt', title: '🤖 robots.txt', file: 'robots.txt', code: artObj.robotsTxt || '' },
    { key: 'sitemap', title: '🗺 sitemap.xml', file: 'sitemap.xml', code: artObj.sitemap || '' },
    { key: 'canonical', title: '🔗 Canonical tag', file: 'canonical-fragment.html', code: artObj.canonical || '' },
    { key: 'ogBlock', title: '📱 OG + Twitter tags', file: 'og-tags.html', code: artObj.ogBlock || '' },
    { key: 'jsonld', title: '🧩 Structured data (JSON-LD)', file: 'schema.jsonld', code: artObj.jsonld || '' },
  ];
  const blocks = items.map((it, idx) => `
    <div class="ws-kb-block">
      <div class="ws-kb-label" style="display:flex;justify-content:space-between;align-items:center;">
        <span>${it.title}</span>
        <span>
          <button class="btn-small" data-seo-copy="${idx}">Copy</button>
          <button class="btn-small" data-seo-dl="${idx}">Download</button>
        </span>
      </div>
      <pre style="font-size:10.5px;background:#00000022;padding:8px;border-radius:6px;overflow:auto;max-height:200px;white-space:pre-wrap;word-break:break-word;color:var(--text1);">${escHtml(it.code)}</pre>
    </div>`).join('');
  if (meta) meta.innerHTML = `<div class="ws-kb-block"><div class="ws-kb-label">🛠 Fix Plan — ${escHtml(plan.domain)}</div>
    <div style="font-size:11px;color:var(--text3);">Generated ${new Date(plan.generatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} · score ${typeof plan.score === 'number' ? plan.score + '/100' : '—'}. Ready-to-deploy files — copy/download karke site root pe upload karo, phir Re-Audit chalao.</div></div>`;
  if (art) art.innerHTML = blocks;
  if (gEl) gEl.innerHTML = `
    <div class="ws-kb-block"><div class="ws-kb-label">📌 Guidelines</div>${(plan.guidelines || []).map(g => `<div style="font-size:12px;margin-bottom:6px;color:var(--text2);line-height:1.5;">• ${escHtml(g)}</div>`).join('')}</div>
    <div class="ws-kb-block"><div class="ws-kb-label">✅ Deploy checklist</div>
      ${['1️⃣ robots.txt + sitemap.xml ko site ke root pe upload karo (existing files overwrite karo).', '2️⃣ canonical + OG + JSON-LD fragments ko apne page ke <head> mein merge karo.', '3️⃣ Google Search Console mein property verify karke sitemap submit karo.', '4️⃣ Tab Re-Audit chalao — score fix hua ya nahi verify karo.', '5️⃣ Har page ka title/meta description unique rakho (duplicate titles fix karo).'].map(x => `<div style="font-size:12px;color:var(--text2);margin-bottom:4px;line-height:1.4;">${x}</div>`).join('')}
    </div>`;
  switchSeoOpTab('fixplan');
}

function renderSeoAudit(site) {
  const el = document.getElementById('seo-audit');
  const a = site.audit || {};
  const score = a.score;
  const signals = a.signals || {};
  const techNotes = a.techNotes || {};
  const sitemapCount = typeof signals.sitemapUrls === 'number' ? signals.sitemapUrls : techNotes.sitemapUrlCount;
  const sitemapLastmod = typeof signals.sitemapLastmod === 'number' ? signals.sitemapLastmod : techNotes.sitemapLastmod;
  const robotsExists = typeof signals.robotsExists === 'boolean' ? signals.robotsExists : techNotes.robotsExists;

  const bar = (val) => {
    const color = val >= 70 ? 'var(--green)' : val >= 50 ? 'var(--amber)' : 'var(--red)';
    return `<div style="height:6px;background:#00000033;border-radius:4px;margin-top:4px;"><div style="width:${Math.max(0, Math.min(100, val))}%;height:100%;background:${color};border-radius:4px;"></div></div>`;
  };

  const breakdownRows = ['technical', 'onpage', 'content', 'links'].map(k => {
    const val = (a.breakdown && a.breakdown[k]) || 0;
    return `<div style="font-size:12px;margin-top:8px;"><div style="display:flex;justify-content:space-between;color:var(--text2);"><span>${k.charAt(0).toUpperCase() + k.slice(1)}</span><span>${val}/100</span></div>${bar(val)}</div>`;
  }).join('');

  const issues = (a.issues || []).slice(0, 8).map(i =>
    `<div style="font-size:12px;margin-bottom:8px;line-height:1.5;"><span style="color:${i.severity === 'high' ? '#f87171' : i.severity === 'medium' ? '#fbbf24' : 'var(--text3)'};font-weight:700;text-transform:capitalize;">[${i.severity}]</span> <span style="color:var(--text1);">${escHtml(i.text)}</span></div>`
  ).join('') || '<div style="font-size:12px;color:var(--text3);">No issues flagged — clean setup!</div>';

  const recs = (a.recommendations || []).slice(0, 6).map(r =>
    `<div style="font-size:12px;margin-bottom:8px;line-height:1.5;"><span style="font-weight:700;color:${r.priority === 'high' ? '#f87171' : r.priority === 'medium' ? '#fbbf24' : 'var(--text2)'};text-transform:uppercase;">${escHtml(r.priority)}</span> <span style="color:var(--text1);">${escHtml(r.issue)}</span><div style="color:var(--text2);">→ ${escHtml(r.fix)}</div></div>`
  ).join('') || '<div style="font-size:12px;color:var(--text3);">No recommendations yet.</div>';

  const signalRow = (label, value) =>
    `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;color:var(--text2);"><span>${label}</span><span style="font-weight:600;color:var(--text1);">${value}</span></div>`;

  const opTab = (id, active, label) =>
    `<button class="seo-op-tab${active ? ' seo-op-tab-on' : ''}" data-seop="${id}" style="padding:5px 10px;border-radius:8px;background:#00000033;color:var(--text2);font-size:11px;font-weight:700;border:1px solid #ffffff18;${active ? 'background:#00000055;color:var(--text1);box-shadow:inset 0 0 0 1px #ffffff33;' : ''}">${label}</button>`;

  el.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
      ${opTab('dash', true, '📊 Dashboard')}
      ${opTab('issues', false, '⚠️ Issues (' + ((a.issues || []).length) + ')')}
      ${opTab('topics', false, '🗺 14-Topics')}
      ${opTab('fixplan', false, '🛠 Fix Plan')}
      ${opTab('compare', false, '⚔️ Compare')}
      ${opTab('kw', false, '🎯 Keywords')}
    </div>
    <div class="seo-op-pane" data-seopath="dash">
      <div class="ws-kb-block" style="text-align:center;">
        <div style="font-size:44px;font-weight:800;color:${seoScoreColor(score)};line-height:1.1;">${typeof score === 'number' ? score + '<span style="font-size:16px;">/100</span>' : '—'}</div>
        ${seoSparkline(site.history)}
        <div style="font-size:11px;color:var(--text3);">${typeof a.pagesFound === 'number' ? a.pagesFound + ' pages audited · ' : ''}${a.auditedAt ? new Date(a.auditedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : ''}</div>
      </div>
      ${a.summary ? `<div class="ws-kb-block"><div class="ws-kb-label">📝 Summary</div><div style="font-size:12px;line-height:1.5;">${escHtml(a.summary)}</div></div>` : ''}
      <div class="ws-kb-block"><div class="ws-kb-label">📊 Breakdown</div>${breakdownRows}</div>
      <div class="ws-kb-block"><div class="ws-kb-label">🌐 Technical signals</div>
        ${signalRow('⚡ TTFB', typeof signals.ttfbMs === 'number' ? signals.ttfbMs + 'ms' : '—')}
        ${signalRow('📦 Page size', typeof signals.htmlBytes === 'number' ? (signals.htmlBytes / 1024).toFixed(0) + ' KB' : '—')}
        ${signalRow('🧩 Scripts', typeof signals.scriptSrcCount === 'number' ? signals.scriptSrcCount + ' (⚠️ ' + signals.blockingScripts + ' blocking)' : '—')}
        ${signalRow('🎨 CSS files', typeof signals.cssLinkCount === 'number' ? signals.cssLinkCount : '—')}
        ${signalRow('🖼 Images', typeof signals.imgCount === 'number' ? signals.imgCount + ' (⌛ ' + signals.lazyImages + ' lazy)' : '—')}
        ${signalRow('🧱 Semantic tags', typeof signals.semanticCount === 'number' ? signals.semanticCount + '/7' : '—')}
        ${signalRow('🗺 Sitemap', typeof sitemapCount === 'number' ? sitemapCount + ' URLs' + (sitemapLastmod ? ' (📅 ' + sitemapLastmod + ' lastmod)' : '') : '-')}
        ${signalRow('🤖 robots.txt', robotsExists ? 'found' : 'missing')}
        ${typeof signals.hreflangCount === 'number' ? signalRow('🌍 hreflang', signals.hreflangCount + (signals.hreflangCount === 1 ? ' lang' : ' langs')) : ''}
        ${Array.isArray(signals.schemaTypes) && signals.schemaTypes.length ? signalRow('🧩 Schema', signals.schemaTypes.join(', ')) : ''}
      </div>
      <div class="ws-kb-block"><div class="ws-kb-label">⚙️ Site Management</div>
        <select id="seo-reaudit-freq" style="width:100%;padding:4px;border-radius:6px;background:#00000033;color:var(--text1);border:1px solid #ffffff22;">
          <option value="0">Off — sirf manual re-audit</option>
          <option value="24">Daily (har 24h)</option>
          <option value="168">Weekly (har 168h)</option>
        </select>
        <div style="font-size:10px;color:var(--text3);margin-top:4px;">GitHub Actions ke background pump se auto re-audit chalega — score trend history me jude rahega.</div>
        <div style="display:flex;gap:6px;margin-top:8px;">
          <button class="btn-small" id="seo-export-json" title="Download JSON" style="flex:1;">⤓ JSON</button>
          <button class="btn-small" id="seo-export-csv" title="Download CSV" style="flex:1;">⤓ CSV</button>
          <button class="btn-small" id="seo-report-btn" title="Download full HTML report" style="flex:1;">📄 Report</button>
        </div>
        <button class="btn-small" id="re-audit-seo" style="width:100%;margin-top:8px;">↻ Re-Audit Website</button>
      </div>
    </div>
    <div class="seo-op-pane" data-seopath="issues" hidden></div>
    <div class="seo-op-pane" data-seopath="topics" hidden></div>
    <div class="seo-op-pane" data-seopath="fixplan" hidden>
      <div id="seo-fp-meta"></div>
      <button class="btn-small" id="seo-fp-gen" style="width:100%;margin:8px 0;">🛠 Generate Fix Plan</button>
      <div id="seo-fp-artifacts"></div>
      <div id="seo-fp-guidelines"></div>
    </div>
    <div class="seo-op-pane" data-seopath="compare" hidden>
      <div class="ws-add-row" style="margin:6px 0;">
        <input id="seo-op-compare-input" type="text" placeholder="Compare: url1, url2, ... (max 4)" />
        <button class="btn-small" id="seo-op-compare-btn">⚔️</button>
      </div>
      <div id="seo-op-compare-results"><div class="empty-msg" style="font-size:11px;">Rival sites ke URLs daalo (comma-separated, max 4) — live quick audit + score comparison.</div></div>
    </div>
    <div class="seo-op-pane" data-seopath="kw" hidden>
      <div class="ws-kb-label">🎯 Target Keywords</div>
      <div style="display:flex;gap:6px;">
        <input id="seo-kw-input" type="text" placeholder="e.g. wedding planner" style="flex:1;padding:4px;border-radius:6px;background:#00000033;color:var(--text1);border:1px solid #ffffff22;" />
        <button class="btn-small" id="seo-kw-add">＋</button>
      </div>
      <div id="seo-op-kw-list" style="margin-top:6px;"></div>
      <div style="font-size:10px;color:var(--text3);margin-top:4px;">Har re-audit par har keyword homepage (title/meta/body) mein search hoga — ✓ found / ✗ missing.</div>
    </div>
  `;

  renderSeoKeyList(site);
  renderSeoIssues(site);
  renderSeoTopics(site);

  const kwInput = document.getElementById('seo-kw-input');
  const kwAdd = document.getElementById('seo-kw-add');
  const addKeyword = async () => {
    const kw = (kwInput ? kwInput.value : '').trim();
    if (!kw || !site.id) return;
    if (kwAdd) { kwAdd.disabled = true; }
    try {
      const { keywords } = await apiFetch('/api/seo/' + site.id + '/keywords', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword: kw }) });
      site.keywords = keywords;
      renderSeoKeyList(site);
      if (kwInput) kwInput.value = '';
    } catch (err) { alert('Add failed: ' + err.message); }
    finally { if (kwAdd) kwAdd.disabled = false; }
  };
  if (kwAdd) kwAdd.addEventListener('click', addKeyword);
  if (kwInput) kwInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addKeyword(); });

  const ra = document.getElementById('re-audit-seo');
  if (ra) ra.addEventListener('click', async () => {
    ra.disabled = true; ra.textContent = '⏳ Auditing…';
    const safetyTimer = setTimeout(() => { if (ra) { ra.disabled = false; ra.textContent = '↻ Re-Audit Website'; } }, 60000);
    try {
      const { site: updated } = await apiFetch('/api/seo/' + site.id + '/analyze', { method: 'POST' });
      clearTimeout(safetyTimer);
      const idx = seoSitesCache.findIndex(x => String(x.id) === String(site.id));
      if (idx !== -1) seoSitesCache[idx] = updated;
      currentSeoSite = updated;
      renderSeoList();
      renderSeoAudit(updated);
      const header = document.getElementById('seo-chat-header');
      if (header && typeof updated.lastScore === 'number') {
        header.innerHTML = `<span>🔍 ${escHtml(updated.domain || updated.url)}</span><span class="ws-chat-header-status ${seoScoreClass(updated.lastScore)}">${updated.lastScore}/100</span>`;
      }
    } catch (err) {
      clearTimeout(safetyTimer);
      alert('Re-audit failed: ' + err.message);
      if (ra) { ra.disabled = false; ra.textContent = '↻ Re-Audit Website'; }
    }
  });

  el.querySelectorAll('.seo-op-tab').forEach(b => b.addEventListener('click', () => switchSeoOpTab(b.dataset.seop)));

  const fpGen = document.getElementById('seo-fp-gen');
  if (fpGen) fpGen.addEventListener('click', () => openSeoFixPlan(site.id));

  const cInp = document.getElementById('seo-op-compare-input');
  const cBtn = document.getElementById('seo-op-compare-btn');
  if (cBtn) cBtn.addEventListener('click', compareSitesFrontend);
  if (cInp) cInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') compareSitesFrontend(); });

  const expJson = document.getElementById('seo-export-json');
  if (expJson) expJson.addEventListener('click', () => seoExportSite(site, 'json'));
  const expCsv = document.getElementById('seo-export-csv');
  if (expCsv) expCsv.addEventListener('click', () => seoExportSite(site, 'csv'));

  const rptBtn = document.getElementById('seo-report-btn');
  if (rptBtn) rptBtn.addEventListener('click', async () => {
    const old = rptBtn.textContent;
    rptBtn.disabled = true; rptBtn.textContent = '⏳';
    try {
      const { html } = await apiFetch('/api/seo/' + site.id + '/report');
      const safeDomain = (site.domain || site.url || 'site').replace(/[^a-zA-Z0-9._-]/g, '_');
      seoDownloadBlob(`seo-report-${safeDomain}.html`, html, 'text/html');
    } catch (err) { alert('Report failed: ' + err.message); }
    finally { rptBtn.disabled = false; rptBtn.textContent = old; }
  });

  const freq = document.getElementById('seo-reaudit-freq');
  if (freq) {
    freq.value = String(site.reAuditEnabled ? (Number(site.reAuditIntervalHours) || 24) : 0);
    freq.addEventListener('change', async () => {
      const val = Number(freq.value) || 0;
      const enabled = val > 0;
      try {
        const { site: updated } = await apiFetch('/api/seo/' + site.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reAuditEnabled: enabled, reAuditIntervalHours: val }) });
        const idx = seoSitesCache.findIndex(x => String(x.id) === String(site.id));
        if (idx !== -1) seoSitesCache[idx] = updated;
        currentSeoSite = updated;
        alert(enabled ? '✅ Auto re-audit ON — har ' + val + 'h mein background mein chalega (score history update hogi).' : 'Auto re-audit OFF.');
      } catch (err) {
        freq.value = String(site.reAuditEnabled ? (Number(site.reAuditIntervalHours) || 24) : 0);
        alert('Settings update failed: ' + err.message);
      }
    });
  }

  const fp = document.getElementById('seo-op-fixplan');
  if (fp) fp.addEventListener('click', async (ev) => {
    const copyBtn = ev.target.closest('[data-seo-copy]');
    let idx;
    if (copyBtn && (idx = Number(copyBtn.dataset.seoCopy)) >= 0 && lastSeoPlan && lastSeoPlan.artifacts) {
      const keys = ['robotsTxt', 'sitemap', 'canonical', 'ogBlock', 'jsonld'];
      const code = lastSeoPlan.artifacts[keys[idx]] || '';
      try {
        await navigator.clipboard.writeText(code);
        const old = copyBtn.textContent;
        copyBtn.textContent = '✓ Copied';
        setTimeout(() => { copyBtn.textContent = old; }, 1200);
      } catch {
        copyBtn.textContent = 'Copy failed';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
      }
    }
    const dlBtn = ev.target.closest('[data-seo-dl]');
    if (dlBtn && lastSeoPlan && lastSeoPlan.artifacts) {
      const meta = [
        ['robotsTxt', 'robots.txt', 'text/plain'],
        ['sitemap', 'sitemap.xml', 'application/xml'],
        ['canonical', 'canonical-fragment.html', 'text/html'],
        ['ogBlock', 'og-tags.html', 'text/html'],
        ['jsonld', 'schema.jsonld', 'application/ld+json'],
      ];
      const it = meta[Number(dlBtn.dataset.seoDl)];
      if (it) seoDownloadBlob(`${(lastSeoPlan.domain || 'site')}-${it[1]}`, lastSeoPlan.artifacts[it[0]] || '', it[2]);
    }
  });
}

let seoIssueSev = 'all';
let seoIssueCat = 'all';

function switchSeoOpTab(name) {
  const ws = document.querySelector('#view-seo .hack-workspace');
  if (ws) {
    ws.dataset.activeTab = 'knowledge';
    setWorkspaceTab('seo', 'knowledge');
  }
  document.querySelectorAll('#seo-audit .seo-op-tab').forEach(b => {
    b.classList.toggle('seo-op-tab-on', b.dataset.seop === name);
    if (b.dataset.seop === name) {
      b.style.background = '#00000055';
      b.style.color = 'var(--text1)';
      b.style.boxShadow = 'inset 0 0 0 1px #ffffff33';
    } else {
      b.style.background = '';
      b.style.color = '';
      b.style.boxShadow = '';
    }
  });
  document.querySelectorAll('#seo-audit .seo-op-pane').forEach(p => {
    p.hidden = p.dataset.seopath !== name;
  });
}

function seoAskBuilder(prompt) {
  const input = document.getElementById('seo-chat-input');
  if (!input || !currentSeoSite) { alert('Pehle koi website select karo.'); return; }
  if (window.innerWidth <= 1024) setWorkspaceTab('seo', 'chat');
  input.value = prompt;
  input.style.height = 'auto';
  sendSeoMessage();
}

function renderSeoIssues(site) {
  const el = document.getElementById('seo-op-issues');
  if (!el) return;
  const issues = (site.audit && site.audit.issues) || [];
  const cats = [...new Set(issues.map(i => i.category || 'misc'))];
  const sevOrder = { high: 3, medium: 2, low: 1 };
  const filtered = issues.filter(i =>
    (seoIssueSev === 'all' || i.severity === seoIssueSev) &&
    (seoIssueCat === 'all' || i.category === seoIssueCat)
  ).sort((x, y) => (sevOrder[y.severity] || 0) - (sevOrder[x.severity] || 0));
  const chip = (kind, val, label, active) =>
    `<button class="btn-small seo-issue-chip" data-kind="${kind}" data-val="${val}" style="${active ? 'outline:2px solid var(--amber);' : ''}">${label}</button>`;
  const sevChips = chip('sev', 'all', 'All', seoIssueSev === 'all') +
    ['high', 'medium', 'low'].map(s => chip('sev', s, s, seoIssueSev === s)).join('');
  const catChips = chip('cat', 'all', 'All', seoIssueCat === 'all') +
    cats.map(c => chip('cat', c, c, seoIssueCat === c)).join('');
  const counts = { high: issues.filter(i => i.severity === 'high').length, medium: issues.filter(i => i.severity === 'medium').length, low: issues.filter(i => i.severity === 'low').length };
  const list = filtered.length ? filtered.map(i => `
    <div class="ws-kb-block" style="margin-bottom:6px;">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <span style="color:${i.severity === 'high' ? '#f87171' : i.severity === 'medium' ? '#fbbf24' : 'var(--text3)'};font-weight:700;text-transform:capitalize;">[${i.severity}]</span>
        <span style="font-size:10px;background:#00000033;padding:2px 6px;border-radius:10px;color:var(--text2);">${escHtml(i.category || 'misc')}</span>
      </div>
      <div style="font-size:12px;margin-top:4px;color:var(--text1);line-height:1.5;">${escHtml(i.text)}</div>
      <button class="btn-small seo-issue-fix" data-fix="${escHtml(i.text)}" style="margin-top:6px;width:100%;">🤖 Fix with Builder</button>
    </div>`).join('') : `<div style="font-size:12px;color:var(--text3);">Is filter mein koi issue nahi — 🎉</div>`;
  el.innerHTML = `
    <div style="font-size:11px;color:var(--text3);margin-bottom:6px;">${issues.length} issues total — <span style="color:#f87171;">${counts.high} high</span> · <span style="color:#fbbf24;">${counts.medium} med</span> · <span style="color:var(--text3);">${counts.low} low</span></div>
    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;align-items:center;">
      <span style="font-size:10px;color:var(--text3);">Severity:</span>${sevChips}
    </div>
    ${cats.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;align-items:center;"><span style="font-size:10px;color:var(--text3);">Category:</span>${catChips}</div>` : ''}
    ${list}
    <div style="font-size:10px;color:var(--text3);margin-top:8px;">💡 "Fix with Builder" dabao — Builder AI usi issue ka root cause + step-by-step fix + ready-use code chat mein dega.</div>
  `;
  el.querySelectorAll('.seo-issue-chip').forEach(ch => ch.addEventListener('click', () => {
    if (ch.dataset.kind === 'sev') seoIssueSev = ch.dataset.val;
    else seoIssueCat = ch.dataset.val;
    renderSeoIssues(site);
  }));
  el.querySelectorAll('.seo-issue-fix').forEach(b => b.addEventListener('click', () => {
    const s = site.audit || {};
    const d = site.domain || site.url;
    seoAskBuilder(`Meri site "${d}" (SEO score ${typeof s.score === 'number' ? s.score + '/100' : '—'}) mein ye SEO issue hai: "${b.dataset.fix}". Root cause samjhao, step-by-step fix do, aur ready-to-use code/tags bhi de. Practical, Hinglish.`);
  }));
}

function seoTopicsOf(site) {
  const a = site.audit || {};
  const s = a.signals || {};
  const urls = Array.isArray(a.crawledUrls) ? a.crawledUrls : [];
  const internal = urls.length;
  const broken = (Array.isArray(a.broken) ? a.broken : []).filter(b => b && !b.ok).length;
  const meta = s.metaDescription || '';
  const schema = Array.isArray(s.schemaTypes) ? s.schemaTypes : [];
  const hasOg = s.ogTitle || s.ogImage;
  const blocking = typeof s.blockingScripts === 'number' ? s.blockingScripts : 0;
  const ttfb = s.ttfbMs || 0;
  const load = s.loadMs || 0;
  const queryUrls = urls.filter(u => /[?&=]/.test(u));
  const H = (title, group, status, why) => ({ title, group, status, why });
  return [
    H('URL Architecture', 'Technical', queryUrls.length ? 'Warn' : 'Pass', queryUrls.length ? queryUrls.length + ' crawl URL(s) mein query params/messy URLs — clean, lowercase, keyword-rich URLs use karo.' : 'Crawled URLs clean hain (no query junk).'),
    H('Redirects & Status Codes', 'Technical', broken ? 'Fail' : 'Pass', broken ? broken + ' broken internal link(s) mile (404/error).' : 'Koi broken internal link nahi mila.'),
    H('Canonicalization', 'Technical', s.canonical ? 'Pass' : 'Fail', s.canonical ? 'Canonical tag present: ' + s.canonical : 'Har page par <link rel="canonical"> missing — duplicate content risk.'),
    H('Structured Data', 'Content', schema.length ? 'Pass' : 'Fail', schema.length ? 'JSON-LD type(s): ' + schema.join(', ') : 'Koi JSON-LD structured data nahi mila.'),
    H('Meta Description', 'On-page', !meta ? 'Fail' : (meta.length < 120 || meta.length > 200) ? 'Warn' : 'Pass', !meta ? 'Meta description missing.' : meta.length + ' chars (' + (meta.length < 120 ? 'kam' : 'zyada') + ') — ideal 120-200.'),
    H('Open Graph + Twitter', 'On-page', (hasOg && s.twitterCard) ? 'Pass' : (hasOg || s.twitterCard) ? 'Warn' : 'Fail', (hasOg && s.twitterCard) ? 'OG + twitter:card present.' : (hasOg ? 'OG hai but twitter:card missing.' : (s.twitterCard ? 'twitter:card hai but OG tags missing.' : 'OG + Twitter meta missing — shared links bland.'))),
    H('XML Sitemap', 'Technical', s.sitemapFound ? 'Pass' : 'Fail', s.sitemapFound ? 'sitemap mile — ' + (typeof s.sitemapUrls === 'number' ? s.sitemapUrls + ' URLs' : '') : 'XML sitemap missing/undiscoverable — GSC submit hoga nahi.'),
    H('robots.txt', 'Technical', s.robotsExists ? 'Pass' : 'Fail', s.robotsExists ? 'robots.txt present.' : 'robots.txt missing — crawl directives + sitemap pointer chahiye.'),
    H('hreflang', 'Content', (typeof s.hreflangCount === 'number' && s.hreflangCount > 0) ? 'Pass' : 'Manual', s.hreflangCount ? s.hreflangCount + ' hreflang link(s) — multi-language URLs map ho rahe.' : 'hreflang nahi mila — sirf tab zaroori hai agar site multi-language hai.'),
    H('Crawl Budget / Renderability', 'Technical', blocking === 0 ? 'Pass' : blocking <= 3 ? 'Warn' : 'Fail', blocking + ' render-blocking script(s) — async/defer lagao ya critical CSS inline karo.'),
    H('Core Web Vitals', 'Technical', (ttfb < 600 && load < 2500) ? 'Pass' : (ttfb < 1500 && load < 4000) ? 'Warn' : 'Fail', 'TTFB ' + ttfb + 'ms · load ~' + load + 'ms (ideal: <600ms / <2.5s).'),
    H('Indexability', 'Technical', s.noindex ? 'Fail' : 'Pass', s.noindex ? 'Page par noindex — Google index nahi karega.' : 'No noindex — page indexable.'),
    H('Internal Linking', 'Content', internal >= 3 ? 'Pass' : internal > 0 ? 'Warn' : 'Fail', internal + ' internal link(s) mile — pages ko aapas mein link karke link equity distribute karo.'),
    H('Log-file Analysis', 'Advanced', 'Manual', 'Server access logs required — search queries, crawl frequency. Deploy ke baad GSC + logs se manually analyse karo.'),
  ];
}

function renderSeoTopics(site) {
  const el = document.getElementById('seo-op-topics');
  if (!el) return;
  const tops = seoTopicsOf(site);
  const color = st => st === 'Pass' ? 'var(--green)' : st === 'Warn' ? 'var(--amber)' : st === 'Fail' ? '#f87171' : 'var(--text3)';
  const card = (t, i) => `
    <div class="ws-kb-block" style="margin-bottom:6px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
        <div style="font-size:12px;font-weight:700;color:var(--text1);">${t.title}</div>
        <span style="font-size:10px;font-weight:800;color:${color(t.status)};background:#00000022;padding:2px 8px;border-radius:10px;text-transform:uppercase;">${t.status}</span>
      </div>
      <div style="font-size:11px;color:var(--text2);margin:4px 0 6px;line-height:1.4;">${escHtml(t.why)}</div>
      <button class="btn-small seo-topic-discuss" data-ti="${i}" style="width:100%;">🤖 Deep-dive in Builder — ${t.group}</button>
    </div>`;
  el.innerHTML = `
    <div style="font-size:11px;color:var(--text3);margin-bottom:8px;line-height:1.5;">14-topic SEO engineering framework ka live map — har topic ka status tumhare audit se. Kisi bhi topic par "Deep-dive" dabao — Builder AI us topic ka complete best-practices + fix plan chat mein dega.</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">${['Technical', 'On-page', 'Content', 'Advanced'].map(g => `<span style="font-size:10px;color:var(--text2);background:#00000022;padding:2px 8px;border-radius:10px;">${g}</span>`).join('')}</div>
    ${tops.map((t, i) => card(t, i)).join('')}
  `;
  el.querySelectorAll('.seo-topic-discuss').forEach(b => b.addEventListener('click', () => {
    const t = tops[Number(b.dataset.ti)];
    if (!t) return;
    const s = site.audit || {};
    seoAskBuilder(`SEO topic "${t.title}" (${t.group}) — main site "${site.domain || site.url}" ka 14-topic SEO map dekh raha hoon. Is topic par current status **${t.status}**: ${t.why}. Deep dive karo: is topic ke complete best practices (SEO engineering knowledge ke hisab se), mere data ke hisab se kya fix karna hai, aur step-by-step actionable plan — code/tags ke saath. Hinglish, practical.`);
  }));
}

function renderSeoKeyList(site) {
  const el = document.getElementById('seo-op-kw-list');
  if (!el) return;
  const kws = site.keywords || [];
  const checks = (site.audit && site.audit.keywordChecks) || [];
  if (!kws.length) {
    el.innerHTML = `<div style="font-size:11px;color:var(--text3);">Abhi koi keyword track nahi ho raha.</div>`;
    return;
  }
  el.innerHTML = kws.map((kw) => {
    const c = checks.find((x) => x.keyword.toLowerCase() === String(kw).toLowerCase());
    const badge = c ? (c.found ? '<span style="color:var(--green);font-weight:700;">✓</span>' : '<span style="color:#f87171;font-weight:700;">✗</span>') : '<span style="color:var(--text3);">·</span>';
    return `<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;padding:3px 0;border-bottom:1px dashed #ffffff14;">
      <span style="color:var(--text1);">${badge} ${escHtml(kw)}</span>
      <button class="ws-del" data-kw="${escHtml(kw)}" title="Remove keyword">✕</button>
    </div>`;
  }).join('');
  el.querySelectorAll('.ws-del[data-kw]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const { keywords } = await apiFetch('/api/seo/' + site.id + '/keywords/' + encodeURIComponent(btn.dataset.kw), { method: 'DELETE' });
        site.keywords = keywords;
        renderSeoKeyList(site);
      } catch (err) { alert('Remove failed: ' + err.message); }
    });
  });
}

async function loadSeoChat(id) {
  const el = document.getElementById('seo-chat-messages');
  if (!el) return;
  try {
    const { messages } = await apiFetch('/api/seo/' + id + '/chat');
    renderWsChat(el, messages || [], 'seo');
  } catch (err) {
    el.innerHTML = `<div class="empty-msg">⚠️ ${escHtml(err.message)}</div>`;
  }
}

async function sendSeoMessage() {
  const input = document.getElementById('seo-chat-input');
  const el = document.getElementById('seo-chat-messages');
  const text = (input.value || '').trim();
  if (!text || !el) return;
  input.value = '';
  input.style.height = 'auto';
  appendWsMsg(el, 'user', 'Nikhil', text);

  if (!currentSeoSite) {
    appendWsMsg(el, 'assistant', 'Bob 🔍', '⏳ Website audit + chat setup ho raha hai…');
    try {
      const { site } = await apiFetch('/api/seo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: text }) });
      el.querySelector('.ws-msg.assistant:last-of-type')?.remove();
      seoSitesCache.unshift(site);
      renderSeoList();
      await selectSeo(site.id);
      appendWsMsg(el, 'assistant', 'Bob 🔍', `✅ "${site.domain}" ka audit complete! Score: ${typeof site.lastScore === 'number' ? site.lastScore + '/100' : '—'} — right side panel me details milegi.`);
    } catch (err) {
      const last = el.querySelector('.ws-msg.assistant:last-of-type');
      if (last) last.innerHTML = wsMsgHTML('assistant', 'Bob 🔍', '⚠️ ' + err.message);
    }
  } else {
    appendWsMsg(el, 'assistant', 'Bob 🔍', '⏳ Thinking…');
    try {
      const data = await apiFetch('/api/seo/' + currentSeoSite.id + '/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }) });
      const last = el.querySelector('.ws-msg.assistant:last-of-type');
      if (last) last.remove();
      appendWsMsg(el, 'assistant', 'Bob 🔍', data.reply || '…');
    } catch (err) {
      const last = el.querySelector('.ws-msg.assistant:last-of-type');
      if (last) last.innerHTML = wsMsgHTML('assistant', 'Bob 🔍', '⚠️ ' + err.message);
    }
  }
  input.focus();
}

async function addSeoSiteFromInput() {
  const input = document.getElementById('seo-url-input');
  const addBtn = document.getElementById('seo-add-btn');
  const url = (input.value || '').trim();
  if (!url) return;
  input.disabled = true;
  if (addBtn) { addBtn.disabled = true; addBtn.textContent = '⏳'; }
  try {
    const { site } = await apiFetch('/api/seo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
    seoSitesCache.unshift(site);
    renderSeoList();
    input.value = '';
    await selectSeo(site.id);
  } catch (err) {
    alert('Audit failed: ' + err.message);
  } finally {
    input.disabled = false;
    if (addBtn) { addBtn.disabled = false; addBtn.textContent = '🔍 Audit'; }
  }
}

async function compareSitesFrontend() {
  const oc = document.getElementById('seo-op-compare-input');
  const sc = document.getElementById('seo-compare-input');
  const urls = ((oc && oc.value.trim()) || (sc && sc.value.trim()) || '');
  if (!urls) { alert('URLs daalo — comma-separated, max 4.'); return; }
  const setBusy = (on) => {
    if (oc) oc.disabled = on;
    if (sc) sc.disabled = on;
    const b1 = document.getElementById('seo-op-compare-btn');
    const b2 = document.getElementById('seo-compare-btn');
    if (b1) { b1.disabled = on; b1.textContent = on ? '⏳' : '⚔️'; }
    if (b2) { b2.disabled = on; b2.textContent = on ? '⏳' : '⚔️'; }
  };
  setBusy(true);
  try {
    const { results } = await apiFetch('/api/seo/compare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls }) });
    renderSeoCompare(results);
  } catch (err) {
    alert('Compare failed: ' + err.message);
  } finally {
    setBusy(false);
  }
}

function renderSeoCompare(results) {
  const el = document.getElementById('seo-op-compare-results');
  if (!el) return;
  const backBtn = `<button class="btn-small" id="seo-compare-back" style="width:100%;margin-bottom:8px;">← Dashboard</button>`;
  const cards = (results || []).map(r => {
    if (r.error) {
      return `<div class="ws-kb-block"><div class="ws-kb-label">⚔️ ${escHtml(r.domain || r.url)}</div><div style="font-size:12px;color:var(--red);">⚠️ ${escHtml(r.error)}</div></div>`;
    }
    const cols = ['technical', 'onpage', 'content', 'links'].map(k =>
      `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0;color:var(--text2);"><span>${k[0].toUpperCase() + k.slice(1)}</span><span style="font-weight:700;color:${seoScoreColor(r.breakdown[k] || 0)};">${r.breakdown[k] || 0}</span></div>`
    ).join('');
    const issues = (r.topIssues || []).map(i => `<div style="font-size:11px;color:var(--text2);line-height:1.4;">• ${escHtml(i)}</div>`).join('');
    return `<div class="ws-kb-block">
      <div class="ws-kb-label">⚔️ ${escHtml(r.domain || r.url)}</div>
      <div style="text-align:center;font-size:32px;font-weight:800;color:${seoScoreColor(r.score)};">${typeof r.score === 'number' ? r.score : '—'}/100</div>
      <div style="font-size:11px;color:var(--text2);margin-top:6px;">${cols}</div>
      ${issues ? `<div style="margin-top:6px;">${issues}</div>` : ''}
    </div>`;
  }).join('');
  el.innerHTML = `<div class="ws-kb-block"><div class="ws-kb-label">⚔️ Competitor Comparison</div>
    <div style="font-size:11px;color:var(--text3);">Deterministic on-page score — har site par live quick audit. Detailed audit ke liye site ko add karke dekh sakte ho.</div>
    ${backBtn}</div>${cards}`;
  const back = document.getElementById('seo-compare-back');
  if (back) back.addEventListener('click', () => switchSeoOpTab('dash'));
  switchSeoOpTab('compare');
}

document.getElementById('seo-send-btn')?.addEventListener('click', sendSeoMessage);
attachAutoResizeTextarea('seo-chat-input', sendSeoMessage);
document.getElementById('seo-compare-btn')?.addEventListener('click', compareSitesFrontend);
document.getElementById('seo-compare-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') compareSitesFrontend(); });
document.getElementById('seo-add-btn')?.addEventListener('click', addSeoSiteFromInput);
document.getElementById('add-seo-btn-sidebar')?.addEventListener('click', () => document.getElementById('seo-url-input')?.focus());
document.getElementById('seo-url-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') addSeoSiteFromInput(); });
document.querySelectorAll('#seo-mobile-tabs .ws-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => setWorkspaceTab('seo', btn.dataset.tab));
});
document.getElementById('seo-panel-toggle')?.addEventListener('click', () => {
  document.querySelector('#view-seo .hack-workspace')?.classList.toggle('list-collapsed');
});

// ═══════════════════════════════════════════════════════
// STALKING WORKSPACE
// ═══════════════════════════════════════════════════════

let stalkCache = [];
let currentStalk = null;
let stalkPollTimer = null;

async function loadStalking() {
  try {
    const { profiles } = await apiFetch('/api/stalking');
    stalkCache = profiles || [];
    renderStalkList();

    // If currently selected profile updated in background, refresh card & chat header
    if (currentStalk) {
      const updated = stalkCache.find(x => String(x.id) === String(currentStalk.id));
      if (updated) {
        currentStalk = updated;
        renderProfileCard(updated);
        updateStalkHeader(updated);
      }
    }

    // Auto-poll if any profile is currently in 'researching' status
    const hasResearching = stalkCache.some(p => p.status === 'researching');
    if (hasResearching && !stalkPollTimer) {
      stalkPollTimer = setTimeout(() => {
        stalkPollTimer = null;
        loadStalking();
      }, 5000);
    }
  } catch (err) { console.error('loadStalking error:', err); }
}

function updateStalkHeader(prof) {
  const header = document.getElementById('stalk-chat-header');
  if (!header) return;
  if (!prof) {
    header.innerHTML = `<span>Select a profile to open its private chat</span>`;
    return;
  }
  header.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;width:100%;">
      <div>
        <strong style="font-size:15px;color:var(--text-main);">${escHtml(prof.name)}</strong>
        <span class="status-badge ${prof.status === 'ready' ? 'green' : (prof.status === 'researching' ? 'amber' : 'grey')}" style="margin-left:8px;font-size:11px;padding:2px 6px;border-radius:4px;">${prof.status}</span>
      </div>
      ${prof.link ? `<a href="${escHtml(prof.link)}" target="_blank" rel="noopener" style="font-size:12px;color:var(--accent-blue);text-decoration:none;">🔗 Open Source</a>` : ''}
    </div>`;
}

function renderStalkList() {
  const tabCountEl = document.getElementById('stalk-tab-count');
  if (tabCountEl) tabCountEl.textContent = stalkCache.length;
  const list = document.getElementById('stalk-list');
  if (!stalkCache.length) { list.innerHTML = '<div class="empty-msg">No profiles yet. Click ＋ to add one.</div>'; return; }
  list.innerHTML = stalkCache.map(p => `
    <div class="ws-item${currentStalk?.id === p.id ? ' selected' : ''}" data-id="${p.id}">
      <div class="ws-item-row">
        <span class="status-dot ${p.status === 'ready' ? 'green' : (p.status === 'researching' ? 'amber' : 'grey')}"></span>
        <span class="ws-item-title">${escHtml(p.name)}</span>
      </div>
      <div class="ws-item-sub">${escHtml(p.link || 'No URL')} · ${p.status}</div>
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
      setTimeout(loadStalking, 3000);
    } catch (err) { alert(err.message); }
  }));
}

async function selectStalk(id) {
  const p = stalkCache.find(x => String(x.id) === String(id)) || null;
  currentStalk = p;
  renderStalkList();
  if (!p) return;

  // On mobile/tablet screens, auto switch to chat tab if currently on list
  if (window.innerWidth <= 1024) {
    const ws = document.querySelector('#view-stalking .hack-workspace');
    if (ws && ws.dataset.activeTab === 'list') {
      setWorkspaceTab('stalking', 'chat');
    }
  }

  updateStalkHeader(p);
  try {
    const { profile } = await apiFetch(`/api/stalking/${id}`);
    const prof = profile || p;
    currentStalk = prof;
    updateStalkHeader(prof);
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
  updateStalkHeader(null);
  document.getElementById('stalk-profile-card').innerHTML = '<div class="empty-msg">Kisi person ka naam + LinkedIn/GitHub URL do ya left me se select karo.</div>';
  document.getElementById('stalk-chat-messages').innerHTML = '<div class="empty-msg">👈 Left list me se koi person select karo ya naya add karo.</div>';
  document.getElementById('stalk-chat-input').disabled = false;
  document.getElementById('stalk-chat-input').placeholder = 'Person ka naam aur LinkedIn/GitHub URL do, ya left me se select karo…';
  document.getElementById('stalk-send-btn').disabled = false;
}

function getLinkInfo(urlStr) {
  const url = String(urlStr || '').toLowerCase();
  if (url.includes('github.com')) return { icon: '🐙', label: 'GitHub Profile' };
  if (url.includes('linkedin.com')) return { icon: '💼', label: 'LinkedIn Profile' };
  if (url.includes('leetcode.com')) return { icon: '🏆', label: 'LeetCode' };
  if (url.includes('codechef.com')) return { icon: '🍳', label: 'CodeChef' };
  if (url.includes('codeforces.com')) return { icon: '⚡', label: 'Codeforces' };
  if (url.includes('hackerrank.com')) return { icon: '🧩', label: 'HackerRank' };
  if (url.includes('kaggle.com')) return { icon: '📊', label: 'Kaggle' };
  if (url.includes('twitter.com') || url.includes('x.com')) return { icon: '🐦', label: 'X / Twitter' };
  if (url.includes('instagram.com')) return { icon: '📸', label: 'Instagram' };
  if (url.includes('medium.com')) return { icon: '📝', label: 'Medium' };
  if (url.includes('dev.to')) return { icon: '✍️', label: 'DEV.to' };
  if (url.includes('hashnode.')) return { icon: '⚡', label: 'Hashnode' };
  if (url.includes('producthunt.com')) return { icon: '😸', label: 'ProductHunt' };
  if (url.includes('youtube.com')) return { icon: '🎬', label: 'YouTube' };
  if (url.includes('vercel.app') || url.includes('netlify.app') || url.includes('.pages.dev') || url.includes('.web.app')) return { icon: '🚀', label: 'Live Deployed App' };
  try { return { icon: '🌐', label: new URL(urlStr).hostname.replace(/^www\./, '') }; } catch(e) { return { icon: '🔗', label: urlStr }; }
}

function renderProfileCard(p) {
  const d = p.profileData || {};
  const el = document.getElementById('stalk-profile-card');
  const primaryLinks = new Set((d.links || []).map(l => l.toLowerCase()));
  const ghNavPattern = /^https?:\/\/github\.com\/(resources|customer-stories|events|whitepapers|trust-center|partners|open-source|trending|sponsors|readme|features|security|pricing|marketplace|about|contact|explore|blog|docs|why-github|solutions|enterprise|team|collections|topics|changelog|releases|discussions|codespaces|copilot|actions|packages|skills|issues|pulls|notifications|showcases|guides|new|organizations|settings)(\/|$)/i;

  const discovered = (d.discoveredLinks || []).filter(l => {
    const url = String(l.url || '').toLowerCase();
    if (primaryLinks.has(url)) return false;
    if (ghNavPattern.test(l.url)) return false;
    return true;
  });

  const verifiedProfiles = [];
  const deployedDemos = [];
  const otherDiscovered = [];

  discovered.forEach(l => {
    const info = getLinkInfo(l.url);
    if (info.icon === '🚀') {
      deployedDemos.push({ ...l, info });
    } else if (['🐙','💼','🏆','🍳','⚡','🧩','📊','🐦','📸','📝','✍️','😸'].includes(info.icon)) {
      verifiedProfiles.push({ ...l, info });
    } else {
      otherDiscovered.push({ ...l, info });
    }
  });
  
  el.innerHTML = `
    <div class="profile-card">
      <div class="profile-head">
        <div class="profile-avatar">${escHtml((p.name || '?')[0].toUpperCase())}</div>
        <div>
          <div class="profile-name">${escHtml(p.name)}</div>
          <div class="profile-headline">${escHtml((d.headline && d.headline !== 'Unknown' && d.headline !== p.name) ? d.headline : '')}</div>
          <div class="profile-meta">${escHtml(d.location || '')}</div>
        </div>
      </div>
      ${d.bio ? `<div class="profile-sec"><div class="profile-sec-title">Bio</div><div>${escHtml(d.bio)}</div></div>` : ''}
      ${(d.certifications || []).length ? `<div class="profile-sec"><div class="profile-sec-title">🏆 Certifications, Badges & Achievements (${d.certifications.length})</div><div>${d.certifications.map(c => `<div class="profile-bullet">🏅 ${escHtml(c)}</div>`).join('')}</div></div>` : ''}
      ${(d.tech || []).length ? `<div class="profile-sec"><div class="profile-sec-title">Tech Stack</div><div class="tech-chips">${d.tech.map(t => `<span class="tech-chip">${escHtml(t)}</span>`).join('')}</div></div>` : ''}
      ${(d.summary || []).length ? `<div class="profile-sec"><div class="profile-sec-title">Deep-Dive Insights</div><div>${d.summary.map(s => `<div class="profile-bullet">• ${escHtml(s)}</div>`).join('')}</div></div>` : ''}
      ${(d.links || []).length ? `<div class="profile-sec"><div class="profile-sec-title">Primary Profile Link</div><div class="profile-links" style="display:flex;flex-direction:column;gap:5px;">${d.links.map(l => {
        const info = getLinkInfo(l);
        return `<div style="display:flex;align-items:center;gap:6px;"><span style="font-size:14px;">${info.icon}</span><a href="${escHtml(l)}" target="_blank" rel="noopener" style="font-size:12px;word-break:break-all;"><strong>${escHtml(info.label)}</strong> — ${escHtml(l)}</a></div>`;
      }).join('')}</div></div>` : ''}
      ${verifiedProfiles.length ? `
        <div class="profile-sec">
          <div class="profile-sec-title">👤 Verified Profiles (${verifiedProfiles.length})</div>
          <div class="profile-links" style="display:flex;flex-direction:column;gap:5px;max-height:160px;overflow-y:auto;">
            ${verifiedProfiles.map(l => `<div style="display:flex;align-items:center;gap:6px;"><span style="font-size:14px;">${l.info.icon}</span><a href="${escHtml(l.url)}" target="_blank" rel="noopener" style="font-size:12px;word-break:break-all;"><strong>${escHtml(l.info.label)}</strong> — ${escHtml(l.url)}</a></div>`).join('')}
          </div>
        </div>` : ''}
      ${deployedDemos.length ? `
        <div class="profile-sec">
          <div class="profile-sec-title">🚀 Deployed Live Demos (${deployedDemos.length})</div>
          <div class="profile-links" style="display:flex;flex-direction:column;gap:5px;">
            ${deployedDemos.map(l => `<div style="display:flex;align-items:center;gap:6px;"><span style="font-size:14px;">🚀</span><a href="${escHtml(l.url)}" target="_blank" rel="noopener" style="font-size:12px;word-break:break-all;"><strong>${escHtml(l.label || l.url)}</strong></a></div>`).join('')}
          </div>
        </div>` : ''}
      ${otherDiscovered.length ? `
        <div class="profile-sec">
          <div class="profile-sec-title">🌐 Discovered Links Network (${otherDiscovered.length})</div>
          <div class="profile-links" style="display:flex;flex-direction:column;gap:4px;max-height:140px;overflow-y:auto;">
            ${otherDiscovered.map(l => `<a href="${escHtml(l.url)}" target="_blank" rel="noopener" title="${escHtml(l.url)}">🔗 ${escHtml(l.label || l.url)} <span style="color:var(--text3);font-size:11px;">(${escHtml(l.source || 'web')})</span></a>`).join('')}
          </div>
        </div>` : ''}
      ${(d.githubRepos || []).length ? `
        <div class="profile-sec">
          <div class="profile-sec-title">🐙 GitHub Repositories (${d.githubRepos.length})</div>
          <div style="display:flex;flex-direction:column;gap:4px;max-height:160px;overflow-y:auto;">
            ${d.githubRepos.map(r => `
              <div class="repo-row" style="display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.03);padding:4px 8px;border-radius:4px;">
                <a href="${escHtml(r.url || `https://github.com/${r.name}`)}" target="_blank" rel="noopener" style="font-weight:600;font-size:12px;color:var(--accent-blue);text-decoration:none;">${escHtml(r.name)}</a>
                <span class="repo-stars" style="font-size:11px;color:var(--text-sub);">⭐ ${r.stars}</span>
              </div>`).join('')}
          </div>
        </div>` : ''}
      <div class="profile-foot" style="margin-top:12px;font-size:11px;color:var(--text-sub);">Last researched: ${d.lastResearchAt ? new Date(d.lastResearchAt).toLocaleString('en-IN') : 'never'}</div>
    </div>`;
}

document.getElementById('stalk-send-btn').addEventListener('click', sendStalkMessage);
attachAutoResizeTextarea('stalk-chat-input', sendStalkMessage);

async function sendStalkMessage() {
  const input = document.getElementById('stalk-chat-input');
  let text = input.value.trim();
  const fileToUpload = pendingStalkFile || pendingStalkPasteImage;
  if (!text && !fileToUpload) return;

  if (fileToUpload) {
    const uploadedRecord = await uploadFileRecord(fileToUpload);
    if (uploadedRecord) {
      const fileName = uploadedRecord.originalName || fileToUpload.name || 'file';
      const fileUrl = uploadedRecord.url || '';
      const extracted = uploadedRecord.extractedText ? `\n\n[File Content: ${uploadedRecord.extractedText.slice(0, 3000)}]` : '';
      text = text ? `📄 Attached File: ${fileName} (${fileUrl})\n${text}${extracted}` : `📄 Attached File: ${fileName} (${fileUrl})${extracted}`;
    }
    clearPendingStalkFile();
    clearPastedStalkImage();
  }

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
      const urlMatch = text.match(/https?:\/\/[^\s]+/);
      const link = urlMatch ? urlMatch[0] : null;
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

    if (data.action === 'data_updated' && data.updatedProfile) {
      currentStalk = data.updatedProfile;
      const idx = stalkCache.findIndex(x => String(x.id) === String(currentStalk.id));
      if (idx !== -1) stalkCache[idx] = currentStalk;
      renderProfileCard(currentStalk);
      renderStalkList();
    } else if (data.action === 'studying') {
      setTimeout(async () => {
        if (currentStalk) {
          const { profile } = await apiFetch(`/api/stalking/${currentStalk.id}`);
          if (profile) {
            currentStalk = profile;
            renderProfileCard(currentStalk);
            renderStalkList();
          }
        }
      }, 8000);
    }
  } catch (err) { appendWsMsg(el, 'assistant', 'Bob 🕵️', '⚠️ ' + err.message); }
  input.disabled = false; input.focus();
}

function openAddStalkModal() {
  openModal('🕵️ Add Person to Stalk', `
    <div class="modal-form">
      <label>Name / Username *<input id="sk-name" type="text" placeholder="e.g. Rahul Sharma or @rahul" /></label>
      <label>LinkedIn / GitHub / Site Link<input id="sk-link" type="url" placeholder="https://linkedin.com/in/... or https://github.com/..." /></label>
      <label>Notes / Context<textarea id="sk-notes" rows="3" placeholder="Pehle se kya pata hai, ya kis topic pe deep-dive karwani hai..."></textarea></label>
      <button id="sk-save" class="btn-primary" style="width:100%;">Start Deep-Dive Research</button>
    </div>`);
  document.getElementById('sk-save').addEventListener('click', async () => {
    const name = document.getElementById('sk-name').value.trim();
    const link = document.getElementById('sk-link').value.trim();
    if (!name && !link) { alert('Provide a name or link to stalk.'); return; }
    try {
      const { profile } = await apiFetch('/api/stalking', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, link, notes: document.getElementById('sk-notes').value.trim() }) });
      closeModal();
      await loadStalking();
      if (profile && profile.id) {
        await selectStalk(String(profile.id));
      }
    } catch (err) { alert(err.message); }
  });
}

document.getElementById('add-stalk-btn')?.addEventListener('click', openAddStalkModal);
document.getElementById('add-stalk-btn-sidebar')?.addEventListener('click', openAddStalkModal);

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
          <button class="btn-small" data-act="del" data-id="${r.id}" style="background:rgba(var(--red-rgb),0.15);color:var(--red);">🗑 Delete</button>
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
  body.innerHTML = '<div class="live-card"></div>';
}

// ── Shared workspace chat helpers ─────────────────────
function renderWsChat(el, messages, tag) {
  if (!messages || !messages.length) { el.innerHTML = '<div class="empty-msg">Is workspace me abhi koi baat nahi hui. Pehla message bhejo — context totally isolated hai.</div>'; return; }
  el.innerHTML = messages.map(m => wsMsgHTML(m.role, m.role === 'user' ? 'Nikhil' : (tag === 'hack' ? 'Bob 🏆' : tag === 'seo' ? 'Bob 🔍' : 'Bob 🕵️'), m.content)).join('');
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

// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
// KEYS LIMIT ENGINE (view)
// ═══════════════════════════════════════════════════════
let keysRefreshTimer = null;

async function loadKeys() {
  const grid = document.getElementById('keys-grid');
  try {
    const data = await apiFetch('/api/keys/health');
    const keys = data.keys || [];
    const summary = data.summary || {};

    // 3-pool model: NEW = untouched ($0, 0 usage); ACTIVE = in-flight (usage>0, healthy); EXHAUSTED = retired.
    const active = keys.filter(k => k.pool === 'ACTIVE');
    const newKeys = keys.filter(k => k.pool === 'NEW').sort((a, b) => String(a.keyId).localeCompare(b.keyId));
    const notActive = keys.filter(k => k.pool === 'EXHAUSTED');
    const byRole = {};
    keys.forEach(k => { byRole[k.role] = (byRole[k.role] || 0) + 1; });

    grid.innerHTML = `
      <div class="keys-summary-bar">
        <span class="ks-label">Active:</span><span class="ks-val ks-ok">${active.length}</span>
        <span class="ks-label">New spares:</span><span class="ks-val ks-ok">${newKeys.length}</span>
        <span class="ks-label">Exhausted:</span><span class="ks-val ks-bad">${notActive.length}</span>
        <span class="ks-label">Roles:</span><span class="ks-val">${Object.entries(byRole).map(([r,c]) => `${r}:${c}`).join(' ')}</span>
        <span class="ks-label">Max per key:</span><span class="ks-val">${(data.maxTokensPerKey || '—')}</span>
      </div>

      <div class="keys-section-title">🟢 Active Keys <span class="ks-note">In rotation (in-flight)</span></div>
      <div class="key-chips">${active.map(k => keyChip(k, 'ok')).join('') || '<div class="empty-msg">no active keys right now</div>'}</div>

      <div class="keys-section-title">🟡 New / Replacement Keys <span class="ks-note">Untouched spares — swap in when active exhaust</span></div>
      <div class="key-chips">
        <div class="ks-label">Available in pool: ${newKeys.length} key(s)</div>
        ${newKeys.map(k => keyChip(k, 'new')).join('')}
      </div>

      <div class="keys-section-title">🔴 Used / Expired <span class="ks-note">Exhausted or out of credits</span></div>
      <div class="key-chips">${notActive.map(k => keyChip(k, 'bad')).join('') || '<div class="empty-msg">none archived yet</div>'}</div>

      ${summary.allExhausted || active.length === 0
        ? '<div class="keys-empty-state">All active keys exhausted — add credits to a replacement key (or ask me to load the new keys), then hit Refresh.</div>'
        : ''}
    `;
  } catch (err) {
    grid.innerHTML = `<div class="empty-msg">⚠️ Keys health load fail: ${escHtml(err.message)}</div>`;
  }
}

function keyChip(k, variant) {
  const cls = variant === 'ok' ? 'key-ok' : variant === 'new' ? 'key-new' : 'key-bad';
  const bal = typeof k.balance === 'number' ? k.balance : '?';
  const used = typeof k.tokensUsed === 'number' ? k.tokensUsed : 0;
  const last = k.lastCheck ? new Date(k.lastCheck).toLocaleTimeString('en-IN', { hour12: false }) : '—';
  const label = k.keyId || (k.last4 ? `…${k.last4}` : '#');
  return `<div class="key-chip ${cls}">
    <span class="key-last4">${label}</span>
    <span class="key-role">${k.role || 'REPLACEMENT'}</span>
    <span class="key-bal">bal ${bal}</span>
    <span class="key-used">used ${used}</span>
    <span class="key-pool">pool ${k.pool || variant}</span>
    <span class="key-time">${last}</span>
  </div>`;
}

document.addEventListener('click', async (e) => {
  if (e.target && e.target.id === 'keys-refresh-btn') {
    e.target.disabled = true; e.target.textContent = 'Refreshing…';
    try { await loadKeys(); } catch (err) { console.error('keys refresh:', err.message); }
    setTimeout(async () => {
      e.target.disabled = false; e.target.textContent = 'Refresh now';
      await loadKeys();
    }, 2000);
  }
});
