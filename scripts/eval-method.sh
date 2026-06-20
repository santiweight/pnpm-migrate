#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGETS_FILE="${TARGETS_FILE:-$ROOT/targets/pnpm-migration-targets.tsv}"
EVAL_ROOT="${PNPM_MIGRATE_EVAL_ROOT:-$ROOT/.eval/methods}"
TIMEOUT_SECONDS="${PNPM_MIGRATE_EVAL_TIMEOUT_SECONDS:-300}"
CLAUDE_PERMISSION_MODE="${PNPM_MIGRATE_CLAUDE_PERMISSION_MODE:-bypassPermissions}"
ALLOW_BASELINE_FAILURE="${PNPM_MIGRATE_EVAL_ALLOW_BASELINE_FAILURE:-0}"
SKIP_BASELINE="${PNPM_MIGRATE_EVAL_SKIP_BASELINE:-0}"
MIRROR_ROOT="${PNPM_MIGRATE_EVAL_MIRROR_ROOT:-}"
TARGET_ID="${1:-}"
METHOD="${2:-}"

usage() {
  cat <<'USAGE'
Usage:
  scripts/eval-method.sh <target-id> <tool|claude>

Runs one migration method against one target and records:
  - migration duration
  - baseline install/test status
  - validation status
  - post-migration test status
  - changed file count

Results are appended to:
  .eval/methods/results.tsv
USAGE
}

if [ -z "$TARGET_ID" ] || [ -z "$METHOD" ] || [ "$TARGET_ID" = "-h" ] || [ "$TARGET_ID" = "--help" ]; then
  usage
  exit 0
fi

case "$METHOD" in
  tool|claude) ;;
  *)
    usage >&2
    exit 1
    ;;
esac

row="$(awk -F'\t' -v id="$TARGET_ID" 'NR > 1 && $1 == id {print; exit}' "$TARGETS_FILE")"
[ -n "$row" ] || { echo "unknown target: $TARGET_ID" >&2; exit 1; }

IFS=$'\t' read -r id repo branch install_cmd baseline_cmd post_migrate_cmd notes <<EOF
$row
EOF

mkdir -p "$EVAL_ROOT"
EVAL_ROOT="$(cd "$EVAL_ROOT" && pwd)"
WORKTREE="$EVAL_ROOT/worktrees/$METHOD/$id"
LOG_DIR="$EVAL_ROOT/logs/$METHOD/$id"
RESULTS="$EVAL_ROOT/results.tsv"
mkdir -p "$LOG_DIR" "$(dirname "$RESULTS")"

if [ ! -f "$RESULTS" ]; then
  printf 'target\tmethod\tphase\tstatus\tduration_seconds\tchanged_files\n' > "$RESULTS"
fi

log() {
  printf '[eval:%s:%s] %s\n' "$METHOD" "$id" "$*"
}

changed_files() {
  git -C "$WORKTREE" status --short | wc -l | tr -d ' '
}

record() {
  local phase="$1"
  local status="$2"
  local duration="$3"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$METHOD" "$phase" "$status" "$duration" "$(changed_files)" >> "$RESULTS"
}

timed_run() {
  local phase="$1"
  shift
  local start end status
  start="$(date +%s)"
  log "$phase"
  set +e
  (
    cd "$WORKTREE"
    printf '$'
    printf ' %q' "$@"
    printf '\n'
    if [ "$TIMEOUT_SECONDS" -gt 0 ]; then
      CI=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0 perl -e 'alarm shift; exec @ARGV' "$TIMEOUT_SECONDS" "$@"
      status="$?"
      if [ "$status" -eq 142 ]; then
        printf '\nphase timed out after %s seconds\n' "$TIMEOUT_SECONDS" >&2
      fi
      exit "$status"
    fi
    CI=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0 "$@"
  ) 2>&1 | tee "$LOG_DIR/$phase.log"
  status="${PIPESTATUS[0]}"
  set -e
  end="$(date +%s)"
  record "$phase" "$status" "$((end - start))"
  return "$status"
}

