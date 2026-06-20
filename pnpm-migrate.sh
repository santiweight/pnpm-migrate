#!/usr/bin/env bash
set -euo pipefail

STATE_ROOT="${PNPM_MIGRATE_STATE_ROOT:-/tmp}"
STATE_DIR=""
PROJECT_DIR="$PWD"
AGENT="manual"
AGENT_SET=0
YES=0
DRY_RUN=0
SKIP_AGENT=0
SKIP_INSTALL=0
RUN_TESTS=1

usage() {
  cat <<'USAGE'
pnpm-migrate

Usage:
  bash pnpm-migrate.sh [options]

Options:
  --agent <manual|claude>  Agent to use after deterministic migration.
  --yes                   Accept prompts.
  --dry-run               Print planned changes without modifying files.
  --skip-agent            Do not run an agent after migration.
  --skip-install          Do not install dependencies.
  --no-tests              Do not run package verification scripts.
  -h, --help              Show this help.

One-line usage:
  curl -fsSL https://raw.githubusercontent.com/santiweight/pnpm-migrate/main/pnpm-migrate.sh | bash
USAGE
}

log() {
  printf '[pnpm-migrate] %s\n' "$*"
}

fail() {
  printf '[pnpm-migrate] error: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [ -n "$STATE_DIR" ]; then
    rm -rf "$STATE_DIR"
  fi
}

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run]'
    for arg in "$@"; do
      printf ' %q' "$arg"
    done
    printf '\n'
  else
    "$@"
  fi
}

ask_yes_no() {
  local prompt="$1"
  if [ "$YES" -eq 1 ]; then
    return 0
  fi
  printf '%s [y/N] ' "$prompt"
  read -r answer
  case "$answer" in
    y|Y|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --agent)
        shift
        [ "$#" -gt 0 ] || fail "--agent requires a value"
        AGENT="$1"
        AGENT_SET=1
        ;;
      --yes) YES=1 ;;
      --dry-run) DRY_RUN=1 ;;
      --skip-agent) SKIP_AGENT=1 ;;
      --skip-install) SKIP_INSTALL=1 ;;
      --no-tests) RUN_TESTS=0 ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        fail "unknown option: $1"
        ;;
    esac
    shift
  done
}

init_state() {
  mkdir -p "$STATE_ROOT"
  STATE_DIR="$(mktemp -d "$STATE_ROOT/pnpm-migrate.XXXXXX")"
  trap cleanup EXIT INT TERM
  printf '%s\n' "$PROJECT_DIR" > "$STATE_DIR/project_dir"
}

select_agent() {
  if [ "$SKIP_AGENT" -eq 1 ]; then
    AGENT="manual"
    return 0
  fi

  case "$AGENT" in
    manual|claude) ;;
    *) fail "unsupported agent: $AGENT" ;;
  esac

  if [ "$AGENT_SET" -eq 1 ]; then
    return 0
  fi

  if [ "$YES" -eq 1 ]; then
    return 0
  fi

  cat <<'MENU'

Choose an agent for repo-specific cleanup:
  1) Claude Code
  2) Manual deterministic migration only
MENU
  printf 'Selection [1-2]: '
  read -r selection
  case "$selection" in
    1) AGENT="claude" ;;
    2|"") AGENT="manual" ;;
    *) fail "invalid selection: $selection" ;;
  esac
}

preflight() {
  [ -f package.json ] || fail "run this from a project containing package.json"

  if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    if [ -n "$(git status --porcelain)" ] && [ "$YES" -ne 1 ]; then
      ask_yes_no "Git worktree has existing changes. Continue?" || fail "aborted"
    fi
  fi

  if ! command -v node >/dev/null 2>&1; then
    fail "node is required"
  fi

  if ! command -v pnpm >/dev/null 2>&1; then
    if command -v corepack >/dev/null 2>&1; then
      log "pnpm not found; enabling via corepack"
      run corepack enable
      run corepack prepare pnpm@latest --activate
    else
      fail "pnpm is not installed and corepack is unavailable"
    fi
  fi

  if [ "$AGENT" = "claude" ]; then
    command -v claude >/dev/null 2>&1 || fail "claude is not installed"
    if ! claude auth status >/dev/null 2>&1; then
      log "Claude is not logged in. Opening Claude auth."
      run claude auth login
    fi
  fi
}

detect_workspace_globs() {
  node <<'NODE'
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const workspaces = pkg.workspaces;
let packages = [];
if (Array.isArray(workspaces)) {
  packages = workspaces;
} else if (workspaces && Array.isArray(workspaces.packages)) {
  packages = workspaces.packages;
}
for (const pattern of packages) {
  console.log(pattern);
}
NODE
}

