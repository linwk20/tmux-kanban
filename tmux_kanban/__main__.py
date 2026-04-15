"""CLI entry point: `tmux-kanban` or `python -m tmux_kanban`."""
import argparse
import os
import uvicorn


def _print_access_info(host, port):
    """Print how to access the dashboard, including SSH tunnel command if remote."""
    print(f"\n  tmux-kanban running at http://{host}:{port}")

    ssh_conn = os.environ.get("SSH_CONNECTION", "")
    if ssh_conn:
        # SSH_CONNECTION = "client_ip client_port server_ip server_port"
        parts = ssh_conn.split()
        server_ip = parts[2] if len(parts) >= 3 else "server"
        user = os.environ.get("USER", "user")
        hostname = os.environ.get("HOSTNAME") or os.uname().nodename or server_ip

        print(f"\n  Remote server detected. Run this on your LOCAL machine:")
        print(f"  ssh -L {port}:localhost:{port} <your-ssh-host>")
        print(f"              ^                    ^")
        print(f"         local port           Host in ~/.ssh/config")
        print(f"  Then open http://localhost:{port}  (use localhost, not 127.0.0.1)")
        print(f"  (If local port {port} is taken, change the first number, e.g. -L 9090:localhost:{port})")
    print()


def main():
    parser = argparse.ArgumentParser(
        prog="tmux-kanban",
        description="Web-based tmux session dashboard with kanban board",
    )
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind (default: 127.0.0.1)")
    parser.add_argument("--port", "-p", type=int, default=59235, help="Port to listen on (default: 59235)")
    parser.add_argument("--public", action="store_true", help="Bind to 0.0.0.0 (all interfaces)")
    parser.add_argument("--config", default=None, help="Custom config file path (default: ~/.tmux-kanban/config.json)")
    parser.add_argument("--worktree-path", default=None, help="Custom worktree folder (default: ~/.tmux-kanban/worktrees)")
    args = parser.parse_args()

    if args.config:
        os.environ["TMUX_KANBAN_CONFIG"] = os.path.expanduser(args.config)
    if args.worktree_path:
        os.environ["TMUX_KANBAN_WORKTREE_PATH"] = os.path.expanduser(args.worktree_path)

    host = "0.0.0.0" if args.public else args.host
    _print_access_info(host, args.port)
    uvicorn.run("tmux_kanban.server:app", host=host, port=args.port)


if __name__ == "__main__":
    main()
