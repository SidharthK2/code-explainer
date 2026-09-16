---
name: review
description: "Use when the user asks to review changes, check the diff, or look over what was just written — e.g. 'review this', 'review my changes', 'what did you change', 'check the diff before I commit'. Opens a side-by-side diff in VS Code with per-hunk reviewer notes."
---

# Code Review

Review of the working tree against a base (default `HEAD`), delivered as read-only notes anchored to each hunk inside VS Code's side-by-side diff editor. The user reads there and talks to you here, in chat. Nothing is narrated, and there is no conversation inside the diff.

**Base ref.** `/review` alone compares against `HEAD` (uncommitted work). If the user names a branch, tag, or sha (`/review main`, "compare with origin/main", "review the whole branch"), compare against the merge-base with that ref so the whole branch is reviewed:
```bash
git fetch -q origin <ref> 2>/dev/null; BASE=$(git merge-base HEAD <ref>)   # falls back to <ref> itself if merge-base fails
```
Use `$BASE` everywhere the steps below say `HEAD`, and put it in the `base` field of `set_review` so the diff editor's left side shows that commit.

## Models

| Tier | Default | Role |
|------|---------|------|
| `REVIEWER` | `sonnet` | Sub-agent for large diffs only — reads the diff, writes the notes, runs nothing |

Resolve the tier to the model name in this table when dispatching. Speed matters more than depth here: the user is waiting to read.

## Checklist

1. **Health check (Bash):** run from inside the repo: `~/.claude/skills/review/scripts/review.sh health` — prints `{"status":"ok","workspaceRoot":"..."}` when the extension is running. The script targets the VS Code window whose workspace is this repo, and opens one (`code <repo root>`) if none exists, so the first call can take a few seconds. If `workspaceRoot` is a different directory, set `REVIEW_ROOT=<repo root>`. If the check fails, use the terminal fallback in step 5.

2. **Get the hunks (Bash):** the extension computes them from git, with exact line ranges. Never compute line numbers yourself.
   ```bash
   ~/.claude/skills/review/scripts/review.sh diff            # vs HEAD
   ~/.claude/skills/review/scripts/review.sh diff "$BASE"    # vs a merge-base sha
   ```
   Returns `{ base, repoRoot, hunks: [{ id, file, relPath, kind, start, end, added, removed, patch }], binaryFiles }`. Hunks are in file order, top to bottom, the order a reviewer reads a pull request. `patch` is the unified diff text for that hunk. If `hunks` is empty, tell the user there is nothing to review and stop. If the extension is unreachable, use `git diff <base> --unified=3` plus untracked files and go to step 5.

3. **Write the notes.** Read `docs/reviewer.md`. Create `TMPDIR=$(mktemp -d)`. Pick by total changed lines (sum of `added + removed`):
   - **Under 400 (most reviews):** write `$TMPDIR/review.json` yourself, now, one note per hunk id, following `docs/reviewer.md`. No sub-agent. Do not run formatters, linters, builds, or tests. Read a file outside the diff only when a hunk is unreadable without it, at most three. Target: the review is open within a minute.
   - **400 or more:** dispatch **one** `REVIEWER` sub-agent with the prompt in `docs/reviewer.md` and the `diff` JSON, writing to `$TMPDIR/review.json`. Pass the hunks and the user's original request, not your own reasoning about the change.

   Put hunk ids for files that are clearly not part of the change (editor scratch, personal notes, lockfiles the user did not touch, skill files) in `skip` instead of writing notes for them, and say which you skipped in one line at the end.

4. **Validate and send:**
   ```bash
   jq -e '.type == "set_review" and (.notes | length) > 0' "$TMPDIR/review.json"
   ~/.claude/skills/review/scripts/review.sh review "$TMPDIR/review.json"
   ```
   The extension joins your notes onto its hunks by id. `{"error": "missing notes for hunk ids ..."}` means you left some out: add notes or `skip` them and resend. Other errors: see `docs/protocol.md`. `"Code Review extension not running"` means the VS Code window went away or reloaded: wait 20 seconds and retry once, then fall back to step 5. Then tell the user, in one line: the review is open in VS Code, `Ctrl+Shift+]` steps to the next hunk, ask about any hunk here in chat. Do **not** repeat the notes in the terminal. You are done; return control to the user.

5. **Terminal fallback (extension unavailable only):** print the summary, then each hunk as `### <relPath>:<start>-<end> — <title> [<severity>]` followed by what / why / check.

## During a review: questions and fixes come through chat

There is no polling loop. After step 4 you return control; the user reads in VS Code and types here. When they say something while a review is active (in this session or a new one):

1. `~/.claude/skills/review/scripts/review.sh state` — returns `hunk` (the one they are looking at: `file`, `start`, `end`, `title`, `what`, `why`, `check`) plus the compact list of all hunks. Ranges are working-tree lines; read them with the Read tool's offset and limit. "This", "here", "that check" mean the current hunk. "Hunk 3" or a title means that entry in the list.
2. **Question:** read the lines, answer in chat, grounded in the code. Short. Reference `file:line`.
3. **Fix request** ("fix that", "read it from config instead"): make the change, then `review.sh resolve <id> "<one line: what you changed>"`. If the edit changed line counts above other hunks, their threads follow the edits inside VS Code; do not try to recompute ranges. The thread shows a fixed mark with that line; say the same one line in chat. If you disagree with the request, say why in chat and do not resolve.
4. **"Done" / "looks good" / "close it":** `review.sh close`, then two to six lines in chat: what was fixed, what is still open, residual risks from the summary.

## Rules

| Rule | Why |
|------|-----|
| Never compute line numbers | The extension owns hunk ranges; you own the words. Notes are keyed by hunk id. |
| One note per git hunk, in file order | Reads like a pull request: file by file, top to bottom. If two adjacent hunks are one change, say so in both notes ("continues from the hunk above"). |
| No terminal narration when the extension is up | The user chose to read in the diff. Terminal output is for the one-line "review is open", answers to their questions, and the closing summary. |
| Conversation happens in chat, never in the diff | Threads are read-only notes. Answer questions here; the only thing that goes back into a thread is the one-line fix note via `resolve`. |
| `resolve` only after the fix is applied and the diff re-checked | Threads say "fixed" to the user; make it true. |
| Reviewer gets the diff, not your intent | When a sub-agent is used, pass the diff and the user's request; never your own explanation of the change. |
| Never run the project's tooling to review | Formatters, linters, builds and tests turn a one-minute review into a six-minute one. If formatting looks off, say so in a `check` and let the user run the formatter. |
| Latency is a feature | The user asked to read, and is waiting. A shallower review delivered in a minute beats a thorough one in six. |

**First-time setup?** Read `docs/setup.md`.
