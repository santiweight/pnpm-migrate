# pnpm-migrate

Go to your npm repo, and run this command:

```bash
curl -fsSL https://raw.githubusercontent.com/santiweight/pnpm-migrate/main/install.sh | bash
```

`pnpm-migrate` will migrate the basics, and then migrate the annoying stuff: readmes, dockerfiles, contributor docs, and then test that it works before making a PR for you.

# Why use pnpm-migrate?

## pnpm-migrate is faster than Claude

`pnpm-migrate` is about **16x faster than asking Claude Code to do the npm -> pnpm migration from scratch** on our 10-repo benchmark.

**Core result**

| Method | 10-repo total time | Avg / repo | Result |
|---|---:|---:|---|
| `pnpm-migrate` | **270s** | **27s** | 10/10 passed |
| Claude Code from scratch | **4,408s** | **441s** | 10/10 passed |

## pnpm-migrate is simple

pnpm-migrate (feels great; no stress):
 1. paste the one-liner
 2. press enter
 3. get back a green PR

Regular migration (pull your hair out):
 1. look for the pnpm migration docs
 2. run `pnpm import` manually
 3. add `packageManager` by hand
 4. write `pnpm-workspace.yaml` by hand
 5. tell Claude to migrate CI
 6. realize you forgot to migrate docs
 7. tell Claude to migrate docs (or forget)
 8. tell Claude to check things for you (or forget)
 9. manually run all the commands you need

# Current Features

1. pnpm migration
2. only supports GitHub PRs

Please file feature requests: I will tackle them.

I don't have a roadmap, if you can think of similar problems that you'd like fixed, send them my way.

# Reach Out

I'm very responsive. Reach out to me here or via [santiweight.com](https://santiweight.com). I'm interested in meeting folks and collaborating.
