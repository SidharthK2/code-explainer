# Extension protocol

The extension runs an HTTP + WebSocket server on `127.0.0.1`, one per VS Code window. Each instance writes
`~/.claude-reviewer/endpoints/<sha1 of workspace root>.json` (`{port, token, root, pid}`) plus the global
fallback files `~/.claude-reviewer-port` and `~/.claude-reviewer-token` (last window to activate wins).
`scripts/review.sh` picks the endpoint whose root matches `git rev-parse --show-toplevel` of the current
directory (override with `REVIEW_ROOT=/path`). When no window serves that repo it opens one with the `code` (or
`cursor`) CLI and waits up to 20s for the extension to register; set `REVIEW_NO_OPEN=1` to disable, `REVIEW_EDITOR=cursor`
to prefer Cursor. It never sends to a window serving a different repo. It wraps every call below.
An instance only deletes files that point at itself, and rewrites its own every 15 seconds if they go missing,
so a window reload leaves the new instance reachable.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | `{"status":"ok","workspaceRoot":"/abs/path"}` when the extension is up. Check that the root is the repo you are reviewing |
| GET | `/api/state` | Status, base, current hunk (full object), reviewed count, and a compact list of all hunks with their reviewed / resolved state. This is how the agent knows what "this hunk" means in chat |
| POST | `/api/message` | One agent message (below). `400` with an `error` string when the schema is wrong |

## Agent → extension messages

### `set_review`

```json
{
  "type": "set_review",
  "title": "Rate limiter for the public API",
  "base": "HEAD",
  "summary": "- Adds a token-bucket limiter in front of `/api/*`\n- Risk: bucket size is per process, not shared\n- Tests cover refill but not burst",
  "hunks": [
    {
      "id": 1,
      "file": "/abs/path/src/middleware/rateLimit.ts",
      "start": 12,
      "end": 41,
      "kind": "added",
      "title": "Token bucket middleware",
      "severity": "attention",
      "what": "Every request takes one token; refills at `RATE_PER_SEC`. Returns 429 when empty.",
      "why": "Presumably to protect the public API from bursts; the user asked for 'basic rate limiting'.",
      "check": "Confirm a 429 is acceptable to the mobile client, which retries immediately today."
    }
  ]
}
```

- `base` (optional) is the git ref or sha the working tree is compared against, default `HEAD`. It is used for the left side of the diff editor. Pass the merge-base sha when reviewing a branch against `main`.
- `file` may be workspace-relative; the extension resolves it against the first workspace folder.
- `start` / `end` are 1-based lines on the **working-tree** side. For `kind: "deleted"` they point at the line just below the removed code.
- `severity` is one of `info`, `attention`, `risk`. `check` may be an empty string.
- Ids must be unique. Hunks are shown in array order.

### Navigation and edits

| Message | Fields | Effect |
|---------|--------|--------|
| `goto` | `hunkId` | Opens that hunk's diff and expands its thread |
| `update_hunk` | `id`, `hunk` (partial) | Patches fields, moves the thread if the range changed. Use after a fix shifts lines |
| `remove_hunks` | `ids` | Deletes threads and list entries |
| `resolve` | `hunkId`, `text?` | Marks the thread resolved and the hunk fixed, showing `text` (one line, default "Fixed.") under the reviewer note |
| `close` | | Ends the review, removes threads and decorations |

## Extension → agent

There are no user actions. Threads are read-only; the user talks to the agent in chat, and the agent reads `/api/state` to know which hunk they mean.

### `state` (WebSocket broadcast and `/api/state`)

```json
{ "type": "state", "status": "active", "currentHunk": 3, "totalHunks": 9, "reviewedCount": 2 }
```

`status` is `idle`, `active`, or `closed`.

## Reviewer-side behaviour worth knowing

- **Next** (`Ctrl+Shift+]`, sidebar button) marks the current hunk reviewed before moving on. **Prev**, clicking in the list, and `goto` do not.
- The checkbox in the sidebar list and the check icon on a thread toggle reviewed by hand. Threads have no reply box.
- The diff editor's right side is the real file, so the user can edit while reviewing. Threads follow edits within an open document; ranges in `/api/state` are the ones you sent, not live positions.
