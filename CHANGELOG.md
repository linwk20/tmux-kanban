# Changelog

## [0.1.0] — Initial Release

### Core Features
- Kanban board (Todo / Running / Review / Done) with drag-and-drop between columns
- Native tmux terminal in browser via xterm.js + WebSocket PTY bridge
- Real-time activity detection (working / idle / stopped) based on pane output changes
- Project grouping with color labels and sidebar navigation
- Git worktree management: create isolated worktrees per session, auto-cleanup with dirty-state protection
- Session persistence across reboots with click-to-restart

### Agent Support
- One-click launch for Claude Code, Codex, Gemini, or plain tmux
- One-click resume with agent-specific commands
- Per-session description and sort order

### Security
- Password authentication set via terminal command (only server owner can initialize)
- Bearer token sessions with auto-rotation (max 10 active)
- Path sandboxing for file operations
- Config file permissions locked to owner (chmod 600)

### Performance
- Persistent tmux control mode connection (no fork-per-command overhead)
- Background activity poller (5s interval)
- In-memory config cache with write-through
- Incremental DOM diff for kanban rendering (no full re-render per poll)
- FLIP animations for smooth card transitions

### UX
- Drag sessions between kanban columns or to sidebar projects
- Drag projects to reorder in sidebar
- Per-session draft bar with command history (max 30 per session)
- Auto-reconnect WebSocket with 30s heartbeat
- Terminal in side panel or fullscreen mode
- Copy via Alt+C (works through VSCode Remote / SSH port forwarding)
- Dark and light themes

### Mobile
- Responsive layout: collapses to single column on small screens
- Touch support via pointer events (works with finger drag on phones/tablets/touch laptops)
- Bigger hit targets on coarse pointer devices

### Deployment
- `tmux-kanban-install-systemd` for systemd --user service setup
- `--config` and `--worktree-path` CLI flags for custom paths
- SSH tunnel instructions printed on startup for remote servers
- Update button: `git pull` for checkouts, `pip install git+...` for pip-installed
