# tmux-kanban

A minimalist web-based kanban board for tmux sessions. ~4,500 lines, 4 files, no build tools.

## Project Structure

```
tmux_kanban/
  __main__.py       CLI entry: parse args, launch Uvicorn
  install_systemd.py  CLI entry: generate/install systemd --user service
  server.py         FastAPI app: all API, WebSocket, auth, config (~1250 lines)
  static/
    index.html      Page structure (~115 lines)
    app.js          All frontend logic (~2300 lines)
    style.css       Dark/Light theme (~1300 lines)
```

Config: `~/.tmux-kanban/config.json` (chmod 600, directory chmod 700)

## Run

```bash
tmux-kanban                   # http://127.0.0.1:8088
tmux-kanban --public          # 0.0.0.0
tmux-kanban --port 9000
tmux-kanban-install-systemd   # install ~/.config/systemd/user/tmux-kanban.service and enable linger
```

## Architecture

**Backend**: FastAPI + asyncio. All tmux interaction via `subprocess.run` (heavy calls wrapped in `asyncio.to_thread`). Config writes protected by `_config_lock` (asyncio.Lock) with atomic tempfile + `os.replace`.

**Frontend**: Vanilla JS + xterm.js (CDN). No framework, no build step. State in module-level variables + localStorage. Kanban uses incremental DOM diff with FLIP animation. Custom mouse-based drag & drop.

**Terminal bridge**: `WebSocket -> PTY (pty.openpty) -> tmux attach-session`. Event-driven reads via `loop.add_reader()`. Resize via `ioctl TIOCSWINSZ`. SIGCHLD handler reaps zombie processes. `server.py` now defaults `TERM=xterm-256color` / `COLORTERM=truecolor` when missing so tmux works under minimal `systemd --user` environments.

**Activity detection**: Background async task (`_activity_poll_loop`) every 3s. MD5 hash of last 30 lines per pane. 8-second grace period before marking idle.

## Security Model

- **Auth**: Password (SHA256 hash) set via terminal command (not web). Bearer token in localStorage. `AuthMiddleware` on all endpoints. WebSocket validates `?token=`.
- **Path sandbox**: `safe_path()` restricts all file ops to home directory (prefix + separator check). `get_wt_base()` validates worktreePath at point of use.
- **Config safety**: `_config_lock` on ALL write paths. Sensitive fields filtered from `GET /api/config`. Corrupted JSON falls back to defaults.
- **Input validation**: `validate_name()` regex on all names. `esc()` / `escAttr()` for XSS.

## API Endpoints

### Auth (public)
- `GET /api/auth/status` — check if password set
- `POST /api/auth/login` — password -> Bearer token
- `POST /api/auth/setup` — change password (requires auth)

### Sessions
- `GET /api/sessions` — merged view (live tmux + config). Only shows sessions registered in config (use POST /api/scan to discover new live sessions)
- `POST /api/sessions` — create session (name, cwd, command, project, description)
- `DELETE /api/sessions/{name}?force=` — checks worktree before kill, dirty-state protection
- `PUT /api/sessions/{name}/rename` — collision check
- `POST /api/sessions/{name}/start` — restart with saved cwd (validates path)
- `POST /api/sessions/{name}/stop` — kill tmux only
- `POST /api/sessions/{name}/command` — send keys
- `POST /api/sessions/{name}/scroll-bottom` — exit copy-mode
- `PUT /api/session/{name}/status` — kanban column (todo/running/review/finish)
- `PUT /api/session/{name}/info` — description, sortIndex
- `PUT /api/sessions/sort` — batch sortIndex update

### Projects
- `POST /api/projects` — create (name, color, sessions)
- `PUT /api/projects/{name}` — update (validates name, checks duplicates)
- `DELETE /api/projects/{name}`
- `POST /api/projects/{name}/assign-session` — removes from other projects first
- `DELETE /api/projects/{name}/remove-session/{session}`

### Git / Worktrees
- `GET /api/check-git?path=` — repo name, branch, default branch
- `GET /api/check-worktree?repo=&branch=`
- `GET /api/git/{name}/worktrees` — list worktrees
- `POST /api/git/{name}/worktree` — create worktree + session (rollback on failure)
- `DELETE /api/git/{name}/worktree/{branch}?force=` — dirty check
- `POST /api/create-session-with-worktree` — combined endpoint

### Utilities
- `GET /api/config` — config (secrets filtered)
- `PUT /api/settings` — update settings only
- `POST /api/scan` — discover unregistered tmux sessions
- `GET /api/path-complete?q=` — autocomplete (home dir only)
- `GET /api/browse?path=` — directory listing (home dir only)
- `GET /api/tmux-buffer?session=` — paste buffer (fallback: capture-pane)
- `WS /ws/terminal/{name}?token=` — interactive terminal

## Keyboard Shortcuts

| Key | Context | Action |
|-----|---------|--------|
| Alt+C | Terminal open | Copy tmux buffer to clipboard |
| Alt+D | Terminal open | Toggle draft bar |
| Esc | Any | Close modal or terminal |
| Enter | Draft bar | Send text to terminal |
| Shift+Enter | Draft bar | Insert newline |
| Up/Down | Draft bar | Navigate per-session history (max 30) |

## Key Patterns

1. **Config writes**: Always `async with _config_lock:` -> `load_config()` -> modify -> `save_config()`
2. **Path validation**: `safe_path(path)` on any user-provided path before use
3. **Error responses**: `raise HTTPException(status_code, detail=msg)` — never `return {"error": ...}`
4. **Frontend errors**: `apiCheck(res)` checks `res.ok`, throws with detail. All mutations in try/catch.
5. **Worktree cleanup**: Check dirty state before delete. Rollback worktree if tmux creation fails.
6. **Delete order**: Check worktree first, then kill tmux, then update config.
7. **Session registration**: `/api/scan` is the only way to register new live tmux sessions. `get_sessions()` only shows sessions in config.

## Config Structure

```json
{
  "projects": [{"name": "...", "color": 0, "sessions": ["..."]}],
  "sessionStatus": {"name": "running"},
  "sessionInfo": {"name": {"cwd": "~/...", "description": "...", "sortIndex": 0}},
  "settings": {"worktreePath": "~/.tmux-kanban/worktrees"},
  "password_hash": "sha256...",
  "password_plain": "...",
  "auth_tokens": ["..."]
}
```

## Theme

CSS variables in `:root` (dark) and `[data-theme="light"]`. Accent: `#d97757` (dark) / `#c96442` (light). 8 project colors `.sc0`-`.sc7`. Session dots: idle (green), working (yellow), stopped (gray).

---
> **Keep this file in sync.** Update when adding/removing endpoints, features, or architectural changes.
