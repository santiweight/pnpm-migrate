#!/usr/bin/env bash
set -euo pipefail

REPO="${PNPM_MIGRATE_REPO:-santiweight/pnpm-migrate}"
REF="${PNPM_MIGRATE_REF:-main}"
SOURCE_DIR="${PNPM_MIGRATE_SOURCE_DIR:-}"
STATE_ROOT="${PNPM_MIGRATE_STATE_ROOT:-/tmp}"
STATE_DIR=""

cleanup() {
  if [ -n "$STATE_DIR" ]; then
    rm -rf "$STATE_DIR"
  fi
}

fail() {
  printf 'pnpm-migrate installer: %s\n' "$*" >&2
  exit 1
}

has_tty() {
  [ -r /dev/tty ] && [ -w /dev/tty ] && (: < /dev/tty) 2>/dev/null
}

command -v node >/dev/null 2>&1 || fail "node is required"
command -v npm >/dev/null 2>&1 || fail "npm is required"
command -v curl >/dev/null 2>&1 || fail "curl is required"
command -v tar >/dev/null 2>&1 || fail "tar is required"

mkdir -p "$STATE_ROOT"
STATE_DIR="$(mktemp -d "$STATE_ROOT/pnpm-migrate.XXXXXX")"
trap cleanup EXIT INT TERM

if [ -n "$SOURCE_DIR" ]; then
  [ -d "$SOURCE_DIR" ] || fail "PNPM_MIGRATE_SOURCE_DIR does not exist: $SOURCE_DIR"
  tar \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='.eval' \
    -cf - -C "$SOURCE_DIR" . | tar -xf - -C "$STATE_DIR"
else
  archive="$STATE_DIR/source.tar.gz"
  curl -fsSL "https://github.com/$REPO/archive/$REF.tar.gz" -o "$archive"
  tar -xzf "$archive" -C "$STATE_DIR" --strip-components 1
fi

npm install --prefix "$STATE_DIR" --omit=dev --no-audit --no-fund --silent

needs_tty=1
if [ "${PNPM_MIGRATE_AUTO_APPROVE:-0}" = "1" ]; then
  needs_tty=0
fi
for arg in "$@"; do
  case "$arg" in
    -h|--help)
      needs_tty=0
      ;;
  esac
done

if [ "$needs_tty" -eq 1 ] && ! has_tty; then
  fail "interactive mode requires a TTY; run pnpm-migrate from a terminal"
fi

if has_tty; then
  node "$STATE_DIR/src/cli.mjs" "$@" < /dev/tty
else
  node "$STATE_DIR/src/cli.mjs" "$@"
fi
