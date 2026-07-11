import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runCommand } from "../src/testing/process.ts";
import { repoRoot } from "./helpers/repo.ts";
import { makeTempDir } from "./helpers/temp.ts";

function extractBuildApprovalHelper(): string {
  const engine = readFileSync(path.join(repoRoot, "pnpm-migrate.sh"), "utf8");
  const match = engine.match(/cat > "\$STATE_DIR\/upsert-pnpm-allow-builds\.js" <<'NODE'\n([\s\S]*?)\nNODE/);
  assert.ok(match, "build approval helper not found");
  return match[1];
}

function runHelper(t: Parameters<typeof makeTempDir>[0], mode: string): string {
  const tmpDir = makeTempDir(t, "pnpm-build-approval.");
  const binDir = path.join(tmpDir, "bin");
  mkdirSync(binDir, { recursive: true });

  writeFileSync(path.join(tmpDir, "helper.js"), extractBuildApprovalHelper());
  writeFileSync(
    path.join(tmpDir, "install.log"),
    [
      "╭ Warning ─────────────────────────────────────────────────────────────────────╮",
      "│   Ignored build scripts: chromedriver, core-js, core-js-pure, es5-ext,       │",
      "│   esbuild, wcag-act-rules.                                                   │",
      "│   Run \"pnpm approve-builds\" to pick which dependencies should be allowed     │",
      "╰──────────────────────────────────────────────────────────────────────────────╯",
      "",
    ].join("\n"),
  );

  const fakePnpm = path.join(binDir, "pnpm");
  writeFileSync(fakePnpm, "#!/usr/bin/env sh\necho 10.17.1\n");
  chmodSync(fakePnpm, 0o755);

  const result = runCommand("node", ["helper.js", "install.log"], {
    cwd: tmpDir,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      PNPM_MIGRATE_BUILD_APPROVAL_CONFIG: mode,
    },
  });
  if (mode === "off") {
    assert.notEqual(result.status, 0);
    return "";
  }

  assert.equal(result.status, 0, result.output);
  return readFileSync(path.join(tmpDir, "pnpm-workspace.yaml"), "utf8");
}

test("build approval config can be forced to pnpm 10 format", (t) => {
  const workspace = runHelper(t, "pnpm10");
  assert.match(workspace, /onlyBuiltDependencies:/);
  assert.match(workspace, /- "chromedriver"/);
  assert.doesNotMatch(workspace, /allowBuilds:/);
});

test("build approval config can be forced to pnpm 11 format", (t) => {
  const workspace = runHelper(t, "pnpm11");
  assert.match(workspace, /allowBuilds:/);
  assert.match(workspace, /"chromedriver": true/);
  assert.doesNotMatch(workspace, /onlyBuiltDependencies:/);
});

test("build approval config can be disabled", (t) => {
  const workspace = runHelper(t, "off");
  assert.equal(workspace, "");
});
