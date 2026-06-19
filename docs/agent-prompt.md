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
- Run the repo's existing lint, test, and build scripts when practical.
- Summarize any commands that fail and make the smallest necessary fix.

Do not:

- Rewrite unrelated code.
- Change dependency versions intentionally unless pnpm resolution requires it.
- Rewrite product-facing docs blindly just because they mention npm or npx.
- Copy or inspect credentials.
