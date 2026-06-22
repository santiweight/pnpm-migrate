# Eval Suite

The eval compares two migration methods against the same target repos:

- `claude`: ask Claude Code to migrate npm to pnpm over multiple passes.
- `tool`: run `pnpm-migrate.sh`, then validate and test.

Each run records baseline install/test, migration, validation, and post-migration test phases.

Run one target:

```bash
scripts/eval-method.sh markdown-it tool
scripts/eval-method.sh markdown-it claude
```

Run all configured targets:

```bash
scripts/eval-methods.sh
```

Skip baseline install/test for a faster repeat migration check after a target has already been qualified:

```bash
PNPM_MIGRATE_EVAL_SKIP_BASELINE=1 scripts/eval-method.sh uuid tool
```

Use a local git mirror cache to make fresh eval roots clone faster:

```bash
PNPM_MIGRATE_EVAL_MIRROR_ROOT=.eval/mirrors scripts/eval-method.sh uuid tool
```

Run independent targets in parallel:

```bash
PNPM_MIGRATE_EVAL_JOBS=4 METHODS=tool scripts/eval-methods.sh
```

The runner writes wall-clock timing to:

```text
.eval/methods/wall-time.txt
```

Results are written to:

```text
.eval/methods/results.tsv
```

Summarize one or more result files:

```bash
scripts/summarize-results.mjs .eval/clean-tool/results.tsv .eval/uuid-fix3/results.tsv
```

Assert that a result file is fully green:

```bash
scripts/assert-results-pass.mjs --expect 10 .eval/overnight/20260620-011321-4/tool/results.tsv
```

Run the overnight loop until 9:00 AM:

```bash
scripts/overnight-loop.sh
```

Each overnight tool run writes `run.env` with the source commit, dirty state, target file, and timeout.

## Scorecard

Latest assertion-checked 10-target local tool run:

```text
run_id=20260620-021807-1
git_commit=4703f26c90d153db41b9c6f27716fb6789fc16b6
git_dirty=false
```

| Repo | Baseline | pnpm-migrate result | Migration time | Changed files |
| --- | --- | --- | ---: | ---: |
| `bpmn-js` | Pass | Pass | 50s | 12 |
| `dayjs` | Pass | Pass | 24s | 7 |
| `dompurify` | Pass | Pass | 97s | 11 |
| `github-readme-stats` | Pass | Pass | 14s | 11 |
| `html5-boilerplate` | Pass | Pass | 7s | 9 |
| `jquery` | Pass | Pass | 15s | 14 |
| `jsdoc` | Pass | Pass | 12s | 15 |
| `lodash` | Pass | Pass | 21s | 10 |
| `markdown-it` | Pass | Pass | 15s | 6 |
| `uuid` | Pass | Pass | 15s | 27 |

Stability check: `20260620-022729-2` also passed all 10 targets from the same clean source commit.

Fast repeat mode after targets are already baseline-qualified:

```text
PNPM_MIGRATE_EVAL_SKIP_BASELINE=1
PNPM_MIGRATE_EVAL_MIRROR_ROOT=.eval/mirrors
PNPM_MIGRATE_EVAL_JOBS=4
```

Measured local result: `.eval/parallel-fast-10-shared` passed all 10 targets in 203 seconds wall time. The equivalent sequential phase sum from the latest assertion-checked run is 466 seconds.

Current 10-repo Claude comparison:

| Repo | Claude migration | pnpm-migrate migration | Time saved |
| --- | ---: | ---: | ---: |
| `bpmn-js` | 411s, 9 files | 50s, 12 files | 361s |
| `dayjs` | 362s, 8 files | 24s, 7 files | 338s |
| `dompurify` | 817s, 14 files | 97s, 11 files | 720s |
| `github-readme-stats` | 200s, 13 files | 14s, 11 files | 186s |
| `html5-boilerplate` | 234s, 12 files | 7s, 9 files | 227s |
| `jquery` | 591s, 14 files | 15s, 14 files | 576s |
| `jsdoc` | 238s, 10 files | 12s, 15 files | 226s |
| `lodash` | 447s, 11 files | 21s, 10 files | 426s |
| `markdown-it` | 149s, 7 files | 15s, 6 files | 134s |
| `uuid` | 999s, 18 files | 15s, 27 files | 984s |

Signal: `pnpm-migrate` is useful as the deterministic migration engine. Claude is better as an optional cleanup/review pass after the tool, not as the first migration step.

Out-of-sample check:

| Repo | Claude migration | pnpm-migrate migration | Result |
| --- | ---: | ---: | --- |
| `moment` | 172s, 7 files | 23s, 6 files | Both passed; tool saved 149s after adding direct `node_modules/*/bin/*` script repair. |

## Batch 2 Expansion

Ten additional npm-lock repos were evaluated on June 22, 2026. Five were added to the sample first; five were held out, evaluated in parallel, then promoted into the sample after passing.

Sample set:

