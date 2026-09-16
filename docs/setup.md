# Setup (one-time)

Run the setup script:

```bash
~/.claude/skills/review/setup.sh
```

It will:
1. Check prerequisites (git, Node.js, VS Code or Cursor CLI; warns if `jq` or `python3` are missing)
2. Ask which model the `REVIEWER` sub-agent should use (default in `SKILL.md`)
3. Build the `code-reviewer` extension and install it into every detected editor
4. Mark the helper scripts executable

Then reload the editor: `Cmd+Shift+P` → "Developer: Reload Window". On activation the extension writes a per-workspace endpoint file under `~/.claude-reviewer/endpoints/` and the global fallbacks `~/.claude-reviewer-port` and `~/.claude-reviewer-token`; `scripts/review.sh health` run inside the repo confirms the right window is up.

**Requirements:** git, Node.js 18+, VS Code or Cursor with the CLI command enabled. No Python environment and no model downloads.
