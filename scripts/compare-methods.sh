#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DEFAULT_TARGETS="html5-boilerplate jsdoc dompurify markdown-it bpmn-js jquery dayjs uuid lodash github-readme-stats"
RUN_ID="${PNPM_MIGRATE_COMPARISON_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
EVAL_ROOT="${PNPM_MIGRATE_EVAL_ROOT:-$ROOT/.eval/comparisons/$RUN_ID}"
TARGETS="${TARGETS:-$DEFAULT_TARGETS}"
METHODS="${METHODS:-tool claude}"

cat <<EOF
comparison_run=$RUN_ID
eval_root=$EVAL_ROOT
targets=$TARGETS
methods=$METHODS
EOF

PNPM_MIGRATE_EVAL_ROOT="$EVAL_ROOT" \
PNPM_MIGRATE_EVAL_MIRROR_ROOT="${PNPM_MIGRATE_EVAL_MIRROR_ROOT:-$ROOT/.eval/mirrors}" \
PNPM_MIGRATE_EVAL_TIMEOUT_SECONDS="${PNPM_MIGRATE_EVAL_TIMEOUT_SECONDS:-1800}" \
PNPM_MIGRATE_EVAL_JOBS="${PNPM_MIGRATE_EVAL_JOBS:-1}" \
TARGETS="$TARGETS" \
METHODS="$METHODS" \
"$ROOT/scripts/eval-methods.sh"

"$ROOT/scripts/summarize-comparison.mjs" --assert-green "$EVAL_ROOT/results.tsv" | tee "$EVAL_ROOT/summary.md"
