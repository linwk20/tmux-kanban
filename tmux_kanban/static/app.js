let sessionsData = [];
let configData = { projects: [], sessionStatus: {} };
let selectedProject = null; // null = "All"
let authToken = localStorage.getItem('tmux-kanban:auth-token') || '';
// Resolved $HOME of the host running tmux-kanban. Persists across
// fetchAll() rounds because configData is reassigned every poll, but
// we want the home fallback to fire at most once per page load.
let _resolvedHome = '';

// ── Auth helpers ──

function authHeaders() {
    return authToken ? { 'X-Auth-Token': authToken, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

function authFetch(url, opts = {}) {
    opts.headers = { ...authHeaders(), ...(opts.headers || {}) };
    return fetch(url, opts).then(res => {
        if (res.status === 401) {
            // Don't auto-show login — let checkAuth handle it on next refresh
            authToken = '';
            localStorage.removeItem('tmux-kanban:auth-token');
            throw new Error('Unauthorized');
        }
        return res;
    });
}

async function apiCheck(res) {
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `Request failed (${res.status})`);
    }
    return res;
}

async function checkAuth() {
    const res = await fetch('/api/auth/status');
    const data = await res.json();
    if (!data.hasPassword) {
        showSetupPage();
        return false;
    }
    if (!authToken) {
        showLoginPage();
        return false;
    }
    // Verify token is still valid (use plain fetch to avoid authFetch throwing)
    const test = await fetch('/api/config', { headers: { 'X-Auth-Token': authToken, 'Content-Type': 'application/json' } });
    if (test.status === 401) {
        showLoginPage();
        return false;
    }
    return true;
}

async function _sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function showSetupPage() {
    _modalLocked = true;
    const modal = document.getElementById('modal');
    modal.innerHTML = `
        <h2 style="font-size:28px;margin-bottom:12px">Welcome to Tmux Kanban</h2>
        <p style="color:var(--text-low);margin-bottom:16px;line-height:1.6;font-size:16px">
            No password set. Follow these 3 steps to secure your dashboard:
        </p>

        <div style="background:var(--accent-dim);padding:18px;border-radius:8px;margin-bottom:12px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
                <p style="font-size:16px;color:var(--text-normal);font-weight:600;margin:0">
                    Step 1: Generate & save your password
                </p>
                <button class="btn-primary" style="font-size:14px;padding:6px 14px" onclick="generateSetupPassword()">Generate Password</button>
            </div>
            <code id="setup-pw-display" style="font-family:monospace;color:var(--accent);font-size:16px;user-select:all;display:block;padding:10px;background:var(--bg-panel);border-radius:6px;word-break:break-all;min-height:22px;color:var(--text-muted)">Click "Generate Password" to create one (min 10 characters)</code>
        </div>

        <div style="background:var(--accent-dim);padding:18px;border-radius:8px;margin-bottom:12px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
                <p style="font-size:16px;color:var(--text-normal);font-weight:600;margin:0">
                    Step 2: Run this on the server terminal
                </p>
                <button class="btn-primary" style="font-size:14px;padding:6px 14px" id="setup-cmd-copy" onclick="navigator.clipboard.writeText(document.getElementById('setup-cmd-display').textContent).catch(()=>{}); this.textContent='Copied!'; setTimeout(()=>this.textContent='Copy',1500)" disabled>Copy</button>
            </div>
            <code id="setup-cmd-display" style="font-family:monospace;font-size:14px;color:var(--text-muted);user-select:all;display:block;padding:10px;background:var(--bg-panel);border-radius:6px;word-break:break-all;line-height:1.5">Generate a password first</code>
        </div>

        <div style="background:var(--accent-dim);padding:18px;border-radius:8px;margin-bottom:16px">
            <div style="display:flex;align-items:center;justify-content:space-between">
                <p style="font-size:16px;color:var(--text-normal);font-weight:600;margin:0">
                    Step 3: Refresh this page
                </p>
                <button class="btn-primary" style="font-size:14px;padding:6px 14px" onclick="location.reload()">Refresh</button>
            </div>
        </div>

        <p style="font-size:11px;color:var(--text-muted);margin-top:8px">
            Password is also recoverable from <code>~/.tmux-kanban/config.json</code>
        </p>
    `;
    document.getElementById('modal-overlay').classList.add('active');
    document.body.classList.add('ready');
}

async function generateSetupPassword() {
    const pw = crypto.randomUUID().replace(/-/g, '');
    const hash = await _sha256(pw);
    // Build the bash command using a heredoc-style python script
    const cmd = `python3 -c "\nimport json, os\np = os.path.expanduser('~/.tmux-kanban/config.json')\ntry: c = json.load(open(p))\nexcept: c = {}\nc['password_hash'] = '${hash}'\nc['password_plain'] = '${pw}'\njson.dump(c, open(p, 'w'), indent=2)\nos.chmod(p, 0o600)\nprint('Password set! Refresh your browser.')\n"`;
    // Show password and copy to clipboard
    const pwEl = document.getElementById('setup-pw-display');
    pwEl.style.color = 'var(--accent)';
    pwEl.textContent = pw;
    navigator.clipboard.writeText(pw).catch(() => {});
    // Show command
    const cmdEl = document.getElementById('setup-cmd-display');
    cmdEl.style.color = 'var(--text-normal)';
    cmdEl.textContent = cmd;
    // Enable copy button
    document.getElementById('setup-cmd-copy').disabled = false;
}

// submitSetup removed — first-time setup done via terminal command

function showLoginPage() {
    _modalLocked = true;
    const modal = document.getElementById('modal');
    modal.innerHTML = `
        <h2 style="font-size:28px;margin-bottom:16px">Tmux Kanban Login</h2>
        <div class="modal-field">
            <label style="font-size:16px">Password</label>
            <input type="password" id="login-password" placeholder="Enter your password" style="font-size:16px;padding:12px"
                   onkeydown="if(event.key==='Enter')submitLogin()">
        </div>
        <div class="modal-actions">
            <button class="btn-primary" style="font-size:16px;padding:10px 24px" onclick="submitLogin()">Login</button>
        </div>
        <div style="background:var(--accent-dim);padding:16px;border-radius:8px;margin-top:16px">
            <p style="font-size:15px;color:var(--text-normal);margin-bottom:10px;font-weight:600">
                Forgot your password?
            </p>
            <p style="font-size:14px;color:var(--text-low);margin-bottom:10px">
                Run this on the server where tmux-kanban is running:
            </p>
            <code style="font-family:monospace;font-size:14px;color:var(--accent);user-select:all;display:block;padding:10px;background:var(--bg-panel);border-radius:6px;word-break:break-all">cat ~/.tmux-kanban/config.json | grep password_plain</code>
            <p style="font-size:13px;color:var(--text-muted);margin-top:8px">
                Look for the <code>password_plain</code> field in the output.
            </p>
        </div>
        </p>
    `;
    document.getElementById('modal-overlay').classList.add('active');
    document.body.classList.add('ready');
    setTimeout(() => document.getElementById('login-password')?.focus(), 50);
}

async function submitLogin() {
    const pw = document.getElementById('login-password').value;
    if (!pw) return;
    if (pw.length < 10) { alert('Password must be at least 10 characters'); return; }
    const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
    });
    const data = await res.json();
    if (data.token) {
        authToken = data.token;
        localStorage.setItem('tmux-kanban:auth-token', authToken);
        startApp();
    } else if (data.detail && data.detail.includes('No password set')) {
        // Password not set yet — go back to setup
        location.reload();
    } else {
        alert(data.detail || 'Login failed');
    }
}
let currentTerminal = null;
let currentWs = null;
let openDropdown = null;

const STATUSES = ['todo', 'running', 'review', 'finish'];
const STATUS_LABELS = { todo: 'Todo', running: 'Running', review: 'Review', finish: 'Finish' };
const COLORS = ['sc0','sc1','sc2','sc3','sc4','sc5','sc6','sc7'];

function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }
function escAttr(s) { return String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;'); }
function shortenHome(path) {
    if (!path) return '';
    const home = configData.home || _resolvedHome;
    if (home && path.startsWith(home + '/')) return '~' + path.slice(home.length);
    if (home && path === home) return '~';
    return path.replace(/^\/home\/[^/]+/, '~'); // fallback
}

// Per-session draft state: { sessionName: { text: '', history: [], historyIndex: -1 } }
let draftStates = {};
const DRAFT_HISTORY_MAX = 30;

function getDraftState(sessName) {
    if (!sessName) sessName = '__global';
    if (!draftStates[sessName]) {
        const saved = JSON.parse(localStorage.getItem('tmux-kanban:draft-history:' + sessName) || '[]');
        draftStates[sessName] = { text: '', history: saved, historyIndex: -1 };
    }
    return draftStates[sessName];
}

function saveDraftHistory(sessName) {
    if (!sessName) sessName = '__global';
    const state = getDraftState(sessName);
    localStorage.setItem('tmux-kanban:draft-history:' + sessName, JSON.stringify(state.history));
}

function saveDraftText(sessName, text) {
    const state = getDraftState(sessName);
    state.text = text;
}

// ── Data ──

async function fetchAll() {
    try {
        const [sessRes, confRes] = await Promise.all([
            authFetch('/api/sessions'),
            authFetch('/api/config'),
        ]);
        sessionsData = (await sessRes.json()).sessions || [];
        configData = await confRes.json();
        if (!configData.projects) configData.projects = [];
        if (!configData.sessionStatus) configData.sessionStatus = {};
        // Resolve home dynamically: newer servers expose it via /api/config,
        // older servers don't — fall back to /api/browse without any args.
        // Older servers default `path` to "~", which they expand to $HOME;
        // newer servers default it to "" and resolve the same way. Both
        // forms return the resolved home as `path` in the response. We
        // explicitly avoid passing path="" because older safe_path() would
        // realpath("") -> process cwd, which is unrelated to $HOME. The
        // _resolvedHome cache makes the fallback fire at most once per
        // page load even if /api/config keeps not exposing `home`.
        if (configData.home) {
            _resolvedHome = configData.home;
        } else if (!_resolvedHome) {
            try {
                const br = await authFetch('/api/browse');
                if (!br.ok) {
                    console.warn('home fallback: /api/browse returned status', br.status);
                } else {
                    const data = await br.json();
                    if (data && data.path) {
                        _resolvedHome = data.path;
                    } else {
                        console.warn('home fallback: /api/browse returned no path', data);
                    }
                }
            } catch (e) {
                console.warn('home fallback: /api/browse failed', e);
            }
        }
        if (_resolvedHome && !configData.home) configData.home = _resolvedHome;
        render();
    } catch (e) {
        if (e.message === 'Unauthorized') return;
        console.error('fetchAll failed:', e);
        document.body.classList.add('ready'); // ensure page is visible even on error
    }
}

function getSessionStatus(name) {
    return configData.sessionStatus[name] || 'todo';
}

function getProjectForSession(sessName) {
    return configData.projects.find(p => p.sessions && p.sessions.includes(sessName));
}

function getVisibleSessions() {
    if (!selectedProject) return sessionsData;
    if (selectedProject === '__unassigned') {
        const assigned = new Set();
        configData.projects.forEach(p => (p.sessions || []).forEach(s => assigned.add(s)));
        return sessionsData.filter(s => !assigned.has(s.name));
    }
    const proj = configData.projects.find(p => p.name === selectedProject);
    if (!proj) return sessionsData;
    return sessionsData.filter(s => proj.sessions.includes(s.name));
}

function getProjectColor(projName) {
    const idx = configData.projects.findIndex(p => p.name === projName);
    return idx >= 0 ? COLORS[(configData.projects[idx].color ?? idx) % COLORS.length] : 'sc0';
}

// ── Render ──

function render() {
    renderSidebar();
    renderKanban();
    updateStats();
}

function updateStats() {
    const vis = getVisibleSessions();
    document.getElementById('stat-sessions').textContent = vis.length;
    const totalPanes = vis.reduce((n, s) =>
        n + s.windows.reduce((m, w) => m + w.panes.length, 0), 0);
    document.getElementById('stat-panes').textContent = totalPanes;
}

// ── Sidebar ──

function renderSidebar() {
    const body = document.getElementById('sidebar-body');

    const allCount = sessionsData.length;
    const projItems = configData.projects.map(p => {
        const count = sessionsData.filter(s => p.sessions && p.sessions.includes(s.name)).length;
        const color = COLORS[p.color != null ? p.color % COLORS.length : configData.projects.indexOf(p) % COLORS.length];
        const active = selectedProject === p.name ? 'active' : '';
        return `
        <div class="sidebar-item ${active}" data-project="${escAttr(p.name)}" onclick="selectProject('${escAttr(p.name)}')">
            <span class="item-dot ${color}"></span>
            <span class="item-name">${esc(p.name)}</span>
            <button class="item-edit" onclick="event.stopPropagation(); showEditProject('${escAttr(p.name)}')" title="Edit">&#9998;</button>
            <span class="item-count">${count}</span>
        </div>`;
    }).join('');

    // Unassigned count
    const assignedSessions = new Set(configData.projects.flatMap(p => p.sessions || []));
    const unassigned = sessionsData.filter(s => !assignedSessions.has(s.name));

    body.innerHTML = `
        <div class="sidebar-item ${!selectedProject ? 'active' : ''}" onclick="selectProject(null)">
            <span class="item-dot sc0"></span>
            <span class="item-name">All Sessions</span>
            <span class="item-count">${allCount}</span>
        </div>
        <div class="sidebar-divider"></div>
        ${projItems}
        <div class="sidebar-divider"></div>
        <div class="sidebar-item ${selectedProject === '__unassigned' ? 'active' : ''}" data-project="__unassigned" onclick="selectProject('__unassigned')" style="opacity:0.6">
            <span class="item-dot" style="background:var(--text-muted)"></span>
            <span class="item-name">Unassigned</span>
            <span class="item-count">${unassigned.length}</span>
        </div>
    `;
}

function selectProject(name) {
    selectedProject = name;
    localStorage.setItem('tmux-selected-project', name || '');
    document.querySelector('.sidebar')?.classList.remove('mobile-open'); // close mobile sidebar
    render();
}

// ── Sidebar project drag to reorder ──
let _projDrag = null;
let _projDragPending = null;
const PROJ_DRAG_THRESHOLD = 5;

document.addEventListener('pointerdown', (e) => {
    const item = e.target.closest('.sidebar-item[data-project]');
    if (!item || e.target.closest('button')) return;
    const projName = item.dataset.project;
    if (!projName || projName === '__unassigned') return;
    _projDragPending = { item, projName, startY: e.clientY };
});

document.addEventListener('pointermove', (e) => {
    if (_projDragPending && !_projDrag) {
        if (Math.abs(e.clientY - _projDragPending.startY) < PROJ_DRAG_THRESHOLD) return;
        const { item, projName } = _projDragPending;
        const rect = item.getBoundingClientRect();
        const ghost = item.cloneNode(true);
        ghost.className = 'sidebar-item drag-ghost';
        ghost.style.cssText = `position:fixed;z-index:9999;width:${rect.width}px;pointer-events:none;opacity:0.9;box-shadow:0 4px 16px rgba(0,0,0,0.2);`;
        ghost.style.left = rect.left + 'px';
        ghost.style.top = rect.top + 'px';
        document.body.appendChild(ghost);
        item.classList.add('dragging');
        _projDrag = { item, ghost, projName, offsetY: e.clientY - rect.top };
        _projDragPending = null;
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
    }
    if (!_projDrag) return;
    _projDrag.ghost.style.top = (e.clientY - _projDrag.offsetY) + 'px';
    // Show drop indicator
    document.querySelectorAll('.sidebar-item.proj-drop-above, .sidebar-item.proj-drop-below').forEach(el => {
        el.classList.remove('proj-drop-above', 'proj-drop-below');
    });
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target) return;
    const targetItem = target.closest('.sidebar-item[data-project]');
    if (targetItem && targetItem.dataset.project !== _projDrag.projName && targetItem.dataset.project !== '__unassigned') {
        const rect = targetItem.getBoundingClientRect();
        const isLowerHalf = e.clientY > rect.top + rect.height / 2;
        targetItem.classList.add(isLowerHalf ? 'proj-drop-below' : 'proj-drop-above');
    }
});