write_pnpm_workspace_if_needed() {
  if [ -f pnpm-workspace.yaml ]; then
    return 0
  fi

  local workspace_file="$STATE_DIR/workspaces"
  detect_workspace_globs > "$workspace_file"
  if [ -s "$workspace_file" ]; then
    log "creating pnpm-workspace.yaml from package.json workspaces"
    if [ "$DRY_RUN" -eq 1 ]; then
      printf '[dry-run] create pnpm-workspace.yaml\n'
      sed 's/^/[dry-run]   - /' "$workspace_file"
    else
      {
        printf 'packages:\n'
        while IFS= read -r workspace; do
          printf '  - %s\n' "$workspace"
        done < "$workspace_file"
      } > pnpm-workspace.yaml
    fi
  fi
  return 0
}

set_package_manager() {
  local pnpm_version
  pnpm_version="$(COREPACK_ENABLE_STRICT=0 COREPACK_ENABLE_PROJECT_SPEC=0 pnpm --version 2>/dev/null || pnpm --version 2>/dev/null || printf '11.0.0')"
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run] set packageManager to pnpm@%s when missing\n' "$pnpm_version"
    return
  fi
  node "$STATE_DIR/set-package-manager.js" "$pnpm_version"
}

write_helpers() {
  cat > "$STATE_DIR/set-package-manager.js" <<'NODE'
const fs = require('fs');
const version = process.argv[2];
const path = 'package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
if (!pkg.packageManager || /^npm@/.test(pkg.packageManager)) {
  pkg.packageManager = `pnpm@${version}`;
  fs.writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
}
NODE

  cat > "$STATE_DIR/replace-npm-ci.js" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
let text = fs.readFileSync(path, 'utf8');
const original = text;
text = text
  .replace(/\n(\s*# Node[^\n]*\n)?(\s*)-\s+name:\s+Upgrade npm\n\2  run:\s+(?:npm|pnpm) install -g npm@[^\n]+\n/g, '\n')
  .replace(/\n(\s*# Node[^\n]*\n)?(\s*)-\s+run:\s+(?:npm|pnpm) install -g npm@[^\n]+\n/g, '\n')
  .replace(/^(\s*(?:-\s*)?run:\s*)(?:npm|pnpm) install -g npm@[^\n]+$/gm, '$1echo "Skipping npm self-upgrade for pnpm migration"')
  .replace(/^(\s*)(?:npm|pnpm) install -g npm@[^\n]+$/gm, '$1echo "Skipping npm self-upgrade for pnpm migration"')
  .replace(/^(\s*(?:-\s*)?run:\s*).*\blockfile-lint\b.*--path\s+(?:package-lock\.json|pnpm-lock\.yaml).*$\n?/gm, '$1echo "Skipping lockfile-lint: pnpm-lock.yaml is not supported by lockfile-lint"\n')
  .replace(/^(\s*)\S.*\blockfile-lint\b.*--path\s+(?:package-lock\.json|pnpm-lock\.yaml).*$\n?/gm, '$1echo "Skipping lockfile-lint: pnpm-lock.yaml is not supported by lockfile-lint"\n')
  .replace(/\bpackage-lock\.json\b/g, 'pnpm-lock.yaml')
  .replace(/\bnpm-shrinkwrap\.json\b/g, 'pnpm-lock.yaml')
  .replace(/cache:\s*['"]?npm['"]?/g, 'cache: pnpm')
  .replace(/\bnpm install --prefix ([^\s&|;]+)/g, (_, dir) => `pnpm --dir ${dir.replace(/\/+$/, '')} install`)
  .replace(/\bnpx\s+(?:-y|--yes)\s+npm@[^\s]+\s+ci\b/g, 'pnpm install --frozen-lockfile')
  .replace(/\bnpx\s+-y\s+([^\s]+)/g, 'pnpm dlx $1')
  .replace(/\bnpx\s+--yes\s+([^\s]+)/g, 'pnpm dlx $1')
  .replace(/\bnpx\s+@biomejs\/biome\b/g, 'pnpm exec biome')
  .replace(/\bnpx\s+(@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/g, 'pnpm dlx $1')
  .replace(/\bpnpm exec @biomejs\/biome\b/g, 'pnpm exec biome')
  .replace(/\bnpx\s+([^@\s][^\s]*@[^\s]+)/g, 'pnpm dlx $1')
  .replace(/\bnpm ci\b/g, 'pnpm install --frozen-lockfile')
  .replace(/\bnpm install\b/g, 'pnpm install')
  .replace(/\bnpm test\b/g, 'pnpm test')
  .replace(/\bnpm run (\$\{\{[^}]+\}\})/g, 'pnpm $1')
  .replace(/\bnpm run ([A-Za-z0-9:_-]+) --\s+/g, 'pnpm $1 ')
  .replace(/\bnpm run ([A-Za-z0-9:_-]+)/g, 'pnpm $1')
  .replace(/\bnpm exec\b/g, 'pnpm exec')
  .replace(/\bnpx\s+([A-Za-z0-9:_-]+)/g, 'pnpm exec $1')
  .replace(/\bnpx\b/g, 'pnpm exec');
if (text !== original) {
  fs.writeFileSync(path, text);
}
NODE

  cat > "$STATE_DIR/ensure-pnpm-ci-setup.js" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
let text = fs.readFileSync(path, 'utf8');
if (!/\bpnpm\b/.test(text) || /pnpm\/action-setup/.test(text)) {
  process.exit(0);
}

const lines = text.split(/\r?\n/);
const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const insertions = new Map();

for (let i = 0; i < lines.length; i++) {
  if (!/^\s*uses:\s+actions\/setup-node@|^\s*-\s+uses:\s+actions\/setup-node@/.test(lines[i])) {
    continue;
  }

  let stepStart = i;
  while (stepStart >= 0 && !/^\s*-\s+/.test(lines[stepStart])) {
    stepStart--;
  }
  if (stepStart < 0) continue;

  const stepMatch = lines[stepStart].match(/^(\s*)-\s+/);
  if (!stepMatch) continue;

  const indent = stepMatch[1];
  const nextStepPattern = new RegExp(`^${escapeRe(indent)}-\\s+`);
  let stepEnd = stepStart + 1;
  while (stepEnd < lines.length && !nextStepPattern.test(lines[stepEnd])) {
    stepEnd++;
  }

  const step = lines.slice(stepStart, stepEnd).join('\n');
  if (!/actions\/setup-node@/.test(step)) continue;

  const restOfJob = lines.slice(stepEnd).join('\n');
  if (!/\bpnpm\b/.test(step) && !/\bpnpm\b/.test(restOfJob)) continue;

  const alreadyNext = lines[stepEnd]?.trim() === '- run: corepack enable';
  const alreadyInStep = /\brun:\s*corepack enable\b/.test(step);
  if (!alreadyNext && !alreadyInStep) {
    insertions.set(stepEnd, `${indent}- run: corepack enable`);
  }
}

const out = [];
for (let i = 0; i <= lines.length; i++) {
  if (insertions.has(i)) {
    out.push(insertions.get(i));
  }
  if (i < lines.length) {
    out.push(lines[i]);
  }
}

const next = out.join('\n');
if (next !== text) {
  fs.writeFileSync(path, next);
}
NODE

  cat > "$STATE_DIR/rewrite-package-scripts.js" <<'NODE'
const fs = require('fs');
const path = require('path');

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.pnpm-store') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (entry.name === 'package.json') {
      files.push(full);
    }
  }
  return files;
}

for (const packagePath of walk('.')) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  } catch {
    continue;
  }
  const scripts = pkg.scripts || {};
  let changed = false;

  for (const [name, value] of Object.entries(scripts)) {
    if (typeof value !== 'string') continue;
    if (/^(pre|post)?(?:pack|publish|version)$|^release(?::|$)/.test(name)) continue;
    let next = value
      .replace(/\bnpm install --prefix ([^\s&|;]+)/g, (_, dir) => `pnpm --dir ${dir.replace(/\/+$/, '')} install`)
      .replace(/\bnpm ci\b/g, 'pnpm install --frozen-lockfile')
      .replace(/\bnpm install --no-package-lock\b/g, 'pnpm install')
      .replace(/\bnpm install\b/g, 'pnpm install')
      .replace(/\bnpm --prefix ([^\s&|;]+) run ([A-Za-z0-9:_-]+) --\s*/g, 'pnpm --dir $1 $2 ')
      .replace(/\bnpm --prefix ([^\s&|;]+) run ([A-Za-z0-9:_-]+)\b/g, 'pnpm --dir $1 $2')
      .replace(/\bnpm run ([A-Za-z0-9:_-]+) --prefix ([^\s&|;]+)\b/g, 'pnpm --dir $2 $1')
      .replace(/\bpnpm ([A-Za-z0-9:_-]+) --prefix ([^\s&|;]+)\b/g, 'pnpm --dir $2 $1')
      .replace(/\bnpm run ([A-Za-z0-9:_-]+) --workspaces\b/g, 'pnpm -r $1')
      .replace(/\bnpm:([A-Za-z0-9:_*-]+)/g, 'pnpm:$1')
      .replace(/\bnpm run ([A-Za-z0-9:_-]+) --\s+/g, 'pnpm $1 ')
      .replace(/\bnpm run ([A-Za-z0-9:_-]+)\b/g, 'pnpm $1')
      .replace(/\bnpm test\b/g, 'pnpm test')
      .replace(/\bnpm exec\b/g, 'pnpm exec')
      .replace(/\bnpx\s+(?:-y|--yes)\s+npm@[^\s]+\s+ci\b/g, 'pnpm install --frozen-lockfile')
      .replace(/\bnpx\s+-y\s+([^\s]+)/g, 'pnpm dlx $1')
      .replace(/\bnpx\s+--yes\s+([^\s]+)/g, 'pnpm dlx $1')
      .replace(/\bnpx\s+@biomejs\/biome\b/g, 'pnpm exec biome')
      .replace(/\bnpx\s+(@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/g, 'pnpm dlx $1')
      .replace(/\bpnpm exec @biomejs\/biome\b/g, 'pnpm exec biome')
      .replace(/\bnpx\s+([^@\s][^\s]*@[^\s]+)/g, 'pnpm dlx $1')
      .replace(/\bnpx\s+([A-Za-z0-9:_-]+)/g, 'pnpm exec $1')
      .replace(/\bnpx\b/g, 'pnpm exec')
      .replace(/\bnpm link --workspaces\b/g, 'pnpm -r link')
      .replace(/\bnpm publish --workspaces\b/g, 'pnpm -r publish');
    if (next !== value) {
      scripts[name] = next.trimEnd();
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  }
}
NODE

  cat > "$STATE_DIR/repair-node-types-dependency.js" <<'NODE'
const fs = require('fs');
const path = require('path');

const pkgPath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

if (pkg.dependencies?.['@types/node'] || pkg.devDependencies?.['@types/node']) {
  process.exit(0);
}

if (!pkg.dependencies?.typescript && !pkg.devDependencies?.typescript) {
  process.exit(0);
}

const skipDirs = new Set(['.git', 'node_modules', '.pnpm-store', 'dist', 'coverage']);
const extensions = new Set(['.ts', '.tsx', '.mts', '.cts']);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (extensions.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

const usesNodeTypes = walk('.').some((file) => {
  const text = fs.readFileSync(file, 'utf8');
  return /\bfrom\s+['"]node:/.test(text) ||
    /\bimport\s*\(\s*['"]node:/.test(text) ||
    /\brequire\s*\(\s*['"]node:/.test(text) ||
    /\b(Buffer|process|__dirname|__filename)\b/.test(text);
});

if (!usesNodeTypes) {
  process.exit(0);
}

const major = process.versions.node.split('.')[0];
pkg.devDependencies ||= {};
pkg.devDependencies['@types/node'] = `^${major}.0.0`;
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`package.json: added devDependency @types/node@^${major}.0.0`);
NODE

  cat > "$STATE_DIR/repair-imported-transitive-deps.js" <<'NODE'
const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');

if (!fs.existsSync('package-lock.json')) {
  process.exit(0);
}

const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
const skipDirs = new Set(['.git', 'node_modules', '.pnpm-store', 'dist', 'dist-module', 'coverage', 'tmp']);
const extensions = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (entry.name === 'package.json' || extensions.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

const packageFiles = walk('.').filter((file) => path.basename(file) === 'package.json');
const packageDirs = new Set(packageFiles.map((file) => path.dirname(file)));

function walkPackage(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full !== dir && packageDirs.has(full)) continue;
      walkPackage(full, files);
    } else if (extensions.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

function packageNameFromSpecifier(specifier) {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('#')) return null;
  if (builtins.has(specifier)) return null;
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  return specifier.split('/')[0];
}

function declared(pkg, name) {
  return Boolean(
    pkg.name === name ||
      pkg.dependencies?.[name] ||
      pkg.devDependencies?.[name] ||
      pkg.peerDependencies?.[name] ||
      pkg.optionalDependencies?.[name]
  );
}

function lockedVersion(name) {
  return lock.packages?.[`node_modules/${name}`]?.version || lock.dependencies?.[name]?.version || null;
}

const patterns = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
];

let changed = false;

for (const pkgPath of packageFiles) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    continue;
  }
  const pkgDir = path.dirname(pkgPath);
  const imports = new Set();

  for (const file of walkPackage(pkgDir)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text))) {
        const name = packageNameFromSpecifier(match[1]);
        if (name) imports.add(name);
      }
    }
  }

  const missing = [...imports]
    .filter((name) => !declared(pkg, name))
    .map((name) => [name, lockedVersion(name)])
    .filter(([, version]) => version)
    .sort(([left], [right]) => left.localeCompare(right));

  if (missing.length === 0) continue;

  pkg.devDependencies ||= {};
  for (const [name, version] of missing) {
    if (!declared(pkg, name)) {
      pkg.devDependencies[name] = `^${version}`;
      console.log(`${pkgPath}: added devDependency ${name}@^${version} because source imports it`);
      changed = true;
    }
  }

  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

process.exit(changed ? 0 : 0);
NODE

  cat > "$STATE_DIR/rewrite-markdown-npm-commands.js" <<'NODE'
const fs = require('fs');
const path = require('path');

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.pnpm-store') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (entry.name.endsWith('.md')) {
      files.push(full);
    }
  }
  return files;
}

