// ---------------------------------------------------------------------------
// Repo Service — lets Bob the Builder self-read any GitHub repository
// (public repos anonymously; private repos need GITHUB_TOKEN in .env).
// Uses only the GitHub REST API + raw.githubusercontent.com — no git binary.
// ---------------------------------------------------------------------------
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

const CACHE_TTL = 30 * 60 * 1000; // 30 min
const cache = new Map();

const MAX_FILES = 30;        // max files to actually read
const MAX_TOTAL_BYTES = 150 * 1024; // 150 KB of file content total
const MAX_FILE_BYTES = 120 * 1024;  // single file cap
const MAX_DISPLAY_FILE = 4500;      // chars shown per file in context

const SKIP_DIRS = ['node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out', 'vendor', 'coverage', '.cache', 'public/build', '__pycache__', '.venv', 'venv', 'target', '.github/workflows'];
const SKIP_FILES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'composer.lock', 'poetry.lock', 'Cargo.lock', 'Gemfile.lock', 'go.sum'];
const SKIP_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.avif', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp4', '.mp3', '.zip', '.gz', '.pdf', '.min.js', '.min.css', '.map'];
const TEXT_EXT = ['.md', '.js', '.jsx', '.ts', '.tsx', '.py', '.go', '.rb', '.java', '.kt', '.php', '.c', '.h', '.cpp', '.hpp', '.cs', '.swift', '.html', '.css', '.scss', '.less', '.vue', '.svelte', '.json', '.yml', '.yaml', '.toml', '.sh', '.sql', '.txt', '.env', '.cfg', '.conf', '.ini'];

function fetchGH(path, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'bob-the-builder',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (GITHUB_TOKEN) headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
  return fetch(`${API}${path}`, { headers, signal: ctrl.signal })
    .then(async (res) => {
      clearTimeout(t);
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body };
    })
    .catch((err) => {
      clearTimeout(t);
      return { status: 0, body: { message: err.name === 'AbortError' ? 'timeout' : err.message } };
    });
}

// ── URL detection ───────────────────────────────────────────
function extractRepoUrls(text) {
  const found = [];
  const seen = new Set();
  const push = (owner, repo, url) => {
    const key = `${owner}/${repo}`;
    if (!seen.has(key)) {
      seen.add(key);
      found.push({ owner, repo, url });
    }
  };
  const ghRe = /(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/g;
  let m;
  while ((m = ghRe.exec(text)) !== null) push(m[1], m[2], m[0]);
  if (!found.length) {
    const bare = text.trim();
    if (bare.length <= 80 && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(bare)) {
      const [o, r] = bare.split('/');
      push(o, r, bare);
    }
  }
  return found;
}

// ── Repo info ───────────────────────────────────────────────
async function getRepoInfo(owner, repo) {
  const { status, body } = await fetchGH(`/repos/${owner}/${repo}`);
  if (status === 0) return { error: 'network', message: body.message };
  if (status === 403) return { error: 'rate_limit', message: 'GitHub API rate limit hit (anonymous: 60/hr). Add GITHUB_TOKEN env to raise it.' };
  if (status === 404) return { error: 'not_found', message: `Repo "${owner}/${repo}" nahi mila — ho sakta hai private ho.` };
  if (status !== 200) return { error: 'api', message: body.message || `GitHub API error ${status}` };
  return {
    fullName: body.full_name,
    description: body.description || '',
    language: body.language || null,
    defaultBranch: body.default_branch || 'main',
    private: !!body.private,
    stars: body.stargazers_count || 0,
    forks: body.forks_count || 0,
    updatedAt: body.updated_at || null,
  };
}

// ── Recursive file tree ─────────────────────────────────────
async function getTree(owner, repo, branch) {
  const { status, body } = await fetchGH(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  if (status !== 200) {
    // Some repos have odd default branches / no tree — retry on 'main'
    if (branch !== 'main') return getTree(owner, repo, 'main');
    return { tree: [], truncated: false };
  }
  return { tree: body.tree || [], truncated: !!body.truncated };
}

function isTextFile(path) {
  const lower = path.toLowerCase();
  if (SKIP_FILES.includes(lower.split('/').pop())) return false;
  if (SKIP_EXT.some(ext => lower.endsWith(ext))) return false;
  if (SKIP_DIRS.some(dir => path.startsWith(dir + '/') || path.split('/').includes(dir))) return false;
  if (/\.min\.(js|css)$/.test(lower)) return false;
  return TEXT_EXT.some(ext => lower.endsWith(ext));
}

function prioritize(tree) {
  const blobs = (tree || []).filter(b => b.type === 'blob' && typeof b.size === 'number' && b.size > 0 && b.size <= MAX_FILE_BYTES && isTextFile(b.path));
  const score = (p, size) => {
    const name = p.split('/').pop().toLowerCase();
    let s = 0;
    if (name === 'readme.md') s += 1000;
    if (name === 'package.json') s += 600;
    if (name === 'tsconfig.json' || name === 'pyproject.toml' || name === 'go.mod' || name === 'requirements.txt') s += 400;
    if (name === '.env.example' || name === 'docker-compose.yml' || name === 'dockerfile') s += 350;
    if (name.startsWith('index.') || name.startsWith('main.') || name.startsWith('app.') || name === 'server.js' || name === 'app.js') s += 200;
    if (name.includes('readme') || name.includes('test') || name.includes('config')) s += 100;
    const depth = p.split('/').length;
    if (depth <= 2) s += 80;
    if (depth <= 3) s += 30;
    return s + (100 - Math.min(100, size / 2000));
  };
  return blobs
    .map(b => ({ ...b, score: score(b.path, b.size) }))
    .sort((a, b) => b.score - a.score);
}

// ── Read file contents (raw first, contents API fallback) ──
async function fetchFile(owner, repo, branch, path) {
  const encPath = path.split('/').map(encodeURIComponent).join('/');
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(`${RAW}/${owner}/${repo}/${encodeURIComponent(branch)}/${encPath}`, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) {
      const text = await res.text();
      if (text.length > 0 && !text.startsWith('<!DOCTYPE') && !text.startsWith('<html')) return text;
    }
  } catch (e) { /* fall through to contents API */ }
  // Fallback: contents API (base64)
  const { status, body } = await fetchGH(`/repos/${owner}/${repo}/contents/${encPath}?ref=${encodeURIComponent(branch)}`, 10000);
  if (status === 200 && body && body.content) {
    try { return Buffer.from(body.content, 'base64').toString('utf8'); } catch (e) { return null; }
  }
  return null;
}

// ── Top-level stats ─────────────────────────────────────────
function treeStats(tree) {
  const dirs = new Set();
  const extCount = {};
  let files = 0;
  (tree || []).forEach(b => {
    if (b.type !== 'blob') return;
    files++;
    const parts = b.path.split('/');
    if (parts.length > 1) dirs.add(parts[0]);
    const dot = parts[parts.length - 1].lastIndexOf('.');
    if (dot > 0) {
      const ext = parts[parts.length - 1].slice(dot).toLowerCase();
      extCount[ext] = (extCount[ext] || 0) + 1;
    }
  });
  const topExt = Object.entries(extCount).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([e, n]) => `${e}×${n}`).join(', ');
  return { fileCount: files, topDirs: [...dirs].slice(0, 10).join(', '), topExt };
}