document.addEventListener('pointerup', async (e) => {
    if (_projDragPending) { _projDragPending = null; return; }
    if (!_projDrag) return;
    const { item, ghost, projName } = _projDrag;
    _projDrag = null;
    ghost.remove();
    item.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.querySelectorAll('.sidebar-item.proj-drop-above, .sidebar-item.proj-drop-below').forEach(el => {
        el.classList.remove('proj-drop-above', 'proj-drop-below');
    });

    // Find drop target
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target) return;
    const targetItem = target.closest('.sidebar-item[data-project]');
    if (!targetItem || targetItem.dataset.project === projName || targetItem.dataset.project === '__unassigned') return;
    const targetName = targetItem.dataset.project;
    const rect = targetItem.getBoundingClientRect();
    const insertBelow = e.clientY > rect.top + rect.height / 2;

    // Reorder configData.projects
    const projects = configData.projects;
    const fromIdx = projects.findIndex(p => p.name === projName);
    const [moved] = projects.splice(fromIdx, 1);
    let toIdx = projects.findIndex(p => p.name === targetName);
    if (insertBelow) toIdx += 1;
    projects.splice(toIdx, 0, moved);

    // Re-render immediately
    renderSidebar();

    // Save to backend
    try {
        await authFetch('/api/projects/reorder', {
            method: 'PUT',
            body: JSON.stringify({ order: projects.map(p => p.name) }),
        });
    } catch { /* ignore */ }
});

// ── Kanban ──

function renderKanban() {
    // Skip re-render during active drag to avoid replacing the dragging card
    if (_drag) return;
    const kanban = document.getElementById('kanban');
    let visible;
    if (selectedProject === '__unassigned') {
        const assigned = new Set(configData.projects.flatMap(p => p.sessions || []));
        visible = sessionsData.filter(s => !assigned.has(s.name));
    } else {
        visible = getVisibleSessions();
    }

    // First render: full innerHTML
    if (!kanban.children.length) {
        kanban.innerHTML = STATUSES.map(status => {
            const sessions = sortSessionsBySortIndex(visible.filter(s => getSessionStatus(s.name) === status));
            const cards = sessions.map(s => renderSessionCard(s)).join('');
            return `
            <div class="kanban-col col-${status}" data-status="${status}">
                <div class="kanban-col-header">
                    <span class="col-indicator"></span>
                    <span class="col-title">${STATUS_LABELS[status]}</span>
                    <span class="col-count">${sessions.length}</span>
                </div>
                <div class="kanban-col-body">
                    ${cards || '<div class="kanban-empty">No sessions</div>'}
                </div>
            </div>`;
        }).join('');
        return;
    }

    // FLIP animation: record positions before DOM changes
    const allCards = kanban.querySelectorAll('.session-card[data-session]');
    const firstRects = new Map();
    allCards.forEach(c => firstRects.set(c.dataset.session, c.getBoundingClientRect()));

    // Subsequent renders: update in-place to preserve hover/scroll/focus
    const newCardEls = []; // track newly inserted cards for fade-in
    for (const status of STATUSES) {
        const sessions = sortSessionsBySortIndex(visible.filter(s => getSessionStatus(s.name) === status));
        const col = kanban.querySelector(`[data-status="${status}"]`);
        if (!col) continue;
        const countEl = col.querySelector('.col-count');
        if (countEl) countEl.textContent = sessions.length;
        const body = col.querySelector('.kanban-col-body');
        if (!body) continue;
        const existingCards = body.querySelectorAll('.session-card');
        const existingMap = new Map();
        existingCards.forEach(c => existingMap.set(c.dataset.session, c));
        const newNamesSet = new Set(sessions.map(s => s.name));

        // Remove cards no longer in this column
        existingCards.forEach(c => {
            if (!newNamesSet.has(c.dataset.session)) c.remove();
        });
        const emptyEl = body.querySelector('.kanban-empty');
        if (emptyEl && sessions.length) emptyEl.remove();

        // Update or insert cards in order
        let prevEl = null;
        for (const sess of sessions) {
            const newHtml = renderSessionCard(sess).trim();
            const existing = existingMap.get(sess.name);
            if (existing) {
                if (existing.outerHTML !== newHtml) {
                    const tmp = document.createElement('div');
                    tmp.innerHTML = newHtml;
                    const newEl = tmp.firstElementChild;
                    body.replaceChild(newEl, existing);
                    // Transfer FLIP rect to new element
                    if (firstRects.has(sess.name)) firstRects.set(sess.name, firstRects.get(sess.name));
                    prevEl = newEl;
                } else {
                    prevEl = existing;
                }
            } else {
                const tmp = document.createElement('div');
                tmp.innerHTML = newHtml;
                const newEl = tmp.firstElementChild;
                if (prevEl && prevEl.nextSibling) {
                    body.insertBefore(newEl, prevEl.nextSibling);
                } else if (!prevEl) {
                    body.insertBefore(newEl, body.firstChild);
                } else {
                    body.appendChild(newEl);
                }
                newCardEls.push(newEl);
                prevEl = newEl;
            }
        }
        if (!sessions.length && !body.querySelector('.kanban-empty')) {
            body.innerHTML = '<div class="kanban-empty">No sessions</div>';
        }
    }

    // FLIP: animate moved cards
    const updatedCards = kanban.querySelectorAll('.session-card[data-session]');
    updatedCards.forEach(card => {
        const name = card.dataset.session;
        const first = firstRects.get(name);
        if (!first) return; // new card, skip FLIP
        const last = card.getBoundingClientRect();
        const dx = first.left - last.left;
        const dy = first.top - last.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return; // didn't move
        card.style.transition = 'none';
        card.style.transform = `translate(${dx}px, ${dy}px)`;
        requestAnimationFrame(() => {
            card.style.transition = 'transform 0.25s ease';
            card.style.transform = '';
            card.addEventListener('transitionend', () => {
                card.style.transition = '';
            }, { once: true });
        });
    });

    // Fade in new cards
    newCardEls.forEach(card => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(8px)';
        requestAnimationFrame(() => {
            card.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
            card.style.opacity = '';
            card.style.transform = '';
            card.addEventListener('transitionend', () => {
                card.style.transition = '';
            }, { once: true });
        });
    });
}

function renderSessionCard(sess) {
    const alive = sess.alive !== false;
    const paneCount = alive ? sess.windows.reduce((n, w) => n + w.panes.length, 0) : 0;
    const isWorking = sess.active === true;
    const statusText = sess.activityLabel || (!alive ? 'stopped' : (isWorking ? 'working' : 'idle'));
    const cwd = shortenHome(sess.windows[0]?.panes[0]?.cwd || '');
    const deadClass = alive ? '' : ' session-card-dead';
    const dotClass = !alive ? 'dot-stopped' : (isWorking ? 'dot-working' : 'dot-idle');
    const dotTitle = !alive ? 'Stopped' : (isWorking ? 'Working' : 'Idle');
    const desc = configData.sessionInfo?.[sess.name]?.description || '';

    return `
    <div class="session-card${deadClass}" data-session="${escAttr(sess.name)}" onclick="openTerminal('${escAttr(sess.name)}', '${escAttr(sess.name)}')">
        <div class="session-card-header">
            <span class="session-dot ${dotClass}" title="${dotTitle}"></span>
            <span class="card-name">${esc(sess.name)}</span>
            <button class="status-menu-btn" onclick="event.stopPropagation(); showSessionSettings('${escAttr(sess.name)}')">&#9881;</button>
        </div>
        ${desc ? `<div class="card-desc">${esc(desc)}</div>` : ''}
        <div class="session-card-body">
            <span class="card-info">${alive ? paneCount + ' panes &middot; ' : ''}${esc(statusText)}</span>
            <span class="card-cwd">${esc(cwd)}</span>
        </div>
    </div>`;
}

// ── Custom Drag & Drop (mouse-based, no browser ghost) ──

let _drag = null; // { card, ghost, sessName, offsetX, offsetY, started }
let _dragPending = null; // { card, sessName, startX, startY, offsetX, offsetY }
const DRAG_THRESHOLD = 5; // px before drag activates

document.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.session-card');
    if (!card || e.target.closest('button') || e.target.closest('select') || e.target.closest('input')) return;
    const rect = card.getBoundingClientRect();
    _dragPending = {
        card, sessName: card.dataset.session,
        startX: e.clientX, startY: e.clientY,
        offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top,
    };
});

document.addEventListener('pointermove', (e) => {
    // Activate drag after threshold
    if (_dragPending && !_drag) {
        const dx = e.clientX - _dragPending.startX;
        const dy = e.clientY - _dragPending.startY;
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        // Start drag
        const { card, sessName, offsetX, offsetY } = _dragPending;
        const rect = card.getBoundingClientRect();
        const ghost = card.cloneNode(true);
        ghost.className = 'session-card drag-ghost';
        ghost.style.cssText = `position:fixed;z-index:9999;width:${rect.width}px;pointer-events:none;transform:rotate(1deg);box-shadow:0 8px 32px rgba(0,0,0,0.18);`;
        ghost.style.left = rect.left + 'px';
        ghost.style.top = rect.top + 'px';
        document.body.appendChild(ghost);
        card.classList.add('dragging');
        _drag = { card, ghost, sessName, offsetX, offsetY };
        _dragPending = null;
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
    }
    if (!_drag) return;
    _drag.ghost.style.left = (e.clientX - _drag.offsetX) + 'px';
    _drag.ghost.style.top = (e.clientY - _drag.offsetY) + 'px';
    // Highlight target column or sidebar project
    document.querySelectorAll('.kanban-col').forEach(c => c.classList.remove('drag-over'));
    document.querySelectorAll('.sidebar-item').forEach(s => s.classList.remove('drag-over'));
    document.querySelectorAll('.drop-indicator').forEach(el => el.remove());
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target) return;

    // Check if hovering over sidebar project
    const sidebarItem = target.closest('.sidebar-item[data-project]');
    if (sidebarItem) {
        sidebarItem.classList.add('drag-over');
        return;
    }

    const colBody = target.closest('.kanban-col-body');
    if (!colBody) return;
    colBody.closest('.kanban-col')?.classList.add('drag-over');
    const info = _getDragInsertInfo(e.clientY, colBody, _drag.sessName);
    const indicator = document.createElement('div');
    indicator.className = 'drop-indicator';
    if (info.before) {
        const t = colBody.querySelector(`[data-session="${info.before}"]`);
        if (t) colBody.insertBefore(indicator, t);
        else colBody.appendChild(indicator);
    } else {
        colBody.appendChild(indicator);
    }
});

