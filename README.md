# pnpm-migrate

cd into your npm project...

```bash
cd your-project
```

and run:

```bash
curl -fsSL https://raw.githubusercontent.com/santiweight/pnpm-migrate/main/pnpm-migrate.sh | bash
```

(`pnpm-migrate` does not install any scripts. it is single run, with ephemeral `/tmp` state)

## Why?

`pnpm` is a faster, production-ready alternative to `npm`.

Migrating to `pnpm` can make your JS/TS projects faster to install and easier to maintain.

## How it Works

You may be asked for Claude login credentials if you choose agent cleanup.

The script handles the deterministic migration steps, then can hand the repo to an agent for project-specific cleanup.

At the end, review the diff and submit the branch as a PR.

## What You Get

A pnpm migration diff you can review and turn into a PR.

## Supported Migration Steps

- imports `package-lock.json` into `pnpm-lock.yaml`
- removes npm lockfiles
- adds `packageManager: pnpm@...`
- creates `pnpm-workspace.yaml` when needed
- rewrites common npm commands in package scripts, GitHub Actions, and Dockerfiles
- rewrites obvious npm commands in Markdown docs
- runs install and the repo's main verification script
- reports release/audit npm references for review
