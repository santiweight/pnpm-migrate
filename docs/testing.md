# Testing

The active test suite is TypeScript-based and runs with Node's test runner.

```bash
pnpm test
pnpm check
```

`pnpm check` runs:

1. TypeScript typechecking.
2. CLI syntax validation.
3. The TypeScript test suite.

## Fixture tests

Fixture repositories are stored as git tags, not checked-in directories:

```text
test/npm-basic
test/npm-workspace
test/npm-hoisted-import
```

The fixture tests materialize each tag into a temporary directory, run `pnpm-migrate.sh`, and validate the migrated output.

To use fixtures from another clone or remote:

```bash
PNPM_MIGRATE_FIXTURE_REPO=https://github.com/santiweight/pnpm-migrate.git pnpm test
```

