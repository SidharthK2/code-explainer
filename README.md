<p align="center">
  <img src="vscode-extension/media/icon.png" width="120" height="120" alt="Code Review icon" />
</p>

<h1 align="center">Code Review</h1>

<p align="center">
  <strong>Review agent-written code the way you review a pull request: side-by-side diff, one comment thread per change, no narration.</strong>
</p>

<p align="center">
  A coding-agent skill plus a VS Code / Cursor extension. After your agent edits code, <code>/review</code> sends the working-tree diff to an independent reviewer sub-agent, then opens each file in VS Code's side-by-side diff editor with a GitHub-style review comment on every hunk: what changed, why, what to check. Ask a question or flag a fix from inside the thread; the agent answers in the thread and resolves it when fixed.
</p>

<p align="center"><em>Forked from <a href="https://github.com/Royal-lobster/code-explainer">Royal-lobster/code-explainer</a>. The walkthrough, TTS and podcast modes were removed in favour of a reading-first review flow.</em></p>

---

## Features

- **Side-by-side diff** — Uses VS Code's native diff editor, `HEAD` on the left and the working tree on the right. New and deleted files included. The right side is the real file, so you can edit while you review. On the first review the extension offers to pin side-by-side rendering, since VS Code otherwise switches to an inline diff in narrow editors.
- **One thread per change** — A GitHub-style comment thread anchored to each hunk with fixed fields: **what changed**, **why**, **check**. Tagged `info`, `attention`, or `risk`.
- **Ordered pass** — The reviewer orders hunks as a story: entry point first, dependencies next, tests and config last. `Ctrl+Shift+]` steps through and marks the hunk reviewed.
- **Ask and flag** — Type in a thread and press **Ask agent** or **Flag for fix**. The answer lands in the thread. A fix gets applied, the thread moves to the new lines and shows as fixed.
- **Independent reviewer** — A fresh sub-agent sees only the diff and your original request, not the writing agent's reasoning.
- **Minimal sidebar** — Change-set summary, progress, and a per-file hunk list with severity dots and reviewed checkboxes. Finish review hands the result back to the agent.

## Requirements

- macOS or Linux with `git`
- Node.js 18+
- VS Code or Cursor with the CLI enabled (`code` or `cursor` command)
- `jq` (the skill validates review JSON with it) and `python3` (for `review.sh reply`)

## Installation

Tell your coding agent:

```
Install the code review skill from https://github.com/SidharthK2/code-explainer
```

<details>
<summary>Manual installation</summary>

### Skill-native agents

| Agent | Install command |
|-------|-----------------|
| **Claude Code** | `git clone https://github.com/SidharthK2/code-explainer.git ~/.claude/skills/review` |
| **Codex CLI** | `git clone https://github.com/SidharthK2/code-explainer.git ~/.codex/skills/review` |
| **OpenCode** | `git clone https://github.com/SidharthK2/code-explainer.git ~/.config/opencode/skills/review` |
| **Amp** | `git clone https://github.com/SidharthK2/code-explainer.git ~/.config/agents/skills/review` |

Then:

```bash
<SKILLS_DIR>/review/setup.sh
# Reload your editor: Cmd+Shift+P → "Developer: Reload Window"
```

### Rule-based agents

Clone anywhere, run `setup.sh`, then point the agent's rules at `SKILL.md` (Cursor `.cursor/rules/review.mdc`, Windsurf global rules, Kilo `~/.kilocode/rules/review.md`, Roo `~/.roo/rules/review.md`, Cline `.clinerules/review.md`). `SKILL.md` references `docs/` and `scripts/` by path, so keep the full repo where you cloned it and adjust the `~/.claude/skills/review/...` paths inside it.

### What setup.sh does

- Checks git, Node.js, editor CLI, `jq`, `python3`
- Lets you pick the `REVIEWER` model (default `opus`)
- Builds the extension and installs the `.vsix` into every detected editor

</details>

## Usage

After your agent has made changes:

```
/review
```

or naturally: "review what you just changed", "check the diff before I commit".

What happens:

1. The agent collects `git diff HEAD` plus untracked files.
2. A fresh `REVIEWER` sub-agent reads the diff and writes ordered hunk notes as JSON.
3. The extension opens the first file's diff, creates a comment thread per hunk, and shows the summary in the sidebar.
4. You step through. Ask or flag from any thread. The agent long-polls for your actions and replies in place.
5. **Finish review** returns control to the agent, which prints a short wrap-up of flagged and fixed items.

If the extension is not running, the agent prints the review as text in the terminal instead.

### In the diff

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+]` | Next hunk (marks current reviewed) |
| `Ctrl+Shift+[` | Previous hunk |
| `Ctrl+Shift+Enter` | Finish review |
| `Ctrl+Shift+\` | Close review |

Thread buttons: **Ask agent**, **Flag for fix**, and a check icon to toggle reviewed. Sidebar: click a hunk to jump, click its checkbox to toggle reviewed, **Finish review** to hand back.

### Reviewer notes

Each thread has the same shape:

| Field | Content |
|-------|---------|
| Title + severity | 3–8 words; `info`, `attention`, or `risk` |
| **What changed** | Behavior, not syntax |
| **Why** | Inferred intent, hedged when it is a guess |
| **Check** | A concrete thing for you to verify, or empty |

## Architecture

```
Coding Agent ──HTTP──▶ Extension Server ──▶ Review state ──▶ Diff editor + comment threads
      ▲                                           │
      └──── long-poll /api/actions ◀── Ask / Flag / Finish ◀── Sidebar webview
```

| Component | File | Role |
|-----------|------|------|
| Skill | `SKILL.md`, `docs/reviewer.md` | Agent checklist and the reviewer sub-agent prompt |
| Helper | `scripts/review.sh` | CLI over the HTTP API: `review`, `wait-action`, `reply`, `resolve`, `goto`, `close` |
| Server | `src/server.ts` | HTTP + WebSocket on localhost with bearer token, schema validation, long-poll actions |
| Review state | `src/review.ts` | Hunks, current position, reviewed / flagged / resolved per hunk |
| Diff | `src/diff.ts` | `HEAD` content provider and `vscode.diff` opening with the hunk revealed |
| Threads | `src/comments.ts` | Comment controller: reviewer note, user questions, agent replies |
| Sidebar | `src/sidebar.ts`, `media/sidebar.*` | Summary, progress, hunk list |

The full message schema is in [`docs/protocol.md`](docs/protocol.md).

## Project structure

```
code-explainer/
├── SKILL.md                     # /review skill instructions
├── setup.sh                     # Build + install the extension
├── scripts/
│   ├── review.sh                # HTTP API helper for the agent
│   └── reinstall-extension.sh   # Quick rebuild
├── docs/
│   ├── reviewer.md              # Reviewer sub-agent prompt
│   ├── protocol.md              # Message schema
│   ├── setup.md
│   └── uninstall.md
└── vscode-extension/
    ├── package.json
    ├── src/
    │   ├── extension.ts         # Wiring: events, commands, agent messages
    │   ├── server.ts            # HTTP + WS server
    │   ├── review.ts            # Review state machine
    │   ├── diff.ts              # Git HEAD provider, open diff
    │   ├── comments.ts          # Comment threads
    │   ├── highlight.ts         # Active-hunk decoration
    │   ├── sidebar.ts           # Webview provider
    │   └── types.ts             # Protocol types
    └── media/
        ├── icon.svg / icon.png
        ├── sidebar.js
        └── sidebar.css
```

## License

MIT
