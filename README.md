# pnpm-migrate

`pnpm-migrate` is a one-line bash tool for migrating an existing npm project to pnpm, then optionally handing the repo to an agent CLI for project-specific cleanup.

Current status: local MVP.

## UX Target

```bash
curl -fsSL https://raw.githubusercontent.com/santiweight/pnpm-migrate/main/pnpm-migrate.sh | bash
```

The command starts an interactive script that:

1. Creates ephemeral state under `~/.pnpm_migrate`.
2. Deletes that state on startup and process exit.
3. Shows an agent menu.
4. Uses the selected agent's own CLI auth instead of copying credentials.
5. Runs deterministic pnpm migration steps.
6. Optionally asks the agent to finish repo-specific cleanup.

For local development:

```bash
bash ./pnpm-migrate.sh
```

Useful noninteractive mode:

```bash
bash ./pnpm-migrate.sh --yes --agent claude
```

Deterministic-only mode:

```bash
bash ./pnpm-migrate.sh --yes --skip-agent
```

## What It Changes

- Creates `pnpm-workspace.yaml` from `package.json` workspaces when needed.
- Runs `pnpm import` for `package-lock.json`, `npm-shrinkwrap.json`, or `yarn.lock`.
- Sets `packageManager` to the current pnpm version when missing or set to npm.
- Removes npm lockfiles after import.
- Runs `pnpm install`.
- Rewrites obvious npm commands in GitHub Actions and Dockerfiles.
- Reports npm/npx commands in Markdown docs for human or agent review.
- Optionally runs Claude Code with a specialized migration prompt.
- Runs the repo's primary verification script, preferring `test`, then `build`, then `lint`.

## Agent Auth Model

The tool does not copy, read, or store agent credentials.

For Claude Code, it checks:

```bash
claude auth status
```

If the user is not logged in, it delegates login to Claude:

```bash
claude auth login
```

This follows the safer pattern from tools that reuse local agent CLIs: the selected CLI owns its credentials and this script only invokes the CLI.

## Candidate Repo Criteria

Use bounded selection before attempting PRs:

- Open source, actively maintained, and accepting dependency/tooling PRs.
- Root `package.json` exists.
- Root `package-lock.json` or `npm-shrinkwrap.json` exists.
- No `pnpm-lock.yaml` exists.
- CI uses `npm ci`, `npm install`, or `npm run`.
- Test/build commands can run locally in reasonable time.
- Maintainers do not document npm as a hard requirement.

Initial research should produce five candidates with evidence for each item above. Then pick three low-risk repos for migration PRs.

## Local Validation

```bash
./scripts/test-local-fixture.sh
```

## Real Repo Evals

Targets live in `targets/pnpm-migration-targets.tsv`.

Run one full eval:

```bash
./scripts/eval-target.sh markdown-it full
```

Run all targets:

```bash
./scripts/eval-targets.sh full
```

Current green migrations:

- `markdown-it/markdown-it`: npm baseline install/test passed; pnpm migration validation passed; pnpm post-test passed.
- `cure53/DOMPurify`: npm baseline install/test passed, including Playwright chromium; pnpm migration validation passed; pnpm post-test passed.
- `bpmn-io/bpmn-js`: npm baseline install/test passed; pnpm migration validation passed; pnpm post-test passed with 2246 Karma tests.
- `promptfoo/promptfoo`: npm baseline install/test passed with 20,095 tests; migration added missing direct `yaml` dev dependency exposed by pnpm isolation; pnpm post-test passed with 20,095 tests. Deep CI audit now blocks this as not PR-ready because an existing `lockfile-lint --path package-lock.json` check has no pnpm-lock equivalent in `lockfile-lint`.
- `jsdoc/jsdoc`: npm baseline install/test passed with 1625 passing specs and 23 pending; migration added missing direct workspace dev dependencies exposed by pnpm isolation; pnpm validation passed; pnpm post-test passed with the same spec count.

Deep audit status:

- Four of five worktrees pass `scripts/validate-migration.mjs`; `promptfoo` is intentionally failing validation on the unsupported lockfile-lint check.
- Runnable surfaces are checked as errors: `package.json` scripts, GitHub Actions, and Dockerfiles.
- Documentation and changelog npm/npx references are checked as warnings because many are product-consumer examples or historical notes.
- `npm publish`, `npm version`, and `npm audit` are warning-only because release/security workflows need maintainer judgment.
- The latest promptfoo audit produced 1,300+ doc warnings; those should not be blindly rewritten.
- Dockerfile and CI cache references to `package-lock.json` are rewritten to `pnpm-lock.yaml`; unsupported lockfile tooling is left as a blocking validation error.

Interesting automation found by evals:

- `npm run <script> -- <args>` must become `pnpm <script> <args>`, not `pnpm <script> -- <args>`.
- `npm install --prefix <dir>` maps to `pnpm --dir <dir> install`.
- `npx -y npm@<version> ci` should collapse to `pnpm install --frozen-lockfile`; rewriting it to `pnpm exec -y npm@...` is invalid.
- CI steps that only upgrade npm become obsolete when the install step moves to pnpm; rewriting them to `pnpm install -g npm@...` is invalid.
- GitHub Actions needs `corepack enable` or another pnpm setup step before pnpm commands. Insert it after the full `actions/setup-node` step, not inside the `with:` block.
- Lockfile references are broader than install commands: Dockerfile `COPY`, CI cache keys, and lockfile-specific lint/security checks must be audited too.
- pnpm may require `allowBuilds` in `pnpm-workspace.yaml` for ignored dependency build scripts.
- Karma configs that rely on implicit `karma-*` plugin discovery may need explicit `plugins: [require(...)]` entries under pnpm.
- Markdown command examples can be product-facing contract, so deterministic migration should report Markdown npm/npx commands instead of rewriting them.
- pnpm's stricter dependency isolation can expose undeclared direct imports; the tool can add missing dev dependencies when verification fails with `Cannot find package ...`.
- Workspace packages can rely on sibling package hoisting under npm; the tool now scans sibling workspace imports and adds missing direct workspace dev dependencies before install.
