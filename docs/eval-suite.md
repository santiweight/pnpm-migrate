# Eval Suite

The eval compares two migration methods against the same target repos:

- `claude`: ask Claude Code to migrate npm to pnpm over multiple passes.
- `tool`: run `pnpm-migrate.sh`, then validate and test.

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
| `DOMPurify` | TBD | TBD | TBD | TBD |
| `bpmn-js` | TBD | TBD | TBD | TBD |
| `jsdoc` | TBD | TBD | TBD | TBD |
| `promptfoo` | TBD | TBD | TBD | TBD |

On `markdown-it`, both methods reached passing validation and `pnpm test`. `pnpm-migrate` was faster and left product docs plus release lifecycle scripts as review items. Claude edited product docs during the repair pass even though the prompt asked it to avoid unrelated docs.

`Time saved` should be calculated as:

```text
Claude total migration+repair time - pnpm-migrate total migration+repair time
```

If either method fails validation or tests, record the result as failed instead of inventing a time saved number.
