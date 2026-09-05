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
    console.error('Login error:', err);
    errEl.textContent = friendlyAuthError(err.code) || err.message;
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
  restoreWorkspaceState();
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
  const headers = {
    'Authorization': `Bearer ${idToken}`,
    ...(options.headers || {}),
  };
  if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(API + path, {
    ...options,
    headers
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
    if (title.startsWith('🏆') || title.startsWith('🕵️') || title.startsWith('🔎') || title.startsWith('🔍')) return false;
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
  localStorage.setItem(currentPersona === 'builder' ? 'bob_builder_session' : 'bob_chat_session', session.id);
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
      let data = null;
      const trimmed = (blockContent || '').trim();
      try {
        data = JSON.parse(trimmed);
      } catch {
        const titleMatch = trimmed.match(/"title"\s*:\s*"([^"]+)"/i) || trimmed.match(/title\s*[:=]\s*(.+?)(?:\n|$)/i);
        const instrMatch = trimmed.match(/"instruction"\s*:\s*"([\s\S]*?)"\s*}/i) || trimmed.match(/instruction\s*[:=]\s*([\s\S]+)/i);
        const title = (titleMatch ? titleMatch[1].trim() : trimmed.split('\n')[0].replace(/[{}"']/g, '').trim()) || 'Project Delegation';
        const instruction = (instrMatch ? instrMatch[1].trim() : trimmed.replace(/^{?\s*"title":.*?,?/i, '').replace(/}?$/, '').trim()) || trimmed;
        if (instruction) {
          data = { title: title.slice(0, 80), instruction };
        }
      }
      if (data && data.instruction && typeof data.instruction === 'string' && data.instruction.trim().length > 5) {
        blocks.push({ type: 'builder', data });
      } else if (trimmed.length > 15 && !trimmed.startsWith('{') && !trimmed.startsWith('```')) {
        blocks.push({ type: 'builder', data: { title: 'Builder Task', instruction: trimmed } });
      } else if (trimmed.length > 0) {
        blocks.push({ type: 'text', content: match[0] });
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
    const out = await apiFetch('/api/builder/delegate', {
      method: 'POST',
      body: JSON.stringify({
        title: data.title,
        instruction: data.instruction,
        sessionId: data.sessionId || null,
      }),
    });
    const body = card.querySelector('.builder-delegation-body');
    const meta = card.querySelector('.file-gen-meta');

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
  updateSendBtnState();
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

// ── Multi-File & Paste Support (Ctrl+V) ─────────────────
let pendingFiles = [];
let pendingPasteImages = [];

function updateSendBtnState() {
  sendBtn.disabled = !messageInput.value.trim() && pendingFiles.length === 0 && pendingPasteImages.length === 0 && !pendingStorageFile;
}

messageInput.addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;

  let hasFile = false;
  for (const item of items) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (!file) continue;
      hasFile = true;
      if (file.type.startsWith('image/')) {
        pendingPasteImages.push(file);
      } else {
        pendingFiles.push(file);
      }
    }
  }

  if (hasFile) {
    e.preventDefault();
    renderAllPreviews();
    updateSendBtnState();
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
  { icon: '🎨', label: 'E-commerce app ke liye best color palette & stack suggest karo' },
  { icon: '⚡', label: 'Next.js vs Vite/React architecture & DB design discuss karo' },
  { icon: '🏗️', label: 'Full-stack SaaS dashboard ka schema & auth flow plan karo' },
  { icon: '📱', label: 'Mobile app ke liye state & offline storage architect karo' },
  { icon: '🚀', label: 'AI tool project ka roadmap & feature plan banao' },
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
    sub.textContent = 'Your Principal Software Architect & Tech Co-Founder. Discuss tech stacks, color palettes, database schemas & architecture. Jab ready ho, tab final code files generate hongi.';
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
      <img src="/logo.png" class="welcome-cat-logo" alt="Bob" />
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
  localStorage.setItem('bob_persona', p);
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

  if (!text && pendingFiles.length === 0 && pendingPasteImages.length === 0 && !pendingStorageFile) return;

  // Collect image URLs to send to Bob for vision analysis (Bob persona only)
  const imageUrls = [];
  const documents = [];

  if (currentPersona === 'bob') {
    // Upload pasted screenshots if any
    if (pendingPasteImages.length > 0) {
      const pasteUploads = await Promise.all(
        pendingPasteImages.map(img => uploadImageFile(img, 'pasted-screenshot'))
      );
      pasteUploads.filter(Boolean).forEach(url => imageUrls.push(url));
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

    // Upload newly attached files from disk if any
    if (pendingFiles.length > 0) {
      const uploadedRecords = await uploadPendingFile();
      for (const uploadedRecord of uploadedRecords) {
        if (!uploadedRecord) continue;
        const isImage = uploadedRecord.resourceType === 'image' || (uploadedRecord.originalName || '').match(/\.(jpg|jpeg|png|gif|webp)$/i);
        if (isImage) {
          imageUrls.push(uploadedRecord.url);
        } else {
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

  // Show user message (with image/doc indicators if applicable)
  let prefix = '';
  if (imageUrls.length > 0 && documents.length > 0) {
    prefix = `🖼️📄 [${imageUrls.length} image(s), ${documents.length} document(s) attached]\n`;
  } else if (imageUrls.length > 1) {
    prefix = `🖼️ [${imageUrls.length} images attached]\n`;
  } else if (imageUrls.length === 1) {
    prefix = `🖼️ [Screenshot attached]\n`;
  } else if (documents.length > 1) {
    prefix = `📄 [${documents.length} documents attached]\n`;
  } else if (documents.length === 1) {
    prefix = `📄 [Document attached: ${documents[0].name}]\n`;
  }

  const displayText = prefix ? `${prefix}${text || 'Yeh dekho aur samjhao'}` : text;
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

function getAttachedFileIcon(file) {
  const type = file.type || '';
  const name = (file.name || '').toLowerCase();
  if (type.startsWith('image/')) return '🖼️';
  if (type.startsWith('audio/')) return '🎵';
  if (type.startsWith('video/')) return '🎬';
  if (type.includes('pdf')) return '📕';
  if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.xlsx') || name.endsWith('.xls')) return '📊';
  if (name.endsWith('.json')) return '🔧';
  if (name.endsWith('.py')) return '🐍';
  if (name.endsWith('.js') || name.endsWith('.ts')) return '🟨';
  if (name.endsWith('.html') || name.endsWith('.htm')) return '🌐';
  if (name.endsWith('.md')) return '📝';
  if (name.endsWith('.sql')) return '🗃️';
  if (name.endsWith('.cpp') || name.endsWith('.c') || name.endsWith('.java')) return '⚡';
  if (name.endsWith('.sh') || name.endsWith('.bash')) return '💻';
  return '📄';
}

function renderAllPreviews() {
  const preview = document.getElementById('file-preview');
  if (!preview) return;

  const totalCount = pendingFiles.length + pendingPasteImages.length + (pendingStorageFile ? 1 : 0);
  if (totalCount === 0) {
    preview.classList.add('hidden');
    preview.innerHTML = '';
    return;
  }

  preview.classList.remove('hidden');
  preview.innerHTML = '';

  // 1. Attached disk files
  pendingFiles.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'file-preview-item';
    item.innerHTML = `
      <span class="file-type-badge">${getAttachedFileIcon(file)}</span>
      <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escHtml(file.name)}">${escHtml(file.name)} <span style="color:var(--text3)">(${formatBytes(file.size)})</span></span>
      <button type="button" class="remove-file" data-idx="${index}">✕</button>
    `;
    item.querySelector('.remove-file').addEventListener('click', (e) => {
      e.stopPropagation();
      pendingFiles.splice(index, 1);
      renderAllPreviews();
      updateSendBtnState();
    });
    preview.appendChild(item);
  });

  // 2. Pasted clipboard images
  pendingPasteImages.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'file-preview-item';
    item.innerHTML = `
      <span class="file-type-badge">🖼️</span>
      <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">Pasted #${index + 1} <span style="color:var(--text3)">(${formatBytes(file.size)})</span></span>
      <button type="button" class="remove-file" data-paste-idx="${index}">✕</button>
    `;
    item.querySelector('.remove-file').addEventListener('click', (e) => {
      e.stopPropagation();
      pendingPasteImages.splice(index, 1);
      renderAllPreviews();
      updateSendBtnState();
    });
    preview.appendChild(item);
  });

  // 3. Pending storage file
  if (pendingStorageFile) {
    const name = pendingStorageFile.originalName || pendingStorageFile.publicId || 'Storage Document';
    const icon = getFileIcon(name, pendingStorageFile.resourceType);
    const size = formatBytes(pendingStorageFile.sizeBytes || 0);
    const item = document.createElement('div');
    item.className = 'file-preview-item';
    item.innerHTML = `
      <span class="file-type-badge">${icon}</span>
      <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escHtml(name)}">${escHtml(name)} <span style="color:var(--text3)">(${size} • Storage)</span></span>
      <button type="button" class="remove-file" id="remove-storage-btn">✕</button>
    `;
    item.querySelector('.remove-file').addEventListener('click', (e) => {
      e.stopPropagation();
      pendingStorageFile = null;
      renderAllPreviews();
      updateSendBtnState();
    });
    preview.appendChild(item);
  }
}

function updateSendBtnState() {
  sendBtn.disabled = !messageInput.value.trim() && pendingFiles.length === 0 && pendingPasteImages.length === 0 && !pendingStorageFile;
}

function clearPendingStorageFile() {
  pendingStorageFile = null;
  renderAllPreviews();
  updateSendBtnState();
}

function clearPendingFile() {
  pendingFiles = [];
  const input = document.getElementById('file-upload-input');
  if (input) input.value = '';
  renderAllPreviews();
  updateSendBtnState();
}

function clearPastedImage() {
  pendingPasteImages = [];
  renderAllPreviews();
  updateSendBtnState();
}

function setStorageFileSelected(file) {
  pendingStorageFile = file;
  renderAllPreviews();
  updateSendBtnState();
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
  const selectedFiles = Array.from(e.target.files || []);
  if (!selectedFiles.length) return;

  // Add selected files to pendingFiles list
  pendingFiles.push(...selectedFiles);

  renderAllPreviews();
  updateSendBtnState();
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
  if (!currentSession || pendingFiles.length === 0) return [];
  const filesToUpload = [...pendingFiles];
  clearPendingFile();
  const results = await Promise.all(filesToUpload.map(f => uploadFileRecord(f)));
  return results.filter(Boolean);
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
  // Remember where the user left off so we can reopen it after reload.
  localStorage.setItem('bob_last_view', next);
  return next;
}

// Reopen wherever the user was before closing/reloading the page.
// Safe views only (no PIN / interactive flows); chat personas + last
// conversation resume automatically.
async function restoreWorkspaceState() {
  const view = localStorage.getItem('bob_last_view') || '';
  const p = localStorage.getItem('bob_persona') || '';
  const sidKey = p === 'builder' ? 'bob_builder_session' : 'bob_chat_session';
  const sid = localStorage.getItem(sidKey) || '';
  if (p && p !== 'bob') setPersona('builder');
  if (['hackathons', 'stalking', 'seo', 'routines', 'live', 'memory', 'files', 'keys', 'hq', 'resume_builder', 'resume'].includes(view)) {
    openHqCard(view === 'resume' ? 'resume_builder' : view);
    return;
  }
  if (!sid) return;
  try {
    await loadSessions();
    const row = document.querySelector(`.session-item[data-id="${sid}"]`);
    if (!row) { localStorage.removeItem(sidKey); return; }
    await selectSession({ id: sid, title: row.dataset.title });
  } catch (err) {
    localStorage.removeItem(sidKey);
  }
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
    title: 'Deep Research',
    tag: '[Research]',
    icon: '🔎',
    desc: 'Target research — social handles (IG, LinkedIn, GitHub) aur crawled profiles',
    emptyMsg: 'Koi researched profile abhi save nahi hua.',
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
    cachedSessions = (sessRes.sessions || []).filter(s => !s.title?.startsWith('🏆') && !s.title?.startsWith('🕵️') && !s.title?.startsWith('🔎') && !s.title?.startsWith('🔍'));

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
  if (type === 'stalker' || category === 'stalker') return '🔎';
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
      list.innerHTML = `<div class="empty-msg">No profiles researched yet. Deep Research workspace me add karo ya upar memory point add karo!</div>`;
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
                  <div class="memory-entity-avatar">🔎</div>
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
                  <button class="btn-small btn-open-stalker-ws" data-prof-id="${p.id}" style="background:rgba(var(--cyan-rgb),0.15); border:1px solid rgba(var(--cyan-rgb),0.3); color:var(--cyan);">💬 Deep Research</button>
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
                        <span class="fact-cat-badge">🔎</span>
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

  // Build a lookup map: sessionId -> pageMap key (for fast sessionId-based fact assignment)
  const sessionIdToKey = new Map();
  if (activeMemoryCat === 'main') {
    cachedSessions.forEach(s => {
      const title = s.title || `Chat ${s.id.slice(-5)}`;
      sessionIdToKey.set(s.id, title.toLowerCase());
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

    let key = pageTitle.toLowerCase();

    // ── FIX: If we're in 'main' category and the fact has a sessionId,
    // always attach it to that session's page (even if sourceTitle changed/mismatches)
    if (activeMemoryCat === 'main' && f.sessionId && sessionIdToKey.has(f.sessionId)) {
      key = sessionIdToKey.get(f.sessionId);
    }

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

  // For 'main' category, hide sessions that have no facts saved (reduces clutter)
  let pages = Array.from(pageMap.values());
  if (activeMemoryCat === 'main') {
    // Always show pages with facts; show empty pages only if there are no other pages with facts
    const pagesWithFacts = pages.filter(p => p.facts.length > 0);
    pages = pagesWithFacts.length > 0 ? pagesWithFacts : pages;
  }

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

    const defaultTitle = activeMemoryCat === 'stalker' ? 'Deep Research' : activeMemoryCat === 'hackathons' ? 'Hackathons' : activeMemoryCat === 'habits' ? 'Habits & Preferences' : (currentSession?.title || 'Main Memory');

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

  const disc = c.discovery || {};
  const nextScanText = disc.nextRunAt ? (disc.nextRunAt > Date.now() ? `in ${Math.ceil((disc.nextRunAt - Date.now()) / (3600000 * 24))}d` : 'ready') : '4-day cycle';
  const discMeta = disc.enabled === false ? 'auto-scan: paused' : `auto-scan: ${nextScanText} · 4-day cycle`;

  const cards = [
    hqCard({ id: 'keys', icon: '🔑', title: 'Keys Limit', color: 'amber', badge: 'OpenRouter', meta: 'key health · auto-refresh', items: [], action: 'Open Keys Management' }),
    hqCard({ id: 'hackathons', icon: '🏆', title: 'Hackathons', color: (hacks.active || 0) > 0 ? 'green' : 'amber', badge: `${hacks.count || 0}`, meta: `active ${hacks.active || 0} · tracking ${hacks.tracking || 0} · 🟢 ${hacks.participating || 0}`, items: (hacks.items || []).slice(0, 3).map(h => ({ text: h.title, sub: `${h.status} · ${fmtDate(h.endDate)}`, dot: h.statusColor })), action: 'Open Hackathon Workspace' }),
    hqCard({ id: 'stalking', icon: '🕵️', title: 'Developer Radar', color: (stalks.researching || 0) > 0 ? 'amber' : 'green', badge: `${stalks.count || 0}`, meta: `ready ${stalks.ready || 0} · researching ${stalks.researching || 0}`, items: (stalks.items || []).slice(0, 3).map(s => ({ text: s.name, sub: s.status, dot: s.status === 'ready' ? 'green' : (s.status === 'researching' ? 'amber' : 'grey') })), action: 'Open Developer Radar' }),
    hqCard({ id: 'routines', icon: '⏰', title: 'Routines', color: (routs.dueSoon || 0) > 0 ? 'green' : 'amber', badge: `${routs.active || 0} active`, meta: `total ${routs.count || 0} · due soon ${routs.dueSoon || 0}`, items: (routs.items || []).slice(0, 3).map(r => ({ text: r.title, sub: `${r.workspace || ''} · every ${r.intervalHours}h`, dot: r.active ? 'green' : 'grey' })), action: 'Open Routines Engine' }),
    hqCard({ id: 'vault', icon: '🔒', title: 'Secret Vault', color: 'amber', badge: 'private', meta: 'PIN protected · spacious workspace', items: [], action: 'Open Secret Vault' }),
    hqCard({ id: 'memory', icon: '🧠', title: 'Memory', color: 'green', badge: `${facts.length} facts`, meta: `months ${months.length}`, items: facts.slice(0, 3).map(f => ({ text: f.text, sub: '', dot: 'green' })), action: 'Open Memory Workspace' }),
    hqCard({ id: 'files', icon: '📁', title: 'Files', color: 'grey', badge: `${files.length}`, meta: 'uploaded files', items: files.slice(0, 3).map(f => ({ text: f.filename || f.id, sub: '', dot: 'grey' })), action: 'Open Files Workspace' }),
    hqCard({ id: 'live', icon: '⚡', title: 'Hackathon Radar', color: disc.enabled === false ? 'amber' : 'green', badge: `${disc.count || 0} discovered`, meta: discMeta, items: (disc.items || []).map(d => ({ text: d.title, sub: `${d.platform} · ${d.prize || 'open'}`, dot: 'green' })), action: 'Open Hackathon Radar' }),
    hqCard({ id: 'resume_builder', icon: '📄', title: 'Resume Builder', color: 'blue', badge: 'Workspace', meta: 'AI Resume Architect & ATS Scanner', items: [], action: 'Open Resume Builder' }),
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
  if (id === 'resume_builder') { showView('resume'); loadResumeProfile(); return; }
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
      const lastMsg = el.querySelector('.ws-msg.assistant:last-child .ws-msg-text');
      if (lastMsg) {
        const badge = document.createElement('div');
        badge.style.cssText = 'margin-top:8px;padding:4px 10px;background:rgba(74,222,128,0.15);border:1px solid rgba(74,222,128,0.4);border-radius:6px;font-size:11px;color:#4ade80;display:inline-block;';
        badge.textContent = '📚 Knowledge panel updated from your paste!';
        lastMsg.appendChild(badge);
      }
      try {
        const { hackathon } = await apiFetch(`/api/hackathons/${currentHack.id}`);
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
  const cached = seoSitesCache.find(s => String(s.id) === String(id));
  if (!cached) return;
  let site = cached;
  currentSeoSite = site;
  renderSeoList();
  try {
    const { site: full } = await apiFetch('/api/seo/' + id);
    if (full) {
      site = full;
      currentSeoSite = full;
      const idx = seoSitesCache.findIndex(s => String(s.id) === String(id));
      if (idx >= 0) seoSitesCache[idx] = full;
    }
  } catch (err) {
    console.error('SEO full site load failed:', err);
  }

  if (window.innerWidth <= 1024) {
    const ws = document.querySelector('#view-seo .hack-workspace');
    if (ws && ws.dataset.activeTab === 'list') setWorkspaceTab('seo', 'chat');
  }

  const score = site.lastScore;
  const header = document.getElementById('seo-chat-header');
  if (header) header.innerHTML = `<span>🔍 ${escHtml(site.domain || site.url)}</span>${typeof score === 'number' ? `<span class="ws-chat-header-status ${seoScoreClass(score)}">${score}/100</span>` : ''}`;

  const input = document.getElementById('seo-chat-input');
  if (input) { input.disabled = false; input.placeholder = 'Website ke SEO issues aur problems ke baare me poochho…'; }
  const sendBtn = document.getElementById('seo-send-btn');
  if (sendBtn) sendBtn.disabled = false;

  renderSeoAudit(site);
  await loadSeoChat(id);
  if (input) input.focus();
}

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

async function seoExportSite(site, fmt) {
  // fmt: 'doc' | 'pdf' | 'html' — replaced legacy JSON/CSV exports
  const safeDomain = (site.domain || site.url || 'site').replace(/[^a-zA-Z0-9._-]/g, '_');
  const reportBody = (html) => {
    const tmp = document.createElement('template');
    tmp.innerHTML = html;
    const style = (tmp.content.querySelector('style') || { textContent: '' }).textContent || '';
    const body = (tmp.content.querySelector('body') || tmp.content).innerHTML || html;
    return { style, body };
  };
  try {
    const { html } = await apiFetch('/api/seo/' + site.id + '/report');
    if (fmt === 'html') {
      seoDownloadBlob(`seo-report-${safeDomain}.html`, html, 'text/html');
      return;
    }
    if (fmt === 'pdf') {
      const { style, body } = reportBody(html);
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
      f.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>SEO Report: ${escHtml(site.domain || site.url)}</title><style>${style}</style></head><body>${body}</body></html>`;
      document.body.appendChild(f);
      f.addEventListener('load', () => setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) {} }, 80));
      return;
    }
    const { style, body } = reportBody(html);
    const wordHtml = '\ufeff<html xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>SEO Report</title><style>' + style + '</style></head><body>' + body + '</body></html>';
    seoDownloadBlob(`seo-report-${safeDomain}.doc`, wordHtml, 'application/msword');
  } catch (err) {
    alert('Export failed: ' + err.message);
    throw err;
  }
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

  const signalRow = (label, value) =>
    `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;color:var(--text2);"><span>${label}</span><span style="font-weight:600;color:var(--text1);">${value}</span></div>`;

  const ps = a.pageSpeed || {};
  const psLive = ps.fetched === true || signals.pageSpeedFetched === true;
  const cwvRow = (label, val, good, warn) => {
    if (val == null || val === '') return '';
    const n = parseFloat(String(val));
    const color = !isNaN(n) ? (n <= good ? 'var(--green)' : n <= warn ? 'var(--amber)' : '#f87171') : 'var(--text1)';
    return signalRow(label, '<span style="color:' + color + ';">' + escHtml(String(val)) + '</span>');
  };
  const psPerf = (typeof ps.perfScore === 'number') ? ps.perfScore : (typeof signals.perfScore === 'number') ? signals.perfScore : null;
  const serpUrl = String(a.homeUrl || site.url || '');
  const serpDomain = String(site.domain || serpUrl.replace(/^https?:\/\//, '').split('/')[0] || '');
  let serpPath = '';
  try { serpPath = new URL(serpUrl).pathname.replace(/\/$/, ''); } catch (e) { }
  const serpCrumb = serpDomain + (serpPath ? ' › ' + serpPath.replace(/\//g, ' › ') : '');
  const serpTitle = String(site.title || site.domain || '');
  const serpSnippet = String(signals.metaDescription || a.summary || 'No meta description — Google koi bhi random snippet utha lega.').slice(0, 160);

  const allIssues = compileAllSeoIssues(site);

  const opTab = (id, active, label) =>
    `<button class="seo-op-tab${active ? ' seo-op-tab-on' : ''}" data-seop="${id}" style="padding:6px 12px;border-radius:8px;background:#00000033;color:var(--text2);font-size:11px;font-weight:700;border:1px solid #ffffff18;${active ? 'background:#00000055;color:var(--text1);box-shadow:inset 0 0 0 1px #ffffff33;' : ''}">${label}</button>`;

  el.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
      ${opTab('dash', true, '📊 Dashboard')}
      ${opTab('issues', false, '⚠️ Issues (' + allIssues.length + ')')}
      ${opTab('strengths', false, '✅ Strengths')}
      ${opTab('topics', false, '🗺 16-Topics')}
      ${opTab('pages', false, '🗂️ Pages (' + ((a.crawledPages || []).length) + ')')}
    </div>
    <div class="seo-op-pane" data-seopath="dash">
      <div class="ws-kb-block" style="text-align:center;">
        <div style="font-size:44px;font-weight:800;color:${seoScoreColor(score)};line-height:1.1;">${typeof score === 'number' ? score + '<span style="font-size:16px;">/100</span>' : '—'}</div>
        ${seoSparkline(site.history)}
        <div style="font-size:11px;color:var(--text3);">${typeof a.pagesFound === 'number' ? a.pagesFound + ' pages audited · ' : ''}${a.auditedAt ? new Date(a.auditedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : ''}</div>
      </div>
      <!-- ✨ Level 4: Token-Optimized AI Action Plan -->
      <div class="ws-kb-block" style="background: linear-gradient(135deg, rgba(var(--accent-rgb),0.1), rgba(0,0,0,0.3)); border: 1px solid rgba(var(--accent-rgb),0.25); border-radius: 8px; padding: 12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-weight:700;font-size:12px;color:var(--text1);">✨ Bob AI Master Plan</span>
          ${(a.aiActionPlan) ? '<span style="font-size:10px;color:var(--green);font-weight:700;padding:2px 6px;border-radius:4px;background:rgba(52,211,153,0.12);">✓ Ready in Chat</span>' : ''}
        </div>
        <div style="font-size:11px;color:var(--text2);margin-zero:6px 0 10px;line-height:1.45;">
          ${(a.aiActionPlan) 
            ? 'Pura roadmap niche preview hai — chat section mein bhi available. Re-generate for fresh plan.' 
            : 'Master Bob website ke 50+ pages, Core Web Vitals aur vulnerabilities ko analyze karke action plan dega.'}
        </div>
        ${(a.aiActionPlan && a.aiActionPlan.text)
          ? `<div class="md-content" style="max-height:230px;overflow-y:auto;margin-bottom:10px;font-size:11.5px;color:var(--text1);line-height:1.55;background:rgba(0,0,0,0.28);border:1px solid rgba(var(--accent-rgb),0.2);border-radius:6px;padding:10px 12px;">${renderTextContent(a.aiActionPlan.text)}</div>`
          : ''}
        <button class="btn-small btn-primary" id="seo-generate-ai-plan" style="width:100%;font-weight:700;box-shadow: 0 2px 10px rgba(var(--accent-rgb),0.35);">
          ${(a.aiActionPlan) ? '💬 View / Re-Generate in Chat' : '✨ Generate AI Action Plan in Chat'}
        </button>
      </div>

      <!-- Level 3: Google SERP emulator + Core Web Vitals -->
      <div class="ws-kb-block"><div class="ws-kb-label">🔍 Google Search Preview</div>
        <div style="background:#ffffff;color:#202124;border-radius:6px;padding:10px 12px;margin-top:4px;font-family:'Segoe UI',Arial,sans-serif;">
          <div style="display:flex;gap:6px;align-items:center;font-size:10px;color:#5f6368;"><span>🌐</span><span>${escHtml(serpCrumb)}</span></div>
          <div style="font-size:15px;line-height:1.25;color:#1a0dab;margin:2px 0;">${escHtml(serpTitle)}</div>
          <div style="font-size:11px;line-height:1.45;">${escHtml(serpSnippet)}</div>
        </div>
        <div style="font-size:10px;color:var(--text3);margin-top:6px;">Google index par aapka site aise dikhega (title • meta description • URL).</div>
      </div>

      <div class="ws-kb-block"><div class="ws-kb-label">⚡ Core Web Vitals ${psLive ? '<span style="font-size:9px;color:var(--green);font-weight:700;padding:2px 6px;border-radius:4px;background:rgba(52,211,153,0.12);">Google PSI • Mobile</span>' : '<span style="font-size:9px;color:var(--amber);font-weight:700;padding:2px 6px;border-radius:4px;background:rgba(251,191,36,0.12);">Estimate</span>'}</div>
        ${psPerf != null ? signalRow('🏆 Performance', psPerf + '/100') : ''}
        ${cwvRow('🎨 LCP', (ps.lcp != null) ? ps.lcp : signals.lcp, 2.5, 4)}
        ${cwvRow('⚡ FCP', (ps.fcp != null) ? ps.fcp : signals.fcp, 1.8, 3)}
        ${cwvRow('📐 CLS', (ps.cls != null) ? ps.cls : signals.cls, 0.1, 0.25)}
        ${cwvRow('🔨 TBT', (ps.tbt != null) ? ps.tbt : signals.tbt, 200, 600)}
        ${signalRow('📡 Strategy', (ps.strategy != null) ? escHtml(ps.strategy) : 'mobile')}
      </div>

      <div class="ws-kb-block"><div class="ws-kb-label">🌐 Technical Signals</div>
        ${signalRow('⚡ TTFB', typeof signals.ttfbMs === 'number' ? signals.ttfbMs + 'ms' : '—')}
        ${signalRow('📦 Page size', typeof signals.htmlBytes === 'number' ? (signals.htmlBytes / 1024).toFixed(0) + ' KB' : '—')}
        ${signalRow('🧩 Scripts', typeof signals.scriptSrcCount === 'number' ? signals.scriptSrcCount + ' (' + (signals.blockingScripts ? '⚠️ ' + signals.blockingScripts + ' blocking' : '0 blocking') + ')' : '—')}
        ${signalRow('🎨 CSS files', typeof signals.cssLinkCount === 'number' ? signals.cssLinkCount : '—')}
        ${signalRow('🖼 Images', typeof signals.imgCount === 'number' ? signals.imgCount + ' (' + (signals.lazyImages || 0) + ' lazy)' : '—')}
        ${signalRow('🧱 Semantic tags', typeof signals.semanticCount === 'number' ? signals.semanticCount + '/7' : '—')}
        ${signalRow('🗺 Sitemap', typeof sitemapCount === 'number' ? sitemapCount + ' URLs' + (sitemapLastmod ? ' (📅 ' + sitemapLastmod + ' lastmod)' : '') : '—')}
        ${signalRow('🤖 robots.txt', robotsExists ? 'found' : 'missing')}
        ${typeof signals.hreflangCount === 'number' ? signalRow('🌍 hreflang', signals.hreflangCount + (signals.hreflangCount === 1 ? ' lang' : ' langs')) : ''}
        ${Array.isArray(signals.schemaTypes) && signals.schemaTypes.length ? signalRow('🧩 Schema', signals.schemaTypes.join(', ')) : ''}
      </div>
      <div class="ws-kb-block"><div class="ws-kb-label">⚙️ Site Management</div>
        <select id="seo-reaudit-freq" style="width:100%;padding:6px;border-radius:6px;background:#00000033;color:var(--text1);border:1px solid #ffffff22;font-size:12px;">
          <option value="0">Off — sirf manual re-audit</option>
          <option value="24">Daily (har 24h)</option>
          <option value="168">Weekly (har 168h)</option>
          <option value="custom">Custom... (apni day gap do)</option>
        </select>
        <div style="display:none;gap:6px;align-items:center;margin-top:6px;" id="seo-reaudit-custom">
          <input id="seo-reaudit-days" type="number" min="1" max="30" value="2" title="Days (1-30)" style="flex:1;padding:6px;border-radius:6px;background:#00000033;color:var(--text1);border:1px solid #ffffff22;font-size:12px;">
          <button class="btn-small" id="seo-reaudit-custom-apply" style="font-size:11px;">Har X din — Apply</button>
        </div>
        <div style="font-size:10px;color:var(--text3);margin-top:4px;">GitHub Actions background pump auto re-audit karega aur score history maintain rakhega. Custom = har 2 / 3 / 4 din jaisa gap.</div>
        <div style="display:flex;gap:6px;margin-top:8px;">
          <button class="btn-small" id="seo-export-pdf" title="Save as PDF (print dialog)" style="flex:1;">⤓ PDF</button>
          
          <button class="btn-small" id="seo-report-btn" title="Download full HTML report" style="flex:1;">📄 HTML</button>
        </div>
        <button class="btn-small" id="re-audit-seo" style="width:100%;margin-top:8px;padding:6px 0;font-weight:700;">↻ Re-Audit Website</button>
      </div>
    </div>
    <div class="seo-op-pane" data-seopath="issues" hidden id="seo-op-issues"></div>
    <div class="seo-op-pane" data-seopath="strengths" hidden id="seo-op-strengths"></div>
    <div class="seo-op-pane" data-seopath="topics" hidden id="seo-op-topics"></div>
    <div class="seo-op-pane" data-seopath="pages" hidden id="seo-op-pages"></div>
  `;

  renderSeoIssues(site);
  renderSeoStrengths(site);
  renderSeoTopics(site);
  renderSeoPages(site);

    const genPlanBtn = document.getElementById('seo-generate-ai-plan');
  if (genPlanBtn) {
    genPlanBtn.addEventListener('click', async () => {
      genPlanBtn.disabled = true;
      genPlanBtn.textContent = '⏳ Formulating Plan…';
      try {
        const res = await apiFetch('/api/seo/' + site.id + '/actionplan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: !!(site.audit && site.audit.aiActionPlan) }) });
        if (site.audit) site.audit.aiActionPlan = res.plan;
        renderSeoAudit(site);
        // Switch mobile tab to chat if mobile
        setWorkspaceTab('seo', 'chat');
        // Reload chat to display the new action plan
        await loadSeoChat(site.id);
        const chatFeed = document.getElementById('seo-chat-messages');
        if (chatFeed) chatFeed.scrollTop = chatFeed.scrollHeight;
      } catch (err) {
        alert('Action plan generation failed: ' + err.message);
        if (genPlanBtn) { genPlanBtn.disabled = false; genPlanBtn.textContent = '✨ Generate AI Action Plan in Chat'; }
      }
    });
  }

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

  const expPdf = document.getElementById('seo-export-pdf');
  if (expPdf) expPdf.addEventListener('click', async () => {
    expPdf.disabled = true; expPdf.textContent = '⏳';
    try { await seoExportSite(site, 'pdf'); } catch (e) {}
    finally { expPdf.disabled = false; expPdf.textContent = '⤓ PDF'; }
  });
  const expDoc = document.getElementById('seo-export-doc');
  if (expDoc) expDoc.addEventListener('click', async () => {
    expDoc.disabled = true; expDoc.textContent = '⏳';
    try { await seoExportSite(site, 'doc'); } catch (e) {}
    finally { expDoc.disabled = false; expDoc.textContent = '⤓ DOC'; }
  });

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
    const customRow = document.getElementById('seo-reaudit-custom');
    const daysInp = document.getElementById('seo-reaudit-days');
    const presetInterval = site.reAuditEnabled ? (Number(site.reAuditIntervalHours) || 24) : 0;
    const preset = !site.reAuditEnabled ? '0' : presetInterval === 24 ? '24' : presetInterval === 168 ? '168' : 'custom';
    freq.value = preset;
    if (customRow && daysInp) {
      customRow.style.display = preset === 'custom' ? 'flex' : 'none';
      daysInp.value = String(Math.round((presetInterval || 24) / 24));
    }
    const applyReauditSettings = async (enabled, val) => {
      try {
        const { site: updated } = await apiFetch('/api/seo/' + site.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reAuditEnabled: enabled, reAuditIntervalHours: val }) });
        const idx = seoSitesCache.findIndex(x => String(x.id) === String(site.id));
        if (idx !== -1) seoSitesCache[idx] = updated;
        currentSeoSite = updated;
        alert(enabled ? '✅ Auto re-audit ON — har ' + (val / 24) + ' din mein background mein chalega.' : 'Auto re-audit OFF.');
      } catch (err) {
        freq.value = String(site.reAuditEnabled ? (Number(site.reAuditIntervalHours) || 24) : 0);
        alert('Settings update failed: ' + err.message);
      }
    };
    freq.addEventListener('change', async () => {
      if (freq.value === 'custom') { if (customRow) customRow.style.display = 'flex'; return; }
      if (customRow) customRow.style.display = 'none';
      const val = Number(freq.value) || 0;
      await applyReauditSettings(val > 0, val);
    });
    const customApply = document.getElementById('seo-reaudit-custom-apply');
    if (customApply && daysInp) customApply.addEventListener('click', async () => {
      const days = Math.max(1, Math.min(30, parseInt(daysInp.value || '2', 10) || 2));
      await applyReauditSettings(true, days * 24);
    });
  }
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
    const isTarget = b.dataset.seop === name;
    b.classList.toggle('seo-op-tab-on', isTarget);
    if (isTarget) {
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

function compileAllSeoIssues(site) {
  const a = site.audit || {};
  const issues = a.issues || [];
  const pages = a.crawledPages || [];
  const signals = a.signals || {};
  const ps = a.pageSpeed || {};

  const compiled = [];

  // 1. Audit Crawler Issues
  issues.forEach(i => {
    compiled.push({
      title: i.text,
      category: i.category || 'crawl',
      severity: i.severity || 'medium',
      problem: `Found during crawler analysis (${i.category || 'on-page'}). Directly affects page crawlability and user experience.`,
      impact: i.severity === 'high' ? 'High bounce risk, organic ranking penalty, and crawler indexing failure.' : 'Sub-optimal indexing factor and minor SEO friction.'
    });
  });

  // 2. 16-Topics Failures & Warnings
  const tops = typeof seoTopicsOf === 'function' ? seoTopicsOf(site) : [];
  tops.forEach(t => {
    const st = (t.status || '').toLowerCase();
    if (st === 'fail' || st === 'warn') {
      // Avoid duplicate if crawler issue text is very similar
      const exists = compiled.some(c => c.title.toLowerCase().includes(t.title.toLowerCase()));
      if (!exists) {
        compiled.push({
          title: `${t.title}: ${t.finding}`,
          category: (t.group || 'technical').toLowerCase(),
          severity: st === 'fail' ? 'high' : 'medium',
          problem: t.problem || t.finding,
          impact: st === 'fail' ? 'Significant search ranking impairment and technical non-compliance.' : 'Advisory warning that reduces organic discovery performance.'
        });
      }
    }
  });

  // 3. Core Web Vitals & Performance Gaps (Dashboard)
  if (ps.lcp != null && Number(ps.lcp) > 2.5) {
    if (!compiled.some(c => c.title.toLowerCase().includes('lcp'))) {
      compiled.push({
        title: `Slow LCP (${ps.lcp}s > 2.5s goal)`,
        category: 'performance',
        severity: Number(ps.lcp) > 4.0 ? 'high' : 'medium',
        problem: 'Largest content element render hone mein 2.5s se zyada time le raha hai.',
        impact: 'Mobile users bounce ho jaate hain aur Google PageSpeed ranking gir sakti hai.'
      });
    }
  }
  if (ps.cls != null && Number(ps.cls) > 0.1) {
    if (!compiled.some(c => c.title.toLowerCase().includes('cls'))) {
      compiled.push({
        title: `Layout Shift CLS (${ps.cls} > 0.1 goal)`,
        category: 'performance',
        severity: 'medium',
        problem: 'Page load hote waqt visual content achanak jump karta hai.',
        impact: 'Accidental taps, high frustration, aur poor Core Web Vitals score.'
      });
    }
  }
  if (ps.tbt != null && Number(ps.tbt) > 200) {
    if (!compiled.some(c => c.title.toLowerCase().includes('tbt'))) {
      compiled.push({
        title: `High TBT Thread Blocking (${ps.tbt}ms > 200ms goal)`,
        category: 'performance',
        severity: 'medium',
        problem: 'Main JavaScript thread heavy scripts execute karne mein busy rehta hai.',
        impact: 'Buttons and user inputs feel unresponsive during initial load.'
      });
    }
  }

  // 4. Technical Security & Bot Signals (Dashboard)
  if (signals.hsts === false || signals.hsts === 'missing') {
    if (!compiled.some(c => c.title.toLowerCase().includes('hsts'))) {
      compiled.push({
        title: 'Missing HSTS (Strict-Transport-Security) Header',
        category: 'security',
        severity: 'medium',
        problem: 'Server response me Strict-Transport-Security header configured nahi hai.',
        impact: 'Insecure downgrade attacks ka risk rehta hai aur browser SSL security rating drop hoti hai.'
      });
    }
  }
  if (signals.robotsExists === false) {
    if (!compiled.some(c => c.title.toLowerCase().includes('robots.txt'))) {
      compiled.push({
        title: 'robots.txt Missing or 404',
        category: 'crawler',
        severity: 'high',
        problem: 'Search engine bots ko crawl rules aur directive boundaries nahi mil pa rahi hain.',
        impact: 'Crawl budget waste hota hai aur non-public URLs accidental index ho sakti hain.'
      });
    }
  }

  // 5. Crawled Pages Architecture (Broken, Orphans, Thin Content, Missing H1)
  pages.forEach(p => {
    const pageUrl = p.path || p.url || '';
    if (p.status && p.status !== 200) {
      compiled.push({
        title: `Broken Page (${p.status} Error): ${pageUrl}`,
        category: 'pages',
        severity: 'high',
        problem: `Internal page load par HTTP ${p.status} status return hua. Dead link detect hui.`,
        impact: 'Users encounter broken links leading to immediate bounce and negative user journey.'
      });
    }
    if (p.isOrphan) {
      compiled.push({
        title: `Orphan Internal Page: ${pageUrl}`,
        category: 'pages',
        severity: 'medium',
        problem: 'Website ke kisi bhi parent ya child navigation se is page ka internal incoming link nahi hai.',
        impact: 'Search crawlers is page ko easily discover ya rank nahi kar paate.'
      });
    }
    if (!p.h1) {
      compiled.push({
        title: `Missing H1 Heading on Page: ${pageUrl}`,
        category: 'pages',
        severity: 'low',
        problem: 'Page structure me primary H1 heading element absent hai.',
        impact: 'Search engines ko primary topic clarity nahi milti.'
      });
    }
    if (p.wordCount > 0 && p.wordCount < 120) {
      compiled.push({
        title: `Thin Content (${p.wordCount} words): ${pageUrl}`,
        category: 'pages',
        severity: 'medium',
        problem: `Page par sirf ${p.wordCount} words detected hue jo content depth guidelines (< 120 words) se kam hain.`,
        impact: 'Google thin content pages ko low-quality / auto-generated samajh kar de-index kar sakta hai.'
      });
    }
  });

  return compiled;
}

function copyAllSeoIssuesText(site, items) {
  const domain = site.domain || site.url || 'Website';
  let text = `========================================\n`;
  text += `🚨 SEO ISSUES & BUGS REPORT: ${domain}\n`;
  text += `Audited on: ${new Date().toLocaleString('en-IN')}\n`;
  text += `Total Issues Detected: ${items.length}\n`;
  text += `========================================\n\n`;

  items.forEach((item, idx) => {
    text += `[${idx + 1}] ${item.title}\n`;
    text += `Severity: ${(item.severity || 'medium').toUpperCase()} | Category: ${(item.category || 'general').toUpperCase()}\n`;
    text += `Problem Detail: ${item.problem}\n`;
    text += `Impact: ${item.impact}\n`;
    text += `----------------------------------------\n\n`;
  });

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      alert(`✅ Saare ${items.length} issues clipboard me copy ho gaye!`);
    }).catch(() => {
      fallbackCopyText(text);
    });
  } else {
    fallbackCopyText(text);
  }
}

function fallbackCopyText(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    alert('✅ Saare issues clipboard me copy ho gaye!');
  } catch (e) {
    alert('Copy failed, please copy manually.');
  }
  document.body.removeChild(ta);
}

function downloadSeoIssuesPdf(site, items) {
  const domain = site.domain || site.url || 'website';
  const rows = items.map((item, idx) => {
    const sevColor = item.severity === 'high' ? '#dc2626' : item.severity === 'medium' ? '#d97706' : '#2563eb';
    const sevBg = item.severity === 'high' ? '#fee2e2' : item.severity === 'medium' ? '#fef3c7' : '#dbeafe';
    return `
      <div style="page-break-inside:avoid;border:1px solid #e2e8f0;border-left:5px solid ${sevColor};border-radius:8px;padding:12px;margin-bottom:12px;background:#ffffff;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-size:11px;font-weight:bold;background:${sevBg};color:${sevColor};padding:3px 8px;border-radius:4px;text-transform:uppercase;">${escHtml(item.severity)}</span>
          <span style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;">${escHtml(item.category)}</span>
        </div>
        <div style="font-size:14px;font-weight:bold;color:#0f172a;margin-bottom:6px;">#${idx + 1}. ${escHtml(item.title)}</div>
        <div style="font-size:12px;color:#334155;line-height:1.5;margin-bottom:8px;">
          <strong style="color:#0f172a;">Problem:</strong> ${escHtml(item.problem)}
        </div>
        <div style="font-size:11.5px;color:#b91c1c;background:#fef2f2;padding:8px 10px;border-radius:6px;line-height:1.45;border:1px solid #fecaca;">
          <strong>Impact:</strong> ${escHtml(item.impact)}
        </div>
      </div>
    `;
  }).join('');

  const html = `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>SEO Issues & Bugs - ${escHtml(domain)}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f8fafc; color: #0f172a; padding: 24px; margin: 0; }
      .header { background: #0f172a; color: #ffffff; padding: 18px 24px; border-radius: 8px; margin-bottom: 20px; }
      .header h1 { margin: 0 0 6px 0; font-size: 20px; }
      .header p { margin: 0; font-size: 12px; color: #94a3b8; }
      @media print {
        body { padding: 0; background: #ffffff; }
        .header { border-radius: 0; }
      }
    </style>
  </head>
  <body>
    <div class="header">
      <h1>🚨 Comprehensive SEO Issues & Defects Report</h1>
      <p>Target: <strong>${escHtml(domain)}</strong> · Total Issues: <strong>${items.length}</strong> · Generated on: ${new Date().toLocaleString('en-IN')}</p>
      <p style="margin-top:4px;font-size:11px;color:#cbd5e1;">(Note: This report contains pure problem and vulnerability impact diagnostics without solution recommendations.)</p>
    </div>
    <div>${rows || '<p>No issues found.</p>'}</div>
  </body>
  </html>`;

  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  f.srcdoc = html;
  document.body.appendChild(f);
  f.addEventListener('load', () => {
    setTimeout(() => {
      try {
        f.contentWindow.focus();
        f.contentWindow.print();
      } catch (e) {
        alert('PDF dialog failed to open.');
      }
    }, 100);
  });
}

function renderSeoIssues(site) {
  const el = document.getElementById('seo-op-issues');
  if (!el) return;

  const allCompiled = compileAllSeoIssues(site);
  const cats = [...new Set(allCompiled.map(i => i.category || 'general'))];
  const sevOrder = { high: 3, medium: 2, low: 1 };

  const filtered = allCompiled.filter(i =>
    (seoIssueSev === 'all' || i.severity === seoIssueSev) &&
    (seoIssueCat === 'all' || i.category === seoIssueCat)
  ).sort((x, y) => (sevOrder[y.severity] || 0) - (sevOrder[x.severity] || 0));

  const pill = (kind, val, label, active) =>
    `<button class="seo-pill${active ? ' active' : ''}" data-kind="${kind}" data-val="${val}">${label}</button>`;
  
  const sevPills = pill('sev', 'all', 'All (' + allCompiled.length + ')', seoIssueSev === 'all') +
    ['high', 'medium', 'low'].map(s => pill('sev', s, `${s.toUpperCase()} (${allCompiled.filter(i => i.severity === s).length})`, seoIssueSev === s)).join('');
  
  const catPills = pill('cat', 'all', 'All', seoIssueCat === 'all') +
    cats.map(c => pill('cat', c, c.toUpperCase(), seoIssueCat === c)).join('');

  const counts = {
    high: allCompiled.filter(i => i.severity === 'high').length,
    medium: allCompiled.filter(i => i.severity === 'medium').length,
    low: allCompiled.filter(i => i.severity === 'low').length
  };

  const list = filtered.length ? filtered.map((i, idx) => {
    const sevClass = i.severity === 'high' ? 'sev-high' : i.severity === 'medium' ? 'sev-medium' : 'sev-low';
    return `
      <div class="seo-diag-card ${sevClass}" style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <div style="display:flex;gap:6px;align-items:center;">
            <span class="seo-badge-tag ${i.severity}">● ${i.severity.toUpperCase()}</span>
            <span class="seo-badge-tag category">${escHtml(i.category || 'general')}</span>
          </div>
          <span style="font-size:10px;color:var(--text3);font-weight:700;">#${idx + 1}</span>
        </div>
        <div class="md-content" style="font-size:13px;font-weight:700;color:var(--text1);line-height:1.45;margin-bottom:6px;">${renderTextContent(i.title)}</div>
        <div style="font-size:11.5px;color:var(--text2);line-height:1.45;margin-bottom:6px;">
          <strong style="color:var(--text1);">Problem:</strong> ${escHtml(i.problem)}
        </div>
        <div style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.18);border-radius:6px;padding:6px 8px;font-size:11px;color:#fecaca;line-height:1.4;">
          <strong style="color:#f87171;">⚠️ Why It Matters (Impact):</strong> ${escHtml(i.impact)}
        </div>
      </div>`;
  }).join('') : `<div style="font-size:12px;color:var(--text3);padding:20px 0;text-align:center;">Is filter mein koi issue nahi mila — All clean! 🎉</div>`;

  el.innerHTML = `
    <div class="ws-kb-block" style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">
        <div>
          <div class="ws-kb-label" style="font-size:13px;">⚠️ Complete Negative Points & System Defects</div>
          <div style="font-size:11.5px;color:var(--text3);margin-top:2px;">
            ${allCompiled.length} total issues compiled across Crawl, Topics, Dashboard & Pages — 
            <span style="color:#f87171;font-weight:700;">${counts.high} high</span> · 
            <span style="color:#fbbf24;font-weight:700;">${counts.medium} med</span> · 
            <span style="color:#38bdf8;font-weight:700;">${counts.low} low</span>
          </div>
        </div>
        <!-- 1-Click Copy & PDF Actions -->
        <div style="display:flex;gap:6px;">
          <button class="btn-small" id="seo-copy-issues-btn" title="Copy all issues without solutions" style="font-size:11px;font-weight:700;padding:5px 10px;background:#3b82f622;color:#60a5fa;border:1px solid #3b82f644;">📋 Copy Issues</button>
          <button class="btn-small" id="seo-pdf-issues-btn" title="Download clean PDF report without solutions" style="font-size:11px;font-weight:700;padding:5px 10px;background:#ef444422;color:#f87171;border:1px solid #ef444444;">⤓ Download PDF</button>
        </div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="font-size:11px;color:var(--text3);font-weight:600;min-width:55px;">Severity:</span>
        <div class="seo-pill-group">${sevPills}</div>
      </div>
      ${cats.length > 1 ? `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="font-size:11px;color:var(--text3);font-weight:600;min-width:55px;">Category:</span>
        <div class="seo-pill-group">${catPills}</div>
      </div>` : ''}
    </div>
    ${list}
  `;

  // Attach event handlers
  el.querySelectorAll('.seo-pill').forEach(btn => btn.addEventListener('click', () => {
    if (btn.dataset.kind === 'sev') seoIssueSev = btn.dataset.val;
    else seoIssueCat = btn.dataset.val;
    renderSeoIssues(site);
  }));

  const copyBtn = document.getElementById('seo-copy-issues-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      copyAllSeoIssuesText(site, filtered.length ? filtered : allCompiled);
    });
  }

  const pdfBtn = document.getElementById('seo-pdf-issues-btn');
  if (pdfBtn) {
    pdfBtn.addEventListener('click', () => {
      downloadSeoIssuesPdf(site, filtered.length ? filtered : allCompiled);
    });
  }
}

function renderSeoStrengths(site) {
  const el = document.getElementById('seo-op-strengths');
  if (!el) return;
  const a = site.audit || {};
  const sig = a.signals || {};
  const urls = Array.isArray(a.crawledUrls) ? a.crawledUrls : [];
  const broken = (Array.isArray(a.broken) ? a.broken : []).filter(b => b && !b.ok).length;

  const strengths = [];

  if (site.url && site.url.startsWith('https://')) strengths.push({ title: 'HTTPS Enabled', note: 'Website SSL secured connection par hai — ranking & security advantage.' });
  if (sig.noindex === false) strengths.push({ title: 'Search Engine Indexable', note: 'noindex directive nahi hai — search engines easily crawl aur index kar sakte hain.' });
  if (sig.canonical) strengths.push({ title: 'Canonical Tag Active', note: 'Self-referencing canonical tag maujood hai — duplicate content issues se protection.' });
  if (sig.semanticCount >= 2) strengths.push({ title: 'HTML5 Semantic Layout', note: `${sig.semanticCount}/7 semantic structure tags (header/nav/main/section/footer) use ho rahe hain.` });
  if (sig.robotsExists) strengths.push({ title: 'robots.txt Configured', note: 'Search engine crawler rules robots.txt mein accurately defined hain.' });
  if (sig.sitemapFound && (sig.sitemapUrls > 0)) strengths.push({ title: 'XML Sitemap Discovered', note: `${sig.sitemapUrls} URLs sitemap structure mein available hain — search engines easily crawl kar sakte hain.` });
  if (sig.ttfbMs && sig.ttfbMs < 1000) strengths.push({ title: 'Fast Server TTFB', note: `Server first byte response time healthy hai (${sig.ttfbMs}ms).` });
  if (sig.htmlBytes && sig.htmlBytes < 300 * 1024) strengths.push({ title: 'Lightweight HTML Payload', note: `HTML page weight sirf ${(sig.htmlBytes / 1024).toFixed(0)} KB hai.` });
  if (sig.blockingScripts === 0) strengths.push({ title: 'Zero Render-Blocking Scripts', note: 'Sabhi scripts async/defer ya non-blocking mode mein load ho rahe hain.' });
  if (Array.isArray(sig.schemaTypes) && sig.schemaTypes.length > 0) strengths.push({ title: 'JSON-LD Structured Data', note: `Rich snippet schemas: ${sig.schemaTypes.join(', ')}.` });
  if (broken === 0 && urls.length > 0) strengths.push({ title: 'Zero Broken Internal Links', note: 'Koi 404 ya broken page internal crawl mein nahi mila.' });
  if (sig.ogTitle && sig.ogImage) strengths.push({ title: 'Social Graph Ready', note: 'Open Graph (og:title, og:image) preview social media sharing ke liye configured hai.' });
  if (sig.twitterCard) strengths.push({ title: 'Twitter Card Meta Active', note: 'Twitter share cards summary_large_image properly configured hain.' });
  // ── Level 1: Security, DOM & Content Quality ──
  if (sig.hsts) strengths.push({ title: 'HSTS Security Header Active', note: 'Strict-Transport-Security header set hai — browsers aur crawlers ko HTTPS enforce karta hai.' });
  if (sig.csp || sig.xFrame) strengths.push({ title: 'Clickjacking Protection Configured', note: 'Content-Security-Policy / X-Frame-Options header present — malicious iframe embedding se protected.' });
  if (typeof sig.totalDomNodes === 'number' && !sig.domBloated) strengths.push({ title: 'Efficient DOM Architecture', note: `DOM sirf ${sig.totalDomNodes} nodes aur ${sig.maxDomDepth} levels deep — rendering fast aur bot-friendly hai.` });
  if (sig.readability === 'Good') strengths.push({ title: 'Excellent Content Readability', note: `Average sentence length ~${sig.avgWordsPerSentence || 0} words/sentence — clear, scannable aur user-friendly content.` });
  if (sig.headingSkipped === false && sig.semanticCount >= 2) strengths.push({ title: 'Sequential Heading Hierarchy', note: 'H1 → H2 → H3 proper order mein follow ho raha hai — content structure bot-parseable hai.' });


  const list = strengths.length ? strengths.map(s => `
    <div class="seo-diag-card is-strength">
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="color:var(--green);font-weight:800;font-size:13px;">✓</span>
        <span style="font-weight:700;font-size:12.5px;color:var(--text1);">${escHtml(s.title)}</span>
      </div>
      <div style="font-size:11.5px;color:var(--text2);margin-top:4px;line-height:1.45;">${escHtml(s.note)}</div>
    </div>`).join('') : `<div style="font-size:12px;color:var(--text3);padding:10px 0;">Strengths calculate ho rahi hain…</div>`;

  el.innerHTML = `
    <div class="ws-kb-block" style="margin-bottom:12px;">
      <div class="ws-kb-label">✅ Positive Points & Highlights</div>
      <div style="font-size:11.5px;color:var(--text3);margin-top:2px;">${strengths.length} verified positive signals jo website ki ranking aur user experience ko boost karte hain.</div>
    </div>
    ${list}
  `;
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

  return [
    {
      title: 'URL Architecture',
      group: 'Technical',
      status: queryUrls.length ? 'Warn' : 'Pass',
      finding: queryUrls.length ? `${queryUrls.length} URL(s) contain query parameters or uppercase segments.` : 'All discovered URLs have clean, lowercase, semantic structure.',
      problem: queryUrls.length ? 'Query parameters (?id=..) aur special characters search engines ko page intent samajhne mein confuse karte hain.' : 'None. URL architecture clean hai.',
      guide: 'Clean, descriptive lowercase URLs use karein with hyphens separating words (e.g. /category/product-name).'
    },
    {
      title: 'Redirects & Status Codes',
      group: 'Technical',
      status: broken ? 'Fail' : 'Pass',
      finding: broken ? `${broken} broken internal link(s) returned 404 or connection failure.` : 'All crawled internal links returned valid HTTP 200 OK.',
      problem: broken ? 'Broken internal links waste crawler budget and lead to poor user experience (404 errors).' : 'None. Saare internal links healthy hain.',
      guide: 'Dead links ko update karein ya 301 Permanent Redirect lagakar active destination page par point karein.'
    },
    {
      title: 'Canonicalization',
      group: 'Technical',
      status: s.canonical ? 'Pass' : 'Fail',
      finding: s.canonical ? `Canonical tag present: ${s.canonical}` : 'No self-referencing canonical tag found in <head>.',
      problem: !s.canonical ? 'Without canonical tags, query variations (e.g. ?ref=..) duplicate content issues create kar sakti hain.' : 'None. Canonical tag active hai.',
      guide: 'Har page ke <head> mein <link rel="canonical" href="https://yourdomain.com/page" /> add karein.'
    },
    {
      title: 'Structured Data (JSON-LD)',
      group: 'Content',
      status: schema.length ? 'Pass' : 'Fail',
      finding: schema.length ? `Detected schemas: ${schema.join(', ')}` : 'No schema.org structured data script found.',
      problem: !schema.length ? 'Google Rich Snippets (stars, FAQ, organization) display nahi honge search result me.' : 'None. JSON-LD schema detect ho gaya.',
      guide: 'Schema.org compliant <script type="application/ld+json"> format mein Organization/WebSite/Article schemas embed karein.'
    },
    {
      title: 'Meta Description',
      group: 'On-page',
      status: !meta ? 'Fail' : (meta.length < 120 || meta.length > 200) ? 'Warn' : 'Pass',
      finding: !meta ? 'Meta description tag is missing.' : `${meta.length} characters long (${meta.length < 120 ? 'Too short' : meta.length > 200 ? 'Too long' : 'Optimal'}).`,
      problem: !meta ? 'Search result snippet me description missing hone se Click-Through Rate (CTR) drop ho sakta hai.' : 'Ideal character count 120-160 characters hota hai.',
      guide: 'Har page par ek unique 120-160 characters ki compelling meta description with call-to-action provide karein.'
    },
    {
      title: 'Open Graph & Social Cards',
      group: 'On-page',
      status: (hasOg && s.twitterCard) ? 'Pass' : (hasOg || s.twitterCard) ? 'Warn' : 'Fail',
      finding: (hasOg && s.twitterCard) ? 'OG tags and Twitter card are both active.' : hasOg ? 'Open Graph present, but Twitter card missing.' : 'Social sharing meta tags are missing.',
      problem: (!hasOg || !s.twitterCard) ? 'Social media (WhatsApp, LinkedIn, X) par share karne par preview card blank ya distorted aayega.' : 'None. Social previews configured hain.',
      guide: 'og:title, og:description, og:image aur twitter:card="summary_large_image" tags <head> mein add karein.'
    },
    {
      title: 'XML Sitemap',
      group: 'Technical',
      status: s.sitemapFound ? 'Pass' : 'Fail',
      finding: s.sitemapFound ? `Sitemap found containing ${typeof s.sitemapUrls === 'number' ? s.sitemapUrls : 0} URLs.` : 'sitemap.xml not discovered at standard paths or robots.txt.',
      problem: !s.sitemapFound ? 'Google aur Bing search engines deep pages ko discover karne mein time lagayenge.' : 'None. Sitemap discovered.',
      guide: 'sitemap.xml file generate karke site root par host karein aur robots.txt mein Sitemap: URL declare karein.'
    },
    {
      title: 'robots.txt Configuration',
      group: 'Technical',
      status: s.robotsExists ? 'Pass' : 'Fail',
      finding: s.robotsExists ? 'robots.txt found with crawl guidelines.' : 'robots.txt not found at /robots.txt.',
      problem: !s.robotsExists ? 'Search crawlers ko crawl paths aur private sections restrict karne ke rules nahi milenge.' : 'None. robots.txt available hai.',
      guide: 'Root path par robots.txt create karein jisme User-agent: * rules aur Sitemap link ho.'
    },
    {
      title: 'hreflang / International SEO',
      group: 'Content',
      status: (typeof s.hreflangCount === 'number' && s.hreflangCount > 0) ? 'Pass' : 'Manual',
      finding: s.hreflangCount ? `${s.hreflangCount} alternate language mapping(s) found.` : 'No hreflang tags found (Only required if multilingual).',
      problem: 'Agar website multiple languages target karti hai to bina hreflang ke duplicate content flag ho sakta hai.',
      guide: 'Multilingual sites par <link rel="alternate" hreflang="lang-code" href="url" /> add karein.'
    },
    {
      title: 'Crawl Budget & Renderability',
      group: 'Technical',
      status: blocking === 0 ? 'Pass' : blocking <= 3 ? 'Warn' : 'Fail',
      finding: `${blocking} render-blocking external script(s) found in document.`,
      problem: blocking > 0 ? 'Render-blocking JavaScript first paint time aur core web vitals ko delay karta hai.' : 'None. Sabhi scripts non-blocking hain.',
      guide: '<script src=".."> par async ya defer attribute use karein taaki parsing block na ho.'
    },
    {
      title: 'Core Web Vitals & Speed',
      group: 'Technical',
      status: (ttfb < 600 && load < 2500) ? 'Pass' : (ttfb < 1500 && load < 4000) ? 'Warn' : 'Fail',
      finding: `Server TTFB: ${ttfb}ms · Page load proxy: ~${load}ms.`,
      problem: ttfb >= 600 ? 'Slow server response time (>600ms) user bounce rate badhata hai aur ranking hurt karta hai.' : 'None. Fast server response.',
      guide: 'Server caching (Redis/CDN), Gzip/Brotli compression, aur edge caching enable karein.'
    },
    {
      title: 'Indexability & Directives',
      group: 'Technical',
      status: s.noindex ? 'Fail' : 'Pass',
      finding: s.noindex ? 'Page contains <meta name="robots" content="noindex">.' : 'Page is fully indexable with no blocking noindex tag.',
      problem: s.noindex ? 'noindex tag laga hone se yeh website Google search index se completely gayab ho jayegi.' : 'None. Page is indexable.',
      guide: 'Robots meta tag se noindex remove karein agar page public search ke liye intended hai.'
    },
    {
      title: 'Internal Linking Architecture',
      group: 'Content',
      status: internal >= 3 ? 'Pass' : internal > 0 ? 'Warn' : 'Fail',
      finding: `${internal} internal navigational link(s) discovered on the homepage.`,
      problem: internal < 3 ? 'Kam internal links hone se search bots deep pages tak efficiently nahi pahunch paate.' : 'None. Healthy internal linking structure.',
      guide: 'Relevant anchor text ke sath header menu, footer aur contextual content links connect karein.'
    },
    {
      title: 'Security HTTP Headers',
      group: 'Technical',
      status: (s.hsts && (s.csp || s.xFrame)) ? 'Pass' : (s.hsts || s.csp || s.xFrame) ? 'Warn' : 'Fail',
      finding: [
        s.hsts ? '✓ HSTS (Strict-Transport-Security) active' : '✗ HSTS missing',
        (s.csp || s.xFrame) ? `✓ Framing protection (${s.xFrame || 'CSP'}) configured` : '✗ Clickjacking protection missing',
      ].join(' · '),
      problem: (!s.hsts || (!s.csp && !s.xFrame)) ? 'Missing security headers from browser aur CDN-level attacks se protect nahi karte. HSTS ensure karta hai ki HTTPS bypass na ho.' : 'None. Security headers correctly configured hain.',
      guide: 'Server pe ye headers add karein: Strict-Transport-Security: max-age=31536000; includeSubDomains | X-Frame-Options: SAMEORIGIN | Content-Security-Policy: default-src \'self\''
    },
    {
      title: 'DOM Complexity & Performance Depth',
      group: 'Technical',
      status: s.domBloated ? 'Warn' : (typeof s.totalDomNodes === 'number' ? 'Pass' : 'Manual'),
      finding: typeof s.totalDomNodes === 'number'
        ? `${s.totalDomNodes} total DOM nodes · Max depth: ${s.maxDomDepth} levels${s.domBloated ? ' — exceeds recommended thresholds' : ' — within optimal range'}.`
        : 'DOM complexity data not yet collected — re-audit karain.',
      problem: s.domBloated ? `Excessive DOM complexity (>${s.totalDomNodes > 1500 ? '1500 nodes' : ''} ${s.maxDomDepth > 32 ? '/ >32 depth' : ''}) cause karta hai slow rendering, browser memory pressure aur poor Lighthouse scores.` : 'None. DOM architecture clean hai.',
      guide: 'Unnecessary wrapper divs hataein, virtual scrolling use karein for large lists, aur browser DevTools > Performance > DOM Stats se profile karein.'
    },
    {
      title: 'Content Readability & Heading Flow',
      group: 'Content',
      status: (s.readability === 'Good' && !s.headingSkipped) ? 'Pass' : (s.readability === 'Complex' || s.headingSkipped) ? 'Warn' : 'Pass',
      finding: `Readability: ${s.readability || 'Unknown'} (~${s.avgWordsPerSentence || 0} words/sentence) · Heading hierarchy: ${s.headingSkipped ? '⚠️ Levels skipped' : '✓ Sequential'}.`,
      problem: (s.readability === 'Complex' || s.headingSkipped) ? `Complex sentences (>${s.avgWordsPerSentence} words avg) Google ke "helpful content" guidelines aur AEO (AI search) ke liye parse karna mushkil bana deti hain. Skipped heading levels (e.g. H1→H4) screen readers aur bots ko confuse karte hain.` : 'None. Content readable aur well-structured hai.',
      guide: 'Sentences 18-20 words se kam rakhein. Heading order maintain karein: ek H1, phir H2 sections, phir H3 subsections — kabhi skip mat karein.'
    }
  ];
}

function renderSeoTopics(site) {
  const el = document.getElementById('seo-op-topics');
  if (!el) return;
  const tops = seoTopicsOf(site);

  const card = (t, idx) => {
    const stLower = (t.status || 'manual').toLowerCase();
    return `
      <div class="seo-topic-card" data-topic-idx="${idx}">
        <div class="seo-topic-header">
          <div class="seo-topic-title">
            <span>${escHtml(t.title)}</span>
            <span class="seo-topic-status-badge ${stLower}">${escHtml(t.status)}</span>
          </div>
          <span class="seo-topic-chevron">▼</span>
        </div>
        <div class="seo-topic-body">
<div class="md-content" style="font-size:11.5px;color:var(--text1);margin-bottom:8px;line-height:1.45;">
            <strong style="color:var(--text2);display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:2px;">🔍 Live Audit Finding:</strong>
            ${renderTextContent(t.finding)}
          </div>
          <div class="md-content" style="font-size:11.5px;color:#fbbf24;margin-bottom:8px;line-height:1.45;background:rgba(251,191,36,0.06);padding:6px 8px;border-radius:5px;">
            <strong style="display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:2px;">⚠️ Problem & Impact:</strong>
            ${renderTextContent(t.problem)}
          </div>
          <div class="md-content" style="font-size:11.5px;color:var(--text2);line-height:1.45;background:rgba(255,255,255,0.04);padding:6px 8px;border-radius:5px;">
            <strong style="color:var(--green);display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:2px;">💡 Recommended Correction:</strong>
            ${renderTextContent(t.guide)}
          </div>
        </div>
      </div>`;
  };

  el.innerHTML = `
    <div class="ws-kb-block" style="margin-bottom:12px;">
      <div class="ws-kb-label">🗺 16-Topic SEO Health Map</div>
      <div style="font-size:11.5px;color:var(--text3);margin-top:2px;">
        Kisi bhi topic par click karke live finding, problem detail aur correction guideline dekhein.
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:4px;">
      ${tops.map((t, idx) => card(t, idx)).join('')}
    </div>
  `;

  el.querySelectorAll('.seo-topic-header').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const parent = hdr.closest('.seo-topic-card');
      if (parent) parent.classList.toggle('open');
    });
  });
}


let seoPageFilterMode = 'issues'; // 'issues' or 'all'

function renderSeoPages(site) {
  const el = document.getElementById('seo-op-pages');
  if (!el) return;
  const pages = (site.audit && site.audit.crawledPages) || [];

  if (!pages.length) {
    el.innerHTML = `
      <div class="ws-kb-block">
        <div class="ws-kb-label">🗂️ Page Architecture Explorer</div>
        <div style="font-size:12px;color:var(--text3);padding:12px 0;text-align:center;">
          No internal pages crawled yet — Re-Audit website to start multi-page scan.
        </div>
      </div>`;
    return;
  }

  // --- Strict issue detection: only real structural problems count ---
  const getPageIssues = (p) => {
    const tags = [];
    if (p.status !== 200) tags.push({ label: p.status + ' Error', color: '#f87171' });
    if (p.isOrphan) tags.push({ label: 'Orphan Page', color: '#f87171' });
    if (!p.h1) tags.push({ label: 'No H1', color: '#fbbf24' });
    if (!p.metaDesc) tags.push({ label: 'No Meta', color: '#fbbf24' });
    if (p.wordCount > 0 && p.wordCount < 120) tags.push({ label: 'Thin Content', color: '#fbbf24' });
    return tags;
  };

  const isPageIssue = (p) => getPageIssues(p).length > 0;
  const issuePages = pages.filter(isPageIssue);
  const orphans = pages.filter(p => p.isOrphan).length;

  // "All Pages" mode: issue pages first (sorted by severity), then healthy pages
  const sortedAllPages = seoPageFilterMode === 'all'
    ? [...issuePages, ...pages.filter(p => !isPageIssue(p))]
    : issuePages;

  const statusDot = (p) => {
    const issues = getPageIssues(p);
    if (issues.length === 0) return '<span style="color:var(--green);font-size:10px;">✓</span>';
    if (p.status !== 200) return '<span style="color:#f87171;font-size:10px;font-weight:700;">✗</span>';
    if (p.isOrphan) return '<span style="color:#f87171;font-size:10px;font-weight:700;" title="Orphan page">⛓</span>';
    return '<span style="color:#fbbf24;font-size:10px;">⚠</span>';
  };

  const issueBadges = (p) => {
    const tags = getPageIssues(p);
    if (!tags.length) return '';
    return tags.map(t =>
      `<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:${t.color}22;color:${t.color};border:1px solid ${t.color}44;white-space:nowrap;">${t.label}</span>`
    ).join('');
  };

  const rows = sortedAllPages.map((p, i) => {
    const hasIssues = isPageIssue(p);
    return `
    <div class="seo-page-row${hasIssues ? ' seo-page-row--issue' : ''}" data-page-idx="${i}">
      <div class="seo-page-row-header">
        <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:0;">
          ${statusDot(p)}
          <span style="font-size:11.5px;font-weight:600;color:var(--text1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(p.url)}">${escHtml(p.path || p.url)}</span>
          ${issueBadges(p)}
        </div>
        <div style="display:flex;gap:4px;align-items:center;flex-shrink:0;">
          <span style="font-size:10px;padding:1px 5px;border-radius:4px;background:${p.status === 200 ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)'};color:${p.status === 200 ? 'var(--green)' : '#f87171'};">${p.status}</span>
          <span style="font-size:10px;color:var(--text3);">${p.wordCount} wds</span>
          <span class="seo-page-chevron" style="font-size:9px;color:var(--text3);transition:transform 0.2s;">▼</span>
        </div>
      </div>
      <div class="seo-page-body">
        <div style="display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:11px;color:var(--text2);line-height:1.6;">
          <strong style="color:var(--text3);">Title</strong><span style="color:${p.title ? 'var(--text2)' : '#f87171'}">${escHtml(p.title || '(missing)')}</span>
          <strong style="color:var(--text3);">H1</strong><span style="color:${p.h1 ? 'var(--text2)' : '#fbbf24'}">${escHtml(p.h1 || '(missing)')}</span>
          <strong style="color:var(--text3);">Meta</strong><span style="color:${p.metaDesc ? 'var(--text2)' : '#f87171'}">${p.metaDesc ? escHtml(p.metaDesc.slice(0, 80)) + (p.metaDesc.length > 80 ? '…' : '') : '(missing)'}</span>
          <span style="color:var(--text3);">Incoming</span><span style="color:${p.incomingLinks > 0 ? 'var(--green)' : '#f87171'}">${p.incomingLinks} internal link${p.incomingLinks !== 1 ? 's' : ''}${p.isOrphan ? ' ⚠️ orphan' : ''}</span>
          <span style="color:var(--text3);">Canonical</span><span style="color:${p.hasCanonical ? 'var(--green)' : '#fbbf24'}">${p.hasCanonical ? '✓ set' : '✗ missing'}</span>
          <span style="color:var(--text3);">Scripts</span><span style="color:${p.blockingScripts > 0 ? '#fbbf24' : 'var(--text2)'}">${p.blockingScripts > 0 ? p.blockingScripts + ' blocking' : 'clean'}</span>
        </div>
      </div>
    </div>`;
  }).join('');

  const healthyCount = pages.length - issuePages.length;
  el.innerHTML = `
    <div class="ws-kb-block" style="margin-bottom:12px;">
      <div class="ws-kb-label">🗂️ PAGE ARCHITECTURE EXPLORER (${pages.length} PAGES)</div>
      <div style="font-size:11.5px;color:var(--text3);margin-top:4px;display:flex;gap:12px;flex-wrap:wrap;">
        ${issuePages.length
          ? `<span>🔴 <strong style="color:#f87171;">${issuePages.length} pages</strong> me issues hain</span>`
          : ''}
        <span>🟢 <strong style="color:var(--green);">${healthyCount} pages</strong> healthy hain</span>
        ${orphans ? `<span>⛓ <strong style="color:#f87171;">${orphans} orphan</strong> pages</span>` : ''}
      </div>
    </div>
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:10px;">
      <button class="seo-page-filter-btn${seoPageFilterMode === 'issues' ? ' active' : ''}" data-filter="issues">
        ⚠️ Issues Only (${issuePages.length})
      </button>
      <button class="seo-page-filter-btn${seoPageFilterMode === 'all' ? ' active' : ''}" data-filter="all">
        All Pages (${pages.length})
      </button>
    </div>
    <div style="display:flex;flex-direction:column;gap:3px;">
      ${rows.length ? rows : `<div style="font-size:12px;color:var(--green);text-align:center;padding:16px 0;">✅ Saare crawled pages healthy hain — koi structural issue nahi mila! 🎉</div>`}
    </div>
  `;

  el.querySelectorAll('.seo-page-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      seoPageFilterMode = btn.dataset.filter;
      renderSeoPages(site);
    });
  });

  el.querySelectorAll('.seo-page-row-header').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const row = hdr.closest('.seo-page-row');
      if (row) row.classList.toggle('open');
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

document.getElementById('seo-send-btn')?.addEventListener('click', sendSeoMessage);
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
    if (hasResearching) {
      if (stalkPollTimer) clearTimeout(stalkPollTimer);
      stalkPollTimer = setTimeout(() => {
        stalkPollTimer = null;
        loadStalking();
      }, 2500);
    } else if (stalkPollTimer) {
      clearTimeout(stalkPollTimer);
      stalkPollTimer = null;
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
      ${prof.link ? `<a href="${escHtml(prof.link.startsWith('http') ? prof.link : 'https://' + prof.link)}" target="_blank" rel="noopener noreferrer" style="font-size:12px;color:var(--accent-blue);text-decoration:none;display:inline-flex;align-items:center;gap:4px;">🔗 <span>Open Source</span></a>` : ''}
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
    btn.disabled = true;
    btn.textContent = '⏳ Starting…';
    try {
      await apiFetch(`/api/stalking/${btn.dataset.id}/research`, { method: 'POST' });
      const p = stalkCache.find(x => String(x.id) === String(btn.dataset.id));
      if (p) p.status = 'researching';
      if (currentStalk && String(currentStalk.id) === String(btn.dataset.id)) {
        currentStalk.status = 'researching';
        updateStalkHeader(currentStalk);
      }
      renderStalkList();
      if (stalkPollTimer) clearTimeout(stalkPollTimer);
      stalkPollTimer = setTimeout(() => {
        stalkPollTimer = null;
        loadStalking();
      }, 2000);
    } catch (err) {
      alert('Re-research error: ' + err.message);
      btn.disabled = false;
      btn.textContent = '🔍 Re-Research';
    }
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
    loadingMsg.innerHTML = '<div class="ws-msg-role">Bob 🔎</div><div class="ws-msg-text">⏳ Profile create kar raha hu…</div>';
    el.appendChild(loadingMsg); el.scrollTop = el.scrollHeight;
    try {
      const urlMatch = text.match(/https?:\/\/[^\s]+/);
      const link = urlMatch ? urlMatch[0] : null;
      const name = text.replace(link || '', '').replace(/[\-–:|,]/g, ' ').trim().split('\n')[0].substring(0, 60) || 'Unknown';
      const { profile } = await apiFetch('/api/stalking', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name || text.substring(0,60), link, notes: text }) });
      el.removeChild(loadingMsg);
      await loadStalking();
      await selectStalk(String(profile.id));
      appendWsMsg(el, 'assistant', 'Bob 🔎', `✅ "${profile.name}" profile list me add ho gaya! Research background me chal raha hai. Ab tum directly iske baare me chat kar sakte ho.`);
    } catch (err) {
      try { el.removeChild(loadingMsg); } catch(_) {}
      appendWsMsg(el, 'assistant', 'Bob 🔎', '⚠️ ' + err.message + '\n\nTip: Name aur LinkedIn/GitHub URL dena zaroori hai, jaise: "Rahul Sharma - https://linkedin.com/in/rahul"');
    }
    input.disabled = false; input.focus();
    return;
  }

  // Profile selected → normal workspace chat
  try {
    const data = await apiFetch(`/api/stalking/${currentStalk.id}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }) });
    appendWsMsg(el, 'assistant', 'Bob 🔎', data.reply);

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
  } catch (err) { appendWsMsg(el, 'assistant', 'Bob 🔎', '⚠️ ' + err.message); }
  input.disabled = false; input.focus();
}

function openAddStalkModal() {
  openModal('🔎 Add Person to Research', `
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
    const [routRes, pulseRes] = await Promise.allSettled([
      apiFetch('/api/routines'),
      apiFetch('/api/live/pulse')
    ]);

    const routines = (routRes.status === 'fulfilled' && routRes.value.routines) || [];
    const pulseData = (pulseRes.status === 'fulfilled' && pulseRes.value) || {};
    const discMeta = pulseData.meta || {};

    const isPaused = discMeta.enabled === false;
    let nextScanStr = 'Ready';
    if (discMeta.nextRunAt) {
      const diffMs = discMeta.nextRunAt - Date.now();
      if (diffMs > 0) {
        const days = Math.floor(diffMs / (3600000 * 24));
        const hours = Math.floor((diffMs % (3600000 * 24)) / 3600000);
        nextScanStr = days > 0 ? `in ${days}d ${hours}h` : `in ${hours}h`;
      }
    }

    const radarAckCard = `
      <div class="routine-item" style="border: 1px solid rgba(139, 92, 246, 0.35); background: rgba(139, 92, 246, 0.05); grid-column: 1 / -1; margin-bottom: 12px;">
        <div class="routine-head">
          <span class="routine-title" style="color: #c084fc;">⚡ Hackathon Discovery Engine — Autonomous 4-Day Cycle</span>
          <span class="routine-ws" style="background: rgba(139, 92, 246, 0.2); color: #c084fc;">AUTONOMOUS CYCLE</span>
        </div>
        <div class="routine-prompt" style="color: var(--text2);">
          Ye schedule Bob backend me autonomously active rehta hai. Har 4 din ke gap me Devpost, Unstop aur Devfolio se naye CSE hackathons automatically scan karke radar me populate karta hai.
        </div>
        <div class="routine-meta" style="color: #38bdf8; font-weight: 600;">
          Status: <span style="color: ${isPaused ? '#f59e0b' : '#4ade80'};">${isPaused ? '⏸ PAUSED' : '🟢 ACTIVE (Running every 4 days)'}</span> · Next Auto-Scan: <span style="color: #facc15;">${nextScanStr}</span>
        </div>
        <div style="font-size: 11px; color: var(--text3); margin-top: 6px;">
          💡 Tip: Iska "Run Now", "Pause/Resume" aur discovery management seedha <strong>⚡ Hackathon Radar</strong> card ke andar se operate hota hai.
        </div>
      </div>
    `;

    if (!routines.length) {
      grid.innerHTML = radarAckCard + '<div class="empty-msg">No custom user routines yet. Ek routine banao — Bob khud prompt karega aur workspace me output dega.</div>';
      return;
    }

    grid.innerHTML = radarAckCard + routines.map(r => `
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
            <option value="stalking">🔎 Deep Research</option>
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
// HACKATHON RADAR (Live Pulse Hub)
// ═══════════════════════════════════════════════════════

let liveDiscoveryCache = [];
let liveDiscoveryMeta = {};

async function loadLive() {
  const body = document.getElementById('live-body');
  body.innerHTML = '<div class="empty-msg">Scanning Hackathon Radar…</div>';

  try {
    const data = await apiFetch('/api/live/pulse');
    liveDiscoveryCache = data.hackathons || [];
    liveDiscoveryMeta = data.meta || {};

    const toggleBtn = document.getElementById('live-toggle-btn');
    if (toggleBtn) {
      const isPaused = liveDiscoveryMeta.enabled === false;
      toggleBtn.textContent = isPaused ? '▶ Resume Auto-Scan' : '⏸ Pause Auto-Scan';
      toggleBtn.style.background = isPaused ? 'rgba(74, 222, 128, 0.15)' : 'rgba(245, 158, 11, 0.15)';
      toggleBtn.style.color = isPaused ? '#4ade80' : '#f59e0b';
      toggleBtn.style.border = isPaused ? '1px solid #4ade80' : '1px solid #f59e0b';
    }

    renderLiveRadar();
  } catch (err) {
    body.innerHTML = `<div class="empty-msg">⚠️ Radar fetch failed: ${escHtml(err.message)}</div>`;
  }
}

function renderLiveRadar() {
  const body = document.getElementById('live-body');
  const isPaused = liveDiscoveryMeta.enabled === false;
  const nextRunAt = liveDiscoveryMeta.nextRunAt || 0;
  
  function getCountdownText(ts) {
    if (!ts || isPaused) return isPaused ? '⏸ Paused' : 'Ready to scan';
    const diff = ts - Date.now();
    if (diff <= 0) return '⚡ Due for auto-scan now';
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (days > 0) return `⏳ Next auto-scan in ${days}d ${hours}h`;
    return `⏳ Next auto-scan in ${hours}h ${mins}m`;
  }

  const countdownStr = getCountdownText(nextRunAt);

  // Dynamic Hero Control Bar visible inside page body
  const heroBarHtml = `
    <div style="background: rgba(139, 92, 246, 0.08); border: 1px solid rgba(139, 92, 246, 0.25); border-radius: 12px; padding: 14px 18px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
      <div>
        <div style="font-weight: 800; font-size: 15px; color: #c084fc; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <span>⚡ Autonomous Crawler Radar</span>
          <span style="font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 10px; background: ${isPaused ? 'rgba(245, 158, 11, 0.2)' : 'rgba(74, 222, 128, 0.2)'}; color: ${isPaused ? '#f59e0b' : '#4ade80'};">
            ${isPaused ? '⏸ PAUSED' : '🟢 ACTIVE (4-Day Auto Cycle)'}
          </span>
          <span id="live-countdown-badge" style="font-size: 11px; font-weight: 800; padding: 2px 9px; border-radius: 10px; background: rgba(139, 92, 246, 0.2); color: #c084fc; border: 1px solid rgba(139, 92, 246, 0.35);">
            ${countdownStr}
          </span>
        </div>
        <div style="font-size: 12px; color: var(--text2); margin-top: 4px;">
          Scrapes real CSE hackathons from <strong>Devpost</strong>, <strong>Unstop</strong> & <strong>Devfolio</strong> with permanent link de-duplication (no repeated hackathons).
        </div>
      </div>
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
        <button id="live-hero-to-ws" class="btn-small btn-secondary" title="Switch to Tracked Hackathons Workspace">🏆 My Hackathons</button>
        <button id="live-hero-toggle" class="btn-small" style="background: ${isPaused ? 'rgba(74, 222, 128, 0.15)' : 'rgba(245, 158, 11, 0.15)'}; color: ${isPaused ? '#4ade80' : '#f59e0b'}; border: 1px solid ${isPaused ? '#4ade80' : '#f59e0b'};">
          ${isPaused ? '▶ Resume Auto-Scan' : '⏸ Pause'}
        </button>
        <button id="live-hero-scan" class="btn-small btn-primary" style="font-weight: 700; box-shadow: 0 2px 10px rgba(56, 189, 248, 0.3);">
          🔍 Scan Now
        </button>
      </div>
    </div>
  `;

  if (!liveDiscoveryCache.length) {
    body.innerHTML = `
      <div style="max-width:800px; margin:0 auto;">
        ${heroBarHtml}
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
    `;

    document.getElementById('live-empty-scan-btn')?.addEventListener('click', triggerLiveScan);
    document.getElementById('live-hero-scan')?.addEventListener('click', triggerLiveScan);
    document.getElementById('live-hero-toggle')?.addEventListener('click', toggleLiveScan);
    document.getElementById('live-hero-to-ws')?.addEventListener('click', () => { showView('hackathons'); loadHackathons(); });
    return;
  }

  const cardsHtml = liveDiscoveryCache.map(h => {
    const platformColors = {
      devpost: '#00a8cc',
      unstop: '#8b5cf6',
      devfolio: '#3b82f6'
    };
    const pColor = platformColors[h.platform] || '#38bdf8';
    const deadline = h.registrationDeadline ? new Date(h.registrationDeadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'Open';
    const tags = (h.tags || []).slice(0, 3).map(t => `<span style="font-size:10px; font-weight:700; padding:3px 7px; border-radius:6px; background:rgba(56,189,248,0.12); color:#38bdf8;">#${escHtml(t)}</span>`).join(' ');
    
    // Clean any residual HTML from prize
    const cleanPrize = (h.prize || 'Prizes & Swags').replace(/<[^>]*>/g, '').trim();
    const feeText = h.fee || 'Free Entry';
    const isFree = feeText.toLowerCase().includes('free');
    const mode = h.mode || 'online';
    const isOnline = mode.toLowerCase() === 'online';
    const location = h.location || (isOnline ? 'Online / Virtual' : 'In-Person Venue');
    const seats = h.seatsStatus || 'Open';

    return `
      <div class="hack-card" style="background:var(--surface); border:1px solid rgba(139, 92, 246, 0.25); border-radius:14px; padding:18px; margin-bottom:16px; box-shadow:0 4px 18px rgba(0,0,0,0.25);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; gap:8px; flex-wrap:wrap;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:10px; font-weight:900; padding:3px 9px; border-radius:6px; background:${pColor}25; color:${pColor}; border:1px solid ${pColor}50; text-transform:uppercase; letter-spacing:0.5px;">${escHtml(h.platform || 'CSE')}</span>
            <span style="font-size:10px; font-weight:800; padding:2px 8px; border-radius:6px; background:${isFree ? 'rgba(74, 222, 128, 0.15)' : 'rgba(245, 158, 11, 0.15)'}; color:${isFree ? '#4ade80' : '#f59e0b'}; border:1px solid ${isFree ? 'rgba(74,222,128,0.3)' : 'rgba(245,158,11,0.3)'};">
              ${isFree ? '🟢 FREE ENTRY' : '💳 ' + escHtml(feeText.toUpperCase())}
            </span>
            <span style="font-size:10px; font-weight:700; padding:2px 8px; border-radius:6px; background:${isOnline ? 'rgba(56, 189, 248, 0.12)' : 'rgba(168, 85, 247, 0.12)'}; color:${isOnline ? '#38bdf8' : '#c084fc'};">
              ${isOnline ? '🌐 Online' : '📍 ' + escHtml(location)}
            </span>
          </div>
          <span style="font-size:11px; font-weight:800; color:#f59e0b; background:rgba(245, 158, 11, 0.1); padding:2px 8px; border-radius:6px;">⏱ ${escHtml(deadline)}</span>
        </div>

        <h3 style="font-size:17px; font-weight:900; color:var(--text); margin-bottom:8px; line-height:1.35;">${escHtml(h.title)}</h3>
        <p style="font-size:13px; color:var(--text2); line-height:1.6; margin-bottom:12px;">${escHtml(h.summary || '')}</p>

        <!-- What to Build highlight block -->
        ${h.whatToBuild ? `
        <div style="background:rgba(139, 92, 246, 0.08); border-left:3px solid #8b5cf6; border-radius:0 8px 8px 0; padding:10px 14px; margin-bottom:12px;">
          <div style="font-size:11px; font-weight:800; color:#c084fc; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px; display:flex; align-items:center; gap:5px;">
            <span>🛠️ What to Build</span>
          </div>
          <div style="font-size:12px; color:var(--text); line-height:1.5;">${escHtml(h.whatToBuild)}</div>
        </div>
        ` : ''}

        <!-- Hackathon Key Facts Quick Bar -->
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:8px; background:rgba(0,0,0,0.25); border:1px solid rgba(255,255,255,0.05); padding:10px 12px; border-radius:8px; margin-bottom:12px; font-size:11px;">
          <div><span style="color:var(--text2);">👥 Team:</span> <strong style="color:var(--text);">${escHtml(h.teamSize || '1-4 Members')}</strong></div>
          <div><span style="color:var(--text2);">📍 Location:</span> <strong style="color:var(--text);">${escHtml(location)}</strong></div>
          <div><span style="color:var(--text2);">📜 Certificates:</span> <strong style="color:${h.hasCertificates !== false ? '#4ade80' : '#94a3b8'};">${escHtml(h.certificatesInfo || (h.hasCertificates !== false ? 'Yes (All Valid)' : 'No'))}</strong></div>
          <div><span style="color:var(--text2);">🎟 Status:</span> <strong style="color:#4ade80;">${escHtml(seats)}</strong></div>
        </div>

        ${h.prizeBasis ? `
        <div style="font-size:11px; color:var(--text2); margin-bottom:12px; display:flex; align-items:flex-start; gap:6px; background:rgba(250, 204, 21, 0.05); border:1px solid rgba(250, 204, 21, 0.15); border-radius:6px; padding:6px 10px;">
          <span style="color:#facc15;">⚖️</span>
          <div><strong style="color:#facc15;">Judging & Prize Basis:</strong> <span style="color:var(--text);">${escHtml(h.prizeBasis)}</span></div>
        </div>
        ` : ''}

        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:14px;">
          ${tags}
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; padding-top:12px; border-top:1px solid rgba(255,255,255,0.06); flex-wrap:wrap; gap:10px;">
          <div style="font-weight:900; font-size:14px; color:#facc15;">💰 ${escHtml(cleanPrize)}</div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <a href="${escHtml(h.link)}" target="_blank" rel="noopener noreferrer" class="btn-small" style="text-decoration:none; background:rgba(56,189,248,0.15); color:#38bdf8; border:1px solid rgba(56,189,248,0.3); font-weight:700;">🔗 Register</a>
            <button class="btn-small btn-primary" data-live-save="${h.id}" title="Transfer to Hackathons Workspace" style="font-weight:700;">📌 Save to Workspace</button>
            <button class="btn-small" data-live-del="${h.id}" style="background:rgba(244,63,94,0.15); color:#f43f5e; border:1px solid rgba(244,63,94,0.3);">✕ Dismiss</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  body.innerHTML = `<div style="max-width:800px; margin:0 auto;">${heroBarHtml}${cardsHtml}</div>`;

  document.getElementById('live-hero-scan')?.addEventListener('click', triggerLiveScan);
  document.getElementById('live-hero-toggle')?.addEventListener('click', toggleLiveScan);
  document.getElementById('live-hero-to-ws')?.addEventListener('click', () => { showView('hackathons'); loadHackathons(); });

  body.querySelectorAll('[data-live-save]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.liveSave;
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await apiFetch(`/api/live/hackathon-discovery/${id}/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ participating: false }) });
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
        await apiFetch(`/api/live/hackathon-discovery/${id}/dismiss`, { method: 'POST' });
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
      alert(`✅ Live scan complete! Discovered ${res.added || 0} new hackathons across Devpost, Unstop & Devfolio.`);
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
}

document.getElementById('live-scan-btn')?.addEventListener('click', async (e) => {
  const btn = e.target;
  btn.disabled = true; btn.textContent = 'Scanning…';
  try {
    const res = await apiFetch('/api/live/hackathon-discovery/run', { method: 'POST' });
    if (res.skipped) {
      alert(`Scan scheduled soon. 4-day interval cycle active.`);
    } else {
      alert(`✅ Scan complete! Found ${res.added || 0} new hackathons.`);
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
    await apiFetch('/api/live/hackathon-discovery/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enable: isPaused }) });
    liveDiscoveryMeta.enabled = isPaused;
    btn.textContent = isPaused ? '⏸ Pause Auto-Scan' : '▶ Resume Auto-Scan';
    btn.style.background = isPaused ? 'rgba(245, 158, 11, 0.15)' : 'rgba(74, 222, 128, 0.15)';
    btn.style.color = isPaused ? '#f59e0b' : '#4ade80';
    btn.style.border = isPaused ? '1px solid #f59e0b' : '1px solid #4ade80';
    alert(isPaused ? '▶ Auto-scan resumed! Har 4 din me naye hackathons aayenge.' : '⏸ Auto-scan paused!');
  } catch (err) { alert(err.message); }
  finally { btn.disabled = false; }
});

// ── Shared workspace chat helpers ─────────────────────
function renderWsChat(el, messages, tag) {
  if (!messages || !messages.length) { el.innerHTML = '<div class="empty-msg">Is workspace me abhi koi baat nahi hui. Pehla message bhejo — context totally isolated hai.</div>'; return; }
  el.innerHTML = messages.map(m => wsMsgHTML(m.role, m.role === 'user' ? 'Nikhil' : (tag === 'hack' ? 'Bob 🏆' : tag === 'seo' ? 'Bob 🔍' : 'Bob 🔎'), m.content)).join('');
  el.scrollTop = el.scrollHeight;
}
function wsMsgHTML(role, author, text) { return `<div class="ws-msg ${role}"><div class="ws-msg-role">${escHtml(author)}</div><div class="ws-msg-text">${renderTextContent(text)}</div></div>`; }
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
    const bags = data.bags || {};
    const bob = bags.bobBag || { queueA: [], queueB: [], totalKeys: 0, activeCount: 0 };
    const builder = bags.builderBag || { queueA: [], queueB: [], totalKeys: 0, activeCount: 0 };
    const gemini = bags.geminiBag || data.gemini || { keys: [], queueA: [], queueB: [], totalKeys: 0, activeCount: 0 };

    grid.innerHTML = `
      <!-- BLOCK 1: BOB KEY BAG -->
      <div class="key-block-section" style="background:rgba(59,130,246,0.04); border:1px solid rgba(59,130,246,0.2); border-radius:12px; padding:16px; margin-bottom:20px;">
        <div class="keys-summary-bar" style="background:rgba(59,130,246,0.1); border:1px solid rgba(59,130,246,0.3);">
          <span class="ks-label" style="color:#60a5fa; font-weight:700; font-size:14px;">🤖 BLOCK 1: BOB KEY BAG</span>
          <span class="ks-label">Queue A (Active Working):</span><span class="ks-val ks-ok">${bob.queueACount || (bob.queueA||[]).length} keys</span>
          <span class="ks-label">Queue B (Cooldown/Rest):</span><span class="ks-val ks-bad">${bob.queueBCount || (bob.queueB||[]).length} keys</span>
          <span class="ks-label">Total in Bag:</span><span class="ks-val">${bob.totalKeys || 0}</span>
          <span class="ks-label">Auto-Shift:</span><span class="ks-val ks-ok">Active ⇄ Rest (Midnight Reset)</span>
        </div>
        <div class="keys-section-title" style="margin-top:12px; color:#93c5fd;">⚡ Queue A — Active Fast Working Queue</div>
        <div class="key-chips">
          ${(bob.queueA || []).map(k => queueKeyChip(k, 'ok')).join('') || '<div class="empty-msg">No active keys in Queue A</div>'}
        </div>
        ${(bob.queueB || []).length ? `
          <div class="keys-section-title" style="margin-top:14px; color:#f87171;">⏳ Queue B — Cooldown & Next-Day Rest Queue</div>
          <div class="key-chips">
            ${bob.queueB.map(k => queueKeyChip(k, 'rest')).join('')}
          </div>
        ` : ''}
      </div>

      <!-- BLOCK 2: BUILDER KEY BAG -->
      <div class="key-block-section" style="background:rgba(245,158,11,0.04); border:1px solid rgba(245,158,11,0.2); border-radius:12px; padding:16px; margin-bottom:20px;">
        <div class="keys-summary-bar" style="background:rgba(245,158,11,0.1); border:1px solid rgba(245,158,11,0.3);">
          <span class="ks-label" style="color:#fbbf24; font-weight:700; font-size:14px;">🏗️ BLOCK 2: BUILDER KEY BAG</span>
          <span class="ks-label">Queue A (Active Working):</span><span class="ks-val ks-ok">${builder.queueACount || (builder.queueA||[]).length} keys</span>
          <span class="ks-label">Queue B (Cooldown/Rest):</span><span class="ks-val ks-bad">${builder.queueBCount || (builder.queueB||[]).length} keys</span>
          <span class="ks-label">Total in Bag:</span><span class="ks-val">${builder.totalKeys || 0}</span>
          <span class="ks-label">Persona:</span><span class="ks-val ks-ok">Builder Architecture & Loops</span>
        </div>
        <div class="keys-section-title" style="margin-top:12px; color:#fcd34d;">⚡ Queue A — Active Fast Working Queue</div>
        <div class="key-chips">
          ${(builder.queueA || []).map(k => queueKeyChip(k, 'ok')).join('') || '<div class="empty-msg">No active keys in Queue A</div>'}
        </div>
        ${(builder.queueB || []).length ? `
          <div class="keys-section-title" style="margin-top:14px; color:#f87171;">⏳ Queue B — Cooldown & Next-Day Rest Queue</div>
          <div class="key-chips">
            ${builder.queueB.map(k => queueKeyChip(k, 'rest')).join('')}
          </div>
        ` : ''}
      </div>

      <!-- BLOCK 3: GEMINI BURST BAG -->
      <div class="key-block-section" style="background:rgba(168,85,247,0.04); border:1px solid rgba(168,85,247,0.2); border-radius:12px; padding:16px;">
        <div class="keys-summary-bar" style="background:rgba(168,85,247,0.1); border:1px solid rgba(168,85,247,0.3);">
          <span class="ks-label" style="color:#d8b4fe; font-weight:700; font-size:14px;">🟣 BLOCK 3: GEMINI BURST BAG</span>
          <span class="ks-label">Active:</span><span class="ks-val ks-gemini">${gemini.activeCount || 0} / ${gemini.totalKeys || 11}</span>
          <span class="ks-label">Requests Today:</span><span class="ks-val" style="color:#38bdf8;">${gemini.totalRequestsToday || 0}</span>
          <span class="ks-label">Daily Capacity:</span><span class="ks-val" style="color:#fbbf24;">${(gemini.dailyCapacity || 11000).toLocaleString()} req/day</span>
          <span class="ks-label">Workload:</span><span class="ks-val ks-ok">SEO, Research, Dossier, Radar & Memory</span>
        </div>
        <div class="keys-section-title" style="margin-top:12px; color:#c084fc;">⚡ 11-Key Rotating Burst Pool</div>
        <div class="key-chips">
          ${(gemini.keys || []).map(gk => geminiKeyChip(gk)).join('')}
        </div>
      </div>
    `;
  } catch (err) {
    grid.innerHTML = `<div class="empty-msg">⚠️ Keys health load fail: ${escHtml(err.message)}</div>`;
  }
}

function queueKeyChip(k, variant) {
  const isRest = variant === 'rest' || k.status === 'cooldown';
  const cls = isRest ? 'key-bad' : 'key-ok';
  const bal = typeof k.lastBalance === 'number' ? k.lastBalance : (typeof k.balance === 'number' ? k.balance : '—');
  const used = typeof k.tokensUsed === 'number' ? k.tokensUsed : 0;
  const label = k.keyId || (k.last4 ? `…${k.last4}` : '#');
  return `<div class="key-chip ${cls}">
    <span class="key-last4">${escHtml(label)}</span>
    <span class="key-role">${isRest ? 'REST / COOLDOWN' : 'QUEUE A (ACTIVE)'}</span>
    <span class="key-bal">bal ${bal}</span>
    <span class="key-used">tokens ${used}</span>
    <span class="key-status" style="color:${isRest ? '#f87171' : '#34d399'};">${isRest ? 'COOLDOWN' : 'READY'}</span>
  </div>`;
}

function geminiKeyChip(gk) {
  const isOk = gk.status === 'active';
  const cls = isOk ? 'key-gemini' : 'key-gemini-warn';
  const last = gk.lastUsedAt ? new Date(gk.lastUsedAt).toLocaleTimeString('en-IN', { hour12: false }) : '—';
  const reqs = gk.requestsToday || 0;
  const limit = gk.dailyLimit || 1000;
  return `<div class="key-chip ${cls}">
    <span class="key-last4">GEMINI #${gk.index}</span>
    <span class="key-role" style="color:#c084fc;">…${gk.keySuffix || '****'}</span>
    <span class="key-bal" style="color:#38bdf8;">${reqs}/${limit} reqs</span>
    <span class="key-status" style="color:${isOk ? '#c084fc' : '#facc15'};">${(gk.status || 'ACTIVE').toUpperCase()}</span>
    <span class="key-pool">BURST POOL</span>
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

// ═══════════════════════════════════════════════════════
// RESUME BUILDER & CAREER INTELLIGENCE WORKSPACE
// ═══════════════════════════════════════════════════════

let currentResumeProfile = null;

async function loadResumeProfile() {
  const syncStatus = document.getElementById('resume-sync-status');
  const baseStatus = document.getElementById('resume-base-status');
  const certCount = document.getElementById('resume-cert-count');
  const ghInput = document.getElementById('resume-github-username');
  const lcInput = document.getElementById('resume-leetcode-username');
  const ccInput = document.getElementById('resume-codechef-username');
  const cfInput = document.getElementById('resume-codeforces-username');

  try {
    const res = await apiFetch('/api/resume/profile');
    if (res && res.profile) {
      currentResumeProfile = res.profile;
      const handles = res.profile.savedHandles || {};
      if (ghInput && res.profile.githubUsername && !ghInput.value) {
        ghInput.value = res.profile.githubUsername;
      }
      if (lcInput && (handles.leetcode || res.profile.developerPlatforms?.leetcode?.username) && !lcInput.value) {
        lcInput.value = handles.leetcode || res.profile.developerPlatforms.leetcode.username;
      }
      if (ccInput && (handles.codechef || res.profile.developerPlatforms?.codechef?.username) && !ccInput.value) {
        ccInput.value = handles.codechef || res.profile.developerPlatforms.codechef.username;
      }
      if (cfInput && (handles.codeforces || res.profile.developerPlatforms?.codeforces?.username) && !cfInput.value) {
        cfInput.value = handles.codeforces || res.profile.developerPlatforms.codeforces.username;
      }

      if (baseStatus) {
        if (res.profile.baseResume?.url) {
          baseStatus.innerHTML = `✅ <a href="${res.profile.baseResume.url}" target="_blank" style="color:var(--accent);">View Uploaded PDF</a> (${res.profile.baseResume.originalName || 'base_resume.pdf'})`;
        } else {
          baseStatus.textContent = 'No PDF uploaded yet';
        }
      }

      if (certCount) {
        const total = (res.profile.certifications || []).length;
        certCount.textContent = `${total} Document${total === 1 ? '' : 's'} stored`;
      }

      const docsList = document.getElementById('resume-docs-list');
      if (docsList) {
        const certs = res.profile.certifications || [];
        if (certs.length === 0) {
          docsList.innerHTML = '<span style="font-size:11px; color:var(--text3);">No extra certificates or marksheets added yet.</span>';
        } else {
          docsList.innerHTML = certs.map(c => `
            <a href="${c.url}" target="_blank" style="display:inline-flex; align-items:center; gap:4px; padding:3px 8px; border-radius:4px; background:var(--surface2); border:1px solid var(--border2); font-size:11px; color:var(--text); text-decoration:none;" title="${c.category || 'Document'}">
              <span>📄</span>
              <span style="max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${c.title}</span>
            </a>
          `).join('');
        }
      }

      // Render Synced GitHub Repositories Preview
      const reposContainer = document.getElementById('resume-repos-container');
      const reposList = document.getElementById('resume-repos-list');
      const reposCount = document.getElementById('resume-repos-count');
      const projects = res.profile.githubProjects || [];

      if (reposContainer && reposList) {
        if (projects.length > 0) {
          reposContainer.style.display = 'block';
          if (reposCount) reposCount.textContent = projects.length;
          reposList.innerHTML = projects.map(p => {
            const stack = (p.techStack || []).slice(0, 3).join(', ');
            return `
              <div style="display:inline-flex; flex-direction:column; gap:2px; padding:6px 10px; border-radius:6px; background:var(--bg); border:1px solid var(--border); font-size:11px; max-width:210px; position:relative;" title="${p.description || p.title}">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
                  <strong style="color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:140px;">📦 ${p.title}</strong>
                  <div style="display:flex; align-items:center; gap:4px;">
                    <a href="${p.githubUrl}" target="_blank" style="color:var(--accent); text-decoration:none;" title="View on GitHub">↗</a>
                    <button class="resume-remove-repo-btn" data-title="${p.title}" style="background:none; border:none; color:var(--text3); cursor:pointer; padding:0 2px; font-size:11px;" title="Remove from Resume">✕</button>
                  </div>
                </div>
                ${stack ? `<span style="color:var(--text3); font-size:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">🛠️ ${stack}</span>` : ''}
              </div>
            `;
          }).join('');

          // Bind delete handlers
          reposList.querySelectorAll('.resume-remove-repo-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
              e.stopPropagation();
              const repoTitle = btn.getAttribute('data-title');
              if (!confirm(`Do you want to exclude "${repoTitle}" from your resume?`)) return;
              try {
                btn.parentElement.parentElement.parentElement.style.opacity = '0.4';
                await apiFetch(`/api/resume/project/${encodeURIComponent(repoTitle)}`, { method: 'DELETE' });
                await loadResumeProfile();
              } catch (delErr) {
                alert(`Failed to remove project: ${delErr.message}`);
                btn.parentElement.parentElement.parentElement.style.opacity = '1';
              }
            });
          });
        } else {
          reposContainer.style.display = 'none';
        }
      }
    }
  } catch (err) {
    console.error('loadResumeProfile error:', err);
    if (syncStatus) syncStatus.textContent = 'Error loading career profile.';
  }
}

// Helper to clean handles from full URLs or raw usernames
function extractCleanHandle(input) {
  if (!input) return '';
  let str = input.trim();
  try {
    if (str.startsWith('http://') || str.startsWith('https://')) {
      const u = new URL(str);
      const parts = u.pathname.split('/').filter(Boolean);
      // handles URLs like /u/username, /users/username, /profile/username or just /username
      if (['u', 'users', 'profile', 'in'].includes(parts[0]) && parts[1]) {
        return parts[1];
      }
      return parts[parts.length - 1] || '';
    }
  } catch (e) {}
  // Strip trailing slashes or domain prefixes if entered without protocol
  str = str.replace(/^(?:https?:\/\/)?(?:www\.)?(?:github\.com|leetcode\.com|codechef\.com|codeforces\.com)\/(?:u\/|users\/|profile\/)?/i, '');
  return str.replace(/\/+$/, '').trim();
}

// GitHub Sync
document.getElementById('resume-sync-github-btn')?.addEventListener('click', async () => {
  const rawInput = document.getElementById('resume-github-username')?.value.trim();
  const username = extractCleanHandle(rawInput);
  const statusEl = document.getElementById('resume-sync-status');
  if (!username) { alert('Please enter your GitHub profile link or username.'); return; }
  
  statusEl.textContent = `⏳ Crawling GitHub repositories & READMEs for @${username}...`;
  try {
    const res = await apiFetch('/api/resume/sync/github', {
      method: 'POST',
      body: JSON.stringify({ username })
    });
    statusEl.textContent = `✅ Synced ${res.projects?.length || 0} GitHub repositories!`;
    await loadResumeProfile();
  } catch (err) {
    statusEl.textContent = `❌ Failed to sync GitHub: ${err.message}`;
  }
});

// Coding Stats Sync
document.getElementById('resume-sync-coding-btn')?.addEventListener('click', async () => {
  const leetcode = extractCleanHandle(document.getElementById('resume-leetcode-username')?.value);
  const codechef = extractCleanHandle(document.getElementById('resume-codechef-username')?.value);
  const codeforces = extractCleanHandle(document.getElementById('resume-codeforces-username')?.value);
  const statusEl = document.getElementById('resume-sync-status');

  statusEl.textContent = '⏳ Syncing coding platform statistics...';
  try {
    const res = await apiFetch('/api/resume/sync/coding', {
      method: 'POST',
      body: JSON.stringify({ handles: { leetcode, codechef, codeforces } })
    });
    statusEl.textContent = `✅ Coding statistics updated!`;
    await loadResumeProfile();
  } catch (err) {
    statusEl.textContent = `❌ Failed to sync coding stats: ${err.message}`;
  }
});

// Base Resume PDF Upload
document.getElementById('resume-base-input')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById('resume-base-status');
  statusEl.textContent = '⏳ Uploading and parsing previous resume PDF...';

  const formData = new FormData();
  formData.append('file', file);

  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(API + '/api/resume/upload/base', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    statusEl.innerHTML = `✅ <a href="${data.baseResume.url}" target="_blank" style="color:var(--accent);">View Uploaded PDF</a>`;
    await loadResumeProfile();
  } catch (err) {
    statusEl.textContent = `❌ Error: ${err.message}`;
  }
});

// Certificates & Academic Marksheets Batch Upload
document.getElementById('resume-cert-input')?.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  if (files.length === 0) return;
  const countEl = document.getElementById('resume-cert-count');
  countEl.textContent = `⏳ Uploading ${files.length} document(s)...`;

  const formData = new FormData();
  files.forEach(f => formData.append('files', f));

  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(API + '/api/resume/upload/documents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    countEl.textContent = `✅ Uploaded ${data.added?.length || files.length} document(s)!`;
    await loadResumeProfile();
  } catch (err) {
    countEl.textContent = `❌ Error: ${err.message}`;
  } finally {
    e.target.value = ''; // Reset input to allow re-uploading if needed
  }
});

// Generate Tailored ATS Resume
document.getElementById('resume-generate-btn')?.addEventListener('click', async () => {
  const targetJobDescription = document.getElementById('resume-jd-input')?.value.trim();
  const spinner = document.getElementById('resume-gen-spinner');
  const resultsBox = document.getElementById('resume-results-container');
  const latexOut = document.getElementById('resume-latex-output');
  const pdfLink = document.getElementById('resume-pdf-download-btn');

  spinner.style.display = 'inline';
  try {
    const res = await apiFetch('/api/resume/generate', {
      method: 'POST',
      body: JSON.stringify({ targetJobDescription })
    });
    
    resultsBox.style.display = 'block';
    latexOut.value = res.latexCode || res.latexSource || '';
    if (pdfLink) {
      pdfLink.style.display = 'inline-flex';
    }
  } catch (err) {
    alert(`Resume Generation Error: ${err.message}`);
  } finally {
    spinner.style.display = 'none';
  }
});

// Direct Download PDF (Safe binary download)
document.getElementById('resume-pdf-download-btn')?.addEventListener('click', async () => {
  const latexOut = document.getElementById('resume-latex-output');
  const latexCode = latexOut?.value?.trim();
  if (!latexCode) { alert('Please generate a resume first.'); return; }

  const btn = document.getElementById('resume-pdf-download-btn');
  const originalText = btn.innerHTML;
  btn.innerHTML = '⏳ Compiling PDF...';
  btn.disabled = true;

  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(API + '/api/resume/download-pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ latexCode, filename: 'master_resume.pdf' })
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `Failed to compile PDF (HTTP ${res.status})`);
    }

    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = 'master_resume.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(blobUrl);
  } catch (err) {
    console.error('Download PDF error:', err);
    alert(`PDF Download Error: ${err.message}\nTip: You can also copy the LaTeX code and compile on Overleaf if needed.`);
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
});

// Copy LaTeX
document.getElementById('resume-copy-latex-btn')?.addEventListener('click', () => {
  const latexOut = document.getElementById('resume-latex-output');
  if (!latexOut || !latexOut.value) return;
  navigator.clipboard.writeText(latexOut.value);
  alert('✅ LaTeX source code copied to clipboard!');
});

// Overleaf 1-Click Open & Copy
document.getElementById('resume-overleaf-btn')?.addEventListener('click', (e) => {
  const latexOut = document.getElementById('resume-latex-output');
  if (latexOut && latexOut.value) {
    navigator.clipboard.writeText(latexOut.value);
  }
});

// Refresh button
document.getElementById('resume-refresh-btn')?.addEventListener('click', () => {
  loadResumeProfile();
});