document.addEventListener('pointerup', async (e) => {
    // If drag never activated, it was a click — let it through
    if (_dragPending) {
        _dragPending = null;
        return; // onclick handler on the card will fire naturally
    }
    if (!_drag) return;
    const { card, ghost, sessName } = _drag;
    _drag = null;
    ghost.remove();
    card.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.querySelectorAll('.kanban-col').forEach(c => c.classList.remove('drag-over'));
    document.querySelectorAll('.sidebar-item').forEach(s => s.classList.remove('drag-over'));
    document.querySelectorAll('.drop-indicator').forEach(el => el.remove());

    // Check if dropped on sidebar project
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target) return;
    const sidebarItem = target.closest('.sidebar-item[data-project]');
    if (sidebarItem) {
        const projName = sidebarItem.dataset.project;
        try {
            if (projName === '__unassigned') {
                // Remove from all projects
                for (const p of configData.projects) {
                    if (p.sessions && p.sessions.includes(sessName)) {
                        await authFetch(`/api/projects/${encodeURIComponent(p.name)}/remove-session/${encodeURIComponent(sessName)}`, { method: 'DELETE' });
                    }
                }
            } else {
                await apiCheck(await authFetch(`/api/projects/${encodeURIComponent(projName)}/assign-session`, {
                    method: 'POST',
                    body: JSON.stringify({ session: sessName }),
                }));
            }
            await fetchAll();
        } catch (err) { if (err.message !== 'Unauthorized') alert(err.message); }
        return;
    }

    // Find target column
    const colBody = target.closest('.kanban-col-body');
    const col = target.closest('.kanban-col');
    if (!colBody || !col) return;
    const newStatus = col.dataset.status;
    if (!newStatus) return;

    const oldStatus = getSessionStatus(sessName);
    const insertInfo = _getDragInsertInfo(e.clientY, colBody, sessName);

    // Status change
    if (oldStatus !== newStatus) {
        try {
            await apiCheck(await authFetch(`/api/session/${encodeURIComponent(sessName)}/status`, {
                method: 'PUT',
                body: JSON.stringify({ status: newStatus }),
            }));
            configData.sessionStatus[sessName] = newStatus;
        } catch (err) { if (err.message !== 'Unauthorized') alert(err.message); return; }
    }

    // Compute new order
    const visible = getVisibleSessions();
    const colSessions = sortSessionsBySortIndex(
        visible.filter(s => getSessionStatus(s.name) === newStatus)
    ).filter(s => s.name !== sessName);
    const orderedNames = colSessions.map(s => s.name);
    if (insertInfo.before) {
        const idx = orderedNames.indexOf(insertInfo.before);
        orderedNames.splice(idx >= 0 ? idx : orderedNames.length, 0, sessName);
    } else {
        orderedNames.push(sessName);
    }

    const order = {};
    orderedNames.forEach((n, i) => { order[n] = i; });
    for (const [n, i] of Object.entries(order)) {
        if (!configData.sessionInfo) configData.sessionInfo = {};
        if (!configData.sessionInfo[n]) configData.sessionInfo[n] = {};
        configData.sessionInfo[n].sortIndex = i;
    }
    document.getElementById('kanban').innerHTML = '';
    renderKanban();
    updateStats();
    try {
        await authFetch('/api/sessions/sort', { method: 'PUT', body: JSON.stringify({ order }) });
    } catch { /* ignore */ }
});

function _getDragInsertInfo(clientY, colBody, dragName) {
    const cards = [...colBody.querySelectorAll('.session-card:not(.dragging)')].filter(c => c.dataset.session !== dragName);
    for (const card of cards) {
        const rect = card.getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) {
            return { before: card.dataset.session };
        }
    }
    return { before: null };
}

// ── Session ordering ──

function getSessionSortIndex(name) {
    return configData.sessionInfo?.[name]?.sortIndex ?? 9999;
}

function sortSessionsBySortIndex(sessions) {
    return [...sessions].sort((a, b) => {
        const ai = getSessionSortIndex(a.name);
        const bi = getSessionSortIndex(b.name);
        if (ai !== bi) return ai - bi;
        return a.name.localeCompare(b.name);
    });
}


// ── Session settings modal ──

function showSessionSettings(sessName) {
    const sess = sessionsData.find(s => s.name === sessName);
    if (!sess) return;
    const alive = sess.alive !== false;
    const cwd = shortenHome(sess.windows[0]?.panes[0]?.cwd || '');
    const currentStatus = getSessionStatus(sessName);
    const currentProj = getProjectForSession(sessName);

    const statusOptions = STATUSES.map(st => {
        const sel = st === currentStatus ? ' selected' : '';
        return `<option value="${st}"${sel}>${STATUS_LABELS[st]}</option>`;
    }).join('');

    const projOptions = `<option value="">None</option>` + configData.projects.map(p => {
        const sel = currentProj && currentProj.name === p.name ? ' selected' : '';
        return `<option value="${esc(p.name)}"${sel}>${esc(p.name)}</option>`;
    }).join('');

    const powerBtn = alive
        ? `<button class="btn-danger" onclick="stopSession('${escAttr(sessName)}'); closeModalForce()">Stop Session</button>`
        : `<button class="btn-primary" onclick="startSession('${escAttr(sessName)}'); closeModalForce()">Start Session</button>`;

    const resumeBtn = alive ? `
        <div class="ss-divider"></div>
        <div class="ss-field">
            <label>Resume Agent</label>
            <div class="agent-type-row">
                <button type="button" class="agent-btn" onclick="resumeAgent('${escAttr(sessName)}', 'claude --continue --dangerously-skip-permissions')">Claude Code</button>
                <button type="button" class="agent-btn" onclick="resumeAgent('${escAttr(sessName)}', 'codex resume --last --dangerously-bypass-approvals-and-sandbox')">Codex</button>
                <button type="button" class="agent-btn" onclick="resumeAgent('${escAttr(sessName)}', 'gemini --yolo --resume latest')">Gemini</button>
            </div>
        </div>
    ` : '';

    const wtSection = cwd ? `
        <div class="ss-divider"></div>
        <div class="ss-field">
            <label>Worktree</label>
            <div class="ss-wt-display">
                <span class="ss-wt-path">${esc(cwd)}</span>
                <button class="ss-wt-copy" onclick="navigator.clipboard.writeText('${escAttr(cwd)}'); this.textContent='Copied!'; setTimeout(()=>this.textContent='Copy',1000)" title="Copy path">Copy</button>
            </div>
        </div>
    ` : '';

    const currentDesc = configData.sessionInfo?.[sessName]?.description || '';

    const modal = document.getElementById('modal');
    modal.innerHTML = `
        <h2>${esc(sessName)}</h2>
        <div class="ss-row">
            <div class="ss-field">
                <label>Rename</label>
                <div class="ss-inline">
                    <input type="text" id="ss-rename" value="${esc(sessName)}">
                    <button class="btn-primary" onclick="ssRename('${escAttr(sessName)}')">Save</button>
                </div>
            </div>
        </div>
        <div class="ss-row">
            <div class="ss-field" style="flex:1">
                <label>Description</label>
                <div class="ss-inline">
                    <input type="text" id="ss-desc" value="${escAttr(currentDesc)}" placeholder="What is this session doing?">
                    <button class="btn-primary" onclick="ssUpdateDesc('${escAttr(sessName)}')">Save</button>
                </div>
            </div>
        </div>
        <div class="ss-row">
            <div class="ss-field">
                <label>Status</label>
                <select class="modal-select" onchange="ssChangeStatus('${escAttr(sessName)}', this.value)">${statusOptions}</select>
            </div>
            <div class="ss-field">
                <label>Project</label>
                <select class="modal-select" onchange="ssMoveProject('${escAttr(sessName)}', this.value)">${projOptions}</select>
            </div>
        </div>
        ${wtSection}
        ${resumeBtn}
        <div class="ss-divider"></div>
        <div class="modal-actions">
            ${powerBtn}
            <button class="btn-danger" onclick="deleteSession('${escAttr(sessName)}')">Delete</button>
            <span style="flex:1"></span>
            <button class="btn-cancel" onclick="closeModalForce()">Close</button>
        </div>
    `;
    document.getElementById('modal-overlay').classList.add('active');
}