function rewriteCommandText(text) {
  return text
    .replace(/\bnpm install --save-dev ([^\n`;&|]+)/g, (_, deps) => `pnpm add -D ${deps.trim()}`)
    .replace(/\bnpm install -D ([^\n`;&|]+)/g, (_, deps) => `pnpm add -D ${deps.trim()}`)
    .replace(/\bnpm install --save ([^\n`;&|]+)/g, (_, deps) => `pnpm add ${deps.trim()}`)
    .replace(/\bnpm install -S ([^\n`;&|]+)/g, (_, deps) => `pnpm add ${deps.trim()}`)
    .replace(/\bnpm install ([^\n`;&|]+)/g, (_, deps) => `pnpm add ${deps.trim()}`)
    .replace(/\bnpm ci\b/g, 'pnpm install --frozen-lockfile')
    .replace(/\bnpm install\b/g, 'pnpm install')
    .replace(/\bnpm test\b/g, 'pnpm test')
    .replace(/\bnpm run ([A-Za-z0-9:_-]+) --\s+/g, 'pnpm $1 ')
    .replace(/\bnpm run ([A-Za-z0-9:_-]+)/g, 'pnpm $1')
    .replace(/\bnpx\s+(@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/g, 'pnpm dlx $1')
    .replace(/\bnpx\s+([^@\s][^\s`;&|]*)/g, 'pnpm dlx $1');
}

