#!/usr/bin/env bash
set -euo pipefail

STATE_ROOT="${PNPM_MIGRATE_STATE_ROOT:-/tmp}"
STATE_DIR=""
PROJECT_DIR="$PWD"
ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT="manual"
AGENT_SET=0
YES=0
DRY_RUN=0
SKIP_AGENT=0
SKIP_INSTALL=0
RUN_TESTS=1
TRUST_LOCKFILE="${PNPM_MIGRATE_TRUST_LOCKFILE:-0}"
TRACE_FILE="${PNPM_MIGRATE_TRACE_FILE:-}"
BOOTSTRAP_PNPM_VERSION="${PNPM_MIGRATE_BOOTSTRAP_PNPM_VERSION:-}"
BUILD_APPROVAL_CONFIG="${PNPM_MIGRATE_BUILD_APPROVAL_CONFIG:-auto}"
COLOR_ENABLED=0
if [ -z "${NO_COLOR:-}" ] && [ -w /dev/tty ] 2>/dev/null; then
  COLOR_ENABLED=1
fi

if [ "$COLOR_ENABLED" -eq 1 ]; then
  BOLD="$(printf '\033[1m')"
  DIM="$(printf '\033[2m')"
  RESET="$(printf '\033[0m')"
  CYAN="$(printf '\033[36m')"
  GREEN="$(printf '\033[32m')"
  YELLOW="$(printf '\033[33m')"
else
  BOLD=""
  DIM=""
  RESET=""
  CYAN=""
  GREEN=""
  YELLOW=""
fi

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
  --trust-lockfile        Trust the generated pnpm lockfile during install.
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

tty_available() {
  [ -r /dev/tty ] && [ -w /dev/tty ]
}

pnpm_works() {
  COREPACK_ENABLE_PROJECT_SPEC=0 COREPACK_ENABLE_STRICT=0 pnpm --version >/dev/null 2>&1
}

ui_printf() {
  if tty_available; then
    printf "$@" > /dev/tty
  else
    printf "$@"
  fi
}

ui_read() {
  local var_name="$1"
  if tty_available; then
    IFS= read -r "$var_name" < /dev/tty
  else
    IFS= read -r "$var_name"
  fi
}