async function resumeAgent(sessName, command) {
    try {
        await apiCheck(await authFetch(`/api/sessions/${encodeURIComponent(sessName)}/command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command }),
        }));
        closeModalForce();
        await fetchAll();
    } catch (e) { if (e.message !== 'Unauthorized') alert(e.message); }
}

async function ssRename(oldName) {
    const newName = document.getElementById('ss-rename').value.trim();
    if (!newName || newName === oldName) return;
    try {
        await apiCheck(await authFetch(`/api/sessions/${encodeURIComponent(oldName)}/rename`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ new_name: newName }),
        }));
        closeModalForce();
        await fetchAll();
    } catch (e) { if (e.message !== 'Unauthorized') alert(e.message); }
}

async function ssUpdateDesc(sessName) {
    const desc = document.getElementById('ss-desc').value.trim();
    try {
        await apiCheck(await authFetch(`/api/session/${encodeURIComponent(sessName)}/info`, {
            method: 'PUT',
            body: JSON.stringify({ description: desc }),
        }));
        if (!configData.sessionInfo) configData.sessionInfo = {};
        if (!configData.sessionInfo[sessName]) configData.sessionInfo[sessName] = {};
        configData.sessionInfo[sessName].description = desc;
        renderKanban();
    } catch (e) { if (e.message !== 'Unauthorized') alert(e.message); }
}

async function ssChangeStatus(sessName, status) {
    await authFetch(`/api/session/${encodeURIComponent(sessName)}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
    });
    configData.sessionStatus[sessName] = status;
    renderKanban();
}

async function ssMoveProject(sessName, projName) {
    try {
        const currentProj = getProjectForSession(sessName);
        if (currentProj) {
            await apiCheck(await authFetch(`/api/projects/${encodeURIComponent(currentProj.name)}/remove-session/${encodeURIComponent(sessName)}`, { method: 'DELETE' }));
        }
        if (projName) {
            await apiCheck(await authFetch(`/api/projects/${encodeURIComponent(projName)}/assign-session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session: sessName }),
            }));
        }
        await fetchAll();
    } catch (e) { if (e.message !== 'Unauthorized') alert(e.message); }
}

async function ssCreateWt(sessName) {
    const branch = document.getElementById('ss-wt-branch').value.trim();
    if (!branch) return;
    const baseBranch = document.getElementById('ss-wt-base').value.trim();
    try {
        const res = await authFetch(`/api/git/${encodeURIComponent(sessName)}/worktree`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ branch, base_branch: baseBranch }),
        });
        await apiCheck(res);
        closeModalForce();
        await fetchAll();
    } catch (e) { if (e.message !== 'Unauthorized') alert(e.message); }
}

// ── Status picker modal ──

function showStatusPicker(sessName) {
    const current = getSessionStatus(sessName);
    const modal = document.getElementById('modal');
    modal.innerHTML = `
        <h2>Move "${esc(sessName)}" to</h2>
        <div class="picker-list">
            ${STATUSES.map(st => {
                const active = st === current ? ' picker-active' : '';
                return `<div class="picker-item${active}" onclick="changeStatus('${escAttr(sessName)}', '${st}')">
                    <span class="picker-dot dd-${st}"></span>
                    <span class="picker-label">${STATUS_LABELS[st]}</span>
                    ${st === current ? '<span class="picker-check">&#10003;</span>' : ''}
                </div>`;
            }).join('')}
        </div>
    `;
    document.getElementById('modal-overlay').classList.add('active');
}

async function changeStatus(sessName, status) {
    await authFetch(`/api/session/${encodeURIComponent(sessName)}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
    });
    configData.sessionStatus[sessName] = status;
    closeModalForce();
    renderKanban();
}

// ── Project picker modal ──

function showProjectPicker(sessName) {
    const currentProj = getProjectForSession(sessName);
    const modal = document.getElementById('modal');
    modal.innerHTML = `
        <h2>Assign "${esc(sessName)}" to project</h2>
        <div class="picker-list">
            <div class="picker-item${!currentProj ? ' picker-active' : ''}" onclick="moveToProject('${escAttr(sessName)}', null)">
                <span class="picker-dot" style="background:var(--text-muted)"></span>
                <span class="picker-label">None</span>
                ${!currentProj ? '<span class="picker-check">&#10003;</span>' : ''}
            </div>
            ${configData.projects.map(p => {
                const active = currentProj && currentProj.name === p.name ? ' picker-active' : '';
                const color = COLORS[p.color != null ? p.color % COLORS.length : configData.projects.indexOf(p) % COLORS.length];
                return `<div class="picker-item${active}" onclick="moveToProject('${escAttr(sessName)}', '${escAttr(p.name)}')">
                    <span class="picker-dot ${color}"></span>
                    <span class="picker-label">${esc(p.name)}</span>
                    ${active ? '<span class="picker-check">&#10003;</span>' : ''}
                </div>`;
            }).join('')}
        </div>
    `;
    document.getElementById('modal-overlay').classList.add('active');
}

async function moveToProject(sessName, projName) {
    try {
        const currentProj = getProjectForSession(sessName);
        if (currentProj) {
            await apiCheck(await authFetch(`/api/projects/${encodeURIComponent(currentProj.name)}/remove-session/${encodeURIComponent(sessName)}`, { method: 'DELETE' }));
        }
        if (projName) {
            await apiCheck(await authFetch(`/api/projects/${encodeURIComponent(projName)}/assign-session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session: sessName }),
            }));
        }
        closeModalForce();
        await fetchAll();
    } catch (e) { if (e.message !== 'Unauthorized') alert(e.message); }
}

// ── Project management modals ──

function colorPickerHtml(selectedIdx, idPrefix) {
    return `<div class="color-picker" id="${idPrefix}-colors">
        ${COLORS.map((c, i) => `<span class="color-option ${c} ${i === selectedIdx ? 'selected' : ''}" data-idx="${i}" onclick="selectColor('${idPrefix}', ${i})"></span>`).join('')}
    </div>`;
}

function selectColor(idPrefix, idx) {
    const picker = document.getElementById(`${idPrefix}-colors`);
    if (!picker) return;
    picker.querySelectorAll('.color-option').forEach(el => el.classList.toggle('selected', parseInt(el.dataset.idx) === idx));
}

function getSelectedColor(idPrefix) {
    const selected = document.querySelector(`#${idPrefix}-colors .color-option.selected`);
    return selected ? parseInt(selected.dataset.idx) : 0;
}

function showManageProjects() {
    const modal = document.getElementById('modal');
    const projList = configData.projects.length
        ? configData.projects.map(p => {
            const color = COLORS[p.color != null ? p.color % COLORS.length : configData.projects.indexOf(p) % COLORS.length];
            const sessCount = (p.sessions || []).length;
            const colorIdx = p.color != null ? p.color % COLORS.length : configData.projects.indexOf(p) % COLORS.length;
            return `
            <label class="ms-item">
                <input type="checkbox" class="mp-check" value="${esc(p.name)}">
                <span class="item-dot ${color}" onclick="event.preventDefault(); showEditProject('${escAttr(p.name)}')" style="cursor:pointer" title="Edit color & name"></span>
                <span class="ms-name" onclick="event.preventDefault(); showEditProject('${escAttr(p.name)}')" style="cursor:pointer">${esc(p.name)}</span>
                <span class="ms-status">${sessCount} sessions</span>
            </label>`;
        }).join('')
        : '<div class="manage-proj-empty">No projects yet</div>';

    modal.innerHTML = `
        <h2>Manage Projects</h2>
        <div class="ms-list">${projList}</div>
        <div class="manage-proj-new" style="margin-top:12px">
            <input type="text" id="new-proj-name" placeholder="New project name...">
            ${colorPickerHtml(configData.projects.length % COLORS.length, 'new-proj')}
        </div>
        <div class="modal-actions" style="margin-top:16px">
            <button class="btn-danger" onclick="deleteSelectedProjects()">Delete Selected</button>
            <button class="btn-primary" onclick="createProject()">Add Project</button>
            <span style="flex:1"></span>
            <button class="btn-cancel" onclick="closeModalForce()">Close</button>
        </div>
    `;
    modal.classList.add('modal-narrow');
    document.getElementById('modal-overlay').classList.add('active');
    setTimeout(() => document.getElementById('new-proj-name')?.focus(), 50);
}

async function createProject() {
    const name = document.getElementById('new-proj-name').value.trim();
    if (!name) return;
    const color = getSelectedColor('new-proj');
    try {
        await apiCheck(await authFetch('/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, sessions: [], color }),
        }));
        await fetchAll();
        showManageProjects();
    } catch (e) { if (e.message !== 'Unauthorized') alert(e.message); }
}

async function deleteSelectedProjects() {
    const checks = document.querySelectorAll('.mp-check:checked');
    const names = [...checks].map(c => c.value);
    if (!names.length) return;
    if (!confirm(`Delete ${names.length} project${names.length > 1 ? 's' : ''}?\n\n${names.join(', ')}`)) return;

    for (const name of names) {
        await authFetch(`/api/projects/${encodeURIComponent(name)}`, { method: 'DELETE' });
        if (selectedProject === name) selectedProject = null;
    }
    await fetchAll();
    showManageProjects();
}

function showEditProject(name) {
    const proj = configData.projects.find(p => p.name === name);
    if (!proj) return;
    const colorIdx = proj.color != null ? proj.color % COLORS.length : configData.projects.indexOf(proj) % COLORS.length;

    const modal = document.getElementById('modal');
    modal.innerHTML = `
        <h2>Edit: ${esc(name)}</h2>
        <div class="modal-field">
            <label>Project Name</label>
            <input type="text" id="edit-proj-name" value="${esc(name)}">
        </div>
        <div class="modal-field">
            <label>Color</label>
            ${colorPickerHtml(colorIdx, 'edit-proj')}
        </div>
        <div class="modal-actions">
            <button class="btn-primary" onclick="saveEditProject('${escAttr(name)}')">Save</button>
        </div>
    `;
    modal.classList.add('modal-narrow');
    document.getElementById('modal-overlay').classList.add('active');
}

async function saveEditProject(origName) {
    const newName = document.getElementById('edit-proj-name').value.trim();
    const newColor = getSelectedColor('edit-proj');
    try {
        await apiCheck(await authFetch(`/api/projects/${encodeURIComponent(origName)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName, color: newColor }),
        }));
        closeModalForce();
        if (selectedProject === origName) selectedProject = newName;
        await fetchAll();
    } catch (e) { if (e.message !== 'Unauthorized') alert(e.message); }
}

async function deleteProject(name) {
    if (!confirm(`Delete project "${name}"?`)) return;
    try {
        await apiCheck(await authFetch(`/api/projects/${encodeURIComponent(name)}`, { method: 'DELETE' }));
        if (selectedProject === name) selectedProject = null;
        await fetchAll();
        showManageProjects();
    } catch (e) { if (e.message !== 'Unauthorized') alert(e.message); }
}

let _modalLocked = false; // prevent dismissing auth modals
function closeModal(e) {
    if (_modalLocked) return;
    if (e.target === document.getElementById('modal-overlay')) closeModalForce();
}
function closeModalForce() {
    if (_modalLocked) return;
    // Save New Session form if it's open
    if (document.getElementById('new-sess-name')) _saveNewSessForm();
    document.getElementById('modal-overlay').classList.remove('active');
    const modal = document.getElementById('modal');
    modal.classList.remove('modal-narrow');
    modal.style.position = '';
    modal.style.left = '';
    modal.style.top = '';
    modal.style.margin = '';
}

// ── Rename session modal ──

function showRenameSession(currentName) {
    const modal = document.getElementById('modal');
    modal.innerHTML = `
        <h2>Rename Session</h2>
        <div class="modal-field">
            <label>New Name</label>
            <input type="text" id="rename-sess-input" value="${esc(currentName)}" autofocus>
        </div>
        <div class="modal-actions">
            <button class="btn-primary" onclick="saveRenameSession('${escAttr(currentName)}')">Save</button>
        </div>
    `;
    document.getElementById('modal-overlay').classList.add('active');
    setTimeout(() => {
        const input = document.getElementById('rename-sess-input');
        if (input) { input.focus(); input.select(); }
    }, 50);
}

async function saveRenameSession(currentName) {
    const newName = document.getElementById('rename-sess-input').value.trim();
    if (!newName || newName === currentName) {
        closeModalForce();
        return;
    }
    try {
        const res = await authFetch(`/api/sessions/${encodeURIComponent(currentName)}/rename`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ new_name: newName }),
        });
        await apiCheck(res);
        closeModalForce();
        await fetchAll();
    } catch (e) { if (e.message !== 'Unauthorized') alert(e.message); }
}

// ── Recent working directories ──

function getRecentCwds() {
    try {
        const raw = localStorage.getItem('tmux-recent-cwds');
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [];
}

function saveRecentCwd(cwd) {
    let paths = getRecentCwds();
    paths = paths.filter(p => p !== cwd);
    paths.unshift(cwd);
    paths = paths.slice(0, 12);
    localStorage.setItem('tmux-recent-cwds', JSON.stringify(paths));
}

// ── Path autocomplete ──

let cwdCompleteTimer = null;
let cwdDropdownOpen = false;

async function fetchCompletions(query) {
    const res = await authFetch(`/api/path-complete?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    return data.completions || [];
}

function showCwdDropdown(items, inputEl) {
    closeCwdDropdown();
    if (!items.length) return;
    const dd = document.createElement('div');
    dd.className = 'cwd-dropdown';
    dd.id = 'cwd-dropdown';
    items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'cwd-dropdown-row';

        const label = document.createElement('span');
        label.className = 'cwd-dropdown-label';
        label.textContent = item;

        const selBtn = document.createElement('button');
        selBtn.className = 'cwd-dropdown-select';
        selBtn.textContent = 'Select';
        selBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            inputEl.value = item;
            closeCwdDropdown();
            if (typeof checkCwdGit === 'function') checkCwdGit();
            inputEl.focus();
        };

        row.onclick = (e) => {
            e.preventDefault();
            inputEl.value = item;
            closeCwdDropdown();
            if (item.endsWith('/')) onCwdInput({ target: inputEl });
            if (typeof checkCwdGit === 'function') checkCwdGit();
            inputEl.focus();
        };

        row.appendChild(label);
        row.appendChild(selBtn);
        dd.appendChild(row);
    });
    inputEl.parentElement.appendChild(dd);
    cwdDropdownOpen = true;
}

function closeCwdDropdown() {
    const dd = document.getElementById('cwd-dropdown');
    if (dd) dd.remove();
    cwdDropdownOpen = false;
}

function onCwdInput(e) {
    clearTimeout(cwdCompleteTimer);
    const val = e.target.value;
    if (!val || val === '~') { closeCwdDropdown(); return; }
    cwdCompleteTimer = setTimeout(async () => {
        const completions = await fetchCompletions(val);
        showCwdDropdown(completions, e.target);
    }, 150);
}

function onCwdKeydown(e) {
    if (e.key === 'Tab') {
        e.preventDefault();
        const dd = document.getElementById('cwd-dropdown');
        if (dd && dd.firstChild) {
            const val = dd.firstChild.textContent;
            e.target.value = val;
            closeCwdDropdown();
            if (val.endsWith('/')) onCwdInput({ target: e.target });
        } else {
            // Force fetch
            onCwdInput(e);
        }
    } else if (e.key === 'Escape') {
        closeCwdDropdown();
    }
}

function showRecentDropdown(inputEl) {
    // Toggle: if already open, close it
    if (cwdDropdownOpen) {
        closeCwdDropdown();
        return;
    }
    const recent = getRecentCwds();
    if (!recent.length) {
        showCwdDropdownEmpty('No recent paths yet', inputEl);
        return;
    }
    showCwdDropdown(recent, inputEl);
}

// Click ▾: show subdirectories of the current input value (or matches if it's a partial).
async function showAutocompleteDropdown(inputEl) {
    if (cwdDropdownOpen) {
        closeCwdDropdown();
        return;
    }
    const raw = inputEl.value || '';
    // First try with trailing slash to get children of the current dir
    const withSlash = raw && !raw.endsWith('/') ? raw + '/' : raw || '/';
    let completions = await fetchCompletions(withSlash);
    // Fallback to prefix matching if appending '/' yielded nothing (e.g. partial path)
    if (!completions.length && raw && !raw.endsWith('/')) {
        completions = await fetchCompletions(raw);
    }
    if (!completions.length) {
        showCwdDropdownEmpty('No subdirectories', inputEl);
        return;
    }
    showCwdDropdown(completions, inputEl);
}

// Render a non-interactive empty-state row in the dropdown.
function showCwdDropdownEmpty(message, inputEl) {
    closeCwdDropdown();
    const dd = document.createElement('div');
    dd.className = 'cwd-dropdown';
    dd.id = 'cwd-dropdown';
    const row = document.createElement('div');
    row.className = 'cwd-dropdown-row cwd-dropdown-empty';
    const label = document.createElement('span');
    label.className = 'cwd-dropdown-label';
    label.textContent = message;
    row.appendChild(label);
    dd.appendChild(row);
    inputEl.parentElement.appendChild(dd);
    cwdDropdownOpen = true;
}

// ── Create session modal ──

let newSessGitInfo = null;
let selectedAgentType = 'tmux';

const AGENT_TYPES = {
    tmux:   { label: 'Tmux',        command: '' },
    claude: { label: 'Claude Code', command: 'claude --dangerously-skip-permissions' },
    codex:  { label: 'Codex',       command: 'codex --dangerously-bypass-approvals-and-sandbox' },
    gemini: { label: 'Gemini',      command: 'gemini --yolo' },
};

function selectAgentType(type) {
    selectedAgentType = type;
    document.querySelectorAll('.agent-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.agent === type));
    const cmdInput = document.getElementById('new-sess-cmd');
    if (cmdInput) cmdInput.value = AGENT_TYPES[type].command;
}

let _newSessFormCache = {}; // remember form values across open/close

function _saveNewSessForm() {
    const name = document.getElementById('new-sess-name');
    const cwd = document.getElementById('new-sess-cwd');
    const desc = document.getElementById('new-sess-desc');
    const cmd = document.getElementById('new-sess-cmd');
    const proj = document.getElementById('new-sess-project');
    _newSessFormCache = {
        name: name?.value || '',
        cwd: cwd?.value || '',
        desc: desc?.value || '',
        cmd: cmd?.value || '',
        project: proj?.value || '',
        agentType: selectedAgentType || 'tmux',
    };
}

function showCreateSession() {
    newSessGitInfo = null;
    selectedAgentType = _newSessFormCache.agentType || 'tmux';
    const projOptions = configData.projects.map(p =>
        `<option value="${esc(p.name)}" ${p.name === selectedProject ? 'selected' : ''}>${esc(p.name)}</option>`
    ).join('');

    const agentBtns = Object.entries(AGENT_TYPES).map(([key, val]) =>
        `<button type="button" class="agent-btn ${key === selectedAgentType ? 'active' : ''}" data-agent="${key}" onclick="selectAgentType('${key}')">${val.label}</button>`
    ).join('');

    const modal = document.getElementById('modal');
    modal.innerHTML = `
        <h2>New Session</h2>
        <div class="modal-field">
            <label>Type</label>
            <div class="agent-type-row">${agentBtns}</div>
        </div>
        <div class="modal-field">
            <label>Session Name</label>
            <input type="text" id="new-sess-name" placeholder="e.g. powergs-train">
        </div>
        <div class="modal-field">
            <label>Description (optional)</label>
            <input type="text" id="new-sess-desc" placeholder="What will this session do?">
        </div>
        <div class="modal-field cwd-field">
            <label>Working Directory <span id="git-indicator"></span></label>
            <div class="cwd-input-row">
                <input type="text" id="new-sess-cwd" placeholder="${escAttr(configData.home || '')}" value="${configData.home || ''}"
                       oninput="onCwdInput(event); checkCwdGit()" onkeydown="onCwdKeydown(event)">
                <button type="button" class="cwd-history-btn" onclick="showAutocompleteDropdown(document.getElementById('new-sess-cwd'))" title="Show subdirectories">&#9662;</button>
                <button type="button" class="cwd-browse-btn" onclick="openBrowser()">Browse</button>
                <button type="button" class="cwd-recent-btn" onclick="showRecentDropdown(document.getElementById('new-sess-cwd'))" title="Recent paths">Recent</button>
            </div>
        </div>
        <div class="file-browser" id="file-browser" style="display:none"></div>
        <div class="modal-field" id="wt-section">
            <label class="wt-label-row">
                <span>Worktree (git only)</span>
                <span class="wt-divider">|</span>
                <label class="wt-skip-label"><input type="checkbox" id="wt-skip" onchange="toggleWtSkip()"> Skip</label>
            </label>
            <div class="ss-inline wt-input-area" id="wt-input-area">
                <span id="wt-prefix" class="wt-prefix-label"></span>
                <input type="text" id="new-sess-wt" placeholder="branch name" disabled oninput="checkWtName()">
            </div>
            <div class="wt-hint" id="wt-hint"></div>
        </div>
        <div class="modal-field">
            <label>Startup Command</label>
            <input type="text" id="new-sess-cmd" placeholder="(none)" value="">
        </div>
        <div class="modal-field">
            <label>Assign to Project (optional)</label>
            <select id="new-sess-project" class="modal-select">
                <option value="">None</option>
                ${projOptions}
            </select>
        </div>
        <div class="modal-actions">
            <button class="btn-cancel" onclick="closeModalForce()">Cancel</button>
            <button class="btn-primary" onclick="createSession()">Create</button>
        </div>
    `;
    document.getElementById('modal-overlay').classList.add('active');
    // Restore cached form values
    const c = _newSessFormCache;
    if (c.name) document.getElementById('new-sess-name').value = c.name;
    if (c.cwd) document.getElementById('new-sess-cwd').value = c.cwd;
    if (c.desc) document.getElementById('new-sess-desc').value = c.desc;
    if (c.cmd) document.getElementById('new-sess-cmd').value = c.cmd;
    if (c.project) document.getElementById('new-sess-project').value = c.project;
    // Auto-check whether the initial cwd is a git repo (updates Skip checkbox)
    checkCwdGit();
    setTimeout(() => document.getElementById('new-sess-name')?.focus(), 50);
}

let gitCheckTimer = null;
function checkCwdGit() {
    clearTimeout(gitCheckTimer);
    gitCheckTimer = setTimeout(async () => {
        const cwd = document.getElementById('new-sess-cwd').value.trim();
        if (!cwd) {
            updateGitIndicator(false);
            return;
        }
        try {
            const res = await authFetch(`/api/check-git?path=${encodeURIComponent(cwd)}`);
            const data = await res.json();
            newSessGitInfo = data.isGit ? data : null;
            updateGitIndicator(data.isGit, data);
        } catch (e) {
            updateGitIndicator(false);
        }
    }, 300);
}

function updateGitIndicator(isGit, data) {
    const indicator = document.getElementById('git-indicator');
    const wtInput = document.getElementById('new-sess-wt');
    const wtPrefix = document.getElementById('wt-prefix');
    const wtHint = document.getElementById('wt-hint');
    if (!indicator) return;

    if (isGit && data) {
        indicator.innerHTML = '(<span class="git-light git-on"></span> git)';
        // Unlock skip checkbox and worktree input
        const skipCheckbox = document.getElementById('wt-skip');
        if (skipCheckbox) {
            skipCheckbox.disabled = false;
            if (!skipCheckbox.checked) {
                wtInput.disabled = false;
                const area = document.getElementById('wt-input-area');
                if (area) area.classList.remove('wt-disabled');
            }
        } else {
            wtInput.disabled = false;
        }
        const sessName = document.getElementById('new-sess-name').value.trim();
        const defaultWt = (sessName || 'wt') + '-' + Date.now().toString(36).slice(-4);
        wtInput.value = defaultWt;
        wtInput.placeholder = `e.g. feature-x (base: ${data.defaultBranch})`;
        wtPrefix.textContent = data.repoName + '/';
        wtHint.textContent = '';
    } else {
        indicator.innerHTML = '(<span class="git-light git-off"></span> not git)';
        wtInput.disabled = true;
        wtInput.value = '';
        wtPrefix.textContent = '';
        wtHint.textContent = '';
        // Force skip worktree for non-git directories
        const skipCheckbox = document.getElementById('wt-skip');
        if (skipCheckbox) {
            skipCheckbox.checked = true;
            skipCheckbox.disabled = true;
        }
        const area = document.getElementById('wt-input-area');
        if (area) area.classList.add('wt-disabled');
    }
}

function toggleWtSkip() {
    const skip = document.getElementById('wt-skip').checked;
    const area = document.getElementById('wt-input-area');
    const wtInput = document.getElementById('new-sess-wt');
    if (skip) {
        area.classList.add('wt-disabled');
        wtInput.disabled = true;
    } else {
        area.classList.remove('wt-disabled');
        if (newSessGitInfo) wtInput.disabled = false;
    }
}

let wtCheckTimer = null;
function checkWtName() {
    clearTimeout(wtCheckTimer);
    const wtInput = document.getElementById('new-sess-wt');
    const wtHint = document.getElementById('wt-hint');
    const branch = wtInput.value.trim();
    if (!branch || !newSessGitInfo) {
        wtHint.textContent = branch ? '' : 'Clear to skip worktree creation';
        wtHint.style.color = '';
        return;
    }
    wtCheckTimer = setTimeout(async () => {
        const res = await authFetch(`/api/check-worktree?repo=${encodeURIComponent(newSessGitInfo.repoName)}&branch=${encodeURIComponent(branch)}`);
        const data = await res.json();
        if (data.exists) {
            wtHint.textContent = 'Name already taken!';
            wtHint.style.color = 'var(--danger)';
        } else {
            wtHint.textContent = 'Available';
            wtHint.style.color = 'var(--success)';
        }
    }, 300);
}

// ── File browser ──

async function openBrowser() {
    const fb = document.getElementById('file-browser');
    if (fb.style.display === 'block') {
        fb.style.display = 'none';
        return;
    }
    const input = document.getElementById('new-sess-cwd');
    // Empty input -> let backend resolve to home
    const startPath = input.value || '';
    await loadBrowserDir(startPath);
    fb.style.display = 'block';
}

async function loadBrowserDir(path) {
    const res = await authFetch(`/api/browse?path=${encodeURIComponent(path)}`);
    const data = await res.json();
    const browser = document.getElementById('file-browser');

    const parentBtn = data.parent
        ? `<div class="browser-item browser-parent" onclick="loadBrowserDir('${escAttr(data.parent)}')">&#8592; ..</div>`
        : '';

    const dirItems = data.dirs.map(d => {
        const sep = data.path.endsWith('/') ? '' : '/';
        const childPath = data.path + sep + d;
        return `<div class="browser-item browser-dir" onclick="loadBrowserDir('${escAttr(childPath)}')">${esc(d)}/</div>`;
    }).join('');

    browser.innerHTML = `
        <div class="browser-header">
            <span class="browser-path">${esc(data.path)}</span>
            <button class="btn-primary browser-select-btn" onclick="selectBrowserPath('${escAttr(data.path)}')">Select This</button>
        </div>
        <div class="browser-list">
            ${parentBtn}
            ${dirItems || '<div class="browser-empty">No subdirectories</div>'}
        </div>
    `;
}

function selectBrowserPath(path) {
    document.getElementById('new-sess-cwd').value = path;
    document.getElementById('file-browser').style.display = 'none';
    checkCwdGit();
}

async function createSession() {
    const name = document.getElementById('new-sess-name').value.trim();
    if (!name) { alert('Session name is required.'); return; }
    const cwd = document.getElementById('new-sess-cwd').value.trim() || '~';
    const project = document.getElementById('new-sess-project').value || null;
    const wtSkip = document.getElementById('wt-skip')?.checked;
    const wtBranch = wtSkip ? '' : document.getElementById('new-sess-wt').value.trim();
    const command = document.getElementById('new-sess-cmd').value.trim() || null;
    const description = document.getElementById('new-sess-desc')?.value.trim() || null;

    // Save the agent command for next time
    if (selectedAgentType !== 'tmux' && command) {
        const saved = JSON.parse(localStorage.getItem('tmux-agent-cmds') || '{}');
        saved[selectedAgentType] = command;
        localStorage.setItem('tmux-agent-cmds', JSON.stringify(saved));
        AGENT_TYPES[selectedAgentType].command = command;
    }

    try {
        if (wtBranch && newSessGitInfo) {
            const res = await authFetch(`/api/create-session-with-worktree`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    cwd,
                    branch: wtBranch,
                    base_branch: newSessGitInfo.defaultBranch,
                    project,
                    command,
                    description,
                }),
            });
            await apiCheck(res);
        } else {
            const res = await authFetch('/api/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, cwd, project, command, description }),
            });
            await apiCheck(res);
        }
        saveRecentCwd(cwd);
        closeCwdDropdown();
        _newSessFormCache = {}; // clear cache on successful creation
        closeModalForce();
        await fetchAll();
    } catch (e) { if (e.message !== 'Unauthorized') alert(e.message); }
}

// Load saved agent commands from localStorage
(function loadSavedAgentCmds() {
    const saved = JSON.parse(localStorage.getItem('tmux-agent-cmds') || '{}');
    for (const [key, cmd] of Object.entries(saved)) {
        if (AGENT_TYPES[key]) AGENT_TYPES[key].command = cmd;
    }
})();

// ── Worktree manager modal ──

async function showWorktreeManager(sessName) {
    const modal = document.getElementById('modal');
    modal.innerHTML = `<h2>Worktrees: ${esc(sessName)}</h2><div style="color:var(--text-low);font-size:13px">Loading...</div>`;
    document.getElementById('modal-overlay').classList.add('active');

    const res = await authFetch(`/api/git/${encodeURIComponent(sessName)}/worktrees`);
    const data = await res.json();
    const wts = data.worktrees || [];
    const defaultBranch = data.defaultBranch || 'main';

    const wtList = wts.length ? wts.map(wt => `
        <div class="wt-item">
            <span class="wt-branch">${esc(wt.branch) || '?'}</span>
            <span class="wt-path">${esc(wt.path)}</span>
        </div>
    `).join('') : '<div class="manage-proj-empty">No worktrees</div>';

    modal.innerHTML = `
        <h2>Worktrees: ${esc(sessName)}</h2>
        <div class="wt-list">${wtList}</div>
        <div class="wt-create">
            <div class="modal-field">
                <label>New Branch Name</label>
                <input type="text" id="wt-branch" placeholder="e.g. feature-x">
            </div>
            <div class="modal-field">
                <label>Base Branch</label>
                <input type="text" id="wt-base" value="${esc(defaultBranch)}">
            </div>
            <div class="modal-actions">
                <button class="btn-cancel" onclick="closeModalForce()">Close</button>
                <button class="btn-primary" onclick="createWorktree('${escAttr(sessName)}')">Create Worktree</button>
            </div>
        </div>
    `;
}

async function createWorktree(sessName) {
    const branch = document.getElementById('wt-branch').value.trim();
    if (!branch) return;
    const baseBranch = document.getElementById('wt-base').value.trim();
    try {
        const res = await authFetch(`/api/git/${encodeURIComponent(sessName)}/worktree`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ branch, base_branch: baseBranch }),
        });
        await apiCheck(res);
        closeModalForce();
        await fetchAll();
    } catch (e) { if (e.message !== 'Unauthorized') alert(e.message); }
}