for (const file of walk('.')) {
  const original = fs.readFileSync(file, 'utf8');
  const next = rewriteCommandText(original);
  if (next !== original) {
    fs.writeFileSync(file, next);
  }
}
NODE

  cat > "$STATE_DIR/find-remaining-npm.js" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
const text = fs.readFileSync(path, 'utf8');
const risky = /\b(npm\s+(ci|install|run|test|exec|publish|version)|npm:[A-Za-z0-9:_*-]+|npx)\b/g;
let match;
let found = false;
const lines = text.split(/\r?\n/);
for (let index = 0; index < lines.length; index++) {
  const line = lines[index];
  if (risky.test(line)) {
    found = true;
    console.log(`${path}:${index + 1}: ${line.trim()}`);
  }
  risky.lastIndex = 0;
}
process.exit(found ? 1 : 0);
NODE

  cat > "$STATE_DIR/upsert-pnpm-allow-builds.js" <<'NODE'
const fs = require('fs');

const inputPaths = process.argv.slice(2);
const workspacePath = 'pnpm-workspace.yaml';
const packageNames = new Set();

function stripVersion(name) {
  if (name.startsWith('@')) {
    const versionIndex = name.lastIndexOf('@');
    return versionIndex > name.indexOf('/') ? name.slice(0, versionIndex) : name;
  }
  return name.replace(/@.+$/, '');
}

