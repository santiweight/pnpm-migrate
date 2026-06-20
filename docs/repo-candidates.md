# Repo Candidate Research

This file is the bounded research checklist for finding real npm-to-pnpm PR targets.

## Evidence To Collect

For each candidate repo, record:

- Repository:
- Stars:
- License:
- Default branch:
- Existing package manager evidence:
- CI evidence:
- Local commands to verify:
- Maintainer policy evidence:
- Risk notes:

## Current Candidate Pool

Evidence checked on 2026-06-18 with `gh api`, raw GitHub workflow files, and local eval runs.

| Repo | Evidence | Eval status |
| --- | --- | --- |
| `markdown-it/markdown-it` | Root `package.json` and `package-lock.json`; no root `pnpm-lock.yaml`; npm cache/install/test in workflows. | Green: npm baseline install/test passed; migration validator passed; pnpm post-test passed. |
| `cure53/DOMPurify` | Root `package.json` and `package-lock.json`; no root `pnpm-lock.yaml`; npm scripts in package.json and workflows. | Green: npm baseline install/test passed including Playwright chromium; migration validator passed; pnpm post-test passed. |
| `bpmn-io/bpmn-js` | Root `package.json` and `package-lock.json`; no root `pnpm-lock.yaml`; npm scripts in workflows; Karma tests. | Green after deterministic fixes: pnpm `allowBuilds`, explicit Karma plugins, and `npx` rewrite. |
| `promptfoo/promptfoo` | Root `package.json` and `package-lock.json`; no root `pnpm-lock.yaml`; workspaces: `src/app`, `site`; npm workflow references. | Tests green but PR-blocked: pnpm post-test passed with 20,095 tests after adding missing direct `yaml`, but deep CI validation flags unsupported `lockfile-lint` usage against the removed npm lockfile. |
| `jsdoc/jsdoc` | Root `package.json` and `package-lock.json`; no root `pnpm-lock.yaml`; large npm workspace repo. | Green: npm baseline install/test passed; migration validator passed; pnpm post-test passed after adding missing direct workspace and transitive dev dependencies exposed by pnpm isolation. |
| `jquery/jquery` | Root `package.json` and `package-lock.json`; no root `pnpm-lock.yaml`; dynamic GitHub Actions matrix scripts and `concurrently` npm shorthand. | Green with `test:jsdom`: migration validator passed; pnpm post-test passed after adding direct `chalk` and `yargs` dev dependencies exposed by pnpm isolation. |

## First Five Attempted

1. `markdown-it/markdown-it`
2. `cure53/DOMPurify`
3. `bpmn-io/bpmn-js`
4. `promptfoo/promptfoo`
5. `jsdoc/jsdoc`

Do not open PRs until each candidate has been cloned, migrated in a branch, and verified with its documented local commands.

## Product Requirements From Candidate Pattern

The five candidates converge on the same migration shape:

- npm workspaces in `package.json` need conversion to `pnpm-workspace.yaml`.
- `packageManager` is missing, so the tool should set `pnpm@<installed-version>`.
- CI has many simple `npm ci`, `npm test`, and `npm run <script>` commands.
- Some workflows likely contain commands that need human/agent judgment, especially `npm publish`, `npm version`, and `npx`.
- `actions/setup-node` cache settings should move from `npm` to `pnpm`.
- Dynamic workflow commands such as `npm run ${{ matrix.NPM_SCRIPT }}` should be rewritten to `pnpm ${{ matrix.NPM_SCRIPT }}`.
- Script-runner shorthands such as `npm:lint` should be rewritten to `pnpm:lint`.
- Source imports that npm satisfied through transitive hoisting can need direct dev dependencies under pnpm.
- The agent should receive a report of remaining risky npm/npx commands instead of assuming deterministic rewrites handled everything.

This confirms the value prop: the deterministic script can do the repetitive package-manager conversion, while the agent focuses on repo-specific workflow and release details.

## Deep Audit Findings

Checked on 2026-06-18 after regenerating `markdown-it`, `jsdoc`, and `promptfoo` with the current script and revalidating all five worktrees.

| Repo | Runnable npm/pnpm audit | Documentation/release audit |
| --- | --- | --- |
| `markdown-it/markdown-it` | Clean. GitHub Actions use pnpm cache/install/test and `corepack enable`; package scripts are pnpm-based. | Four warnings: user install examples, benchmark command docs, and changelog release wording. |
| `jsdoc/jsdoc` | Clean. GitHub Actions use pnpm cache/install/test and `corepack enable`; workspace package direct deps are explicit. | Eight warnings, mostly user install examples and historical changelog entries. |
| `promptfoo/promptfoo` | Not clean. Dockerfile and cache-key lockfile references are now auto-rewritten, but `lockfile-lint` does not support `pnpm-lock.yaml`; validator blocks this until the check is replaced or removed by maintainer-approved policy. | Large warning surface: product docs, agent instructions, changelog history, `npm publish`, and `npm audit fix`. Needs curated docs/release policy before PR. |
| `cure53/DOMPurify` | Clean. One package-description mention of npm lockfile behavior is non-runnable. | Needs small manual doc review if PR scope includes docs. |
| `bpmn-io/bpmn-js` | Clean. | Release workflow still uses `npm publish`, intentionally warning-only pending maintainer preference. |

Policy from the audit:

- Treat runnable package-manager references in `package.json`, GitHub Actions, and Dockerfiles as blocking errors.
- Treat Markdown, changelog, product install instructions, and release publishing commands as review warnings.
- Do not rewrite every `npm`/`npx` mention. A pnpm repo can still publish to npm and can still document npm/npx as consumer install options.
- Audit lockfile-specific tooling separately from install commands. Some npm-lock tooling, such as `lockfile-lint`, cannot be pointed at `pnpm-lock.yaml`.
