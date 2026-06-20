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

## Scorecard

Current local run:

| Repo | Claude result | pnpm-migrate result | Tests | Time saved |
| --- | --- | --- | --- | --- |
| `markdown-it` | Pass, 149s, 7 changed files | Pass, 25s, 5 changed files | Pass | 124s |
| `DOMPurify` | Pass, 817s, 14 changed files | Pass, 562s, 8 changed files | Pass | 255s |
| `bpmn-js` | Pass, 411s, 9 changed files | Pass, 164s, 9 changed files | Pass | 247s |
| `jsdoc` | Pass, 237s, 10 changed files | Baseline-aware rerun in progress | TBD | TBD |
| `promptfoo` | TBD | TBD | TBD | TBD |
| `axios` | Not run | Baseline-aware rerun in progress | TBD | TBD |
| `dayjs` | Not run | Baseline-aware rerun in progress | TBD | TBD |
| `marked` | Not run | Baseline-aware rerun in progress | TBD | TBD |
| `lodash` | Not run | Baseline-aware rerun in progress | TBD | TBD |
| `reveal-js` | Not run | Baseline-aware rerun in progress | TBD | TBD |

Early signal: on the first three green repos, `pnpm-migrate` is materially faster than multi-pass Claude and changes fewer files on two of three. It also surfaces docs and release-command references as review items instead of blindly editing product docs.

`Time saved` should be calculated as:

```text
Claude total migration+repair time - pnpm-migrate total migration+repair time
```

If either method fails validation or tests, record the result as failed instead of inventing a time saved number.
