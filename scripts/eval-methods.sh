#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGETS="${TARGETS:-markdown-it jsdoc dompurify bpmn-js promptfoo}"
METHODS="${METHODS:-tool claude}"

for target in $TARGETS; do
  for method in $METHODS; do
    "$ROOT/scripts/eval-method.sh" "$target" "$method"
  done
done

printf '\nResults:\n'
cat "${PNPM_MIGRATE_EVAL_ROOT:-$ROOT/.eval/methods}/results.tsv"
