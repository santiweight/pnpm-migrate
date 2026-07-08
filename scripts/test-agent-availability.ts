import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { detectAgents } from "../src/agents/detect.ts";
import { runCleanup } from "../src/core/cleanup.ts";
import type { MigrationWorktree } from "../src/core/worktree.ts";

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function writeExecutable(filePath: string, contents: string): void {
  writeFileSync(filePath, contents);
  chmodSync(filePath, 0o755);
}

function withPath(binDir: string, fn: () => void): void {
  const originalPath = process.env.PATH;
  process.env.PATH = `${binDir}:/usr/bin:/bin`;
  try {
    fn();
  } finally {
    process.env.PATH = originalPath;
  }
}

function assertAgents(binDir: string, expected: string[]): void {
  withPath(binDir, () => {
    const actual = detectAgents().map((agent) => agent.id);
    if (actual.join(",") !== expected.join(",")) {
      throw new Error(`expected agents ${expected.join(",") || "(none)"}, got ${actual.join(",") || "(none)"}`);
    }
  });
}

const root = mkdtempSync(path.join(os.tmpdir(), "pnpm-migrate-agent-test."));
const originalPath = process.env.PATH ?? "";
const emptyBin = path.join(root, "empty-bin");
const claudeBin = path.join(root, "claude-bin");
const codexBin = path.join(root, "codex-bin");
const bothBin = path.join(root, "both-bin");
mkdirSync(emptyBin);
mkdirSync(claudeBin);
mkdirSync(codexBin);
mkdirSync(bothBin);

const fakeClaude = [
  "#!/usr/bin/env bash",
  "if [ \"$1 $2\" = \"auth status\" ]; then",
  "  exit 0",
  "fi",
  "printf '%s\\n' '{\"type\":\"tool_use\",\"name\":\"Read\"}'",
  "printf 'claude cleanup\\n' > CLEANUP_CLAUDE.md",
].join("\n");

const fakeCodex = [
  "#!/usr/bin/env bash",
  "if [ \"$1\" = \"--version\" ]; then",
  "  printf 'codex 0.0.0\\n'",
  "  exit 0",
  "fi",
  "printf '%s\\n' '{\"type\":\"tool_use\",\"name\":\"Read\"}'",
  "printf 'codex cleanup\\n' > CLEANUP_CODEX.md",
].join("\n");

writeExecutable(path.join(claudeBin, "claude"), fakeClaude);
writeExecutable(path.join(codexBin, "codex"), fakeCodex);
writeExecutable(path.join(bothBin, "claude"), fakeClaude);
writeExecutable(path.join(bothBin, "codex"), fakeCodex);

assertAgents(emptyBin, []);
assertAgents(claudeBin, ["claude"]);
assertAgents(codexBin, ["codex"]);
assertAgents(bothBin, ["claude", "codex"]);

const project = path.join(root, "project");
mkdirSync(project);
writeFileSync(path.join(project, "package.json"), '{"name":"agent-test","version":"1.0.0"}\n');
writeFileSync(path.join(project, "README.md"), "# agent-test\n\nnpm install\n");
run("git", ["init", "-q"], project);
run("git", ["add", "-A"], project);
run("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-m", "init"], project);

const deterministicLog = path.join(root, "deterministic.log");
writeFileSync(deterministicLog, "remaining npm/npx commands need review:\nREADME.md:3: npm install\n");

const worktree: MigrationWorktree = {
  branch: "pnpm-migrate/agent-test",
  projectPath: project,
  runRoot: root,
  worktreePath: project,
};

process.env.PATH = `${codexBin}:${originalPath}`;
const cleanup = await runCleanup({ id: "codex", label: "Codex" }, worktree, deterministicLog);

if (cleanup.run.code !== 0) {
  throw new Error(`Codex cleanup failed: ${cleanup.run.code}`);
}

if (!cleanup.commit.committed) {
  throw new Error(`Codex cleanup did not commit: ${cleanup.commit.error ?? "unknown error"}`);
}

const subject = run("git", ["log", "-1", "--pretty=%s"], project);
if (subject !== "Polish pnpm migration cleanup") {
  throw new Error(`unexpected Codex cleanup commit subject: ${subject}`);
}

console.log("agent availability smoke passed");
