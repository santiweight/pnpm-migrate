#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGETS_FILE="${TARGETS_FILE:-$ROOT/targets/pnpm-migration-targets.tsv}"
TARGETS="${TARGETS:-$(awk -F'\t' 'NR > 1 {print $1}' "$TARGETS_FILE" | tr '\n' ' ')}"
METHODS="${METHODS:-tool claude}"
EVAL_ROOT="${PNPM_MIGRATE_EVAL_ROOT:-$ROOT/.eval/methods}"
JOBS="${PNPM_MIGRATE_EVAL_JOBS:-1}"
START_SECONDS="$(date +%s)"

record_wall_time() {
  local end_seconds
  end_seconds="$(date +%s)"
  mkdir -p "$EVAL_ROOT"
  printf 'wall_seconds=%s\n' "$((end_seconds - START_SECONDS))" > "$EVAL_ROOT/wall-time.txt"
}

if [ "$JOBS" -le 1 ]; then
  for target in $TARGETS; do
    for method in $METHODS; do
      "$ROOT/scripts/eval-method.sh" "$target" "$method"
    done
  done

  printf '\nResults:\n'
  cat "$EVAL_ROOT/results.tsv"
  record_wall_time
  exit 0
fi

mkdir -p "$EVAL_ROOT/jobs" "$EVAL_ROOT/job-logs" "$EVAL_ROOT/job-status"
rm -f "$EVAL_ROOT/results.tsv"
rm -f "$EVAL_ROOT"/job-status/*.status 2>/dev/null || true
expected_jobs=0

active_jobs() {
  jobs -pr | wc -l | tr -d ' '
}

launch_job() {
  local target="$1"
  local method="$2"
  local job_id="${target}-${method}"
  local job_root="$EVAL_ROOT/jobs/$job_id"
  local job_log="$EVAL_ROOT/job-logs/$job_id.log"
  local status_file="$EVAL_ROOT/job-status/$job_id.status"

  (
    set +e
    PNPM_MIGRATE_EVAL_ROOT="$job_root" "$ROOT/scripts/eval-method.sh" "$target" "$method" > "$job_log" 2>&1
    printf '%s\n' "$?" > "$status_file"
  ) &
}

for target in $TARGETS; do
  for method in $METHODS; do
    while [ "$(active_jobs)" -ge "$JOBS" ]; do
      sleep 1
    done
    launch_job "$target" "$method"
    expected_jobs="$((expected_jobs + 1))"
  done
done

set +e
wait
set -e

printf 'target\tmethod\tphase\tstatus\tduration_seconds\tchanged_files\n' > "$EVAL_ROOT/results.tsv"
for results in "$EVAL_ROOT"/jobs/*/results.tsv; do
  [ -f "$results" ] || continue
  tail -n +2 "$results" >> "$EVAL_ROOT/results.tsv"
done

failed=0
completed_jobs=0
for status in "$EVAL_ROOT"/job-status/*.status; do
  [ -f "$status" ] || continue
  completed_jobs="$((completed_jobs + 1))"
  if [ "$(cat "$status")" -ne 0 ]; then
    failed=1
  fi
done
if [ "$completed_jobs" -ne "$expected_jobs" ]; then
  failed=1
fi

printf '\nResults:\n'
cat "$EVAL_ROOT/results.tsv"
record_wall_time

if [ "$failed" -ne 0 ]; then
  printf 'one or more eval jobs failed; see %s/job-logs\n' "$EVAL_ROOT" >&2
  exit 1
fi
