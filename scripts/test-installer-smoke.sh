#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
STATE_ROOT="$(mktemp -d)"
LOG_PATH="$TMP_DIR/pnpm-migrate-installer-smoke.log"

on_error() {
  local status="$?"
  if [ -f "$LOG_PATH" ]; then
    printf '\n--- pnpm-migrate installer smoke log ---\n' >&2
    cat "$LOG_PATH" >&2
    printf '%s\n' '--- end pnpm-migrate installer smoke log ---' >&2
  fi
  rm -rf "$TMP_DIR" "$STATE_ROOT"
  exit "$status"
}

trap on_error ERR
trap 'rm -rf "$TMP_DIR" "$STATE_ROOT"' EXIT

BIN_DIR="$TMP_DIR/bin"
PROJECT="$TMP_DIR/project"
mkdir -p "$BIN_DIR" "$PROJECT/.github/workflows"

cat > "$BIN_DIR/codex" <<'CODEX'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then
  printf 'codex 0.0.0\n'
  exit 0
fi
printf 'unexpected codex invocation: %s\n' "$*" >&2
exit 1
CODEX
chmod +x "$BIN_DIR/codex"

cat > "$PROJECT/package.json" <<'JSON'
{
  "name": "pnpm-migrate-installer-smoke",
  "version": "1.0.0",
  "scripts": {
    "build": "node index.js",
    "ci": "npm run build && npm test",
    "start": "npm run build",
    "test": "node test.js"
  },
  "dependencies": {
    "left-pad": "1.3.0"
  }
}
JSON

cat > "$PROJECT/index.js" <<'JS'
const leftPad = require("left-pad");
module.exports = (value) => leftPad(value, 3, "0");
JS

cat > "$PROJECT/test.js" <<'JS'
const assert = require("node:assert/strict");
const pad = require("./index.js");
assert.equal(pad("7"), "007");
JS

cat > "$PROJECT/README.md" <<'MD'
# installer smoke

```bash
npm install
npm run build
npm test
npx cowsay hello
```
MD

cat > "$PROJECT/.github/workflows/ci.yml" <<'YAML'
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
YAML

cd "$PROJECT"
npm install --package-lock-only --no-audit --no-fund >/dev/null
git init -q
git checkout -b main >/dev/null 2>&1
git add -A
git -c user.name=test -c user.email=test@example.invalid commit -m "Initial npm repo" >/dev/null

before_head="$(git rev-parse HEAD)"
before_status="$(git status --porcelain)"
if [ -n "$before_status" ]; then
  printf 'test repo should start clean\n' >&2
  exit 1
fi

PATH="$BIN_DIR:$PATH" \
PNPM_MIGRATE_AUTO_APPROVE=1 \
PNPM_MIGRATE_SOURCE_DIR="$ROOT" \
PNPM_MIGRATE_STATE_ROOT="$STATE_ROOT" \
PNPM_MIGRATE_TELEMETRY=0 \
bash "$ROOT/install.sh" >"$LOG_PATH" 2>&1

after_head="$(git rev-parse HEAD)"
after_status="$(git status --porcelain)"
if [ "$after_head" != "$before_head" ]; then
  printf 'current checkout HEAD changed\n' >&2
  cat "$LOG_PATH" >&2
  exit 1
fi
if [ -n "$after_status" ]; then
  printf 'current checkout was modified:\n%s\n' "$after_status" >&2
  cat "$LOG_PATH" >&2
  exit 1
fi

branch="$(git for-each-ref --format='%(refname:short)' refs/heads/pnpm-migrate/ | head -n 1)"
if [ -z "$branch" ]; then
  printf 'migration branch was not created\n' >&2
  cat "$LOG_PATH" >&2
  exit 1
fi

worktree="$(git worktree list --porcelain | awk -v branch="refs/heads/$branch" '
  $1 == "worktree" { current = $2 }
  $1 == "branch" && $2 == branch { print current }
')"
if [ -z "$worktree" ]; then
  printf 'migration worktree for %s was not found\n' "$branch" >&2
  cat "$LOG_PATH" >&2
  exit 1
fi

test -f "$worktree/pnpm-lock.yaml"
test ! -f "$worktree/package-lock.json"
node -e "const p=require(process.argv[1]); if (!/^pnpm@/.test(p.packageManager || '')) process.exit(1)" "$worktree/package.json"
grep -q 'cache: pnpm' "$worktree/.github/workflows/ci.yml"
grep -q 'pnpm install --frozen-lockfile' "$worktree/.github/workflows/ci.yml"
grep -q 'pnpm test' "$worktree/.github/workflows/ci.yml"
grep -q 'pnpm install' "$worktree/README.md"
grep -q 'pnpm build' "$worktree/README.md"
grep -q 'pnpm test' "$worktree/README.md"
grep -q 'pnpm dlx cowsay hello' "$worktree/README.md"
if [ -n "$(git -C "$worktree" status --porcelain)" ]; then
  printf 'migration worktree has uncommitted changes\n' >&2
  git -C "$worktree" status --porcelain >&2
  exit 1
fi

git worktree remove -f "$worktree"
git branch -D "$branch" >/dev/null

printf 'installer smoke passed\n'