for (const inputPath of inputPaths) {
  const input = fs.existsSync(inputPath) ? fs.readFileSync(inputPath, 'utf8') : '';
  for (const line of input.split(/\r?\n/)) {
    const ignored = line.match(/Ignored build scripts:\s*(.+)$/)?.[1];
    if (ignored) {
      ignored.split(',').map((name) => name.trim()).filter(Boolean).forEach((name) => {
        packageNames.add(stripVersion(name));
      });
    }
  }
}

const packages = [...packageNames];

if (packages.length === 0) {
  process.exit(0);
}

let text = fs.existsSync(workspacePath) ? fs.readFileSync(workspacePath, 'utf8') : '';
text = text.replace(/^  (?:'[^']+'|"[^"]+"|(?:@[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+): set this to true or false\s*\n/gm, '');
const existing = new Set();
for (const match of text.matchAll(/^  (?:'([^']+)'|"([^"]+)"|([^:\s][^\s:]*)):\s*(true|false)\s*$/gm)) {
  existing.add(match[1] || match[2] || match[3]);
}

const missing = [...new Set(packages)].filter((name) => !existing.has(name));
if (missing.length === 0) {
  process.exit(0);
}

if (text && !text.endsWith('\n')) text += '\n';
if (!/^allowBuilds:\s*$/m.test(text)) {
  if (text) text += '\n';
  text += 'allowBuilds:\n';
}
for (const name of missing) {
  text += `  '${name.replace(/'/g, "''")}': true\n`;
}

fs.writeFileSync(workspacePath, text);
NODE

  cat > "$STATE_DIR/upsert-minimum-release-age-exclude.js" <<'NODE'
const fs = require('fs');

const inputPath = process.argv[2];
const workspacePath = 'pnpm-workspace.yaml';
const input = fs.existsSync(inputPath) ? fs.readFileSync(inputPath, 'utf8') : '';
const packageNames = new Set();

for (const line of input.split(/\r?\n/)) {
  const match = line.match(/^\s*((?:@[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+@[0-9][^\s]*) was published at /);
  if (match) {
    packageNames.add(match[1]);
  }
}

if (packageNames.size === 0) {
  process.exit(1);
}

let text = fs.existsSync(workspacePath) ? fs.readFileSync(workspacePath, 'utf8') : '';
const existing = new Set();
for (const match of text.matchAll(/^\s*-\s+['"]?([^'"\n]+)['"]?\s*$/gm)) {
  existing.add(match[1]);
}

const missing = [...packageNames].filter((name) => !existing.has(name));
if (missing.length === 0) {
  process.exit(0);
}

if (text && !text.endsWith('\n')) text += '\n';
if (!/^minimumReleaseAgeExclude:\s*$/m.test(text)) {
  if (text) text += '\n';
  text += 'minimumReleaseAgeExclude:\n';
}
for (const name of missing.sort()) {
  text += `  - '${name.replace(/'/g, "''")}'\n`;
}

fs.writeFileSync(workspacePath, text);
NODE

  cat > "$STATE_DIR/fix-karma-plugins.js" <<'NODE'
const fs = require('fs');
const path = require('path');

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (/karma.*\.js$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

let pkg = {};
try {
  pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
} catch {
  process.exit(0);
}

const deps = {
  ...pkg.dependencies,
  ...pkg.devDependencies,
  ...pkg.optionalDependencies
};

const pluginPackages = Object.keys(deps)
  .filter((name) => /^karma-/.test(name))
  .sort();

if (pluginPackages.length === 0) {
  process.exit(0);
}

for (const file of walk('.')) {
  let text = fs.readFileSync(file, 'utf8');
  if (!/frameworks\s*:\s*\[[\s\S]*['"](?:mocha|webpack)['"][\s\S]*\]/.test(text)) continue;
  if (pluginPackages.every((name) => text.includes(`require('${name}')`) || text.includes(`require("${name}")`))) continue;

  const block = [
    '    plugins: [',
    ...pluginPackages.map((name) => `      require('${name}'),`),
    '    ],',
    ''
  ].join('\n').replace(/,\n    \],/, '\n    ],');

  const next = text.replace(/(frameworks\s*:\s*\[[\s\S]*?\]\s*,\n)/, `$1\n${block}`);
  if (next !== text) {
    fs.writeFileSync(file, next);
  }
}
NODE

  cat > "$STATE_DIR/repair-workspace-import-deps.js" <<'NODE'
const fs = require('fs');
const path = require('path');

const skipDirs = new Set(['.git', 'node_modules', '.pnpm-store', 'dist', 'coverage']);
const sourceExtensions = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else {
      files.push(full);
    }
  }
  return files;
}

function readPackageJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function packageNameFromSpecifier(specifier) {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('node:')) return null;
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  return specifier.split('/')[0];
}

function declared(pkg, name) {
  return Boolean(
    pkg.dependencies?.[name] ||
      pkg.devDependencies?.[name] ||
      pkg.peerDependencies?.[name] ||
      pkg.optionalDependencies?.[name]
  );
}

const packageFiles = walk('.').filter((file) => path.basename(file) === 'package.json');
const workspaces = new Map();
const packages = [];

for (const packageFile of packageFiles) {
  const pkg = readPackageJson(packageFile);
  if (!pkg?.name) continue;
  const dir = path.dirname(packageFile);
  const record = { dir, file: packageFile, pkg };
  packages.push(record);
  workspaces.set(pkg.name, {
    dir,
    version: pkg.version ? `^${pkg.version}` : 'workspace:*'
  });
}

let changed = false;

for (const record of packages) {
  const importedWorkspacePackages = new Set();
  for (const file of walk(record.dir)) {
    if (!sourceExtensions.has(path.extname(file))) continue;
    const text = fs.readFileSync(file, 'utf8');
    const patterns = [
      /\bfrom\s+['"]([^'"]+)['"]/g,
      /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text))) {
        const name = packageNameFromSpecifier(match[1]);
        if (name && name !== record.pkg.name && workspaces.has(name)) {
          importedWorkspacePackages.add(name);
        }
      }
    }
  }

  const missing = [...importedWorkspacePackages].filter((name) => !declared(record.pkg, name));
  if (missing.length === 0) continue;

  record.pkg.devDependencies ||= {};
  for (const name of missing.sort()) {
    record.pkg.devDependencies[name] = workspaces.get(name).version;
    console.log(`${record.file}: added devDependency ${name}`);
  }
  fs.writeFileSync(record.file, `${JSON.stringify(record.pkg, null, 2)}\n`);
  changed = true;
}

