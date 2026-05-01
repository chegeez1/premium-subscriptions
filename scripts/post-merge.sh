#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

# Re-install git hooks so auto-sync stays active after every merge
bash scripts/install-hooks.sh
