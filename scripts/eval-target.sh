#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGETS_FILE="${TARGETS_FILE:-$ROOT/targets/pnpm-migration-targets.tsv}"
EVAL_ROOT="${PNPM_MIGRATE_EVAL_ROOT:-$ROOT/.eval}"
TARGET_ID="${1:-}"
MODE="${2:-full}"
AGENT="${AGENT:-manual}"

usage() {
  cat <<'USAGE'
Usage:
  scripts/eval-target.sh <target-id> [clone|baseline|migrate|post|full]

Environment:
  AGENT=manual|claude       Agent passed to pnpm-migrate.sh during migrate.
  PNPM_MIGRATE_EVAL_ROOT    Directory for clones and logs. Default: ./.eval
USAGE
}

if [ -z "$TARGET_ID" ] || [ "$TARGET_ID" = "-h" ] || [ "$TARGET_ID" = "--help" ]; then
  usage
  exit 0
fi

row="$(awk -F'\t' -v id="$TARGET_ID" 'NR > 1 && $1 == id {print; exit}' "$TARGETS_FILE")"
[ -n "$row" ] || { echo "unknown target: $TARGET_ID" >&2; exit 1; }

IFS=$'\t' read -r id repo commit install_cmd baseline_cmd post_migrate_cmd notes <<EOF
$row
EOF

WORKTREE="$EVAL_ROOT/worktrees/$id"
LOG_DIR="$EVAL_ROOT/logs/$id"
mkdir -p "$LOG_DIR"

log() {
  printf '[eval:%s] %s\n' "$id" "$*"
}

run_logged() {
  local name="$1"
  shift
  log "$name"
  (
    cd "$WORKTREE"
    printf '$'
    printf ' %q' "$@"
    printf '\n'
    "$@"
  ) 2>&1 | tee "$LOG_DIR/$name.log"
}

clone_target() {
  mkdir -p "$EVAL_ROOT/worktrees"
  if [ -d "$WORKTREE/.git" ]; then
    log "updating existing clone"
    git -C "$WORKTREE" fetch origin
    git -C "$WORKTREE" checkout --detach "$commit"
    git -C "$WORKTREE" reset --hard "$commit"
    git -C "$WORKTREE" clean -fdx
  else
    log "cloning $repo@$commit"
    git clone "https://github.com/$repo.git" "$WORKTREE"
    git -C "$WORKTREE" checkout --detach "$commit"
  fi
}

run_baseline() {
  run_logged baseline-install bash -lc "$install_cmd"
  run_logged baseline-test bash -lc "$baseline_cmd"
}

run_migrate() {
  run_logged migrate bash "$ROOT/pnpm-migrate.sh" --yes --agent "$AGENT"
}

run_post() {
  run_logged validate node "$ROOT/scripts/validate-migration.mjs" "$WORKTREE"
  run_logged post-test bash -lc "$post_migrate_cmd"
}

case "$MODE" in
  clone)
    clone_target
    ;;
  baseline)
    clone_target
    run_baseline
    ;;
  migrate)
    clone_target
    run_migrate
    ;;
  post)
    run_post
    ;;
  full)
    clone_target
    run_baseline
    run_migrate
    run_post
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac

log "done"
