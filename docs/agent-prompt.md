# Agent Prompt

You are migrating this JavaScript/TypeScript repository from npm to pnpm.

Goal:

- Complete the migration so contributors use pnpm consistently.
- Preserve existing behavior and tests.
- Keep changes scoped to package manager migration.

Required checks:

- `package.json` has `packageManager` set to pnpm.
- `pnpm-lock.yaml` exists and `package-lock.json`/`npm-shrinkwrap.json` are removed.
- npm CI commands in GitHub Actions and Dockerfiles are replaced with pnpm equivalents.
- npm/npx references in docs are reviewed and classified:
  - Contributor setup/test/build docs should usually move to pnpm.
  - Product-consumer install examples, changelog history, and npm publish/version release commands may intentionally stay npm-oriented.
- Workspaces have `pnpm-workspace.yaml` when needed.
- The deterministic migration already ran one basic build-first verification command. Run broader relevant lint, test, typecheck, and build scripts when practical.
- Classify each failure as migration-caused or pre-existing. Fix only migration-caused failures and clearly report unrelated existing failures.

Do not:

- Rewrite unrelated code.
- Change dependency versions intentionally unless pnpm resolution requires it.
- Rewrite product-facing docs blindly just because they mention npm or npx.
- Copy or inspect credentials.