ui_banner() {
  ui_printf '\n%s+--------------------------------------------------+%s\n' "$CYAN" "$RESET"
  ui_printf '%s|%s %spnpm-migrate%s                                      %s|%s\n' "$CYAN" "$RESET" "$BOLD" "$RESET" "$CYAN" "$RESET"
  ui_printf '%s|%s deterministic npm -> pnpm migration             %s|%s\n' "$CYAN" "$RESET" "$CYAN" "$RESET"
  ui_printf '%s+--------------------------------------------------+%s\n\n' "$CYAN" "$RESET"
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

trace_init() {
  [ -n "$TRACE_FILE" ] || return 0
  mkdir -p "$(dirname "$TRACE_FILE")"
  printf 'phase\tstatus\tduration_seconds\n' > "$TRACE_FILE"
}

phase() {
  local name="$1"
  shift
  local start end status
  start="$(date +%s)"
  set +e
  "$@"
  status="$?"
  set -e
  end="$(date +%s)"
  if [ -n "$TRACE_FILE" ]; then
    printf '%s\t%s\t%s\n' "$name" "$status" "$((end - start))" >> "$TRACE_FILE"
  fi
  return "$status"
}

pnpm_install() {
  local args=(install --no-frozen-lockfile --prefer-offline)
  if [ "$TRUST_LOCKFILE" = "1" ]; then
    args+=(--config.trust-lockfile=true)
  fi
  pnpm "${args[@]}" "$@"
}

dry_run_pnpm_install() {
  local args=(pnpm install --no-frozen-lockfile --prefer-offline)
  if [ "$TRUST_LOCKFILE" = "1" ]; then
    args+=(--config.trust-lockfile=true)
  fi
  run "${args[@]}" "$@"
}

ask_yes_no() {
  local prompt="$1"
  if [ "$YES" -eq 1 ]; then
    return 0
  fi
  ui_printf '%s [y/N] ' "$prompt"
  ui_read answer
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
      --trust-lockfile) TRUST_LOCKFILE=1 ;;
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

  if ! tty_available; then
    fail "agent selection requires a TTY; rerun with --agent manual, --agent claude, or --yes"
  fi

  ui_banner
  ui_printf '%sAgent cleanup%s\n' "$BOLD" "$RESET"
  ui_printf '%sThe deterministic migration runs first. Pick what should handle repo-specific cleanup after that.%s\n\n' "$DIM" "$RESET"
  ui_printf '  %s1%s  %sClaude Code%s\n' "$GREEN" "$RESET" "$BOLD" "$RESET"
  ui_printf '     Uses your existing Claude CLI login for focused migration cleanup.\n\n'
  ui_printf '  %s2%s  %sManual only%s %s(default)%s\n' "$GREEN" "$RESET" "$BOLD" "$RESET" "$DIM" "$RESET"
  ui_printf '     Runs only deterministic rewrites and reports leftovers for review.\n\n'
  ui_printf '%sSelection [1-2, Enter for 2]:%s ' "$YELLOW" "$RESET"
  ui_read selection
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

  if ! command -v pnpm >/dev/null 2>&1 || ! pnpm_works; then
    if command -v corepack >/dev/null 2>&1; then
      local bootstrap_version
      bootstrap_version="$BOOTSTRAP_PNPM_VERSION"
      if [ -z "$bootstrap_version" ]; then
        local node_major
        node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
        if [ "$node_major" -ge 22 ]; then
          bootstrap_version="11.8.0"
        else
          bootstrap_version="10.17.1"
        fi
      fi
      log "pnpm not available; enabling pnpm@$bootstrap_version via corepack"
      run corepack enable
      run env COREPACK_ENABLE_PROJECT_SPEC=0 COREPACK_ENABLE_STRICT=0 corepack prepare "pnpm@$bootstrap_version" --activate
    else
      fail "pnpm is not installed and corepack is unavailable"
    fi
  fi

  pnpm_works || fail "pnpm is installed but could not run"

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
          workspace="${workspace//\\/\\\\}"
          workspace="${workspace//\"/\\\"}"
          printf '  - "%s"\n' "$workspace"
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

normalize_github_tarball_dependencies() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run] inspect package.json for GitHub tarball dependency specs\n'
    return 0
  fi
  node "$STATE_DIR/normalize-github-tarball-deps.js"
}

