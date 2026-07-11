import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { readBenchmarkTargets } from "../benchmarks/targets.ts";
import { makeTempDir } from "./helpers/temp.ts";

test("reads benchmark target verification scripts", (t) => {
  const tmpDir = makeTempDir(t, "pnpm-benchmark-targets.");
  const targetsPath = path.join(tmpDir, "targets.tsv");
  writeFileSync(
    targetsPath,
    [
      "id\trepo\tcommit\tverification\tnotes",
      "fixture\towner/repo\tabc123\tbuild,test\tRuns build and test.",
      "",
    ].join("\n"),
  );

  assert.deepEqual(readBenchmarkTargets(targetsPath), [
    {
      id: "fixture",
      repo: "owner/repo",
      commit: "abc123",
      verification: "build,test",
      notes: "Runs build and test.",
    },
  ]);
});

test("reads legacy benchmark targets as migration-only", (t) => {
  const tmpDir = makeTempDir(t, "pnpm-benchmark-targets.");
  const targetsPath = path.join(tmpDir, "targets.tsv");
  writeFileSync(
    targetsPath,
    [
      "id\trepo\tcommit\tnotes",
      "fixture\towner/repo\tabc123\tLegacy row.",
      "",
    ].join("\n"),
  );

  assert.deepEqual(readBenchmarkTargets(targetsPath), [
    {
      id: "fixture",
      repo: "owner/repo",
      commit: "abc123",
      verification: "migration",
      notes: "Legacy row.",
    },
  ]);
});
