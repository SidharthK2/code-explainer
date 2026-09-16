#!/bin/bash
# Helper for the coding agent to talk to the Code Review VS Code extension.
# Usage:
#   review.sh health                    Exit 0 if the extension is running
#   review.sh review <json_file>        Send a set_review message from a file
#   review.sh send <json_string>        Send a raw JSON message
#   review.sh state                     Current review state (includes current hunk)
#   review.sh wait-action [timeout]     Long-poll for a user action (default 60s). Prints {} on timeout
#   review.sh reply <hunk_id> <text>    Post a comment into a hunk's thread
#   review.sh resolve <hunk_id> [text]  Mark a flagged hunk fixed, optionally with a closing comment
#   review.sh goto <hunk_id>            Move the reviewer to a hunk
#   review.sh close                     Close the review

PORT_FILE="$HOME/.claude-reviewer-port"
TOKEN_FILE="$HOME/.claude-reviewer-token"
ENDPOINTS_DIR="$HOME/.claude-reviewer/endpoints"

# Each VS Code window runs its own extension instance. Prefer the one whose workspace
# is the repo we are in (REVIEW_ROOT overrides); fall back to the global "last window" files.
ROOT="${REVIEW_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
PORT=""
TOKEN=""
if command -v shasum &>/dev/null; then
    KEY=$(printf '%s' "$ROOT" | shasum -a 1 | cut -d' ' -f1)
    EP_FILE="$ENDPOINTS_DIR/$KEY.json"
    if [ -f "$EP_FILE" ]; then
        PORT=$(sed -nE 's/.*"port":([0-9]+).*/\1/p' "$EP_FILE")
        TOKEN=$(sed -nE 's/.*"token":"([0-9a-f]+)".*/\1/p' "$EP_FILE")
        # Stale file from a crashed window: ignore it and fall back.
        if ! curl -sf --max-time 2 -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
            PORT=""; TOKEN=""
        fi
    fi
fi
# No window serves this repo: open one and wait for its extension to register.
# Set REVIEW_NO_OPEN=1 to disable. Never falls back to another repo's window.
if [ -z "$PORT" ] && [ -z "$REVIEW_NO_OPEN" ] && [ -n "${EP_FILE:-}" ]; then
    EDITOR_CLI=""
    for c in ${REVIEW_EDITOR:-code cursor}; do command -v "$c" &>/dev/null && { EDITOR_CLI="$c"; break; }; done
    if [ -n "$EDITOR_CLI" ]; then
        "$EDITOR_CLI" "$ROOT" >/dev/null 2>&1
        for _ in $(seq 1 40); do
            sleep 0.5
            if [ -f "$EP_FILE" ]; then
                PORT=$(sed -nE 's/.*"port":([0-9]+).*/\1/p' "$EP_FILE")
                TOKEN=$(sed -nE 's/.*"token":"([0-9a-f]+)".*/\1/p' "$EP_FILE")
                if curl -sf --max-time 2 -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
                    break
                fi
                PORT=""; TOKEN=""
            fi
        done
    fi
fi
if [ -z "$PORT" ] || [ -z "$TOKEN" ]; then
    echo "{\"error\": \"Code Review extension not running for $ROOT. Open that folder in VS Code (extension installed and window reloaded), or check that the 'code' CLI is on PATH so review.sh can open it for you.\"}" >&2
    exit 1
fi
BASE="http://127.0.0.1:$PORT"
AUTH_HEADER="Authorization: Bearer $TOKEN"

post() {
    curl -s -X POST "$BASE/api/message" \
        -H 'Content-Type: application/json' \
        -H "$AUTH_HEADER" \
        "$@"
}

# JSON-encode a string argument without depending on jq.
json_str() {
    python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"
}

case "$1" in
    health)
        curl -sf -H "$AUTH_HEADER" "$BASE/api/health"
        ;;
    review)
        [ -z "$2" ] && { echo "Usage: review.sh review <json_file>" >&2; exit 1; }
        post -d @"$2"
        ;;
    send)
        [ -z "$2" ] && { echo "Usage: review.sh send '<json>'" >&2; exit 1; }
        post -d "$2"
        ;;
    state)
        curl -s -H "$AUTH_HEADER" "$BASE/api/state"
        ;;
    wait-action)
        TIMEOUT="${2:-60}"
        OUT=$(curl -s -w '\n%{http_code}' --max-time "$((TIMEOUT + 5))" -H "$AUTH_HEADER" "$BASE/api/actions?timeout=$TIMEOUT")
        CODE=$(echo "$OUT" | tail -1)
        BODY=$(echo "$OUT" | sed '$d')
        if [ "$CODE" = "204" ] || [ -z "$BODY" ]; then echo '{}'; else echo "$BODY"; fi
        ;;
    reply)
        [ -z "$2" ] || [ -z "$3" ] && { echo "Usage: review.sh reply <hunk_id> <text>" >&2; exit 1; }
        post -d "{\"type\":\"reply\",\"hunkId\":$2,\"text\":$(json_str "$3")}"
        ;;
    resolve)
        [ -z "$2" ] && { echo "Usage: review.sh resolve <hunk_id> [text]" >&2; exit 1; }
        if [ -n "$3" ]; then
            post -d "{\"type\":\"resolve\",\"hunkId\":$2,\"text\":$(json_str "$3")}"
        else
            post -d "{\"type\":\"resolve\",\"hunkId\":$2}"
        fi
        ;;
    goto)
        [ -z "$2" ] && { echo "Usage: review.sh goto <hunk_id>" >&2; exit 1; }
        post -d "{\"type\":\"goto\",\"hunkId\":$2}"
        ;;
    close)
        post -d '{"type":"close"}'
        ;;
    *)
        sed -n '2,13p' "$0" >&2
        exit 1
        ;;
esac
