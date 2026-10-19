#!/bin/bash
# Installs dependencies so lint, typecheck, tests and the dev server work in Claude Code cloud sessions.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Web panel: Node packages and the Prisma client (types come from prisma/schema.prisma).
npm install --no-audit --no-fund
npx prisma generate

# Node agent: Go modules.
if command -v go >/dev/null 2>&1; then
  (cd agent && go mod download)
fi

# Python Playwright for the webapp-testing skill (Chromium is preinstalled in cloud sessions).
if ! python3 -c "import playwright" >/dev/null 2>&1; then
  python3 -m pip install --quiet playwright || echo "Could not install Python Playwright; webapp-testing scripts will not run."
fi