// ── Settings modal ──

function showSettings() {
    const settings = configData.settings || {};
    const currentTheme = settings.theme || localStorage.getItem('tmux-theme') || 'dark';
    const modal = document.getElementById('modal');
    modal.innerHTML = `
        <h2>Personalized Settings</h2>
        <div class="modal-field">
            <label>Browser Tab Title</label>
            <input type="text" id="settings-title" value="${esc(localStorage.getItem('tmux-kanban:title') || 'Tmux Kanban')}" placeholder="Tmux Kanban">
            <p style="font-size:11px;color:var(--text-muted);margin-top:4px">Changes the browser tab name and the title in the top-left corner.</p>
        </div>
        <div class="modal-field">
            <label>Theme</label>
            <div class="theme-toggle">
                <button class="theme-btn ${currentTheme === 'dark' ? 'active' : ''}" onclick="setTheme('dark')">Dark</button>
                <button class="theme-btn ${currentTheme === 'light' ? 'active' : ''}" onclick="setTheme('light')">Light</button>
            </div>
        </div>
        <div class="modal-field">
            <label>Config File Path (read-only)</label>
            <input type="text" value="${esc(settings.configPath || '~/.tmux-kanban/config.json')}" disabled style="opacity:0.5">
            <p style="font-size:11px;color:var(--text-muted);margin-top:4px">To change config location, restart with: <code>tmux-kanban --config /new/path</code></p>
        </div>
        <div class="modal-field">
            <label>Worktree Folder (read-only)</label>
            <input type="text" value="${esc(settings.worktreePath || '~/.tmux-kanban/worktrees')}" disabled style="opacity:0.5">
            <p style="font-size:11px;color:var(--text-muted);margin-top:4px">To change worktree location, restart with: <code>tmux-kanban --worktree-path /new/path</code></p>
        </div>
        <div class="modal-actions">
            <button class="btn-primary" onclick="saveSettings()">Save</button>
        </div>
    `;
    document.getElementById('modal-overlay').classList.add('active');
}

