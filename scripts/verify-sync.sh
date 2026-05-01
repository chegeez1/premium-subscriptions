#!/usr/bin/env bash
# Quick check that GitHub auto-sync is properly configured.
# Run at any time: bash scripts/verify-sync.sh

set -euo pipefail

OK=true

echo "=== GitHub Auto-Sync Health Check ==="
echo ""

# 1. Check for "github" remote
if git remote get-url github &>/dev/null; then
  URL="$(git remote get-url github)"
  echo "✅ Remote 'github' is set → $URL"
else
  echo "❌ Remote 'github' is NOT configured."
  echo "   Fix: git remote add github https://github.com/OWNER/REPO.git"
  OK=false
fi

# 2. Check hook is installed
HOOK=".git/hooks/post-commit"
if [[ -x "$HOOK" ]]; then
  echo "✅ post-commit hook is installed and executable"
else
  echo "❌ post-commit hook is missing or not executable."
  echo "   Fix: bash scripts/install-hooks.sh"
  OK=false
fi

# 3. Check hook content matches the repo copy
SRC="scripts/hooks/post-commit"
if [[ -f "$SRC" ]] && diff -q "$SRC" "$HOOK" &>/dev/null; then
  echo "✅ Hook is up to date (matches scripts/hooks/post-commit)"
elif [[ ! -f "$HOOK" ]]; then
  : # already reported above
else
  echo "⚠️  Hook exists but differs from scripts/hooks/post-commit."
  echo "   Fix: bash scripts/install-hooks.sh"
fi

echo ""
if $OK; then
  echo "✅ All checks passed — auto-sync is active."
  echo "   Every future commit will be pushed to the 'github' remote automatically."
else
  echo "❌ One or more checks failed — follow the instructions above to complete setup."
  exit 1
fi
