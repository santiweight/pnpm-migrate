# pnpm-migrate

One-line npm-to-pnpm migration script.

```bash
curl -fsSL https://raw.githubusercontent.com/santiweight/pnpm-migrate/main/pnpm-migrate.sh | bash
```

## What It Does

- imports `package-lock.json` into `pnpm-lock.yaml`
- removes npm lockfiles
- adds `packageManager: pnpm@...`
- creates `pnpm-workspace.yaml` when needed
- rewrites common npm commands in package scripts, GitHub Actions, and Dockerfiles
- runs install and the repo's main verification script
- reports docs/release npm references for review instead of blindly rewriting them

## Safer Local Usage

```bash
git clone https://github.com/santiweight/pnpm-migrate.git
cd your-project
bash ../pnpm-migrate/pnpm-migrate.sh --yes --skip-agent
```

With Claude cleanup:

```bash
bash ../pnpm-migrate/pnpm-migrate.sh --yes --agent claude
```

## Status

Alpha. Useful, but review the diff before opening a PR.

Tested against `markdown-it`, `DOMPurify`, `bpmn-js`, `jsdoc`, and `promptfoo`. The main recurring misses are repo-specific CI checks, release workflows, and docs that intentionally mention npm or npx.

## Development

```bash
./scripts/test-local-fixture.sh
./scripts/eval-target.sh markdown-it full
```