function setTheme(theme) {
    document.body.classList.toggle('light', theme === 'light');
    localStorage.setItem('tmux-theme', theme);
    configData.settings = configData.settings || {};
    configData.settings.theme = theme;
    // Update toggle buttons
    document.querySelectorAll('.theme-btn').forEach(b => {
        b.classList.toggle('active', b.textContent.toLowerCase() === theme);
    });
}

// Apply saved theme on load
function applySavedTheme() {
    const theme = localStorage.getItem('tmux-theme') || 'dark';
    if (theme === 'light') document.body.classList.add('light');
}
applySavedTheme();

async function saveSettings() {
    // Save title locally
    const title = document.getElementById('settings-title')?.value.trim() || 'Tmux Kanban';
    localStorage.setItem('tmux-kanban:title', title);
    applyTitle();

    const settings = {
        theme: localStorage.getItem('tmux-theme') || 'dark',
    };
    try {
        await apiCheck(await authFetch('/api/settings', {
            method: 'PUT',
            body: JSON.stringify(settings),
        }));
        configData.settings = { ...configData.settings, ...settings };
        closeModalForce();
    } catch (e) { if (e.message !== 'Unauthorized') alert(e.message); }
}

function applyTitle() {
    const title = localStorage.getItem('tmux-kanban:title') || 'Tmux Kanban';
    document.title = title;
    const h1 = document.querySelector('.topbar h1');
    if (h1) h1.textContent = title;
}
applyTitle();

// ── Update app ──

async function updateApp(btn) {
    // Ask the server which install mode we're in so we show the right options
    let info;
    try {
        const res = await authFetch('/api/update/info');
        info = await (await apiCheck(res)).json();
    } catch (e) {
        if (e.message !== 'Unauthorized') alert('Update unavailable: ' + e.message);
        return;
    }

    const isEditable = info.mode === 'editable';
    const modal = document.getElementById('modal');
    modal.innerHTML = `
        <h2>Update tmux-kanban</h2>
        <p style="font-size:14px;color:var(--text-normal);margin-bottom:16px;line-height:1.6">
            Choose where to pull the latest version from:
        </p>
        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">
            <button class="btn-primary" style="text-align:left;padding:12px 14px" onclick="_runUpdate('pypi', this)">
                <div style="font-weight:600;font-size:14px">From PyPI <span style="opacity:.6;font-weight:400">(stable)</span></div>
                <div style="font-size:12px;opacity:.75;margin-top:2px"><code>pip install --upgrade tmux-kanban</code></div>
            </button>
            <button class="btn-primary" style="text-align:left;padding:12px 14px;background:var(--bg-panel);color:var(--text-normal)" onclick="_runUpdate('github', this)">
                <div style="font-weight:600;font-size:14px">From GitHub <span style="opacity:.6;font-weight:400">(latest main)</span></div>
                <div style="font-size:12px;opacity:.75;margin-top:2px"><code>pip install --upgrade git+https://github.com/linwk20/tmux-kanban.git</code></div>
            </button>
            ${isEditable ? `
            <button class="btn-primary" style="text-align:left;padding:12px 14px;background:var(--bg-panel);color:var(--text-normal)" onclick="_runUpdate('editable', this)">
                <div style="font-weight:600;font-size:14px">From local checkout <span style="opacity:.6;font-weight:400">(editable install)</span></div>
                <div style="font-size:12px;opacity:.75;margin-top:2px"><code>git pull &amp;&amp; pip install -e .</code></div>
            </button>` : ''}
        </div>
        <div class="modal-actions">
            <button class="btn-cancel" onclick="closeModalForce()">Cancel</button>
        </div>
    `;
    document.getElementById('modal-overlay').classList.add('active');
}

async function _runUpdate(source, btn) {
    const origHTML = btn.innerHTML;
    btn.innerHTML = 'Updating from ' + source + '...';
    btn.disabled = true;
    try {
        const res = await authFetch('/api/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source }),
        });
        const data = await (await apiCheck(res)).json();
        const modal = document.getElementById('modal');
        modal.innerHTML = `
            <h2>Update Complete</h2>
            <div style="background:var(--accent-dim);padding:16px;border-radius:8px;margin-bottom:16px">
                <p style="font-size:14px;color:var(--text-normal);margin-bottom:8px;font-weight:600">
                    ${esc(data.detail || 'Already up to date.')}
                </p>
            </div>
            <p style="font-size:15px;color:var(--text-normal);margin-bottom:12px;line-height:1.6">
                To apply the update, restart the server:
            </p>
            <p style="font-size:12px;color:var(--text-muted);margin-bottom:4px">If running via <code>systemd --user</code>:</p>
            <code style="font-family:monospace;font-size:13px;color:var(--accent);user-select:all;display:block;padding:10px;background:var(--bg-panel);border-radius:6px;margin-bottom:12px">systemctl --user restart tmux-kanban.service</code>
            <p style="font-size:12px;color:var(--text-muted);margin-bottom:4px">If running in the foreground:</p>
            <code style="font-family:monospace;font-size:13px;color:var(--accent);user-select:all;display:block;padding:10px;background:var(--bg-panel);border-radius:6px;margin-bottom:16px">pkill -f tmux-kanban; tmux-kanban</code>
            <div class="modal-actions">
                <button class="btn-primary" onclick="closeModalForce()">OK</button>
            </div>
        `;
    } catch (e) {
        btn.innerHTML = origHTML;
        btn.disabled = false;
        if (e.message !== 'Unauthorized') alert('Update failed: ' + e.message);
    }
}

// ── Scan sessions ──

async function scanSessions(btn) {
    btn.textContent = 'Scanning...';
    btn.disabled = true;
    let data;
    try {
        const res = await authFetch('/api/scan', { method: 'POST' });
        data = await (await apiCheck(res)).json();
    } catch (e) {
        btn.textContent = 'Scan Sessions';
        btn.disabled = false;
        if (e.message !== 'Unauthorized') alert(e.message);
        return;
    }
    await fetchAll();

    if (data.added.length) {
        btn.textContent = `Found ${data.added.length}`;
        // Show results in a modal
        const modal = document.getElementById('modal');
        modal.innerHTML = `
            <h2>Scan Results</h2>
            <p style="color:var(--text-low);font-size:14px;margin-bottom:16px">Found ${data.added.length} new session${data.added.length > 1 ? 's' : ''} (${data.total} total running)</p>
            <div class="scan-results">
                ${data.added.map(name => `
                    <div class="scan-result-item">
                        <span class="session-dot dot-idle"></span>
                        <span>${esc(name)}</span>
                    </div>
                `).join('')}
            </div>
            <div class="modal-actions" style="margin-top:16px">
                <button class="btn-primary" onclick="closeModalForce()">OK</button>
            </div>
        `;
        document.getElementById('modal-overlay').classList.add('active');
    } else {
        btn.textContent = 'No new';
    }
    setTimeout(() => { btn.textContent = 'Scan Sessions'; btn.disabled = false; }, 2000);
}

// ── Start / Stop session ──

async function deleteSession(name, force = false) {
    if (!force && !confirm(`Delete session "${name}"? This will kill the tmux session and remove it from the dashboard.`)) return;
    if (currentSessionName === name) closeTerminal();
    const url = `/api/sessions/${encodeURIComponent(name)}` + (force ? '?force=true' : '');
    const res = await authFetch(url, { method: 'DELETE' });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const detail = data.detail || 'Delete failed';
        if (detail.includes('uncommitted changes') && confirm(`${detail}\n\nForce delete anyway?`)) {
            return deleteSession(name, true);
        }
        alert(detail);
        return;
    }
    closeModalForce();
    // Immediately remove from local data for instant UI update
    sessionsData = sessionsData.filter(s => s.name !== name);
    delete configData.sessionStatus[name];
    delete configData.sessionInfo?.[name];
    document.getElementById('kanban').innerHTML = '';
    renderKanban();
    updateStats();
    // Then sync with server
    await fetchAll();
}

// ── Manage Sessions modal ──

function showManageSessions() {
    const modal = document.getElementById('modal');

    // Group sessions by project
    const assigned = new Set();
    const groups = configData.projects.map(p => {
        const sessions = sessionsData.filter(s => (p.sessions || []).includes(s.name));
        sessions.forEach(s => assigned.add(s.name));
        return { name: p.name, sessions };
    });
    const unassigned = sessionsData.filter(s => !assigned.has(s.name));
    if (unassigned.length) {
        groups.push({ name: 'Unassigned', sessions: unassigned });
    }

    const groupsHtml = groups.map(g => {
        if (!g.sessions.length) return '';
        const items = g.sessions.map(s => {
            const alive = s.alive !== false;
            const dotClass = alive ? 'dot-idle' : 'dot-stopped';
            return `
            <label class="ms-item">
                <input type="checkbox" class="ms-check" value="${esc(s.name)}">
                <span class="session-dot ${dotClass}"></span>
                <span class="ms-name">${esc(s.name)}</span>
                <span class="ms-status">${alive ? 'running' : 'stopped'}</span>
            </label>`;
        }).join('');
        return `
        <div class="ms-group">
            <div class="ms-group-header">${esc(g.name)}</div>
            ${items}
        </div>`;
    }).join('');

    modal.innerHTML = `
        <h2>Manage Sessions</h2>
        <div class="ms-list">${groupsHtml || '<div class="manage-proj-empty">No sessions</div>'}</div>
        <div class="modal-actions" style="margin-top:16px">
            <button class="btn-danger" onclick="deleteSelectedSessions()">Delete Selected</button>
            <span style="flex:1"></span>
            <button class="btn-cancel" onclick="closeModalForce()">Close</button>
        </div>
    `;
    modal.classList.add('modal-narrow');
    document.getElementById('modal-overlay').classList.add('active');
}

async function deleteSelectedSessions() {
    const checks = document.querySelectorAll('.ms-check:checked');
    const names = [...checks].map(c => c.value);
    if (!names.length) return;
    if (!confirm(`Delete ${names.length} session${names.length > 1 ? 's' : ''}?\n\n${names.join(', ')}`)) return;

    const errors = [];
    for (const name of names) {
        if (currentSessionName === name) closeTerminal();
        const res = await authFetch(`/api/sessions/${encodeURIComponent(name)}`, { method: 'DELETE' });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            if (data.detail && data.detail.includes('uncommitted changes')) {
                if (confirm(`Session "${name}": ${data.detail}\n\nForce delete?`)) {
                    const r2 = await authFetch(`/api/sessions/${encodeURIComponent(name)}?force=true`, { method: 'DELETE' });
                    if (!r2.ok) errors.push(name);
                } else {
                    errors.push(name);
                }
            } else {
                errors.push(name);
            }
        }
    }
    if (errors.length) alert(`Failed to delete: ${errors.join(', ')}`);
    await fetchAll();
    showManageSessions();
}