// ── Build readable context block ────────────────────────────
function buildRepoContext(a) {
  const lines = [];
  lines.push('━━━ 📦 GITHUB REPO ANALYSIS (Bob the Builder self-read this repository) ━━━');
  lines.push(`Repo: ${a.repo.fullName}`);
  if (a.repo.description) lines.push(`About: ${a.repo.description.slice(0, 300)}`);
  lines.push(`Language: ${a.repo.language || 'n/a'} · Default branch: ${a.repo.defaultBranch} · ⭐ ${a.repo.stars} · Forks: ${a.repo.forks}`);
  lines.push(`Size: ${a.stats.fileCount} files · top dirs: ${a.stats.topDirs || 'n/a'} · top extensions: ${a.stats.topExt || 'n/a'}`);
  lines.push(`Read ${a.readCount} key files (of ${a.stats.fileCount})`);
  if (a.truncated) lines.push('⚠️ Repo tree was truncated (huge repo) — analysis covers the most relevant files.');
  lines.push('');
  lines.push('### 🔑 KEY FILES (actual code read below — use these EXACT details):');
  a.files.forEach(f => {
    lines.push('');
    lines.push(`--- ${f.path} ---`);
    lines.push(f.content.slice(0, MAX_DISPLAY_FILE));
  });
  return lines.join('\n');
}

// ── Main entry: analyze a GitHub repo (cached) ──────────────
async function analyzeRepo(urlOrText) {
  const parts = extractRepoUrls(urlOrText)[0];
  if (!parts) return { status: 'no_repo', message: 'Koi valid GitHub repo link nahi mila.' };
  const key = `${parts.owner}/${parts.repo}`;

  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const info = await getRepoInfo(parts.owner, parts.repo);

  let result;
  if (info.error) {
    result = { status: 'error', repo: { fullName: key }, error: info.error, message: info.message };
  } else if (info.private && !GITHUB_TOKEN) {
    result = {
      status: 'private',
      repo: { fullName: info.fullName, private: true },
      message: `Repo "${info.fullName}" PRIVATE hai. GitHub pe public karke dobara link bhejo (ya GITHUB_TOKEN env lagao).`,
    };
  } else {
    try {
      const { tree, truncated } = await getTree(parts.owner, parts.repo, info.defaultBranch);
      const prioritized = prioritize(tree);
      const selected = prioritized.slice(0, MAX_FILES);
      let totalBytes = 0;
      const readList = [];
      for (const f of selected) {
        if (totalBytes >= MAX_TOTAL_BYTES) break;
        const content = await fetchFile(parts.owner, parts.repo, info.defaultBranch, f.path);
        if (content) {
          readList.push({ path: f.path, content });
          totalBytes += content.length;
        }
      }
      const stats = treeStats(tree);
      const files = readList.sort((a, b) => {
        const nameRank = (p) => (/readme\.md$/i.test(p) ? 0 : 1);
        return nameRank(a.path) - nameRank(b.path);
      });
      result = {
        status: 'ok',
        repo: info,
        filesRead: files,
        readCount: files.length,
        stats,
        truncated,
        context: buildRepoContext({ repo: info, files, stats, readCount: files.length, truncated }),
      };
    } catch (err) {
      result = { status: 'error', repo: { fullName: key }, error: 'read', message: err.message };
    }
  }

  cache.set(key, { ts: Date.now(), data: result });
  return result;
}

module.exports = { extractRepoUrls, analyzeRepo, getRepoInfo };
