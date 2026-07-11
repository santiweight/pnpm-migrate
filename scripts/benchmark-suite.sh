#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TIER="${1:-deterministic}"

usage() {
  cat <<'USAGE'
Usage:
  scripts/benchmark-suite.sh <fixture|deterministic>

Tiers:
  fixture  Fast local deterministic fixtures.
  deterministic Pinned repo+commit deterministic migration+validation benchmark.
USAGE
}

if [ "$TIER" = "-h" ] || [ "$TIER" = "--help" ]; then
  usage
  exit 0
fi

case "$TIER" in
  fixture)
    "$ROOT/scripts/test-local-fixture.sh"
    ;;
  deterministic)
    "$ROOT/scripts/benchmark-deterministic.sh"
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
