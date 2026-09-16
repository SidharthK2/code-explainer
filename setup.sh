#!/bin/bash
set -e

# ============================================================================
# Code Review — Setup Script
# ============================================================================
# Builds and installs the VS Code / Cursor extension used by the /review skill.
#
# Usage: ./setup.sh
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$SCRIPT_DIR/vscode-extension"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

step=0
total_steps=4

header() {
    echo ""
    step=$((step + 1))
    echo -e "${BLUE}[$step/$total_steps]${NC} ${BOLD}$1${NC}"
}

ok() { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║   Code Review — Setup                        ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════╝${NC}"

# ── Step 1: Prerequisites ───────────────────────────────────────────────────
header "Checking prerequisites"

EDITORS=()
if command -v code &>/dev/null; then
    EDITORS+=("code")
    ok "VS Code CLI found: $(code --version | head -1)"
fi
if command -v cursor &>/dev/null; then
    EDITORS+=("cursor")
    ok "Cursor CLI found"
fi
if [[ ${#EDITORS[@]} -eq 0 ]]; then
    fail "No editor CLI found. Install VS Code ('code') or Cursor ('cursor') and enable the CLI: Cmd+Shift+P → 'Shell Command: Install ...'"
fi

command -v git &>/dev/null && ok "git found: $(git --version)" || fail "git not found"
command -v node &>/dev/null && ok "Node.js found: $(node --version)" || fail "Node.js not found. Install via: brew install node"
command -v npm &>/dev/null && ok "npm found: $(npm --version)" || fail "npm not found. Install via: brew install node"
command -v jq &>/dev/null && ok "jq found" || warn "jq not found — the skill uses it to validate review JSON. Install via: brew install jq"
command -v python3 &>/dev/null && ok "python3 found (used by review.sh to JSON-encode replies)" || warn "python3 not found — review.sh reply/resolve need it"

# ── Step 2: Configure reviewer model ────────────────────────────────────────
header "Configure reviewer model"

SKILL_FILE="$SCRIPT_DIR/SKILL.md"
CURRENT_REVIEWER=$(sed -nE 's/^\| `REVIEWER` \| `([^`]+)`.*/\1/p' "$SKILL_FILE" | head -1)
CURRENT_REVIEWER="${CURRENT_REVIEWER:-opus}"

echo ""
echo -e "  ${BOLD}REVIEWER${NC} — independent reviewer sub-agent : ${BLUE}$CURRENT_REVIEWER${NC}"
echo -e "  Use any model name your agent supports."
echo -ne "  ${BOLD}Keep this default?${NC} [Y/n] "
read -r KEEP_MODEL </dev/tty

if [[ "$KEEP_MODEL" =~ ^[Nn] ]]; then
    echo -ne "  REVIEWER [$CURRENT_REVIEWER]: "
    read -r NEW_REVIEWER </dev/tty
    NEW_REVIEWER="${NEW_REVIEWER:-$CURRENT_REVIEWER}"
    NEW_REVIEWER=$(echo "$NEW_REVIEWER" | tr -d '`|\n' | xargs)
    sed -i.bak -E "s/^(\| \`REVIEWER\` \| )\`[^\`]+\`/\1\`$NEW_REVIEWER\`/" "$SKILL_FILE" && rm -f "$SKILL_FILE.bak"
    ok "REVIEWER → $NEW_REVIEWER (saved to SKILL.md)"
else
    ok "Using $CURRENT_REVIEWER"
fi

# ── Step 3: Build and install the extension ─────────────────────────────────
header "Building and installing extension"

cd "$EXT_DIR"
npm install --silent 2>&1 | tail -1
ok "npm dependencies installed"

npm run compile --silent -- --minify 2>&1 | tail -1
ok "Extension bundled"

npx @vscode/vsce package --no-dependencies --allow-star-activation --allow-missing-repository 2>&1 | grep -E "^( DONE|VSIX)" | head -1
VSIX_FILE=$(ls -t "$EXT_DIR"/*.vsix 2>/dev/null | head -1)
[[ -z "$VSIX_FILE" ]] && fail "VSIX packaging failed — no .vsix file found"
ok "VSIX packaged: $(basename "$VSIX_FILE")"

for EDITOR_CLI in "${EDITORS[@]}"; do
    "$EDITOR_CLI" --install-extension "$VSIX_FILE" --force 2>&1 | grep -v "^$"
    ok "Extension installed in $EDITOR_CLI"
done
cd "$SCRIPT_DIR"

# ── Step 4: Scripts ─────────────────────────────────────────────────────────
header "Setting up scripts"
chmod +x "$SCRIPT_DIR/scripts/review.sh" "$SCRIPT_DIR/scripts/reinstall-extension.sh" "$SCRIPT_DIR/setup.sh"
ok "Scripts marked executable"

# ── Done ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║   Setup complete!                            ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Skill installed at:${NC} $SCRIPT_DIR"
echo ""
echo -e "  ${BOLD}Next steps:${NC}"
echo -e "  1. Reload your editor: ${BLUE}Cmd+Shift+P → 'Developer: Reload Window'${NC}"
if [[ "$SCRIPT_DIR" == *"/skills/review"* ]]; then
    echo -e "  2. After your agent edits code, run: ${BLUE}/review${NC}"
else
    echo -e "  2. Put the skill where your agent looks for it, e.g."
    echo -e "     ${BOLD}Claude Code:${NC}  ${BLUE}cp -r $SCRIPT_DIR ~/.claude/skills/review${NC}"
    echo -e "     ${BOLD}Codex CLI:${NC}    ${BLUE}cp -r $SCRIPT_DIR ~/.codex/skills/review${NC}"
    echo -e "     ${BOLD}OpenCode:${NC}     ${BLUE}cp -r $SCRIPT_DIR ~/.config/opencode/skills/review${NC}"
    echo -e "     ${BOLD}Amp:${NC}          ${BLUE}cp -r $SCRIPT_DIR ~/.config/agents/skills/review${NC}"
    echo -e "  3. After your agent edits code, run: ${BLUE}/review${NC}"
fi
echo ""
echo -e "  ${BOLD}In the diff:${NC} Ctrl+Shift+] next hunk · Ctrl+Shift+[ previous · type in a thread and press Ask agent or Flag for fix"
echo ""
