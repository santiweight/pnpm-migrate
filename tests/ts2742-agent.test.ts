import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { runCleanup } from "../src/core/cleanup.ts";
import type { MigrationWorktree } from "../src/core/worktree.ts";
import { runCommand, runCommandOk } from "../src/testing/process.ts";

function writeTs2742Project(project: string): void {
  writeFileSync(path.join(project, "package.json"), `${JSON.stringify({
    name: "ts2742-agent-repro",
    version: "1.0.0",
    private: true,
    type: "module",
    scripts: {
      build: "tsc",
    },
    dependencies: {
      express: "4.21.2",
    },
    devDependencies: {
      "@types/express": "5.0.5",
      "@types/node": "22.19.1",
      typescript: "5.9.3",
    },
  }, null, 2)}\n`);
  writeFileSync(path.join(project, "index.ts"), [
    "import express from 'express';",
    "",
    "export function createApp() {",
    "  const app = express();",
    "  app.get('/ok', (_req, res) => res.send('ok'));",
    "  return app;",
    "}",
    "",
  ].join("\n"));
  writeFileSync(path.join(project, "tsconfig.json"), `${JSON.stringify({
    compilerOptions: {
      declaration: true,
      esModuleInterop: true,
      module: "NodeNext",
      moduleResolution: "NodeNext",
      outDir: "dist",
      skipLibCheck: true,
      strict: true,
      target: "ES2022",
    },
    include: ["index.ts"],
  }, null, 2)}\n`);
  writeFileSync(path.join(project, ".gitignore"), [
    "node_modules/",
    "dist/",
    "cleanup-agent.args",
    "",
  ].join("\n"));
}

test("cleanup agent can fix a TS2742 inferred Express return type", async () => {
  assert.ok(process.env.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY is required for the live Claude TS2742 test");

  const root = mkdtempSync(path.join(os.tmpdir(), "pnpm-migrate-ts2742-agent."));
  const project = path.join(root, "project");
  mkdirSync(project);
  writeTs2742Project(project);

  runCommandOk("pnpm", ["install"], { cwd: project, timeoutSeconds: 60 });
  const before = runCommand("pnpm", ["build"], { cwd: project, timeoutSeconds: 30 });
  assert.notEqual(before.status, 0, before.output);
  assert.match(before.output, /TS2742/);

  runCommandOk("git", ["init", "-q"], { cwd: project });
  runCommandOk("git", ["add", "-A"], { cwd: project });
  runCommandOk("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-m", "init"], { cwd: project });

  const deterministicLog = path.join(root, "deterministic.log");
  writeFileSync(deterministicLog, before.output);

  const worktree: MigrationWorktree = {
    branch: "pnpm-migrate/ts2742-agent-repro",
    projectPath: project,
    runRoot: root,
    worktreePath: project,
  };
  const result = await runCleanup({ id: "claude", label: "Claude Code" }, worktree, deterministicLog);
  assert.equal(result.run.code, 0, readFileSync(result.run.logPath, "utf8"));
  assert.equal(result.commit.committed, true, result.commit.error ?? "cleanup did not commit");

  const source = readFileSync(path.join(project, "index.ts"), "utf8");
  assert.match(source, /type\s+Express/);
  assert.match(source, /export function createApp\(\): Express \{/);
  assert.equal(existsSync(path.join(project, "node_modules")), false, "cleanup commit should prune generated dependency dirs");

  runCommandOk("pnpm", ["install", "--frozen-lockfile"], { cwd: project, timeoutSeconds: 60 });
  const after = runCommand("pnpm", ["build"], { cwd: project, timeoutSeconds: 30 });
  assert.equal(after.status, 0, after.output);
});
