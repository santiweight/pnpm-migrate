#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGETS_FILE="${TARGETS_FILE:-$ROOT/targets/pnpm-migration-targets.tsv}"
TARGETS="${TARGETS:-$(awk -F'\t' 'NR > 1 {print $1}' "$TARGETS_FILE" | tr '\n' ' ')}"
METHODS="${METHODS:-tool claude}"

for target in $TARGETS; do
  for method in $METHODS; do
    "$ROOT/scripts/eval-method.sh" "$target" "$method"
  done
done

printf '\nResults:\n'
cat "${PNPM_MIGRATE_EVAL_ROOT:-$ROOT/.eval/methods}/results.tsv"
