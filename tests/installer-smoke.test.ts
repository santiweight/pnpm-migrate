import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runCommand as run, runCommandOk as runOk } from "../src/testing/process.ts";
import { repoRoot } from "./helpers/repo.ts";
import { makeTempDir } from "./helpers/temp.ts";

test("install.sh migrates in an isolated worktree without touching the source checkout", (t) => {
  const tmpDir = makeTempDir(t, "pnpm-migrate-installer.");
  const stateRoot = makeTempDir(t, "pnpm-migrate-state.");
  const binDir = path.join(tmpDir, "bin");
  const project = path.join(tmpDir, "project");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(path.join(project, ".github/workflows"), { recursive: true });

  const fakeCodex = path.join(binDir, "codex");
  writeFileSync(
    fakeCodex,
    [
      "#!/usr/bin/env bash",
      "if [ \"${1:-}\" = \"--version\" ]; then",
      "  printf 'codex 0.0.0\\n'",
      "  exit 0",
      "fi",
      "printf 'unexpected codex invocation: %s\\n' \"$*\" >&2",
      "exit 1",
    ].join("\n"),
  );
  chmodSync(fakeCodex, 0o755);

  writeFileSync(
    path.join(project, "package.json"),
    JSON.stringify({
      name: "pnpm-migrate-installer-smoke",
      version: "1.0.0",
      scripts: {
        build: "node index.js",
        ci: "npm run build && npm test",
        start: "npm run build",
        test: "node test.js",
      },
      dependencies: {
        "left-pad": "1.3.0",
      },
    }, null, 2) + "\n",
  );
  writeFileSync(
    path.join(project, "index.js"),
    [
      'const leftPad = require("left-pad");',
      'module.exports = (value) => leftPad(value, 3, "0");',
    ].join("\n") + "\n",
  );
  writeFileSync(
    path.join(project, "test.js"),
    [
      'const assert = require("node:assert/strict");',
      'const pad = require("./index.js");',
      'assert.equal(pad("7"), "007");',
    ].join("\n") + "\n",
  );
  writeFileSync(
    path.join(project, "README.md"),
    [
      "# installer smoke",
      "",
      "```bash",
      "npm install",
      "npm run build",
      "npm test",
      "npx cowsay hello",
      "```",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(project, ".github/workflows/ci.yml"),
    [
      "name: CI",
      "",
      "on:",
      "  pull_request:",
      "  push:",
      "    branches: [main]",
      "",
      "jobs:",
      "  test:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: actions/setup-node@v4",
      "        with:",
      "          node-version: 22",
      "          cache: npm",
      "      - run: npm ci",
      "      - run: npm test",
      "",
    ].join("\n"),
  );

  runOk("npm", ["install", "--package-lock-only", "--no-audit", "--no-fund"], { cwd: project });
  runOk("git", ["init", "-q"], { cwd: project });
  runOk("git", ["checkout", "-b", "main"], { cwd: project });
  runOk("git", ["add", "-A"], { cwd: project });
  runOk("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-m", "Initial npm repo"], { cwd: project });

  const beforeHead = runOk("git", ["rev-parse", "HEAD"], { cwd: project }).stdout.trim();
  assert.equal(runOk("git", ["status", "--porcelain"], { cwd: project }).stdout, "");

  const install = run("bash", [path.join(repoRoot, "install.sh")], {
    cwd: project,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      PNPM_MIGRATE_AUTO_APPROVE: "1",
      PNPM_MIGRATE_SOURCE_DIR: repoRoot,
      PNPM_MIGRATE_STATE_ROOT: stateRoot,
      PNPM_MIGRATE_TELEMETRY: "0",
    },
  });
  assert.equal(install.status, 0, install.output);

  assert.equal(runOk("git", ["rev-parse", "HEAD"], { cwd: project }).stdout.trim(), beforeHead);
  assert.equal(runOk("git", ["status", "--porcelain"], { cwd: project }).stdout, "");

  const branch = runOk("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads/pnpm-migrate/"], { cwd: project })
    .stdout
    .trim()
    .split(/\r?\n/)
    .find(Boolean);
  assert.ok(branch);

  const worktreeList = runOk("git", ["worktree", "list", "--porcelain"], { cwd: project }).stdout.split(/\r?\n/);
  let currentWorktree = "";
  let migrationWorktree = "";
  for (const line of worktreeList) {
    if (line.startsWith("worktree ")) {
      currentWorktree = line.slice("worktree ".length);
    }
    if (line === `branch refs/heads/${branch}`) {
      migrationWorktree = currentWorktree;
    }
  }
  assert.ok(migrationWorktree);

  assert.equal(existsSync(path.join(migrationWorktree, "pnpm-lock.yaml")), true);
  assert.equal(existsSync(path.join(migrationWorktree, "package-lock.json")), false);
  assert.match(JSON.parse(readFileSync(path.join(migrationWorktree, "package.json"), "utf8")).packageManager ?? "", /^pnpm@/);

  const workflow = readFileSync(path.join(migrationWorktree, ".github/workflows/ci.yml"), "utf8");
  assert.match(workflow, /cache: pnpm/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /pnpm test/);

  const readme = readFileSync(path.join(migrationWorktree, "README.md"), "utf8");
  assert.match(readme, /pnpm install/);
  assert.match(readme, /pnpm build/);
  assert.match(readme, /pnpm test/);
  assert.match(readme, /pnpm dlx cowsay hello/);

  assert.equal(runOk("git", ["status", "--porcelain"], { cwd: migrationWorktree }).stdout, "");

  runOk("git", ["worktree", "remove", "-f", migrationWorktree], { cwd: project });
  runOk("git", ["branch", "-D", branch], { cwd: project });
});
