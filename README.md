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

## Benchmarks

In 10 local repo evals, `pnpm-migrate` was 16.5x faster than asking Claude Code to migrate manually.

| Repo | Claude | pnpm-migrate | Saved |
| --- | ---: | ---: | ---: |
| `bpmn-js` | 411s | 50s | 361s |
| `dayjs` | 362s | 24s | 338s |
| `dompurify` | 817s | 97s | 720s |
| `github-readme-stats` | 200s | 14s | 186s |
| `html5-boilerplate` | 234s | 7s | 227s |
| `jquery` | 591s | 15s | 576s |
| `jsdoc` | 238s | 12s | 226s |
| `lodash` | 447s | 21s | 426s |
| `markdown-it` | 149s | 15s | 134s |
| `uuid` | 999s | 15s | 984s |

Fresh 10-repo expansion:

| Repo | Set | Baseline | pnpm-migrate | Files | Result |
| --- | --- | ---: | ---: | ---: | --- |
| `javascript-algorithms` | sample | 31s | 76s | 26 | Pass |
| `koa` | sample | 16s | 27s | 6 | Pass |
| `drawio-desktop` | sample | 15s | 28s | 10 | Pass |
| `leaflet` | sample | 46s | 48s | 7 | Pass |
| `thirty-three-js-concepts` | sample | 23s | 18s | 12 | Pass |
| `drawdb` | holdout | 122s | 74s | 7 | Pass |
| `impress` | holdout | 48s | 29s | 7 | Pass |
| `monaco-editor` | holdout | 78s | 93s | 18 | Pass |
| `remote-jobs` | holdout | 89s | 103s | 10 | Pass |
| `wtfjs` | holdout | 36s | 26s | 5 | Pass |

The holdout set passed before being promoted into the sample.

The full 20-repo sample now passes in repeat eval mode in 385 seconds wall time.

Second 10-repo expansion:

| Repo | Set | Baseline | pnpm-migrate | Files | Result |
| --- | --- | ---: | ---: | ---: | --- |
| `bmad-method` | sample | 147s | 157s | 65 | Pass |
| `htmx` | sample | 54s | 73s | 8 | Pass |
| `iptv` | sample | 105s | 177s | 8 | Pass |
| `swiper` | sample | 117s | 124s | 5 | Pass |
| `videojs` | sample | 133s | 127s | 8 | Pass |
| `codegraph` | holdout | 57s | 79s | 21 | Pass |
| `hexo` | holdout | 56s | 99s | 11 | Pass |
| `pixijs` | holdout | 335s | 126s | 16 | Pass |
| `quill` | holdout | 221s | 77s | 9 | Pass |
| `zx` | holdout | 50s | 108s | 14 | Pass |

The target sample now covers 30 repos and passes repeat eval mode in 747 seconds wall time.

## Supported Migration Steps

- imports `package-lock.json` into `pnpm-lock.yaml`
- removes npm lockfiles
- adds `packageManager: pnpm@...`
- creates `pnpm-workspace.yaml` when needed
- rewrites common npm commands in package scripts, GitHub Actions, and Dockerfiles
- rewrites contributor-style npm commands in Markdown docs
- runs install and the repo's main verification script
- reports release/audit npm references for review
