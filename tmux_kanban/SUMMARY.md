# tmux_kanban

Core Python package — contains the FastAPI server with all business logic, the CLI entry point, and the web frontend static assets.

## Contents

| Path | Description |
|------|-------------|
| `__init__.py` | Package metadata (`__version__`) |
| `__main__.py` | CLI entry point — parses `--host`/`--port` args, launches Uvicorn |
| `server.py` | Core FastAPI application (~2600 lines): REST API, WebSocket terminal, tmux management, git worktree ops, config persistence, activity detection |
| `static/` | Web frontend assets (no build step, served directly) |
| `static/index.html` | Main HTML page — loads xterm.js from CDN, includes app.js and style.css |
| `static/app.js` | Frontend logic (~1335 lines): kanban rendering, session CRUD, project management, terminal (xterm.js + WebSocket + clipboard bridge), path autocomplete, modal system |
| `static/style.css` | Styling (~1048 lines): dark/light themes, kanban layout, terminal panel, modals |

## Interactions

- **`__main__.py` → `server.py`**: Entry point runs `server:app` through Uvicorn
- **`server.py` → tmux**: All session operations (create, kill, rename, send-keys, capture-pane) go through `subprocess.run(["tmux", ...])` via the `run_tmux()` helper
- **`server.py` → filesystem**: Reads/writes `~/.tmux-kanban/config.json` for persistence; manages git worktrees under `~/.tmux-kanban/worktrees/`
- **`server.py` ↔ `app.js`**: REST API (`/api/*`) for CRUD operations; WebSocket (`/ws/terminal/{name}`) for live PTY-bridged terminal sessions
- **`app.js` → `index.html`**: Renders all UI dynamically into container elements defined in the HTML
- **`style.css`**: Two themes (dark default, light) toggled via `[data-theme]` attribute on `<body>`

## Key API Groups in `server.py`

- **Sessions**: `GET/POST /api/sessions`, `PUT /api/sessions/{name}/status`, `POST /api/sessions/{name}/command`
- **Worktrees**: `POST /api/create-session-with-worktree`, `GET/POST/DELETE /api/git/{session}/worktree`
- **Projects**: `POST/PUT/DELETE /api/projects`
- **Terminal**: `WS /ws/terminal/{session_name}` — PTY fork + async I/O queue
- **Utils**: `/api/path-complete`, `/api/browse`, `/api/check-git`, `/api/scan`

---
> **Keep this file in sync.** If you add, remove, rename, or edit any files/folders described here, or if you notice this file is inaccurate, update it in the same commit.

> **VERY IMPORTANT:** Whenever you modify, add, or remove any file in this project, you MUST check whether the corresponding `CLAUDE.md` or `SUMMARY.md` needs to be updated and do so in the same commit. This includes changes to functionality, arguments, interactions, or data flow — not just file renames.