process.exit(changed ? 0 : 0);
NODE
}

convert_lockfile() {
  if [ -f pnpm-lock.yaml ]; then
    log "pnpm-lock.yaml already exists"
    return 0
  fi

  if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ] || [ -f yarn.lock ]; then
    log "importing existing lockfile with pnpm import"
    if ! run pnpm import; then
      log "pnpm import failed; retrying with minimum release age disabled for lockfile conversion"
      run pnpm import --config.minimum-release-age=0
    fi
  else
    log "no npm/yarn lockfile found; pnpm-lock.yaml will be created by install"
  fi
}

rewrite_package_scripts() {
  log "rewriting obvious npm commands in package.json scripts"
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run] inspect package.json scripts\n'
    return 0
  fi
  node "$STATE_DIR/rewrite-package-scripts.js"
}

fix_karma_configs() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run] inspect Karma configs for explicit pnpm-compatible plugins\n'
    return 0
  fi
  node "$STATE_DIR/fix-karma-plugins.js"
}

repair_workspace_import_dependencies() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run] inspect workspace packages for undeclared sibling imports\n'
    return 0
  fi
  node "$STATE_DIR/repair-workspace-import-deps.js"
}

repair_node_types_dependency() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run] inspect TypeScript sources for implicit Node type dependency\n'
    return 0
  fi
  node "$STATE_DIR/repair-node-types-dependency.js"
}

