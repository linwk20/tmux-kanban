"""Install tmux-kanban as a systemd --user service."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


def _systemd_quote(value: str) -> str:
    if not value:
        return '""'
    if any(ch.isspace() or ch in {'"', "\\"} for ch in value):
        escaped = value.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return value


def _build_exec_args(args: argparse.Namespace) -> list[str]:
    command = [sys.executable, "-m", "tmux_kanban"]
    if args.public:
        command.append("--public")
    else:
        command.extend(["--host", args.host])
    command.extend(["--port", str(args.port)])
    if args.config:
        command.extend(["--config", os.path.expanduser(args.config)])
    if args.worktree_path:
        command.extend(["--worktree-path", os.path.expanduser(args.worktree_path)])
    return command


def build_unit(args: argparse.Namespace) -> str:
    exec_start = " ".join(_systemd_quote(part) for part in _build_exec_args(args))
    return "\n".join(
        [
            "[Unit]",
            "Description=tmux-kanban web app",
            "After=default.target",
            "",
            "[Service]",
            "Type=simple",
            "WorkingDirectory=%h",
            "Environment=TERM=xterm-256color",
            "Environment=COLORTERM=truecolor",
            f"ExecStart={exec_start}",
            "Restart=always",
            "RestartSec=3",
            "",
            "[Install]",
            "WantedBy=default.target",
            "",
        ]
    )


def _write_unit(unit_path: Path, content: str) -> None:
    unit_path.parent.mkdir(parents=True, exist_ok=True)
    unit_path.write_text(content, encoding="utf-8")


def _reload_systemd() -> None:
    subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)


def _enable_now(service_name: str) -> None:
    subprocess.run(["systemctl", "--user", "enable", "--now", f"{service_name}.service"], check=True)


def _linger_enabled() -> bool | None:
    try:
        result = subprocess.run(
            ["loginctl", "show-user", os.environ.get("USER", ""), "-p", "Linger", "--value"],
            capture_output=True,
            text=True,
            check=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None
    return result.stdout.strip().lower() == "yes"


def _ensure_linger() -> str:
    user = os.environ.get("USER", "your-user")
    linger = _linger_enabled()
    if linger is True:
        return f"Linger already enabled for {user}"
    if linger is None:
        return "Could not determine linger status; check with: loginctl show-user \"$USER\" -p Linger"

    try:
        subprocess.run(["loginctl", "enable-linger", user], check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        return f"Could not enable linger automatically; run: loginctl enable-linger {user}"

    linger = _linger_enabled()
    if linger is True:
        return f"Enabled linger for {user}"
    return f"Tried to enable linger for {user}, but could not confirm it; check with: loginctl show-user {user} -p Linger"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="tmux-kanban-install-systemd",
        description="Install tmux-kanban as a systemd --user service",
    )
    parser.add_argument("--service-name", default="tmux-kanban", help="systemd service name (default: tmux-kanban)")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind when not using --public")
    parser.add_argument("--port", "-p", type=int, default=59235, help="Port to listen on (default: 59235)")
    parser.add_argument("--public", action="store_true", help="Bind to 0.0.0.0 instead of a loopback host")
    parser.add_argument("--config", default=None, help="Custom config file path")
    parser.add_argument("--worktree-path", default=None, help="Custom worktree folder")
    parser.add_argument("--write-only", action="store_true", help="Write the unit file but do not enable/start it")
    parser.add_argument("--dry-run", action="store_true", help="Print the generated unit and exit")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    unit_path = Path.home() / ".config/systemd/user" / f"{args.service_name}.service"
    unit_content = build_unit(args)

    if args.dry_run:
        print(f"# {unit_path}")
        print(unit_content, end="")
        return

    _write_unit(unit_path, unit_content)

    if args.write_only:
        print(f"Wrote {unit_path}")
        print(f"Next: systemctl --user daemon-reload && systemctl --user enable --now {args.service_name}.service")
        return

    _reload_systemd()
    _enable_now(args.service_name)

    print(f"Installed and started {args.service_name}.service")
    print(f"Unit: {unit_path}")
    print(f"Status: systemctl --user status {args.service_name}.service")
    print(f"Logs: journalctl --user -u {args.service_name}.service -f")
    print(_ensure_linger())


if __name__ == "__main__":
    main()
