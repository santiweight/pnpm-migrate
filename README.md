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