async function stopSession(name) {
    try {
        await apiCheck(await authFetch(`/api/sessions/${encodeURIComponent(name)}/stop`, { method: 'POST' }));
        if (currentSessionName === name) closeTerminal();
        await fetchAll();
    } catch (e) { if (e.message !== 'Unauthorized') alert(e.message); }
}

async function startSession(name) {
    try {
        await apiCheck(await authFetch(`/api/sessions/${encodeURIComponent(name)}/start`, { method: 'POST' }));
        await fetchAll();
    } catch (e) { if (e.message !== 'Unauthorized') alert(e.message); }
}

// ── Terminal (side panel + fullscreen) ──

let terminalMode = 'panel'; // 'panel' or 'fullscreen'
let currentSessionName = '';

const TERM_THEME = {
    background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff',
    selectionBackground: '#264f78',
    black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
    blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39d353', white: '#c9d1d9',
    brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364',
    brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd', brightWhite: '#f0f6fc',
};

function saveDraftForCurrentSession() {
    if (currentSessionName) {
        const ta = document.getElementById('draft-input');
        const taFs = document.getElementById('draft-input-fs');
        const text = ta?.value || taFs?.value || '';
        saveDraftText(currentSessionName, text);
    }
}

function restoreDraftForSession(sessName) {
    const state = getDraftState(sessName);
    const ta = document.getElementById('draft-input');
    const taFs = document.getElementById('draft-input-fs');
    if (ta) ta.value = state.text || '';
    if (taFs) taFs.value = state.text || '';
}

function openTerminalInMode(sessionName, label, mode) {
    saveDraftForCurrentSession();
    if (currentWs) { currentWs.close(); currentWs = null; }
    if (currentTerminal) { currentTerminal.term.dispose(); currentTerminal = null; }

    currentSessionName = sessionName;
    terminalMode = mode;
    localStorage.setItem('tmux-open-session', sessionName);
    localStorage.setItem('tmux-terminal-mode', mode);

    document.getElementById('panel-title').textContent = label;
    document.getElementById('fs-title').textContent = label;

    if (mode === 'fullscreen') {
        document.getElementById('terminal-panel').classList.remove('active');
        document.getElementById('resize-handle').classList.remove('active');
        document.getElementById('terminal-overlay').classList.add('active');
        const bodyEl = document.getElementById('fs-body');
        bodyEl.innerHTML = '';
        setTimeout(() => initTerminal(bodyEl, sessionName), 50);
    } else {
        document.getElementById('terminal-panel').classList.add('active');
        document.getElementById('resize-handle').classList.add('active');
        document.getElementById('terminal-overlay').classList.remove('active');
        const bodyEl = document.getElementById('panel-body');
        bodyEl.innerHTML = '';
        initTerminal(bodyEl, sessionName);
    }
    restoreDraftForSession(sessionName);
    const draftId = mode === 'fullscreen' ? 'draft-input-fs' : 'draft-input';
    setTimeout(() => document.getElementById(draftId)?.focus(), 100);
}

function openTerminal(sessionName, label) {
    saveDraftForCurrentSession();
    // Clean up previous
    if (currentWs) { currentWs.close(); currentWs = null; }
    if (currentTerminal) { currentTerminal.term.dispose(); currentTerminal = null; }

    currentSessionName = sessionName;
    terminalMode = 'panel';
    localStorage.setItem('tmux-open-session', sessionName);
    localStorage.setItem('tmux-terminal-mode', 'panel');

    // Set titles
    document.getElementById('panel-title').textContent = label;
    document.getElementById('fs-title').textContent = label;

    // Show side panel + resize handle
    document.getElementById('terminal-panel').classList.add('active');
    document.getElementById('resize-handle').classList.add('active');
    document.getElementById('terminal-overlay').classList.remove('active');

    const bodyEl = document.getElementById('panel-body');
    bodyEl.innerHTML = '';

    initTerminal(bodyEl, sessionName);
    restoreDraftForSession(sessionName);
    setTimeout(() => document.getElementById('draft-input')?.focus(), 100);
}

function initTerminal(bodyEl, sessionName) {
    const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
        theme: TERM_THEME,
    });

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(bodyEl);
    fitAddon.fit();
    currentTerminal = { term, fitAddon };

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/ws/terminal/${encodeURIComponent(sessionName)}?token=${encodeURIComponent(authToken)}`);
    currentWs = ws;
    ws.binaryType = 'arraybuffer';

    let _wsHeartbeat = null;
    ws.onopen = () => {
        ws.send(`resize:${term.cols},${term.rows}`);
        // Heartbeat: send ping every 30s to keep connection alive
        _wsHeartbeat = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) ws.send('');
        }, 30000);
    };
    ws.onmessage = (evt) => {
        if (evt.data instanceof ArrayBuffer) term.write(new Uint8Array(evt.data));
        else term.write(evt.data);
    };
    ws.onclose = () => {
        if (_wsHeartbeat) { clearInterval(_wsHeartbeat); _wsHeartbeat = null; }
        // Auto-reconnect after 2 seconds if this session is still open
        if (currentSessionName === sessionName) {
            term.write('\r\n\x1b[90m[disconnected — reconnecting...]\x1b[0m\r\n');
            setTimeout(() => {
                if (currentSessionName === sessionName && (!currentWs || currentWs.readyState !== WebSocket.OPEN)) {
                    const newWs = new WebSocket(`${protocol}//${location.host}/ws/terminal/${encodeURIComponent(sessionName)}?token=${encodeURIComponent(authToken)}`);
                    newWs.binaryType = 'arraybuffer';
                    currentWs = newWs;
                    newWs.onopen = ws.onopen;
                    newWs.onmessage = ws.onmessage;
                    newWs.onclose = ws.onclose;
                    term.write('\r\n\x1b[90m[reconnected]\x1b[0m\r\n');
                }
            }, 2000);
        } else {
            term.write('\r\n\x1b[90m[disconnected]\x1b[0m\r\n');
        }
    };
    term.onData((data) => { if (currentWs?.readyState === WebSocket.OPEN) currentWs.send(data); });

    term.focus();

    // Alt+C / Alt+D shortcuts inside terminal
    term.attachCustomKeyEventHandler((e) => {
        if (e.type !== 'keydown') return true;
        // Ctrl+C: auto-copy tmux buffer to clipboard, then pass to tmux
        if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'c' || e.key === 'C')) {
            copyTmuxBuffer(document.querySelector('.term-btn[onclick*="copyTmuxBuffer"]'));
            return true; // also send Ctrl+C to tmux
        }
        // Alt+D: draft
        if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'd' || e.key === 'D')) {
            e.preventDefault();
            showDraftBox();
            return false;
        }
        return true;
    });

    const ro = new ResizeObserver(() => {
        fitAddon.fit();
        if (ws.readyState === WebSocket.OPEN) ws.send(`resize:${term.cols},${term.rows}`);
    });
    ro.observe(bodyEl);
    term.focus();
}

function toggleFullscreen() {
    if (!currentSessionName) return;

    // Kill current terminal + ws
    if (currentWs) { currentWs.close(); currentWs = null; }
    if (currentTerminal) { currentTerminal.term.dispose(); currentTerminal = null; }

    if (terminalMode === 'panel') {
        // Switch to fullscreen
        terminalMode = 'fullscreen';
        localStorage.setItem('tmux-terminal-mode', 'fullscreen');
        document.getElementById('terminal-panel').classList.remove('active');
        document.getElementById('resize-handle').classList.remove('active');
        document.getElementById('terminal-overlay').classList.add('active');
        const bodyEl = document.getElementById('fs-body');
        bodyEl.innerHTML = '';
        setTimeout(() => initTerminal(bodyEl, currentSessionName), 50);
    } else {
        // Switch to panel
        terminalMode = 'panel';
        localStorage.setItem('tmux-terminal-mode', 'panel');
        document.getElementById('terminal-overlay').classList.remove('active');
        document.getElementById('terminal-panel').classList.add('active');
        document.getElementById('resize-handle').classList.add('active');
        const bodyEl = document.getElementById('panel-body');
        bodyEl.innerHTML = '';
        setTimeout(() => initTerminal(bodyEl, currentSessionName), 50);
    }
}

function _getDraftBars() {
    // Return both draft bars so they stay in sync
    return [document.getElementById('draft-input'), document.getElementById('draft-input-fs')].filter(Boolean);
}

function _getDraftBarText() {
    // Read from whichever bar has content (prefer active mode)
    const fs = document.getElementById('draft-input-fs');
    const panel = document.getElementById('draft-input');
    if (terminalMode === 'fullscreen' && fs?.value) return fs.value;
    if (panel?.value) return panel.value;
    if (fs?.value) return fs.value;
    return '';
}

function showDraftBox() {
    const barText = _getDraftBarText();
    const modal = document.getElementById('modal');
    modal.innerHTML = `
        <h2>Draft</h2>
        <textarea class="copy-textarea" id="draft-textarea" placeholder="Type or dictate here, then send to terminal..."></textarea>
        <div class="modal-actions">
            <button class="btn-primary" onclick="sendDraftText()">Send</button>
            <button class="btn-cancel" onclick="closeDraftBox()">Close</button>
        </div>
    `;
    document.getElementById('draft-textarea').value = barText;
    document.getElementById('modal-overlay').classList.add('active');
    const ta = document.getElementById('draft-textarea');
    setTimeout(() => { ta?.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; }, 50);
}

function closeDraftBox() {
    const ta = document.getElementById('draft-textarea');
    if (ta) {
        // Sync modal content back to BOTH bars
        _getDraftBars().forEach(bar => { bar.value = ta.value; });
    }
    closeModalForce();
}

async function sendDraftText() {
    const text = document.getElementById('draft-textarea').value;
    if (!text) return;
    if (!currentWs || currentWs.readyState !== WebSocket.OPEN) {
        alert('Terminal disconnected. Click the session card to reconnect.');
        return;
    }
    // Exit copy-mode if active
    if (currentSessionName) {
        await authFetch(`/api/sessions/${encodeURIComponent(currentSessionName)}/scroll-bottom`, { method: 'POST' }).catch(() => {});
    }
    _getDraftBars().forEach(bar => { bar.value = ''; });
    currentWs.send(text);
    closeModalForce();
    if (currentTerminal) currentTerminal.term.focus();
}

async function sendDraftFromBar(mode) {
    const id = mode === 'fs' ? 'draft-input-fs' : 'draft-input';
    const ta = document.getElementById(id);
    if (!ta) return;
    if (!currentWs || currentWs.readyState !== WebSocket.OPEN) {
        alert('Terminal disconnected. Click the session card to reconnect.');
        return;
    }
    // Empty draft: just send Enter
    if (!ta.value) {
        if (currentSessionName) {
            await authFetch(`/api/sessions/${encodeURIComponent(currentSessionName)}/scroll-bottom`, { method: 'POST' }).catch(() => {});
        }
        currentWs.send('\r');
        ta.focus();
        return;
    }
    // Exit copy-mode if active (must do this or keys get eaten by copy-mode)
    if (currentSessionName) {
        await authFetch(`/api/sessions/${encodeURIComponent(currentSessionName)}/scroll-bottom`, { method: 'POST' }).catch(() => {});
    }
    // Save to per-session history
    if (ta.value.trim() && currentSessionName) {
        const state = getDraftState(currentSessionName);
        state.history.push(ta.value.trim());
        if (state.history.length > DRAFT_HISTORY_MAX) state.history.shift();
        state.historyIndex = -1;
        saveDraftHistory(currentSessionName);
    }
    // Temporarily prevent terminal from stealing focus
    const term = currentTerminal?.term;
    if (term) term.textarea.setAttribute('tabindex', '-1');
    currentWs.send(ta.value);
    setTimeout(() => { if (currentWs?.readyState === WebSocket.OPEN) currentWs.send('\r'); }, 200);
    ta.value = '';
    saveDraftText(currentSessionName, '');
    ta.focus();
    // Restore terminal focusability after a frame
    requestAnimationFrame(() => {
        if (term) term.textarea.removeAttribute('tabindex');
    });
}

// Save draft text on input change + live-update history
document.addEventListener('input', (e) => {
    if ((e.target?.id === 'draft-input' || e.target?.id === 'draft-input-fs') && currentSessionName) {
        const text = e.target.value;
        saveDraftText(currentSessionName, text);
        const state = getDraftState(currentSessionName);
        if (state.historyIndex >= 0 && state.historyIndex < state.history.length) {
            // Editing a history entry — update it in place
            state.history[state.historyIndex] = text;
            saveDraftHistory(currentSessionName);
        }
    }
});

