# TODO

Ideas and features planned for future releases.

## Roadmap

### 1. Tmux Bridge — agents talking to each other

Today, every tmux session is isolated. We plan to ship a **Tmux Bridge skill** that lets different agents inside tmux-kanban send and receive messages across sessions — one Claude Code agent can ask a Codex agent for help, peek at another session's output, or hand off work to a teammate — all through tmux's native IPC.

### 2. Team Mode — reduce human orchestration overhead

Managing agents one by one doesn't scale. Team Mode will turn the kanban into an actual team coordinator:

1. **Team building** — define a team of N agents (roles, system prompts, launch commands, worktrees) and spin them up with a single click.
2. **Built-in collaboration & division of labor** — agents on the same team discover each other, split a task, and hand off intermediate results without you having to copy-paste between panes.

The goal is to cut down on the human overhead of babysitting the board.

### 3. Agent Skill — drive tmux-kanban from inside your coding agent

Ship a dedicated **agent skill** (Claude Code / Codex / Gemini) that lets an agent drive tmux-kanban itself — create/delete sessions, move cards between columns, spawn worktrees, and wire up a Team Mode team — all from inside your coding agent. The kanban becomes not just a UI for humans, but an API surface your agent can automate.

### Other planned items

- **Public Access Tutorial** — step-by-step guide for exposing your dashboard via public IP, Cloudflare Tunnel, or ngrok — for access from any device without SSH.
- **PyPI Release** — publish to PyPI so users can `pip install tmux-kanban` instead of installing from git.

## Nice to Have

- **Performance tuning** — profile and optimize the hot paths so the board stays snappy as sessions, projects, and worktrees grow.
- **Database-backed storage** — today everything lives in a single JSON config. Migrating to a real database (SQLite at first, Postgres for multi-user deployments) would unlock scaling to larger teams and heavier workloads.

## Known Issues

- **Cards briefly go gray under heavy output.** When an agent (e.g. Claude Code) writes a lot to its pane, the shared tmux control-mode channel gets saturated, and the next `list-sessions` probe can time out and return empty. All cards flash "stopped" (gray) for one poll cycle until the next probe succeeds. Cosmetic only — sessions are fine. Fix options: cache the last-known live set and only mark stopped after N consecutive empty polls, or use a dedicated subprocess for liveness probing.
