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

- `migration` runs deterministic migration and structural validation.
- A comma-separated list such as `test,build,lint` runs those scripts when present. Use this for regressions that only appear during compilation or tests.

Run a subset:

```bash
TARGETS="opencli p5" pnpm benchmark
```

CI runs the pinned `clean-and-green-philly` target with `verification=build`, so its migrated Next.js production build must pass without being coupled to unrelated pre-existing lint failures.

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
3. run `pnpm-migrate.sh --yes --skip-agent`, adding `--no-tests` for `migration` targets;
4. validate the migrated repo through the shared TypeScript validation API;
5. write `results.tsv`.