// Enter to send from draft bar (Shift+Enter for newline)
// ── Unified keyboard handler ──
document.addEventListener('keydown', (e) => {
    // Draft input: Enter to send, Up/Down for history
    if (e.target?.id === 'draft-input' || e.target?.id === 'draft-input-fs') {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendDraftFromBar(e.target.id === 'draft-input-fs' ? 'fs' : '');
        }
        if (e.key === 'ArrowUp' && currentSessionName) {
            const ta = e.target;
            const state = getDraftState(currentSessionName);
            const inHistory = state.historyIndex >= 0;
            const textBefore = ta.value.substring(0, ta.selectionStart);
            const onFirstLine = !textBefore.includes('\n');
            if (inHistory || onFirstLine) {
                e.preventDefault();
                if (state.historyIndex === -1) {
                    // Save current draft before entering history
                    state._savedDraft = ta.value;
                    state.historyIndex = state.history.length;
                }
                if (state.historyIndex > 0) {
                    state.historyIndex--;
                    ta.value = state.history[state.historyIndex];
                }
            }
        }
        if (e.key === 'ArrowDown' && currentSessionName) {
            const ta = e.target;
            const state = getDraftState(currentSessionName);
            const inHistory = state.historyIndex >= 0;
            const textAfter = ta.value.substring(ta.selectionEnd);
            const onLastLine = !textAfter.includes('\n');
            if (inHistory || onLastLine) {
                e.preventDefault();
                if (state.historyIndex >= 0 && state.historyIndex < state.history.length - 1) {
                    state.historyIndex++;
                    ta.value = state.history[state.historyIndex];
                } else if (state.historyIndex >= 0) {
                    // Back to bottom — restore saved draft
                    state.historyIndex = -1;
                    ta.value = state._savedDraft || '';
                    delete state._savedDraft;
                }
            }
        }
        return;
    }
    // Escape: close modal or terminal
    if (e.key === 'Escape') {
        if (document.getElementById('modal-overlay').classList.contains('active')) {
            closeModalForce();
        } else if (document.getElementById('terminal-overlay').classList.contains('active')) {
            closeTerminal();
        }
    }
    // Alt+C → Copy, Alt+D → Draft (only when terminal is open)
    if (e.altKey && !e.ctrlKey && !e.metaKey && currentSessionName) {
        if (e.key === 'c' || e.key === 'C') {
            e.preventDefault();
            copyTmuxBuffer(document.querySelector('.term-btn[onclick*="copyTmuxBuffer"]'));
        } else if (e.key === 'd' || e.key === 'D') {
            e.preventDefault();
            showDraftBox();
        }
    }
});

async function copyTmuxBuffer(btn) {
    const res = await authFetch('/api/tmux-buffer?session=' + encodeURIComponent(currentSessionName || ''));
    const data = await res.json();
    if (!data.content) {
        if (btn) { btn.textContent = 'Empty'; setTimeout(() => btn.textContent = 'Copy (Select \u2192 Release \u2192 Alt+C)', 1500); }
        return;
    }

    // Try auto-copy: textarea + execCommand (works if browser trusts user gesture)
    const ta = document.createElement('textarea');
    ta.value = data.content;
    ta.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);

    if (ok) {
        if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy (Select \u2192 Release \u2192 Alt+C)', 1500); }
        if (currentTerminal) currentTerminal.term.focus();
        return;
    }

    // Fallback: modal for manual Ctrl+C
    const modal = document.getElementById('modal');
    modal.innerHTML = `
        <h2>Copy Terminal Text</h2>
        <textarea class="copy-textarea" id="copy-textarea" readonly>${data.content.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</textarea>
        <div class="modal-actions">
            <button class="btn-primary" onclick="document.getElementById('copy-textarea').select()">Select All</button>
            <button class="btn-cancel" onclick="closeModalForce()">Close</button>
        </div>
    `;
    document.getElementById('modal-overlay').classList.add('active');
    setTimeout(() => { const t = document.getElementById('copy-textarea'); t.focus(); t.select(); }, 50);
}

async function refreshTerminal() {
    if (!currentSessionName || !currentWs || currentWs.readyState !== WebSocket.OPEN) {
        if (currentSessionName) openTerminalInMode(currentSessionName, currentSessionName, terminalMode);
        return;
    }
    // Scroll up 5 times then back to bottom to force tmux redraw
    for (let i = 0; i < 5; i++) {
        currentWs.send('\x1b[5~'); // PageUp
        await new Promise(r => setTimeout(r, 50));
    }
    await new Promise(r => setTimeout(r, 100));
    for (let i = 0; i < 5; i++) {
        currentWs.send('\x1b[6~'); // PageDown
        await new Promise(r => setTimeout(r, 50));
    }
    await new Promise(r => setTimeout(r, 200));
    // Then reconnect for a clean state
    openTerminalInMode(currentSessionName, currentSessionName, terminalMode);
}

async function jumpToBottom() {
    if (!currentWs || currentWs.readyState !== WebSocket.OPEN || !currentTerminal?.term) return;

    // 1. If tmux is in copy-mode, exit it
    if (currentSessionName) {
        await authFetch(`/api/sessions/${encodeURIComponent(currentSessionName)}/scroll-bottom`, { method: 'POST' });
    }

    // 2. Send many PageDown keys to scroll any TUI app to bottom
    // PageDown = \x1b[6~, works universally in most apps
    const pageDown = '\x1b[6~';
    for (let i = 0; i < 50; i++) {
        currentWs.send(pageDown);
    }

    // 3. Also scroll xterm buffer
    currentTerminal.term.scrollToBottom();
    currentTerminal.term.focus();
}

function closeTerminal() {
    document.getElementById('terminal-panel').classList.remove('active');
    document.getElementById('resize-handle').classList.remove('active');
    document.getElementById('terminal-overlay').classList.remove('active');
    localStorage.removeItem('tmux-open-session');
    localStorage.removeItem('tmux-terminal-mode');
    currentSessionName = '';
    if (currentWs) { currentWs.close(); currentWs = null; }
    if (currentTerminal) { currentTerminal.term.dispose(); currentTerminal = null; }
    currentSessionName = '';
}

// Keyboard shortcuts (Escape, Alt+C, Alt+D) merged into unified handler above

// ── Sidebar resize drag ──

(function initSidebarResize() {
    const handle = document.getElementById('sidebar-resize');
    const sidebar = document.querySelector('.sidebar');
    if (!handle || !sidebar) return;
    let dragging = false;

    handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        dragging = true;
        handle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const newWidth = Math.max(120, Math.min(400, e.clientX));
        sidebar.style.width = newWidth + 'px';
    });

    document.addEventListener('pointerup', () => {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });
})();

// ── Terminal panel resize drag ──

(function initResize() {
    const handle = document.getElementById('resize-handle');
    const wrapper = document.querySelector('.content-wrapper');
    const panel = document.getElementById('terminal-panel');
    let dragging = false;

    handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        dragging = true;
        handle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const rect = wrapper.getBoundingClientRect();
        const panelWidth = rect.right - e.clientX;
        const minW = 250;
        const maxW = rect.width * 0.8;
        const clamped = Math.max(minW, Math.min(maxW, panelWidth));
        panel.style.width = clamped + 'px';
        // Refit terminal
        if (currentTerminal) currentTerminal.fitAddon.fit();
    });

    document.addEventListener('pointerup', () => {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        if (currentTerminal) currentTerminal.fitAddon.fit();
    });
})();

// ── Draft bar resize drag ──

(function initDraftResize() {
    let dragging = false;
    let activeHandle = null;

    document.addEventListener('pointerdown', (e) => {
        if (e.target.classList.contains('draft-resize')) {
            e.preventDefault();
            dragging = true;
            activeHandle = e.target;
            activeHandle.classList.add('dragging');
            document.body.style.cursor = 'row-resize';
            document.body.style.userSelect = 'none';
        }
    });

    document.addEventListener('pointermove', (e) => {
        if (!dragging || !activeHandle) return;
        const bar = activeHandle.nextElementSibling; // draft-bar
        const panel = bar.closest('.terminal-panel') || bar.closest('.terminal-container');
        if (!panel) return;
        const panelRect = panel.getBoundingClientRect();
        // Distance from mouse to bottom of panel = draft bar height
        const draftHeight = panelRect.bottom - e.clientY;
        const min = 50;
        const max = panelRect.height - 100; // leave at least 100px for terminal
        const clamped = Math.max(min, Math.min(max, draftHeight));
        bar.style.height = clamped + 'px';
        if (currentTerminal) currentTerminal.fitAddon.fit();
    });

    document.addEventListener('pointerup', () => {
        if (!dragging) return;
        if (activeHandle) activeHandle.classList.remove('dragging');
        dragging = false;
        activeHandle = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        if (currentTerminal) currentTerminal.fitAddon.fit();
    });
})();

// ── Modal drag to move (by title bar h2) ──

(function initModalDrag() {
    let dragging = false;
    let startX, startY, startLeft, startTop;

    document.addEventListener('pointerdown', (e) => {
        const h2 = e.target.closest('.modal h2');
        if (!h2) return;
        const modal = h2.closest('.modal');
        if (!modal) return;
        e.preventDefault();
        dragging = true;
        const rect = modal.getBoundingClientRect();
        // Switch from centered layout to absolute positioning
        if (!modal.style.position || modal.style.position !== 'absolute') {
            modal.style.position = 'absolute';
            modal.style.left = rect.left + 'px';
            modal.style.top = rect.top + 'px';
            modal.style.margin = '0';
        }
        startX = e.clientX;
        startY = e.clientY;
        startLeft = parseInt(modal.style.left);
        startTop = parseInt(modal.style.top);
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const modal = document.getElementById('modal');
        modal.style.left = (startLeft + e.clientX - startX) + 'px';
        modal.style.top = (startTop + e.clientY - startY) + 'px';
    });

    document.addEventListener('pointerup', () => {
        if (!dragging) return;
        dragging = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });
})();

// ── Modal edge resize ──

(function initModalResize() {
    const EDGE = 8; // px from edge to trigger resize
    let resizing = false;
    let resizeDir = null; // 'n','s','e','w','ne','nw','se','sw'
    let startX, startY, startRect;
    let modal = null;

    function getDir(e, rect) {
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const w = rect.width;
        const h = rect.height;
        const top = y < EDGE, bottom = y > h - EDGE;
        const left = x < EDGE, right = x > w - EDGE;
        if (top && left) return 'nw';
        if (top && right) return 'ne';
        if (bottom && left) return 'sw';
        if (bottom && right) return 'se';
        if (top) return 'n';
        if (bottom) return 's';
        if (left) return 'w';
        if (right) return 'e';
        return null;
    }

    const cursors = {n:'ns-resize',s:'ns-resize',e:'ew-resize',w:'ew-resize',ne:'nesw-resize',sw:'nesw-resize',nw:'nwse-resize',se:'nwse-resize'};

    document.addEventListener('pointermove', (e) => {
        if (resizing) {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            let {top, left, width, height} = startRect;
            if (resizeDir.includes('e')) width = Math.max(300, width + dx);
            if (resizeDir.includes('w')) { width = Math.max(300, width - dx); left = left + dx; }
            if (resizeDir.includes('s')) height = Math.max(200, height + dy);
            if (resizeDir.includes('n')) { height = Math.max(200, height - dy); top = top + dy; }
            modal.style.width = width + 'px';
            modal.style.height = height + 'px';
            modal.style.position = 'fixed';
            modal.style.left = left + 'px';
            modal.style.top = top + 'px';
            modal.style.margin = '0';
            return;
        }
        // Update cursor on hover
        const m = document.querySelector('.modal-overlay.active .modal');
        if (!m) return;
        const rect = m.getBoundingClientRect();
        const dir = getDir(e, rect);
        m.style.cursor = dir ? cursors[dir] : '';
    });

    document.addEventListener('pointerdown', (e) => {
        const m = document.querySelector('.modal-overlay.active .modal');
        if (!m) return;
        const rect = m.getBoundingClientRect();
        const dir = getDir(e, rect);
        if (!dir) return;
        e.preventDefault();
        resizing = true;
        resizeDir = dir;
        modal = m;
        startX = e.clientX;
        startY = e.clientY;
        startRect = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
        document.body.style.userSelect = 'none';
        document.body.style.cursor = cursors[dir];
    });

    document.addEventListener('pointerup', () => {
        if (!resizing) return;
        resizing = false;
        resizeDir = null;
        modal = null;
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
    });
})();

// ── Init ──

function startApp() {
    _modalLocked = false;
    document.getElementById('modal-overlay').classList.remove('active');
    // Restore saved state
    const savedProject = localStorage.getItem('tmux-selected-project');
    if (savedProject) selectedProject = savedProject || null;
    if (savedProject === '') selectedProject = null;

    fetchAll().then(() => {
        const savedSession = localStorage.getItem('tmux-open-session');
        const savedMode = localStorage.getItem('tmux-terminal-mode');
        if (savedSession) {
            const exists = sessionsData.some(s => s.name === savedSession);
            if (exists) {
                if (savedMode === 'fullscreen') {
                    openTerminalInMode(savedSession, savedSession, 'fullscreen');
                } else {
                    openTerminal(savedSession, savedSession);
                }
            } else {
                localStorage.removeItem('tmux-open-session');
                localStorage.removeItem('tmux-terminal-mode');
            }
        }
        setTimeout(() => document.body.classList.add('ready'), 50);
    });
}

// Check auth then start
checkAuth().then(authenticated => {
    if (authenticated) startApp();
});

setInterval(() => {
    if (!authToken) return;
    fetchAll();
}, 5000);

// Fetch GitHub star count
fetch('https://api.github.com/repos/linwk20/tmux-kanban')
    .then(r => { if (!r.ok) throw new Error(); return r.json(); })
    .then(d => {
        const n = d.stargazers_count;
        const label = n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : n;
        document.getElementById('github-stars').textContent = label + ' Stars';
    })
    .catch(() => { document.getElementById('github-stars').textContent = '?? Stars'; });
