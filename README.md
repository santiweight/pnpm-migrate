# pnpm-migrate

Migrate an npm project to pnpm from an isolated git worktree.

```bash
curl -fsSL https://raw.githubusercontent.com/santiweight/pnpm-migrate/main/install.sh | bash
```

`pnpm-migrate` checks the repo, creates a temporary worktree, applies the deterministic migration, verifies it, and leaves you with a branch you can review or turn into a PR.

## What It Changes

- imports `package-lock.json` into `pnpm-lock.yaml`
- removes npm lockfiles
- adds `packageManager`
- creates `pnpm-workspace.yaml` when needed
- updates common npm commands in scripts, CI, Dockerfiles, and contributor docs
- runs install and project verification
- optionally asks Claude Code to review repo-specific cleanup

## Compared To Raw pnpm Migration

| Step | Raw pnpm pattern | pnpm-migrate |
| --- | --- | --- |
| Lockfile | Run `pnpm import` manually | Automatic |
| Package metadata | Add `packageManager` by hand | Automatic |
| Workspaces | Write `pnpm-workspace.yaml` by hand | Automatic |
| Scripts and CI | Search and rewrite npm commands | Automatic for common patterns |
| Docs | Manually update setup/test commands | Automatic for obvious contributor docs |
| Verification | Decide which install/test commands to run | Runs install and the repo verification script |
| Safety | Work in your current checkout unless you create a branch | Always uses an isolated git worktree |

## Local Development

```bash
pnpm install
pnpm check
```

Run the local version against another repo:

```bash
PNPM_MIGRATE_SOURCE_DIR=/path/to/pnpm-migrate bash /path/to/pnpm-migrate/install.sh
```
