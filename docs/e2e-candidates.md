# Deterministic E2E Candidates

These targets are pinned npm repositories used to evaluate deterministic npm to pnpm migration behavior.

| Target | Repo | Stars | Migration issue | Status | Notes |
| --- | --- | ---: | --- | --- | --- |
| clean-and-green-philly | santiweight/clean-and-green-philly | 0 | n/a | Passing | Owned Next.js smoke target. |
| actor-rag-web-browser | apify/actor-rag-web-browser | 73 | https://github.com/apify/actor-rag-web-browser/issues/104 | Failing | Full deterministic verification reaches a TypeScript TS2742 portability failure. |
| axe-core | dequelabs/axe-core | 7303 | https://github.com/dequelabs/axe-core/issues/5111 | Passing | Full deterministic migration and `pnpm build` pass. Remaining release/publish npm commands are reported for maintainer review. |
| pollinations | pollinations/pollinations | 4809 | https://github.com/pollinations/pollinations/issues/11484 | Passing | Workspace migration passes structural validation. Root has no default `test`, `build`, or `lint` script, so verification is shallow. Many docs/release npm references are reported for review. |
| jaeger-ui | jaegertracing/jaeger-ui | 1503 | https://github.com/jaegertracing/jaeger-ui/issues/4115 | Failing | `pnpm import` fails because `packages/jaeger-ui` depends on unpublished `@jaegertracing/plexus@0.2.0`; npm lockfile import cannot produce `pnpm-lock.yaml`. |
| wa-js | wppconnect-team/wa-js | 768 | https://github.com/wppconnect-team/wa-js/issues/3428 | Failing | Migration validates, but `pnpm test` fails because `playwright test --project tests` resolves to a Playwright CLI without the `test` command. |
| vscode-containers | microsoft/vscode-containers | 125 | https://github.com/microsoft/vscode-containers/issues/520 | Failing | Migration validates, but `pnpm build` exposes missing direct dependencies/types: `@vscode/extension-telemetry` and Mocha test globals. |
