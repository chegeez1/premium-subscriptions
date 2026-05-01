#!/usr/bin/env bash
# Installs project git hooks from scripts/hooks/ into .git/hooks/.
# Run once after cloning: bash scripts/install-hooks.sh

set -euo pipefail

HOOKS_SRC="$(cd "$(dirname "$0")/hooks" && pwd)"
HOOKS_DST="$(git rev-parse --git-dir)/hooks"

echo "Installing git hooks from $HOOKS_SRC → $HOOKS_DST"

for hook in "$HOOKS_SRC"/*; do
  name="$(basename "$hook")"
  dest="$HOOKS_DST/$name"
  cp "$hook" "$dest"
  chmod +x "$dest"
  echo "  ✓ $name"
done

echo ""
echo "Done. Hooks will run automatically on each git operation."
echo ""
echo "Next: add your GitHub remote if you haven't already:"
echo "  git remote add github https://github.com/OWNER/REPO.git"
echo "  (replace OWNER/REPO with your real repository path)"