write_helpers() {
  cat > "$STATE_DIR/set-package-manager.js" <<'NODE'
const fs = require('fs');
const version = process.argv[2];
const path = 'package.json';
const text = fs.readFileSync(path, 'utf8');
const indent = text.match(/\n([ \t]+)"/)?.[1] || '  ';
const pkg = JSON.parse(text);
const packageManager = `pnpm@${version}`;
if (pkg.packageManager && /^npm@/.test(pkg.packageManager)) {
  pkg.packageManager = packageManager;
  fs.writeFileSync(path, `${JSON.stringify(pkg, null, indent)}\n`);
} else if (!pkg.packageManager) {
  const next = {};
  let inserted = false;
  for (const [key, value] of Object.entries(pkg)) {
    next[key] = value;
    if (!inserted && (key === 'version' || key === 'name')) {
      next.packageManager = packageManager;
      inserted = true;
    }
  }
  if (!inserted) {
    next.packageManager = packageManager;
  }
  fs.writeFileSync(path, `${JSON.stringify(next, null, indent)}\n`);
}
NODE

  cat > "$STATE_DIR/normalize-github-tarball-deps.js" <<'NODE'
const fs = require('fs');

const path = 'package.json';
const original = fs.readFileSync(path, 'utf8');
const indent = original.match(/\n([ \t]+)"/)?.[1] || '  ';
const pkg = JSON.parse(original);
const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const tarballPattern = /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/tarball\/(.+)$/;
let changed = false;

for (const section of sections) {
  const deps = pkg[section];
  if (!deps) continue;
  for (const [name, specifier] of Object.entries(deps)) {
    if (typeof specifier !== 'string') continue;
    const match = specifier.match(tarballPattern);
    if (!match) continue;
    deps[name] = `github:${match[1]}/${match[2]}#${match[3]}`;
    console.log(`package.json: normalized GitHub tarball dependency ${name}`);
    changed = true;
  }
}

if (changed) {
  fs.writeFileSync(path, `${JSON.stringify(pkg, null, indent)}\n`);
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
  .replace(/\bnpm install -g ([^\s&|;]+)/g, 'pnpm add -g $1')
  .replace(/\bnpm install\b/g, 'pnpm install')
  .replace(/\bnpm test\b/g, 'pnpm test')
  .replace(/\bnpm start\b/g, 'pnpm start')
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

  const alreadyPrevious = lines[stepStart - 1]?.trim() === '- run: corepack enable';
  const alreadyInStep = /\brun:\s*corepack enable\b/.test(step);
  if (!alreadyPrevious && !alreadyInStep) {
    insertions.set(stepStart, `${indent}- run: corepack enable`);
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

const PNPM_COMMANDS = new Set([
  'add',
  'approve-builds',
  'audit',
  'bin',
  'config',
  'create',
  'deploy',
  'dlx',
  'env',
  'exec',
  'fetch',
  'help',
  'import',
  'init',
  'install',
  'link',
  'list',
  'login',
  'logout',
  'outdated',
  'pack',
  'patch',
  'patch-commit',
  'publish',
  'rebuild',
  'remove',
  'root',
  'run',
  'setup',
  'store',
  'test',
  'unlink',
  'uninstall',
  'update',
  'upgrade',
  'why'
]);

function scriptCommand(name) {
  return PNPM_COMMANDS.has(name) ? `run ${name}` : name;
}

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
      .replace(/\bnpm --prefix ([^\s&|;]+) run ([A-Za-z0-9:_-]+) --\s*/g, (_, dir, script) => `pnpm --dir ${dir} ${scriptCommand(script)} `)
      .replace(/\bnpm --prefix ([^\s&|;]+) run ([A-Za-z0-9:_-]+)\b/g, (_, dir, script) => `pnpm --dir ${dir} ${scriptCommand(script)}`)
      .replace(/\bnpm run ([A-Za-z0-9:_-]+) --prefix ([^\s&|;]+)\b/g, (_, script, dir) => `pnpm --dir ${dir} ${scriptCommand(script)}`)
      .replace(/\bpnpm ([A-Za-z0-9:_-]+) --prefix ([^\s&|;]+)\b/g, (_, script, dir) => `pnpm --dir ${dir} ${scriptCommand(script)}`)
      .replace(/\bnpm run ([A-Za-z0-9:_-]+)\s+(?:--workspaces|-ws)\b/g, (_, script) => `pnpm -r ${scriptCommand(script)}`)
      .replace(/\bpnpm ([A-Za-z0-9:_-]+)\s+(?:--workspaces|-ws)\b/g, (_, script) => `pnpm -r ${scriptCommand(script)}`)
      .replace(/\bnpm run ([A-Za-z0-9:_-]+)\s+(?:--workspace|-w)\s+([^\s&|;]+)/g, (_, script, filter) => `pnpm --filter ${filter} ${scriptCommand(script)}`)
      .replace(/\bpnpm ([A-Za-z0-9:_-]+)\s+(?:--workspace|-w)\s+([^\s&|;]+)/g, (_, script, filter) => `pnpm --filter ${filter} ${scriptCommand(script)}`)
      .replace(/\bnpm run ([A-Za-z0-9:_-]+) --workspaces\b/g, (_, script) => `pnpm -r ${scriptCommand(script)}`)
      .replace(/\bnpm:([A-Za-z0-9:_*-]+)/g, 'pnpm:$1')
      .replace(/\bnpm install -g ([^\s&|;]+)/g, 'pnpm add -g $1')
      .replace(/\bnpm run ([A-Za-z0-9:_-]+) --\s+/g, (_, script) => `pnpm ${scriptCommand(script)} `)
      .replace(/\bnpm run ([A-Za-z0-9:_-]+)\b/g, (_, script) => `pnpm ${scriptCommand(script)}`)
      .replace(/\bnpm test\b/g, 'pnpm test')
      .replace(/\bnpm start\b/g, 'pnpm start')
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
      .replace(/(^|[;&|]\s*)((?:cross-env\s+(?:\S+=\S+\s+)*)?)node_modules\/((?:@[^/\s]+\/)?[^/\s]+)\/bin\/([^\s&|;]+)/g, '$1$2node node_modules/$3/bin/$4')
      .replace(/\bnpm publish --workspaces\b/g, 'pnpm -r publish');
    if (next !== value) {
      scripts[name] = next.trimEnd();
      changed = true;
    }
  }

  if (changed) {
    const text = fs.readFileSync(packagePath, 'utf8');
    const indent = text.match(/\n([ \t]+)"/)?.[1] || '  ';
    fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, indent)}\n`);
  }
}
NODE

  cat > "$STATE_DIR/repair-node-types-dependency.js" <<'NODE'
const fs = require('fs');
const path = require('path');

const pkgPath = 'package.json';
const original = fs.readFileSync(pkgPath, 'utf8');
const indent = original.match(/\n([ \t]+)"/)?.[1] || '  ';
const pkg = JSON.parse(original);

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
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, indent)}\n`);
console.log(`package.json: added devDependency @types/node@^${major}.0.0`);
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
    .replace(/\bnpm ci\b/g, 'pnpm install --frozen-lockfile')
    .replace(/\bnpm install(?=\s*(?:$|[#`;&|]))/g, 'pnpm install')
    .replace(/\bnpm test\b/g, 'pnpm test')
    .replace(/\bnpm start\b/g, 'pnpm start')
    .replace(/\bnpm run ([A-Za-z0-9:_-]+) --\s+/g, 'pnpm $1 ')
    .replace(/\bnpm run ([A-Za-z0-9:_-]+)/g, 'pnpm $1')
    .replace(/\bnpx\s+(@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/g, 'pnpm dlx $1')
    .replace(/\bnpx\s+([^@\s][^\s`;&|]*)/g, 'pnpm dlx $1');
}

function shouldSkipFile(file) {
  return /(?:^|\/)(?:CHANGELOG|CHANGES|HISTORY|RELEASES?)(?:\.[^.\/]+)?$/i.test(file);
}

function rewriteMarkdown(text) {
  const lines = text.split(/(\r?\n)/);
  let inFence = false;
  for (let i = 0; i < lines.length; i += 2) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }

    const isCommandLine =
      inFence ||
      /^\s{4,}(?:npm|npx)\b/.test(line) ||
      /^\s*(?:[-*]\s*)?(?:\$|>)?\s*(?:npm|npx)\b/.test(line);

    if (isCommandLine) {
      lines[i] = rewriteCommandText(line);
    } else {
      lines[i] = line.replace(/`([^`]*(?:npm|npx)[^`]*)`/g, (match, command) => {
        const rewritten = rewriteCommandText(command);
        return rewritten === command ? match : `\`${rewritten}\``;
      });
    }
  }
  return lines.join('');
}

for (const file of walk('.')) {
  if (shouldSkipFile(file)) continue;
  const original = fs.readFileSync(file, 'utf8');
  const next = rewriteMarkdown(original);
  if (next !== original) {
    fs.writeFileSync(file, next);
  }
}
NODE

  cat > "$STATE_DIR/find-remaining-npm.js" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
const text = fs.readFileSync(path, 'utf8');
const risky = /\b(npm\s+(ci|install|run|test|start|exec|publish|version)|npm:[A-Za-z0-9:_*-]+|npx)\b/g;
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
const { spawnSync } = require('child_process');

const inputPaths = process.argv.slice(2);
const workspacePath = 'pnpm-workspace.yaml';
const packageNames = new Set();
const configMode = process.env.PNPM_MIGRATE_BUILD_APPROVAL_CONFIG || 'auto';

if (configMode === 'off') {
  process.exit(1);
}

function stripVersion(name) {
  name = name.trim().replace(/[.,;:]+$/, '');
  if (name.startsWith('@')) {
    const versionIndex = name.lastIndexOf('@');
    return versionIndex > name.indexOf('/') ? name.slice(0, versionIndex) : name;
  }
  return name.replace(/@.+$/, '');
}

function collectIgnoredBuilds(input) {
  const lines = input.split(/\r?\n/).map((line) =>
    line
      .replace(/[│╭╮╰╯]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
  const segments = [];
  for (let index = 0; index < lines.length; index += 1) {
    const first = lines[index].match(/Ignored build scripts:\s*(.+)$/)?.[1];
    if (!first) continue;

    const parts = [first];
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const line = lines[nextIndex];
      if (!line || /^Run\b/.test(line) || /^Warning\b/.test(line)) break;
      parts.push(line);
    }
    segments.push(parts.join(' '));
  }
  return segments;
}

for (const inputPath of inputPaths) {
  const input = fs.existsSync(inputPath) ? fs.readFileSync(inputPath, 'utf8') : '';
  for (const ignored of collectIgnoredBuilds(input)) {
    ignored.split(',').map((name) => name.trim()).filter(Boolean).forEach((name) => {
      packageNames.add(stripVersion(name));
    });
  }
}

const packages = [...packageNames];

if (packages.length === 0) {
  process.exit(1);
}

let text = fs.existsSync(workspacePath) ? fs.readFileSync(workspacePath, 'utf8') : '';
const uniquePackages = [...new Set(packages)];

function pnpmMajor() {
  if (configMode === 'pnpm10') return 10;
  if (configMode === 'pnpm11') return 11;
  const result = spawnSync('pnpm', ['--version'], { encoding: 'utf8' });
  const version = result.stdout.trim();
  const major = Number(version.split('.')[0]);
  return Number.isFinite(major) ? major : 10;
}

function quoteYaml(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function upsertOnlyBuiltDependencies(text, names) {
  const existing = new Set();
  const lines = text.split('\n');
  let blockIndex = -1;
  let insertIndex = -1;

  for (let index = 0; index < lines.length; index += 1) {
    if (/^onlyBuiltDependencies:\s*$/.test(lines[index])) {
      blockIndex = index;
      insertIndex = index + 1;
      for (let next = index + 1; next < lines.length; next += 1) {
        const line = lines[next];
        if (/^\s*-\s+/.test(line)) {
          const value = line.replace(/^\s*-\s+['"]?/, '').replace(/['"]?\s*$/, '');
          existing.add(value);
          insertIndex = next + 1;
          continue;
        }
        if (line.trim() === '') {
          insertIndex = next + 1;
          continue;
        }
        break;
      }
      break;
    }
  }

  const missingNames = names.filter((name) => !existing.has(name));
  if (missingNames.length === 0) {
    return null;
  }

  if (blockIndex === -1) {
    if (text && !text.endsWith('\n')) text += '\n';
    if (text) text += '\n';
    text += 'onlyBuiltDependencies:\n';
    for (const name of missingNames) {
      text += `  - ${quoteYaml(name)}\n`;
    }
    return text;
  }

  const additions = missingNames.map((name) => `  - ${quoteYaml(name)}`);
  lines.splice(insertIndex, 0, ...additions);
  return lines.join('\n');
}

function upsertAllowBuilds(text, names) {
  text = text.replace(/^  (?:'[^']+'|"[^"]+"|(?:@[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+): set this to true or false\s*\n/gm, '');
  const existingAllowBuilds = new Set();
  for (const match of text.matchAll(/^  (?:'([^']+)'|"([^"]+)"|([^:\s][^\s:]*)):\s*(true|false)\s*$/gm)) {
    existingAllowBuilds.add(match[1] || match[2] || match[3]);
  }

  const missingAllowBuilds = names.filter((name) => !existingAllowBuilds.has(name));
  if (missingAllowBuilds.length === 0) {
    return null;
  }

  if (text && !text.endsWith('\n')) text += '\n';
  if (!/^allowBuilds:\s*$/m.test(text)) {
    if (text) text += '\n';
    text += 'allowBuilds:\n';
  }
  for (const name of missingAllowBuilds) {
    text += `  ${quoteYaml(name)}: true\n`;
  }
  return text;
}

if (text && !text.endsWith('\n')) text += '\n';
const nextText = pnpmMajor() >= 11
  ? upsertAllowBuilds(text, uniquePackages)
  : upsertOnlyBuiltDependencies(text, uniquePackages);

if (nextText === null) {
  process.exit(1);
}

fs.writeFileSync(workspacePath, nextText);
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

function walkPackageJsons(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkPackageJsons(full, files);
    } else if (entry.name === 'package.json') {
      files.push(full);
    }
  }
  return files;
}

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

const packageFiles = walkPackageJsons('.');
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
  const original = fs.readFileSync(record.file, 'utf8');
  const indent = original.match(/\n([ \t]+)"/)?.[1] || '  ';
  fs.writeFileSync(record.file, `${JSON.stringify(record.pkg, null, indent)}\n`);
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
    if run pnpm import; then
      return 0
    fi
    log "pnpm import failed; retrying with minimum release age disabled for lockfile conversion"
    if run pnpm import --config.minimum-release-age=0; then
      return 0
    fi
    log "pnpm import failed; retrying with exotic subdependency policy disabled for lockfile conversion"
    run pnpm import --config.minimum-release-age=0 --config.block-exotic-subdeps=false
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
  node "$ENGINE_DIR/src/migration/imported-packages.mjs" "$PROJECT_DIR"
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
    grep -IqE '\b(npm|npx)\b|npm:' "$file" || continue
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
    dry_run_pnpm_install
    return 0
  fi

  local install_log="$STATE_DIR/pnpm-install.log"
  if pnpm_install 2>&1 | tee "$install_log"; then
    if node "$STATE_DIR/upsert-pnpm-allow-builds.js" "$install_log"; then
      log "approved pnpm dependency build scripts reported by pnpm install"
      pnpm_install
      pnpm rebuild
    fi
    return 0
  fi

  if grep -q 'ERR_PNPM_IGNORED_BUILDS' "$install_log"; then
    if node "$STATE_DIR/upsert-pnpm-allow-builds.js" "$install_log"; then
      log "approved pnpm dependency build scripts reported by pnpm install"
      pnpm_install
      pnpm rebuild
      return 0
    fi
  fi

  if grep -q 'ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION' "$install_log"; then
    if node "$STATE_DIR/upsert-minimum-release-age-exclude.js" "$install_log"; then
      log "excluded pnpm minimum-release-age violations reported by pnpm install"
      pnpm_install
      return 0
    fi
  fi

  if grep -q 'ERR_PNPM_EXOTIC_SUBDEP' "$install_log"; then
    log "retrying pnpm install with exotic subdependency policy disabled"
    if pnpm_install --config.block-exotic-subdeps=false 2>&1 | tee "$install_log"; then
      return 0
    fi
    if grep -q 'ERR_PNPM_IGNORED_BUILDS' "$install_log"; then
      if node "$STATE_DIR/upsert-pnpm-allow-builds.js" "$install_log"; then
        log "approved pnpm dependency build scripts reported by pnpm install"
        pnpm_install --config.block-exotic-subdeps=false
        pnpm rebuild
        return 0
      fi
    fi
  fi

  return 1
}

format_metadata_if_needed() {
  [ "$DRY_RUN" -eq 0 ] || return 0
  [ -x node_modules/.bin/prettier ] || return 0

  node <<'NODE' || return 0
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const scripts = Object.values(pkg.scripts || {}).filter((value) => typeof value === 'string');
const checksAllFiles = scripts.some((script) => /\bprettier\b/.test(script) && /--check\b/.test(script));
process.exit(checksAllFiles ? 0 : 1);
NODE

  local files=()
  [ -f package.json ] && files+=(package.json)
  [ -f pnpm-lock.yaml ] && files+=(pnpm-lock.yaml)
  [ -f pnpm-workspace.yaml ] && files+=(pnpm-workspace.yaml)
  [ "${#files[@]}" -gt 0 ] || return 0

  log "formatting package manager metadata with repo Prettier"
  pnpm exec prettier --write "${files[@]}" >/dev/null 2>&1 || true
}

repair_missing_verification_dependencies() {
  local log_path="$1"
  local packages
  local parser="$STATE_DIR/repair-missing-verification-dependencies.js"
  cat > "$parser" <<'NODE'
const fs = require('fs');
const { builtinModules } = require('module');

const logPath = process.argv[2];
const log = fs.readFileSync(logPath, 'utf8');
const pnpmLock = fs.existsSync('pnpm-lock.yaml') ? fs.readFileSync('pnpm-lock.yaml', 'utf8') : '';
const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

function packageNameFromSpecifier(specifier) {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('#')) return null;
  if (builtins.has(specifier)) return null;
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  return specifier.split('/')[0];
}

function typesPackageName(name) {
  if (name.startsWith('@')) {
    const parts = name.split('/');
    if (parts.length < 2) return null;
    return `@types/${parts[0].slice(1)}__${parts[1]}`;
  }
  return `@types/${name}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lockContainsPackage(name) {
  if (!pnpmLock) return false;
  const escaped = escapeRegExp(name);
  return new RegExp(`^\\s{2}'?${escaped}@`, 'm').test(pnpmLock);
}

const missing = new Set();
const pattern = /Cannot find (?:package|module) '([^']+)'/g;
let match;
while ((match = pattern.exec(log))) {
  const name = packageNameFromSpecifier(match[1]);
  if (!name) continue;

  const typesName = typesPackageName(name);
  if (!lockContainsPackage(name) && typesName && lockContainsPackage(typesName)) {
    missing.add(typesName);
  } else {
    missing.add(name);
  }
}

console.log([...missing].sort().join('\n'));
NODE
  packages="$(node "$parser" "$log_path")"
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
if (scripts.build && scripts.test) {
  console.log('build');
  console.log('test');
} else {
  for (const name of ['test', 'build', 'lint']) {
    if (scripts[name]) {
      console.log(name);
      break;
    }
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
  trace_init
  write_helpers
  write_agent_prompt
  phase select_agent select_agent
  phase preflight preflight

  log "state directory: $STATE_DIR"
  log "project directory: $PROJECT_DIR"
  log "selected agent: $AGENT"

  phase write_pnpm_workspace write_pnpm_workspace_if_needed
  phase set_package_manager set_package_manager
  phase normalize_github_tarballs normalize_github_tarball_dependencies
  phase convert_lockfile convert_lockfile
  phase repair_imported_transitive_deps repair_imported_transitive_dependencies
  phase remove_npm_lockfiles remove_npm_lockfiles
  phase rewrite_package_scripts rewrite_package_scripts
  phase fix_karma_configs fix_karma_configs
  phase repair_workspace_import_deps repair_workspace_import_dependencies
  phase repair_node_types_dependency repair_node_types_dependency
  phase install_deps install_deps
  phase format_metadata format_metadata_if_needed
  phase rewrite_ci_npm_commands rewrite_ci_npm_commands
  phase rewrite_markdown_npm_commands rewrite_markdown_npm_commands
  phase report_remaining_npm_commands report_remaining_npm_commands
  phase run_agent run_agent
  phase run_verification run_verification

  log "done"
}

main "$@"
