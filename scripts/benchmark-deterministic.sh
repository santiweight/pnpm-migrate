#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGETS_FILE="${TARGETS_FILE:-$ROOT/targets/pnpm-deterministic-benchmark-targets.tsv}"
TARGETS="${TARGETS:-$(awk -F'\t' 'NR > 1 {print $1}' "$TARGETS_FILE" | tr '\n' ' ')}"
TIMEOUT_SECONDS="${PNPM_MIGRATE_BENCH_TIMEOUT_SECONDS:-900}"
KEEP_ROOT="${PNPM_MIGRATE_BENCH_KEEP_ROOT:-0}"
SKIP_INSTALL="${PNPM_MIGRATE_BENCH_SKIP_INSTALL:-0}"

if [ -n "${PNPM_MIGRATE_BENCH_ROOT:-}" ]; then
  BENCH_ROOT="$PNPM_MIGRATE_BENCH_ROOT"
  mkdir -p "$BENCH_ROOT"
  CLEANUP_ROOT=0
else
  BENCH_ROOT="$(mktemp -d)"
  CLEANUP_ROOT=1
fi

BENCH_ROOT="$(cd "$BENCH_ROOT" && pwd)"
CLONE_ROOT="$BENCH_ROOT/repos"
LOG_ROOT="$BENCH_ROOT/logs"
RESULTS="$BENCH_ROOT/results.tsv"
mkdir -p "$CLONE_ROOT" "$LOG_ROOT"

cleanup() {
  if [ "$CLEANUP_ROOT" -eq 1 ] && [ "$KEEP_ROOT" -ne 1 ]; then
    rm -rf "$BENCH_ROOT"
  fi
}
trap cleanup EXIT

usage() {
  cat <<'USAGE'
Usage:
  scripts/benchmark-deterministic.sh

Environment:
  TARGETS                         Space-separated target ids. Default: all targets.
  TARGETS_FILE                    TSV with columns: id, repo, commit, notes.
  PNPM_MIGRATE_BENCH_ROOT         Directory for temp clones, logs, and results. Default: mktemp.
  PNPM_MIGRATE_BENCH_KEEP_ROOT=1  Keep auto-created temp root after the run.
  PNPM_MIGRATE_BENCH_SKIP_INSTALL=1
                                  Pass --skip-install to benchmark lockfile-only deterministic rewrites.
  PNPM_MIGRATE_BENCH_TIMEOUT_SECONDS
                                  Per phase timeout. Default: 900.

Contract:
  1. Clone each repo into a benchmark temp directory.
  2. Check out the pinned commit in detached HEAD state.
  3. Run pnpm-migrate.sh with agent and post-tests disabled.
  4. Run scripts/validate-migration.mjs against the migrated tree.
  5. Record clone, migrate, and validate statuses in results.tsv.
USAGE
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

printf 'target\trepo\tcommit\tphase\tstatus\tduration_seconds\tchanged_files\n' > "$RESULTS"

log() {
  local id="$1"
  shift
  printf '[bench:%s] %s\n' "$id" "$*"
}

changed_files() {
  local worktree="$1"
  if [ -d "$worktree/.git" ]; then
    git -C "$worktree" status --short | wc -l | tr -d ' '
  else
    printf '0'
  fi
}

record() {
  local id="$1"
  local repo="$2"
  local commit="$3"
  local phase="$4"
  local status="$5"
  local duration="$6"
  local worktree="$7"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$repo" "$commit" "$phase" "$status" "$duration" "$(changed_files "$worktree")" >> "$RESULTS"
}

timed_run() {
  local id="$1"
  local repo="$2"
  local commit="$3"
  local phase="$4"
  local worktree="$5"
  shift 5
  local start end status
  start="$(date +%s)"
  log "$id" "$phase"
  set +e
  (
    cd "$worktree"
    printf '$'
    printf ' %q' "$@"
    printf '\n'
    if [ "$TIMEOUT_SECONDS" -gt 0 ]; then
      CI=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0 perl -e 'alarm shift; exec @ARGV' "$TIMEOUT_SECONDS" "$@"
    else
      CI=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0 "$@"
    fi
  ) 2>&1 | tee "$LOG_ROOT/$id-$phase.log"
  status="${PIPESTATUS[0]}"
  set -e
  end="$(date +%s)"
  record "$id" "$repo" "$commit" "$phase" "$status" "$((end - start))" "$worktree"
  return "$status"
}

clone_target() {
  local id="$1"
  local repo="$2"
  local commit="$3"
  local worktree="$4"
  local start end status
  start="$(date +%s)"
  log "$id" "clone https://github.com/$repo.git @ $commit"
  set +e
  rm -rf "$worktree"
  git clone "https://github.com/$repo.git" "$worktree" 2>&1 | tee "$LOG_ROOT/$id-clone.log"
  status="${PIPESTATUS[0]}"
  if [ "$status" -eq 0 ]; then
    git -C "$worktree" checkout --detach "$commit" 2>&1 | tee -a "$LOG_ROOT/$id-clone.log"
    status="${PIPESTATUS[0]}"
  fi
  set -e
  end="$(date +%s)"
  record "$id" "$repo" "$commit" clone "$status" "$((end - start))" "$worktree"
  return "$status"
}

run_target() {
  local requested_id="$1"
  local row id repo commit notes worktree status migrate_args
  row="$(awk -F'\t' -v id="$requested_id" 'NR > 1 && $1 == id {print; exit}' "$TARGETS_FILE")"
  if [ -z "$row" ]; then
    printf 'unknown benchmark target: %s\n' "$requested_id" >&2
    return 1
  fi

  IFS=$'\t' read -r id repo commit notes <<EOF
$row
EOF

  worktree="$CLONE_ROOT/$id"
  status=0

  clone_target "$id" "$repo" "$commit" "$worktree" || status=1
  if [ "$status" -ne 0 ]; then
    record "$id" "$repo" "$commit" migrate 125 0 "$worktree"
    record "$id" "$repo" "$commit" validate 125 0 "$worktree"
    return 1
  fi

  migrate_args=("$ROOT/pnpm-migrate.sh" --yes --skip-agent --no-tests)
  if [ "$SKIP_INSTALL" -eq 1 ]; then
    migrate_args+=(--skip-install)
  fi

  timed_run "$id" "$repo" "$commit" migrate "$worktree" bash "${migrate_args[@]}" || status=1
  timed_run "$id" "$repo" "$commit" validate "$worktree" node "$ROOT/scripts/validate-migration.mjs" "$worktree" || status=1

  return "$status"
}

failed=0
for target in $TARGETS; do
  run_target "$target" || failed=1
done

printf '\nResults: %s\n' "$RESULTS"
cat "$RESULTS"

if [ "$KEEP_ROOT" -eq 1 ] || [ "$CLEANUP_ROOT" -eq 0 ]; then
  printf '\nBenchmark root: %s\n' "$BENCH_ROOT"
fi

exit "$failed"
