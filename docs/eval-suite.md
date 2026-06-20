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

Results are written to:

```text
.eval/methods/results.tsv
```

Summarize one or more result files:

```bash
scripts/summarize-results.mjs .eval/clean-tool/results.tsv .eval/uuid-fix3/results.tsv
```

Run the overnight loop until 9:00 AM:

```bash
scripts/overnight-loop.sh
```

## Scorecard

Current corrected local tool run:

| Repo | Baseline | pnpm-migrate result | Migration time | Changed files |
| --- | --- | --- | ---: | ---: |
| `bpmn-js` | Pass | Pass | 51s | 9 |
| `dayjs` | Pass | Pass | 23s | 6 |
| `dompurify` | Pass | Pass | 213s | 8 |
| `github-readme-stats` | Pass | Pass | 12s | 10 |
| `html5-boilerplate` | Pass | Pass | 6s | 6 |
| `jquery` | Pass | Pass | 16s | 11 |
| `jsdoc` | Pass | Pass | 10s | 10 |
| `lodash` | Pass | Pass | 25s | 8 |
| `markdown-it` | Pass | Pass | 15s | 5 |
| `uuid` | Pass | Pass | 17s | 15 |

Current Claude comparison from earlier paired runs:

| Repo | Claude result | pnpm-migrate result | Signal |
| --- | --- | --- | --- |
| `markdown-it` | Pass, 149s, 7 changed files | Pass, 117s corrected run, 5 changed files | Tool is faster and smaller. |
| `DOMPurify` | Pass, 817s, 14 changed files | Pass, 103s corrected run, 8 changed files | Tool is much faster and smaller. |
| `bpmn-js` | Pass, 411s, 9 changed files | Pass, 52s corrected run, 9 changed files | Tool is much faster. |
| `jsdoc` | Pass, 237s, 10 changed files | Pass, 58s corrected run, 10 changed files | Tool is much faster. |

Signal: `pnpm-migrate` is useful as the deterministic migration engine. Claude is better as an optional cleanup/review pass after the tool, not as the first migration step.

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
- Source imports hidden by npm's flatter install tree are promoted to direct dev dependencies when the imported package exists in `package-lock.json`.