clone_target() {
  mkdir -p "$(dirname "$WORKTREE")"
  if [ -d "$WORKTREE/.git" ]; then
    log "updating existing clone"
    git -C "$WORKTREE" fetch --depth 1 origin "$branch"
    git -C "$WORKTREE" checkout "$branch"
    git -C "$WORKTREE" reset --hard "origin/$branch"
    git -C "$WORKTREE" clean -fdx
  else
    log "cloning $repo#$branch"
    if [ -n "$MIRROR_ROOT" ]; then
      mkdir -p "$MIRROR_ROOT"
      local mirror="$MIRROR_ROOT/${repo//\//__}.git"
      if [ -d "$mirror" ]; then
        git -C "$mirror" fetch --prune origin
      else
        git clone --mirror "https://github.com/$repo.git" "$mirror"
      fi
      git clone --shared --branch "$branch" "$mirror" "$WORKTREE"
    else
      git clone --depth 1 --branch "$branch" "https://github.com/$repo.git" "$WORKTREE"
    fi
  fi
}

run_validation() {
  timed_run validate node "$ROOT/scripts/validate-migration.mjs" "$WORKTREE"
}

run_baseline() {
  local status=0
  timed_run baseline-install bash -lc "$install_cmd" || status=1
  timed_run baseline-test bash -lc "$baseline_cmd" || status=1
  git -C "$WORKTREE" reset --hard "origin/$branch"
  git -C "$WORKTREE" clean -fdx
  return "$status"
}

run_post_test() {
  timed_run post-test bash -lc "$post_migrate_cmd"
}

run_tool() {
  timed_run migrate bash "$ROOT/pnpm-migrate.sh" --yes --agent manual --no-tests
}

run_claude() {
  command -v claude >/dev/null 2>&1 || { echo "claude is not installed" >&2; exit 1; }
  claude auth status >/dev/null 2>&1 || { echo "claude is not logged in" >&2; exit 1; }

  timed_run claude-pass-1 claude --permission-mode "$CLAUDE_PERMISSION_MODE" --dangerously-skip-permissions -p "$(cat <<'PROMPT'
Migrate this repository from npm to pnpm.

Do not use pnpm-migrate. Make the smallest scoped changes required:
- import or regenerate a pnpm lockfile
- remove npm lockfiles
- add packageManager
- add pnpm-workspace.yaml if needed
- update package scripts, GitHub Actions, and Dockerfiles
- leave release commands and product docs alone unless they clearly block contributor workflows

Stop after making the initial migration changes.
PROMPT
)"

  run_validation || true
  timed_run claude-pass-2 claude --continue --permission-mode "$CLAUDE_PERMISSION_MODE" --dangerously-skip-permissions -p "$(cat <<PROMPT
Continue the pnpm migration. Fix validation errors from this run:

$(tail -160 "$LOG_DIR/validate.log" 2>/dev/null || true)

Keep changes scoped. Do not rewrite unrelated docs.
PROMPT
)"

  run_validation || true
  timed_run claude-pass-3 claude --continue --permission-mode "$CLAUDE_PERMISSION_MODE" --dangerously-skip-permissions -p "$(cat <<PROMPT
Continue the pnpm migration. Run the post-migration command:

$post_migrate_cmd

If it fails, fix the smallest pnpm-related issue and rerun the relevant command.
PROMPT
)"
}

clone_target
if [ "$SKIP_BASELINE" -eq 1 ]; then
  log "baseline skipped"
  record baseline-install 0 0
  record baseline-test 0 0
elif ! run_baseline && [ "$ALLOW_BASELINE_FAILURE" -ne 1 ]; then
  log "baseline failed; skipping migration phases"
  record migrate 125 0
  record validate 125 0
  record post-test 125 0
  exit 0
fi

case "$METHOD" in
  tool)
    run_tool || true
    ;;
  claude)
    run_claude || true
    ;;
esac

run_validation || true
run_post_test || true

log "done; results: $RESULTS"
