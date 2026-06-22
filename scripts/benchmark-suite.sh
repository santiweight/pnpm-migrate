#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TIER="${1:-phase}"

run_eval() {
  local name="$1"
  local targets="$2"
  local skip_post="$3"
  local skip_install="$4"
  local jobs="${PNPM_MIGRATE_BENCH_JOBS:-5}"

  PNPM_MIGRATE_TRUST_LOCKFILE="${PNPM_MIGRATE_TRUST_LOCKFILE:-1}" \
  PNPM_MIGRATE_EVAL_SKIP_BASELINE=1 \
  PNPM_MIGRATE_EVAL_SKIP_POST_TEST="$skip_post" \
  PNPM_MIGRATE_EVAL_SKIP_TOOL_INSTALL="$skip_install" \
  PNPM_MIGRATE_EVAL_MIRROR_ROOT="${PNPM_MIGRATE_EVAL_MIRROR_ROOT:-$ROOT/.eval/mirrors}" \
  PNPM_MIGRATE_EVAL_ROOT="${PNPM_MIGRATE_EVAL_ROOT:-$ROOT/.eval/bench-$name}" \
  PNPM_MIGRATE_EVAL_JOBS="$jobs" \
  PNPM_MIGRATE_EVAL_TIMEOUT_SECONDS="${PNPM_MIGRATE_EVAL_TIMEOUT_SECONDS:-900}" \
  TARGETS="$targets" \
  METHODS=tool \
  "$ROOT/scripts/eval-methods.sh"
}

case "$TIER" in
  fixture)
    "$ROOT/scripts/test-local-fixture.sh"
    ;;
  lockfile)
    run_eval lockfile "opencli p5 semantic-release magicmirror highlightjs docsify winston mocha underscore" 1 1
    ;;
  phase)
    run_eval phase "opencli p5 semantic-release magicmirror highlightjs docsify winston mocha underscore" 1 0
    ;;
  canary)
    run_eval canary "uuid ramda marked bpmn-js pixijs opencli p5 semantic-release magicmirror docsify" 0 0
    ;;
  full)
    run_eval full "$(awk -F'\t' 'NR > 1 {print $1}' "$ROOT/targets/pnpm-migration-targets.tsv" | tr '\n' ' ')" 0 0
    ;;
  *)
    cat >&2 <<'USAGE'
Usage:
  scripts/benchmark-suite.sh <fixture|lockfile|phase|canary|full>

Tiers:
  fixture  Fast local deterministic fixtures.
  lockfile Deterministic migration+validation without pnpm install.
  phase    Install-inclusive migration+validation on slow targets.
  canary   Representative post-test-enabled sample.
  full     All configured targets with post-tests enabled.
USAGE
    exit 1
    ;;
esac