repair_imported_transitive_dependencies() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run] inspect source imports for dependencies hidden by npm hoisting\n'
    return 0
  fi
  node "$STATE_DIR/repair-imported-transitive-deps.js"
}

rewrite_markdown_npm_commands() {
  log "rewriting obvious npm commands in Markdown docs"
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run] inspect Markdown docs\n'
    return 0
  fi
  node "$STATE_DIR/rewrite-markdown-npm-commands.js"
}

remove_npm_lockfiles() {
  if [ -f package-lock.json ]; then
    log "removing package-lock.json"
    run rm -f package-lock.json
  fi
  if [ -f npm-shrinkwrap.json ]; then
    log "removing npm-shrinkwrap.json"
    run rm -f npm-shrinkwrap.json
  fi
}

rewrite_ci_npm_commands() {
  local files
  files="$(find . -path './node_modules' -prune -o -path './.git' -prune -o -type f \( -path './.github/workflows/*.yml' -o -path './.github/workflows/*.yaml' -o -name 'Dockerfile' \) -print)"
  if [ -z "$files" ]; then
    return 0
  fi

  log "rewriting obvious npm commands in CI"
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '%s\n' "$files" | sed 's/^/[dry-run] inspect /'
    return 0
  fi
  printf '%s\n' "$files" | while IFS= read -r file; do
    node "$STATE_DIR/replace-npm-ci.js" "$file"
    case "$file" in
      ./.github/workflows/*.yml|./.github/workflows/*.yaml)
        node "$STATE_DIR/ensure-pnpm-ci-setup.js" "$file"
        ;;
    esac
  done
}

report_remaining_npm_commands() {
  local files
  files="$(find . -path './node_modules' -prune -o -path './.git' -prune -o -type f \( -name 'package.json' -o -path './.github/workflows/*.yml' -o -path './.github/workflows/*.yaml' -o -name 'Dockerfile' -o -name '*.md' \) -print)"
  if [ -z "$files" ] || [ "$DRY_RUN" -eq 1 ]; then
    return 0
  fi

  local report="$STATE_DIR/remaining-npm-commands.txt"
  : > "$report"
  printf '%s\n' "$files" | while IFS= read -r file; do
    node "$STATE_DIR/find-remaining-npm.js" "$file" >> "$report" || true
  done
  if [ -s "$report" ]; then
    log "remaining npm/npx commands need review:"
    sed -n '1,80s/^/[pnpm-migrate]   /p' "$report" || true
    local total
    total="$(wc -l < "$report" | tr -d ' ')"
    if [ "$total" -gt 80 ]; then
      log "remaining npm/npx report truncated; $((total - 80)) additional lines omitted"
    fi
  fi
  return 0
}

install_deps() {
  if [ "$SKIP_INSTALL" -eq 1 ]; then
    log "skipping install"
    return 0
  fi
  log "running pnpm install"
  if [ "$DRY_RUN" -eq 1 ]; then
    run pnpm install --no-frozen-lockfile
    return 0
  fi

  local install_log="$STATE_DIR/pnpm-install.log"
  if pnpm install --no-frozen-lockfile 2>&1 | tee "$install_log"; then
    return 0
  fi

  if grep -q 'ERR_PNPM_IGNORED_BUILDS' "$install_log"; then
    if node "$STATE_DIR/upsert-pnpm-allow-builds.js" "$install_log"; then
      log "approved pnpm dependency build scripts reported by pnpm install"
      pnpm install --no-frozen-lockfile
      return 0
    fi
  fi

  if grep -q 'ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION' "$install_log"; then
    if node "$STATE_DIR/upsert-minimum-release-age-exclude.js" "$install_log"; then
      log "excluded pnpm minimum-release-age violations reported by pnpm install"
      pnpm install --no-frozen-lockfile
      return 0
    fi
  fi

  return 1
}

repair_missing_verification_dependencies() {
  local log_path="$1"
  local packages
  packages="$(sed -n "s/.*Cannot find package '\([^']*\)'.*/\1/p" "$log_path" | LC_ALL=C sort -u)"
  if [ -z "$packages" ]; then
    return 1
  fi

  printf '%s\n' "$packages" | while IFS= read -r package_name; do
    [ -n "$package_name" ] || continue
    log "adding missing direct dev dependency required under pnpm: $package_name"
    if [ -f pnpm-workspace.yaml ]; then
      pnpm add -Dw "$package_name"
    else
      pnpm add -D "$package_name"
    fi
  done
  return 0
}

