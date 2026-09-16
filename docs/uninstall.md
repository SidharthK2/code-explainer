# Uninstalling Code Review

## 1. Uninstall the extension

```bash
code --uninstall-extension sidharthk2.code-reviewer 2>/dev/null && echo "Removed from VS Code" || echo "Not installed in VS Code"
cursor --uninstall-extension sidharthk2.code-reviewer 2>/dev/null && echo "Removed from Cursor" || echo "Not installed in Cursor"
```

Verify:

```bash
code --list-extensions 2>/dev/null | grep -i code-reviewer || echo "VS Code: clean"
cursor --list-extensions 2>/dev/null | grep -i code-reviewer || echo "Cursor: clean"
```

Reload the editor afterwards: **Cmd+Shift+P** → **Developer: Reload Window**.

## 2. Remove the port and token files

The extension deletes these on deactivation; remove them if it was force-quit.

```bash
rm -rf ~/.claude-reviewer-port ~/.claude-reviewer-token ~/.claude-reviewer
```

## 3. Remove the skill directory

Pick the one matching your agent:

```bash
rm -rf ~/.claude/skills/review            # Claude Code
rm -rf ~/.codex/skills/review             # Codex CLI
rm -rf ~/.config/opencode/skills/review   # OpenCode
rm -rf ~/.config/agents/skills/review     # Amp
```

For rule-based agents (Cursor, Windsurf, Kilo, Roo, Cline) also delete the rule file you created from `SKILL.md`.
