<div align="center">

**English** | [中文](README.zh-CN.md)

<img src="assets/logo.png" width="200" alt="tmux-kanban logo">

# tmux-kanban

**An AI-native kanban board for tmux.**

Manage your terminal sessions — AI agents, dev servers, build scripts, anything — from a drag-and-drop web dashboard with native tmux terminals.

[![Python 3.10+](https://img.shields.io/badge/python-3.10%2B-blue?style=flat-square)](https://python.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![tmux](https://img.shields.io/badge/tmux-3.2%2B-orange?style=flat-square)](https://github.com/tmux/tmux)

[Why tmux-kanban?](#-why-tmux-kanban) &bull; [Key Features](#-key-features) &bull; [Quick Start](#-quick-start) &bull; [Roadmap](TODO.md)

<br>

<img src="assets/demo.gif" alt="tmux-kanban demo" width="900">

</div>

---

> **⚠️ Beta.** This is a vibe-coded project. It has been dogfooded for two weeks without issues, but bugs are still possible — please file an issue if you hit one.

## 🤔 Why tmux-kanban?

Managing AI agents is hard — especially when you want to run multiple terminal agents in parallel. Existing kanban tools try to help, but they have real problems:

- **Not native tmux** — emulated terminals are unstable at runtime and lose many of the features of terminal agents.
- **Heavy and laggy** — they bundle a lot of unrelated functionality, which causes two pain points: poor performance, and customization via vibe-coding becomes extremely hard (thousands of files, build pipelines, framework lock-in).
- **No security by default** — on a shared server, anyone can hit the dashboard and control your agents.

I realized that rather than filing issues and waiting for updates that may never come, it's a better idea to just vibe-code the kanban we actually want. 

So I vibe-coded this — a native-tmux, lightweight, and simple web tmux kanban that was designed to address those pain points. 
**You genuinely own this code**: you can vibe-code whatever feature you want on top of it. 

For example, one of the more serious issues with existing dashboards is security — they assume you're running locally and ship with no password protection at all. 
In this version, I simply vibe-coded security in (see [Key Features](#-key-features)).


---

## ✨ Key Features

### 1. Native Tmux — Agents Never Disconnect

**Agents Never Disconnect.** Every session is a real `tmux attach-session`. Your agents run in persistent tmux sessions.


**All terminal features supported.** We fully support all the useful terminal features offered by tools like Claude Code, Codex, or Tmux.

### 2. Minimalist — Read It, Hack It, Own It

The entire app is vanilla JS + FastAPI. 
Your agent can read the whole codebase, add a feature in minutes, or restyle the UI easily. 
No webpack, no React, no Docker — just `pip install` and go.

### 3. Access from Anywhere

**It's a web app.** Set up port forwarding (SSH, VSCode Remote, Cloudflare Tunnel, frpc, ngrok — whatever you prefer) and manage your agents from your phone, laptop, or any device with a browser. 
No special client, no VPN, no desktop app required.

### 4. Secure by Default

Existing kanban dashboards bind to `localhost:PORT` with zero authentication. On a shared server, **any user can access your dashboard and control your agents**.

tmux-kanban has password authentication built in from day one:
- Password set via terminal command (only the server owner can initialize)
- Bearer token auth on every API endpoint and WebSocket connection
- Config files and worktrees live under `~/.tmux-kanban/` with `chmod 600`
- So other users on the same machine can't read your config or access your dashboard

### 5. First-class agent, session & worktree workflow

Built-in support for the popular terminal agents — **Claude Code**, **Codex**, and **Gemini** — one click to launch, one click to resume.

Built-in git **worktree** support, so you can run multiple agents in parallel on the same repo without them stepping on each other.

### Point your own agent at this repo to learn more.


---

## 🚀 Quick Start

### Prerequisites

- Python 3.10+
- tmux 3.2+
- A modern browser

### Install

```bash
pip install tmux-kanban
```

Or install the latest from git:

```bash
pip install git+https://github.com/linwk20/tmux-kanban.git
```

### Recommended tmux config

We provide a [`tmux.conf.recommended`](tmux.conf.recommended) with mouse support, copy-on-select, scroll-enters-copy-mode, pane navigation (Prefix + ijkl), and a clean status bar. To use it:

```bash
cp tmux.conf.recommended ~/.tmux.conf
tmux source-file ~/.tmux.conf
```

### Run

```bash
tmux-kanban
```

Open **http://localhost:59235**. On first visit, you'll set a password via a terminal command (only the server owner can do this).

### Advanced

Running on a remote/shared server, or behind a reverse proxy? See **[Advanced Use Cases](docs/advanced.md)** for CLI options, systemd user-service install, SSH tunneling, and public-IP deployment.

---

## 📋 Roadmap

Planned features (see **[TODO.md](TODO.md)** for details):

- **Tmux Bridge** — cross-agent messaging across tmux sessions
- **Team Mode** — multi-agent coordination and division of labor
- **Agent Skill** — a skill for driving tmux-kanban itself from your coding agent
- and more

## License

MIT
