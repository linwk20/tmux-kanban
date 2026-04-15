# Advanced Use Cases

Everything below is optional — `tmux-kanban` alone is enough for a single user on `localhost`. These recipes cover production deployment, remote access, and custom configuration.

- [CLI Options](#cli-options)
- [Run as a systemd user service](#run-as-a-systemd-user-service)
- [Remote Access via SSH Tunnel](#remote-access-via-ssh-tunnel)
- [Public IP / Reverse Proxy](#public-ip--reverse-proxy)

---

## CLI Options

```bash
tmux-kanban --port 9000       # Custom port
tmux-kanban --host 0.0.0.0    # Bind to all interfaces
tmux-kanban --config /path/to/config.json         # Custom config location
tmux-kanban --worktree-path /path/to/worktrees    # Custom worktree folder
```

---

## Run as a systemd user service

For remote servers, this is the most reliable way to keep tmux-kanban alive and to make browser terminals work cleanly under `systemd --user`:

```bash
tmux-kanban-install-systemd
```

That writes `~/.config/systemd/user/tmux-kanban.service`, enables it, and starts it with:

- `Restart=always`
- `TERM=xterm-256color`
- `COLORTERM=truecolor`

Common variants:

```bash
tmux-kanban-install-systemd --public
tmux-kanban-install-systemd --port 9000
tmux-kanban-install-systemd --service-name tmux-kanban-web
tmux-kanban-install-systemd --config ~/.tmux-kanban/config.json --worktree-path ~/.tmux-kanban/worktrees
```

Useful commands:

```bash
systemctl --user status tmux-kanban.service
systemctl --user restart tmux-kanban.service
journalctl --user -u tmux-kanban.service -f
```

The installer also attempts to enable linger for the current user and prints whether it was already on or just enabled. If your system blocks that, run:

```bash
loginctl enable-linger "$USER"
```

---

## Remote Access via SSH Tunnel

Running tmux-kanban on a remote server? You need to forward the port to your local machine.

**If you use VS Code Remote** — it auto-forwards ports, no extra setup needed. Just open `http://localhost:59235`.

**If you use a terminal** — run this on your **local machine** (not the server):

```bash
ssh -L 59235:localhost:59235 <your-ssh-host>
#         ^                    ^
#    local port           Host in ~/.ssh/config
```

Then open `http://localhost:59235` in your local browser. If local port 59235 is already taken, change the first number (e.g. `-L 9090:localhost:59235`, then open `http://localhost:9090`).

---

## Public IP / Reverse Proxy

If your server has a public IP address, or you want to use a reverse proxy (Cloudflare Tunnel, ngrok, frpc, etc.), bind to all interfaces with `--host 0.0.0.0` and access it directly.

> A detailed tutorial for this setup is coming soon. In the meantime, because tmux-kanban ships with password + bearer-token auth by default, exposing it publicly is safe as long as you set a strong password on first visit.
