#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGETS_FILE="${TARGETS_FILE:-$ROOT/targets/pnpm-migration-targets.tsv}"
MODE="${1:-full}"

awk -F'\t' 'NR > 1 {print $1}' "$TARGETS_FILE" | while IFS= read -r target; do
  "$ROOT/scripts/eval-target.sh" "$target" "$MODE"
done
