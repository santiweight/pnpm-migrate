import assert from "node:assert/strict";
import test from "node:test";
import { buildDiamondLines, splitCopyableSummaryLines } from "../src/ui/cards.ts";

test("keeps copyable migration summary values out of boxed lines", () => {
  const summary = splitCopyableSummaryLines([
    "Branch: pnpm-migrate/actor-rag-web-browser-1783789974854",
    "Changed files: 10",
    "Log: /tmp/pnpm-migrate.3QSRLP-deterministic-migration.log",
    "PR: https://github.com/example/project/pull/1",
    "Commit note: Migration failed before commit",
  ]);

  assert.deepEqual(summary.boxedLines, [
    "Changed files: 10",
    "Commit note: Migration failed before commit",
  ]);
  assert.deepEqual(summary.copyableLines, [
    "Branch: pnpm-migrate/actor-rag-web-browser-1783789974854",
    "Log: /tmp/pnpm-migrate.3QSRLP-deterministic-migration.log",
    "PR: https://github.com/example/project/pull/1",
  ]);
});

test("uses a short boxed placeholder when every summary line is copyable", () => {
  const summary = splitCopyableSummaryLines([
    "Branch: pnpm-migrate/example",
    "Log: /tmp/pnpm-migrate.log",
  ]);

  assert.deepEqual(summary.boxedLines, ["Details are printed below."]);
  assert.deepEqual(summary.copyableLines, [
    "Branch: pnpm-migrate/example",
    "Log: /tmp/pnpm-migrate.log",
  ]);
});

test("prints copyable values as one-line diamond details", () => {
  assert.deepEqual(buildDiamondLines([
    "Branch: pnpm-migrate/actor-rag-web-browser-1783790631791",
    "Log: /tmp/pnpm-migrate.SfvS6c-deterministic-migration.log",
    "PR: https://github.com/example/project/pull/1",
  ]), [
    "◇  Branch: pnpm-migrate/actor-rag-web-browser-1783790631791",
    "◇  Log: /tmp/pnpm-migrate.SfvS6c-deterministic-migration.log",
    "◇  PR: https://github.com/example/project/pull/1",
  ]);
});
