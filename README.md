# pnpm-migrate

cd into a repo that uses `npm`, and run this command:

```bash
curl -fsSL https://raw.githubusercontent.com/santiweight/pnpm-migrate/main/install.sh | bash
```

`pnpm-migrate` will migrate the basics, and then migrate the annoying stuff: readmes, dockerfiles, contributor docs, and then test that it works before making a PR for you.

## pnpm-migrate is faster than Claude

`pnpm-migrate` is **16x faster than asking Claude Code to do the npm -> pnpm migration from scratch**. Measured across 10 real-world repos.

**Core result**

| Method | 10-repo total time | Avg / repo | Result |
|---|---:|---:|---|
| `pnpm-migrate` | **270s** | **27s** | 10/10 passed |
| Claude Code from scratch | **4,408s** | **441s** | 10/10 passed |

Repos migrated: `bpmn-js`, `dayjs`, `dompurify`, `github-readme-stats`, `html5-boilerplate`, `jquery`, `jsdoc`, `lodash`, `markdown-it`, `uuid`.

## pnpm-migrate is simple

pnpm-migrate (feels great; no stress):
 1. paste the one-liner
 2. press enter
 3. get back a green PR

Regular migration (pull your hair out):
 1. look for the pnpm migration docs
 2. run commands manually
 3. mess up the steps; start again
 4. tell Claude to migrate CI
 5. realize you forgot to migrate docs
 6. tell Claude to migrate docs
 7. babysit the PR for 4 days across 10 rebases
 8. coworker complains that the docs are broken
 9. fix the docs (or forget)
 10. wonder why you didn't use `pnpm-migrate`

# Current Features

1. pnpm migration
2. only supports GitHub PRs

Please file feature requests: I will tackle them.

I don't have a roadmap, if you can think of similar problems that you'd like fixed, send them my way.

# Reach Out

I'm very responsive. Reach out to me here or via [santiweight.com](https://santiweight.com). I'm interested in meeting folks and collaborating.