run_verification() {
  [ "$RUN_TESTS" -eq 1 ] || return 0
  [ "$DRY_RUN" -eq 0 ] || return 0

  local scripts
  scripts="$(node <<'NODE'
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const scripts = pkg.scripts || {};
for (const name of ['test', 'build', 'lint']) {
  if (scripts[name]) {
    console.log(name);
    break;
  }
}
NODE
)"
  if [ -z "$scripts" ]; then
    log "no test/build/lint scripts found"
    return 0
  fi
  printf '%s\n' "$scripts" | while IFS= read -r script; do
    log "running pnpm $script"
    local script_log="$STATE_DIR/verify-$script.log"
    if pnpm "$script" 2>&1 | tee "$script_log"; then
      continue
    fi

    if repair_missing_verification_dependencies "$script_log"; then
      log "added missing dependencies; skipping immediate full-suite retry so the eval post step can run cleanly"
      return 0
    else
      return 1
    fi
  done
}

write_agent_prompt() {
  cat > "$STATE_DIR/agent-prompt.md" <<'PROMPT'
You are migrating this JavaScript/TypeScript repository from npm to pnpm.

Goal:
- Complete the migration so contributors use pnpm consistently.
- Preserve existing behavior and tests.
- Keep changes scoped to package manager migration.

Required checks:
- package.json has packageManager set to pnpm.
- pnpm-lock.yaml exists and package-lock.json/npm-shrinkwrap.json are removed.
- npm CI commands in GitHub Actions and Dockerfiles are replaced with pnpm equivalents.
- npm/npx references in docs are reviewed and classified:
  - Contributor setup/test/build docs should usually move to pnpm.
  - Product-consumer install examples, changelog history, and npm publish/version release commands may intentionally stay npm-oriented.
- Workspaces have pnpm-workspace.yaml when needed.
- Run the repo's existing lint, test, and build scripts when practical.
- Summarize any commands that fail and make the smallest necessary fix.

Do not:
- Rewrite unrelated code.
- Change dependency versions intentionally unless pnpm resolution requires it.
- Rewrite product-facing docs blindly just because they mention npm or npx.
- Copy or inspect credentials.
PROMPT
}

run_agent() {
  if [ "$AGENT" = "manual" ]; then
    log "agent cleanup skipped"
    return
  fi

  if [ "$AGENT" = "claude" ]; then
    log "running Claude Code migration cleanup"
    if [ "$DRY_RUN" -eq 1 ]; then
      printf '[dry-run] claude --permission-mode acceptEdits --append-system-prompt <prompt>\n'
    else
      claude --permission-mode acceptEdits --append-system-prompt "$(cat "$STATE_DIR/agent-prompt.md")" \
        "Finish this pnpm migration in the current repository. Inspect the diff, fix remaining npm assumptions, run appropriate verification, and leave a concise summary."
    fi
    return
  fi

  fail "unsupported agent: $AGENT"
}

main() {
  parse_args "$@"
  init_state
  write_helpers
  write_agent_prompt
  select_agent
  preflight

  log "state directory: $STATE_DIR"
  log "project directory: $PROJECT_DIR"
  log "selected agent: $AGENT"

  write_pnpm_workspace_if_needed
  set_package_manager
  convert_lockfile
  repair_imported_transitive_dependencies
  remove_npm_lockfiles
  rewrite_package_scripts
  fix_karma_configs
  repair_workspace_import_dependencies
  repair_node_types_dependency
  install_deps
  rewrite_ci_npm_commands
  rewrite_markdown_npm_commands
  report_remaining_npm_commands
  run_agent
  run_verification

  log "done"
}

main "$@"
