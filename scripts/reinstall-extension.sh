#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$SCRIPT_DIR/../vscode-extension"

cd "$EXT_DIR"

echo "Building extension..."
npm run compile -- --minify

echo "Packaging extension..."
npx @vscode/vsce package --no-dependencies --allow-star-activation --allow-missing-repository

VSIX=$(ls -t *.vsix | head -1)

for EDITOR_CLI in code cursor; do
    if command -v "$EDITOR_CLI" &>/dev/null; then
        echo "Installing $VSIX in $EDITOR_CLI..."
        "$EDITOR_CLI" --install-extension "$VSIX" --force
    fi
done

echo "Done. Reload your editor to pick up changes."
