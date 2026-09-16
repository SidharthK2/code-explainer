# Code Review

VS Code / Cursor extension used by the `/review` coding-agent skill. It opens the working tree against `HEAD` in the side-by-side diff editor and attaches one GitHub-style comment thread per hunk with the reviewer's note: what changed, why, what to check.

- Step through hunks with `Ctrl+Shift+]` / `Ctrl+Shift+[`
- Type in a thread and press **Ask agent** or **Flag for fix**; the agent replies in the thread
- Sidebar shows the change-set summary, progress, and a per-file hunk list

The extension runs a localhost HTTP + WebSocket server with a bearer token. Port and token are written to `~/.claude-reviewer-port` and `~/.claude-reviewer-token`. See the repository's `docs/protocol.md` for the message schema.

Install through the repository's `setup.sh`; this extension is not useful on its own.
