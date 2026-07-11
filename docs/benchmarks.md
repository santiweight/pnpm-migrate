# Benchmarks

Benchmarks are separate from the test suite. They use pinned repo commits so results are stable over time.

```bash
pnpm benchmark
```

Targets live in:

```text
benchmarks/targets.tsv
```

Target rows have this shape:

```text
id	repo	commit	verification	notes
```

`verification` controls which of the target's own verification scripts run:

- `default` runs the same deterministic migration and verification path as the interactive Continue flow.
- A comma-separated list such as `test,build,lint` runs those scripts when present. Use this for regressions that only appear during compilation or tests.

Run a subset:

```bash
TARGETS="opencli p5" pnpm benchmark
```

CI runs pinned deterministic e2e smoke targets for `clean-and-green-philly` and `actor-rag-web-browser`.

Each smoke clones the pinned repo commit, runs the deterministic migration end to end, validates the migrated output, installs with pnpm, and runs the same default project verification path as the interactive Continue flow.

Keep the temporary benchmark directory:

```bash
PNPM_MIGRATE_BENCH_KEEP_ROOT=1 pnpm benchmark
```

Write benchmark output to a stable directory:

```bash
PNPM_MIGRATE_BENCH_ROOT=.eval/deterministic pnpm benchmark
```

Skip dependency install for a faster lockfile/rewrite benchmark:

```bash
PNPM_MIGRATE_BENCH_SKIP_INSTALL=1 pnpm benchmark
```

The benchmark contract is:

1. clone the target repo into a temporary directory;
2. check out the pinned commit in detached HEAD state;
3. run `pnpm-migrate.sh --yes --skip-agent`;
4. validate the migrated repo through the shared TypeScript validation API;
5. write `results.tsv`.
