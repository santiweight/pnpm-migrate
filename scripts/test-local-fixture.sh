#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

run_fixture() {
  local fixture="$1"
  local project="$TMP_DIR/$fixture"

  cp -R "$ROOT/fixtures/$fixture" "$project"
  cd "$project"

  npm install --package-lock-only >/dev/null
  local log="$TMP_DIR/$fixture.log"
  bash "$ROOT/pnpm-migrate.sh" --yes --skip-agent 2>&1 | tee "$log"
  grep -Eq '\[pnpm-migrate\] state directory: /tmp/pnpm-migrate\.' "$log"

  test -f pnpm-lock.yaml
  test ! -f package-lock.json
  node -e "const p=require('./package.json'); if (!/^pnpm@/.test(p.packageManager || '')) process.exit(1)"
  node "$ROOT/scripts/validate-migration.mjs" "$project"
  grep -q 'pnpm install --frozen-lockfile' .github/workflows/ci.yml
  grep -q 'pnpm test' .github/workflows/ci.yml
  node -e "const lines=require('fs').readFileSync('.github/workflows/ci.yml','utf8').split(/\\r?\\n/); const setup=lines.findIndex((line)=>line.includes('actions/setup-node@')); if (setup < 1 || lines[setup - 1].trim() !== '- run: corepack enable') process.exit(1)"
}

run_fixture npm-basic

cd "$TMP_DIR/npm-basic"
grep -q 'cache: pnpm' .github/workflows/ci.yml
grep -q 'pnpm install' README.md
grep -q 'pnpm start' README.md
grep -q 'pnpm build' README.md
grep -q 'pnpm test' README.md
grep -q 'pnpm dlx cowsay hello' README.md
grep -q 'npm install npm-basic --save' README.md
grep -q 'npm install --save-dev npm-basic' README.md
grep -q 'npm publish' README.md
grep -q 'Contributor checks: `pnpm test && pnpm build`' README.md
node -e "const s=require('./package.json').scripts; if (s.prepare !== 'pnpm run patch') process.exit(1); if (s.patch !== 'node -e \"process.exit(0)\"') process.exit(1)"

run_fixture npm-workspace

cd "$TMP_DIR/npm-workspace"
test -f pnpm-workspace.yaml
grep -q 'packages/\\*' pnpm-workspace.yaml
node -e "const s=require('./package.json').scripts; if (s.lint !== 'pnpm -r build') process.exit(1); if (s.package !== 'pnpm --filter @fixture/a build') process.exit(1)"

run_fixture npm-hoisted-import

cd "$TMP_DIR/npm-hoisted-import"
node -e "const p=require('./package.json'); if (!p.devDependencies?.['ansi-styles']) process.exit(1)"

echo "local fixtures passed"
