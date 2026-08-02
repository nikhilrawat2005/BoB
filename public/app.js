/* ═══════════════════════════════════════════════════════
   BOB — Frontend App
   Firebase Auth (client) + Backend API calls
═══════════════════════════════════════════════════════

   ⚠️  SETUP REQUIRED:
   Replace the firebaseConfig below with your actual
   Firebase Web App config from:
   Firebase Console → Project Settings → General → Your apps → Web app
   If you haven't registered a web app yet, click the </> icon to add one.
═══════════════════════════════════════════════════════ */

const firebaseConfig = {
  apiKey:            "AIzaSyCjbVNMc1GTnBVpvLONAoFn-mIdDIiLcaw",
  authDomain:        "bob-3ff28.firebaseapp.com",
  projectId:         "bob-3ff28",
  storageBucket:     "bob-3ff28.firebasestorage.app",
  messagingSenderId: "180416673423",
  appId:             "1:180416673423:web:258a36eeee081c7081a2fa"
};

// ── Init Firebase ────────────────────────────────────
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

// ── API base (same origin since Express serves both) ─
const API = '';   // e.g. '' means http://localhost:3000

// ── State ────────────────────────────────────────────
let currentUser    = null;
let idToken        = null;
let currentSession = null;
let pendingFile    = null;

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

// Auth state listener
auth.onAuthStateChanged(async (user) => {
  if (user) {
    const email = (user.email || '').toLowerCase();
    
    // Check if email is in allowed list
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
    await loadSessions();
    await loadNotifications();
    fetchProactiveGreeting();
  } else {
    currentUser = null; idToken = null; currentSession = null;
    showScreen('login');
  }
});

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
    const { sessions } = await apiFetch('/api/sessions');
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
      await apiFetch(`/api/notifications/${notifId}/read`, { method: 'POST' });
      await createNewSession();
      const msgInput = document.getElementById('message-input');
      msgInput.value = snippet;
      msgInput.dispatchEvent(new Event('input'));
      await sendMessage();
      await loadNotifications();
    });
  });
}

function renderSessions(sessions) {
  const list = document.getElementById('sessions-list');
  if (!sessions.length) {
    list.innerHTML = '<div class="empty-sessions">No chats yet</div>';
    return;
  }
  list.innerHTML = sessions.map(s => `
    <div class="session-item ${currentSession?.id === s.id ? 'active' : ''}"
         data-id="${s.id}" data-title="${escHtml(s.title || 'Chat')}">
      ${escHtml(s.title || 'Chat')}
    </div>
  `).join('');

  list.querySelectorAll('.session-item').forEach(el => {
    el.addEventListener('click', () => selectSession({ id: el.dataset.id, title: el.dataset.title }));
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
    const { messages } = await apiFetch(`/api/sessions/${sessionId}/messages`);
    (messages || []).forEach(m => appendMessage(m.role, m.content, false));
    scrollToBottom();
  } catch (err) {
    console.error('loadMessages error:', err);
  }
}

function appendMessage(role, content, animate = true) {
  const container = document.getElementById('messages-container');

  // Remove welcome screen if present
  const welcome = document.getElementById('welcome-screen');
  if (welcome) welcome.remove();

  const row = document.createElement('div');
  row.className = `message-row ${role}`;
  if (!animate) row.style.animation = 'none';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = content;

  row.appendChild(bubble);
  container.appendChild(row);
  scrollToBottom();
  return row;
}

function showTypingIndicator() {
  const container = document.getElementById('messages-container');
  const row = document.createElement('div');
  row.className = 'message-row assistant';
  row.id = 'typing-row';
  row.innerHTML = `<div class="message-bubble"><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
  container.appendChild(row);
  scrollToBottom();
}

function removeTypingIndicator() {
  document.getElementById('typing-row')?.remove();
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
  // Enable send button
  sendBtn.disabled = !messageInput.value.trim();
});

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);

async function sendMessage() {
  if (!currentSession) {
    await createNewSession();
    if (!currentSession) return;
  }

  const text  = messageInput.value.trim();
  const model = document.getElementById('model-selector').value || undefined;

  if (!text && !pendingFile) return;

  // Upload file first if pending
  if (pendingFile) {
    await uploadPendingFile();
  }

  if (!text) return;

  // Clear input
  messageInput.value = '';
  messageInput.style.height = 'auto';
  sendBtn.disabled = true;

  // Show user message
  appendMessage('user', text);

  // Show typing
  showTypingIndicator();

  try {
    const data = await apiFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentSession.id, message: text, model }),
    });

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

  const preview = document.getElementById('file-preview');
  preview.classList.remove('hidden');
  preview.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>
    <span>${escHtml(file.name)} (${formatBytes(file.size)})</span>
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
  if (!currentSession || !pendingFile) return;
  const formData = new FormData();
  formData.append('file', pendingFile);
  clearPendingFile();

  try {
    await fetch(API + '/api/files/upload', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${idToken}` },
      body: formData,
    });
    appendMessage('assistant', `📎 File uploaded successfully.`, true);
  } catch (err) {
    appendMessage('assistant', `⚠️ File upload failed: ${err.message}`, true);
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
});