| Repo | Baseline | pnpm-migrate result | Migration time | Changed files |
| --- | ---: | --- | ---: | ---: |
| `javascript-algorithms` | 31s | Pass | 76s | 26 |
| `koa` | 16s | Pass | 27s | 6 |
| `drawio-desktop` | 15s | Pass | 28s | 10 |
| `leaflet` | 46s | Pass | 48s | 7 |
| `thirty-three-js-concepts` | 23s | Pass | 18s | 12 |

Holdout set:

| Repo | Baseline | pnpm-migrate result | Migration time | Changed files |
| --- | ---: | --- | ---: | ---: |
| `drawdb` | 122s | Pass | 74s | 7 |
| `impress` | 48s | Pass | 29s | 7 |
| `monaco-editor` | 78s | Pass | 93s | 18 |
| `remote-jobs` | 89s | Pass | 103s | 10 |
| `wtfjs` | 36s | Pass | 26s | 5 |

Batch 2 result: 10/10 passed. The first candidate sweep also exposed two deterministic gaps that were fixed before final holdout promotion:

- `wtfjs`: repos that run Prettier over the whole tree need generated package-manager metadata formatted.
- `bmad-method`: pnpm `allowBuilds` entries need double-quoted YAML keys for strict YAML lint rules.

After promotion, the expanded 20-repo target file passed in repeat mode:

```text
PNPM_MIGRATE_EVAL_SKIP_BASELINE=1
PNPM_MIGRATE_EVAL_MIRROR_ROOT=.eval/mirrors
PNPM_MIGRATE_EVAL_JOBS=5
```

Result: `.eval/batch2-expanded-20-fast` passed 20/20 targets in 385 seconds wall time.

## Batch 3 Expansion

Ten more npm-lock repos were evaluated on June 22, 2026. Five were added to the sample; five were held out, evaluated in parallel, then promoted after passing.

Sample set:

| Repo | Baseline | pnpm-migrate result | Migration time | Changed files |
| --- | ---: | --- | ---: | ---: |
| `bmad-method` | 147s | Pass | 157s | 65 |
| `htmx` | 54s | Pass | 73s | 8 |
| `iptv` | 105s | Pass | 177s | 8 |
| `swiper` | 117s | Pass | 124s | 5 |
| `videojs` | 133s | Pass | 127s | 8 |

Holdout set:

| Repo | Baseline | pnpm-migrate result | Migration time | Changed files |
| --- | ---: | --- | ---: | ---: |
| `codegraph` | 57s | Pass | 79s | 21 |
| `hexo` | 56s | Pass | 99s | 11 |
| `pixijs` | 335s | Pass | 126s | 16 |
| `quill` | 221s | Pass | 77s | 9 |
| `zx` | 50s | Pass | 108s | 14 |

Batch 3 result: 10/10 passed. The candidate sweep exposed two more deterministic fixes:

- `zx`: `npm:` package protocol references, such as Deno's `npm:types/node`, are not npm script shorthand and should not fail validation.
- `quill`: npm workspace flags must be translated without recursion. `npm run lint -ws` now becomes `pnpm -r lint`, and `npm run build -w <workspace>` becomes `pnpm --filter <workspace> build`.

After promotion, the expanded 30-repo target file passed in repeat mode:

```text
PNPM_MIGRATE_EVAL_SKIP_BASELINE=1
PNPM_MIGRATE_EVAL_MIRROR_ROOT=.eval/mirrors
PNPM_MIGRATE_EVAL_JOBS=5
```

Result: `.eval/batch3-expanded-30-fast` passed 30/30 targets in 747 seconds wall time.

`Time saved` should be calculated as:

```text
Claude total migration+repair time - pnpm-migrate total migration+repair time
```

If either method fails validation or tests, record the result as failed instead of inventing a time saved number.

Rejected or unstable local targets are tracked separately from migration failures. Examples so far:

- `axios`: npm baseline failed locally due test/environment issues before migration.
- `marked`: npm baseline failed performance-threshold tests under local load.
- `promptfoo`: npm baseline failed locally.
- `reveal-js`: npm baseline install/test failed locally.
- `anime`: npm baseline failed locally.
- `three-js`: npm baseline failed locally before migration in the addon Puppeteer suite.

## New Cases Covered

Recent eval failures added these deterministic checks:

- `npm:<script>` shorthand in package scripts is rewritten to `pnpm:<script>`.
- Dynamic CI commands such as `npm run ${{ matrix.NPM_SCRIPT }}` are rewritten to `pnpm ${{ matrix.NPM_SCRIPT }}`.
- Scoped package invocations such as `npx @puppeteer/browsers ...` are rewritten to `pnpm dlx @puppeteer/browsers ...`.
- Source imports hidden by npm's flatter install tree are promoted to direct dev dependencies when the imported package exists in `package-lock.json`.
- Contributor-style Markdown commands are rewritten, while package install examples and release/audit commands remain warnings for review.
- Direct `npm start` commands and backticked inline contributor commands are rewritten. A focused `uuid` run covers this case.
