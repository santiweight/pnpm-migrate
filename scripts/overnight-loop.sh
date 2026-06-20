#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
END_HOUR="${PNPM_MIGRATE_OVERNIGHT_END_HOUR:-9}"
TARGETS_FILE="${TARGETS_FILE:-$ROOT/targets/pnpm-migration-targets.tsv}"
METHODS="${METHODS:-tool}"
TIMEOUT_SECONDS="${PNPM_MIGRATE_EVAL_TIMEOUT_SECONDS:-1200}"
SLEEP_SECONDS="${PNPM_MIGRATE_OVERNIGHT_SLEEP_SECONDS:-60}"
RUN_CLAUDE="${PNPM_MIGRATE_RUN_CLAUDE:-0}"
CLAUDE_TARGETS="${PNPM_MIGRATE_CLAUDE_TARGETS:-markdown-it html5-boilerplate github-readme-stats}"
BASE_ROOT="${PNPM_MIGRATE_OVERNIGHT_ROOT:-$ROOT/.eval/overnight}"

end_epoch() {
  node - "$END_HOUR" <<'NODE'
const endHour = Number(process.argv[2]);
const now = new Date();
const end = new Date(now);
end.setHours(endHour, 0, 0, 0);
if (end <= now) end.setDate(end.getDate() + 1);
console.log(Math.floor(end.getTime() / 1000));
NODE
}

timestamp() {
  date '+%Y-%m-%dT%H:%M:%S%z'
}

log() {
  printf '[overnight %s] %s\n' "$(timestamp)" "$*"
}

cleanup_eval_ports() {
  command -v lsof >/dev/null 2>&1 || return 0

  local port pid cwd
  for port in 9877; do
    while IFS= read -r pid; do
      [ -n "$pid" ] || continue
      cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
      case "$cwd" in
        "$ROOT/.eval"/*|"$BASE_ROOT"/*)
          log "stopping stale eval process $pid on port $port"
          kill "$pid" 2>/dev/null || true
          ;;
      esac
    done < <(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  done
}

run_tool_eval() {
  local run_id="$1"
  local run_root="$BASE_ROOT/$run_id/tool"
  mkdir -p "$run_root"
  {
    printf 'run_id=%s\n' "$run_id"
    printf 'started_at=%s\n' "$(timestamp)"
    printf 'method=tool\n'
    printf 'git_commit=%s\n' "$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || printf unknown)"
    printf 'git_dirty=%s\n' "$(test -z "$(git -C "$ROOT" status --porcelain 2>/dev/null)" && printf false || printf true)"
    printf 'targets_file=%s\n' "$TARGETS_FILE"
    printf 'timeout_seconds=%s\n' "$TIMEOUT_SECONDS"
  } > "$run_root/run.env"
  log "tool eval: $run_root"
  PNPM_MIGRATE_EVAL_ROOT="$run_root" \
  PNPM_MIGRATE_EVAL_TIMEOUT_SECONDS="$TIMEOUT_SECONDS" \
  TARGETS_FILE="$TARGETS_FILE" \
  METHODS="tool" \
    "$ROOT/scripts/eval-methods.sh"
  node "$ROOT/scripts/summarize-results.mjs" "$run_root/results.tsv" > "$run_root/summary.md"
  node "$ROOT/scripts/assert-results-pass.mjs" --expect "$(awk -F'\t' 'NR > 1 {count++} END {print count + 0}' "$TARGETS_FILE")" "$run_root/results.tsv"
}

run_claude_eval() {
  local run_id="$1"
  local run_root="$BASE_ROOT/$run_id/claude"
  [ "$RUN_CLAUDE" = "1" ] || return 0
  mkdir -p "$run_root"
  log "claude eval: $run_root"
  PNPM_MIGRATE_EVAL_ROOT="$run_root" \
  PNPM_MIGRATE_EVAL_TIMEOUT_SECONDS="$TIMEOUT_SECONDS" \
  TARGETS_FILE="$TARGETS_FILE" \
  TARGETS="$CLAUDE_TARGETS" \
  METHODS="claude" \
    "$ROOT/scripts/eval-methods.sh"
  node "$ROOT/scripts/summarize-results.mjs" "$run_root/results.tsv" > "$run_root/summary.md"
}

main() {
  mkdir -p "$BASE_ROOT"
  local end
  end="$(end_epoch)"
  log "starting; will stop after epoch $end"

  local iteration=1
  while [ "$(date +%s)" -lt "$end" ]; do
    local run_id
    run_id="$(date '+%Y%m%d-%H%M%S')-$iteration"
    log "iteration $iteration"

    cleanup_eval_ports

    if "$ROOT/scripts/test-local-fixture.sh"; then
      log "local fixtures passed"
    else
      log "local fixtures failed; continuing to evals"
    fi

    run_tool_eval "$run_id" || log "tool eval failed for $run_id"
    run_claude_eval "$run_id" || log "claude eval failed for $run_id"

    find "$BASE_ROOT/$run_id" -maxdepth 3 -name summary.md -print -exec cat {} \; > "$BASE_ROOT/latest-summary.md" 2>/dev/null || true

    iteration="$((iteration + 1))"
    log "sleeping $SLEEP_SECONDS seconds"
    sleep "$SLEEP_SECONDS"
  done

  log "finished"
}

main "$@"
