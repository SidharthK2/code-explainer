---
name: review
description: "Use when the user asks to review changes, check the diff, or look over what was just written — e.g. 'review this', 'review my changes', 'what did you change', 'check the diff before I commit'. Opens a side-by-side diff in VS Code with per-hunk reviewer notes."
---

# Code Review

Independent review of the working tree against a base (default `HEAD`), delivered as GitHub-style comment threads inside VS Code's side-by-side diff editor. The user reads; nothing is narrated. Questions and fix requests come back to you through the extension.

**Base ref.** `/review` alone compares against `HEAD` (uncommitted work). If the user names a branch, tag, or sha (`/review main`, "compare with origin/main", "review the whole branch"), compare against the merge-base with that ref so the whole branch is reviewed:
```bash
git fetch -q origin <ref> 2>/dev/null; BASE=$(git merge-base HEAD <ref>)   # falls back to <ref> itself if merge-base fails
```
Use `$BASE` everywhere the steps below say `HEAD`, and put it in the `base` field of `set_review` so the diff editor's left side shows that commit.

## Models

| Tier | Default | Role |
|------|---------|------|
| `REVIEWER` | `opus` | Independent reviewer sub-agent — reads the diff, writes the notes |

Resolve the tier to the model name in this table when dispatching.

## Checklist

1. **Health check (Bash):** run from inside the repo: `~/.claude/skills/review/scripts/review.sh health` — prints `{"status":"ok","workspaceRoot":"..."}` when the extension is running. The script targets the VS Code window whose workspace is this repo; if `workspaceRoot` is a different directory, set `REVIEW_ROOT=<repo root>` or ask the user to open the repo in VS Code. If the check fails, use the terminal fallback in step 5.

2. **Collect the diff (Bash):**
   ```bash
   git -C "$(git rev-parse --show-toplevel)" diff HEAD --stat
   git diff HEAD --unified=3
   git ls-files --others --exclude-standard          # untracked files count as additions
   ```
   For each untracked file, include `git diff --no-index --unified=3 /dev/null <file>` so the reviewer sees its content. Skip untracked files that are clearly not part of the change (editor scratch, notes, lockfiles the user did not touch) and say so in one line at the end. If everything is empty, tell the user there is nothing to review and stop.

3. **Dispatch the reviewer:** read `docs/reviewer.md` and dispatch **one** `REVIEWER` sub-agent with that prompt, the diff text, and the repo root. Create `TMPDIR=$(mktemp -d)` and have the agent write `$TMPDIR/review.json`. The reviewer is independent: do not pass it your own reasoning about the change, only the diff and the user's original request if they gave one.

4. **Validate and send:**
   ```bash
   jq -e '.type == "set_review" and (.hunks | length) > 0 and ([.hunks[].id] | unique | length) == (.hunks | length)' "$TMPDIR/review.json"
   ~/.claude/skills/review/scripts/review.sh review "$TMPDIR/review.json"
   ```
   A non-zero exit or an `{"error": ...}` body means the schema is wrong: see `docs/protocol.md`, fix, resend. `"Code Review extension not running"` means the VS Code window went away or reloaded: wait 20 seconds and retry once (the extension re-registers itself), then fall back to step 5. Then tell the user, in one line: the review is open in the sidebar, `Ctrl+Shift+]` steps to the next hunk. Do **not** repeat the notes in the terminal.

5. **Terminal fallback (extension unavailable only):** print the summary, then each hunk as `### <file>:<start>-<end> — <title> [<severity>]` followed by what / why / check. Stop; there is no action loop.

6. **Action loop:** repeat `review.sh wait-action 120` until you receive `finish` or the user tells you to stop. `{}` means timeout: poll again. Handle each action:

   | `action` | What to do |
   |----------|------------|
   | `ask_question` | Read the hunk's code (`file`, `start`, `end` are in the action). Answer with `review.sh reply <hunkId> "<markdown>"`. The answer belongs in the thread, not the terminal. Ground it in the lines, not in concepts. |
   | `flag` | Make the requested fix. Re-run `git diff HEAD -- <file>` to find the hunk's new line range and send `update_hunk` if it moved. Then `review.sh resolve <hunkId> "<one or two sentences on what you changed>"`. If you disagree with the flag, reply with your reasoning instead of resolving. |
   | `finish` | Leave the loop. In the terminal: list hunks that were flagged and how each was resolved, anything still open, and the residual risks from the summary. Two to eight lines. |

   While in the loop, if the user types in chat instead of the diff, answer them normally and go back to polling.

## Rules

| Rule | Why |
|------|-----|
| Line numbers are working-tree lines | The threads anchor on the modified side of the diff. Use the `+c,d` side of `@@ -a,b +c,d @@`. |
| One thread per logical change, not per git hunk | Merge adjacent hunks that make one change; split a git hunk that mixes two changes. |
| Order hunks as a story | Entry point or public surface first, then the code it calls, tests and config last. The reviewer decides; the extension follows. |
| No terminal narration when the extension is up | The user chose to read in the diff. Terminal output is for the one-line "review is open" and the finish summary. |
| Answers go in the thread | `reply` for questions, `resolve` for fixes. |
| `resolve` only after the fix is applied and the diff re-checked | Threads say "fixed" to the user; make it true. |
| Reviewer gets the diff, not your intent | Independence is the point. If the user stated what they asked for, pass that; never pass your own explanation of the change. |

**First-time setup?** Read `docs/setup.md`.