document.getElementById('toggle-files-btn').addEventListener('click', async () => {
  openPanel(filesPanel);
  await loadFiles();
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
    await loadVaultNotes();
  } catch (err) {
    // Wrong PIN
    shakeErrorDots();
    vaultErrEl.textContent = 'Incorrect PIN. Try again.';
    vaultErrEl.classList.remove('hidden');
    vaultPin = '';
    setTimeout(() => {
      resetPinDots();
    }, 650);
  }
}

// ── Load vault notes ─────────────────────────────────
async function loadVaultNotes() {
  const list = document.getElementById('vault-notes-list');
  try {
    const { notes } = await apiFetch('/api/secret/notes');
    if (!notes.length) {
      list.innerHTML = '<div class="empty-msg">No private notes yet. Add your first secret entry below.</div>';
      vaultBtn.classList.remove('has-notes');
      return;
    }
    vaultBtn.classList.add('has-notes');
    list.innerHTML = notes.map(n => `
      <div class="vault-note-item" data-id="${n.id}">
        <div class="vault-note-content">
          <div>${escHtml(n.noteText)}</div>
          ${n.eventDate ? `<div class="vault-note-date">📅 ${formatEventDate(n.eventDate)}</div>` : ''}
        </div>
        <button class="vault-note-delete" data-id="${n.id}" title="Delete">✕</button>
      </div>
    `).join('');
    list.querySelectorAll('.vault-note-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteVaultNote(btn.dataset.id));
    });
  } catch (err) {
    list.innerHTML = `<div class="empty-msg">Error: ${err.message}</div>`;
  }
}

// ── Add vault note ────────────────────────────────────
document.getElementById('add-vault-note-btn').addEventListener('click', async () => {
  const noteInput = document.getElementById('vault-note-input');
  const dateInput = document.getElementById('vault-date-input');
  const noteText  = noteInput.value.trim();
  const eventDate = dateInput.value || null;

  if (!noteText) return;
  try {
    await apiFetch('/api/secret/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteText, eventDate }),
    });
    noteInput.value = '';
    dateInput.value = '';
    await loadVaultNotes();
  } catch (err) {
    alert('Failed to add note: ' + err.message);
  }
});

document.getElementById('vault-note-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('add-vault-note-btn').click();
});

// ── Delete vault note ─────────────────────────────────
async function deleteVaultNote(id) {
  try {
    await apiFetch(`/api/secret/notes/${id}`, { method: 'DELETE' });
    await loadVaultNotes();
  } catch (err) {
    alert('Failed to delete note: ' + err.message);
  }
}

// ── Format event date nicely ──────────────────────────
function formatEventDate(dateStr) {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    const now = new Date();
    const diffDays = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
    const formatted = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    if (diffDays === 0) return `${formatted} — Today!`;
    if (diffDays === 1) return `${formatted} — Tomorrow`;
    if (diffDays > 0 && diffDays <= 7) return `${formatted} — in ${diffDays} days`;
    if (diffDays < 0) return `${formatted} — ${Math.abs(diffDays)}d ago`;
    return formatted;
  } catch {
    return dateStr;
  }
}

// ── Check vault on login (for sidebar dot) ───────────
async function checkVaultStatus() {
  try {
    // We only check if notes exist via a quick verify with stored PIN
    // Just ping notes endpoint — if user already verified, great; else skip
    // Since we can't auto-auth without PIN, we'll just check via a separate status endpoint.
    // For now silently skip; the dot shows after first open.
  } catch { /* silent */ }
}

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

