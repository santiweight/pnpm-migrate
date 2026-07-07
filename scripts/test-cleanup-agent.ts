import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runCleanup } from "../src/core/cleanup.ts";
import { createAgentStatusParser } from "../src/agents/status.ts";
import type { MigrationWorktree } from "../src/core/worktree.ts";

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr}`);
  }
  return result.stdout.trim();
}

const root = mkdtempSync(path.join(os.tmpdir(), "pnpm-migrate-cleanup-test."));
const binDir = path.join(root, "bin");
const project = path.join(root, "project");
mkdirSync(binDir);
mkdirSync(project);

const fakeClaude = path.join(binDir, "claude");
writeFileSync(
  fakeClaude,
  [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "printf '%s\\n' \"$@\" > cleanup-agent.args",
    "printf '%s\\n' '{\"type\":\"tool_use\",\"name\":\"Read\"}'",
    "printf 'cleanup ran\\n' > CLEANUP.md",
  ].join("\n"),
);
chmodSync(fakeClaude, 0o755);

writeFileSync(path.join(project, "package.json"), '{"name":"cleanup-test","version":"1.0.0"}\n');
writeFileSync(path.join(project, "README.md"), "# cleanup-test\n\nnpm install\n");
run("git", ["init", "-q"], project);
run("git", ["add", "-A"], project);
run("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-m", "init"], project);

const deterministicLog = path.join(root, "deterministic.log");
writeFileSync(deterministicLog, "remaining npm/npx commands need review:\nREADME.md:3: npm install\n");

const originalPath = process.env.PATH;
process.env.PATH = `${binDir}:${originalPath}`;

const worktree: MigrationWorktree = {
  branch: "pnpm-migrate/cleanup-test",
  projectPath: project,
  runRoot: root,
  worktreePath: project,
};

const statuses: string[] = [];
const result = await runCleanup({ id: "claude", label: "Claude Code" }, worktree, deterministicLog, (message) => {
  statuses.push(message);
});

if (result.run.code !== 0) {
  throw new Error(`cleanup runner failed: ${result.run.code}`);
}

if (!result.commit.committed) {
  throw new Error(`cleanup result was not committed: ${result.commit.error ?? "unknown error"}`);
}

if (!existsSync(path.join(project, "CLEANUP.md"))) {
  throw new Error("fake cleanup agent did not modify the worktree");
}

if (!readFileSync(path.join(project, "cleanup-agent.args"), "utf8").includes("temporary git worktree")) {
  throw new Error("cleanup prompt was not passed to the agent");
}

if (!readFileSync(path.join(project, "cleanup-agent.args"), "utf8").includes("--verbose")) {
  throw new Error("Claude stream-json cleanup must include --verbose");
}

if (!statuses.includes("Inspecting migration files")) {
  throw new Error(`cleanup status callback did not receive streamed activity: ${statuses.join(", ")}`);
}

const subject = run("git", ["log", "-1", "--pretty=%s"], project);
if (subject !== "Polish pnpm migration cleanup") {
  throw new Error(`unexpected cleanup commit subject: ${subject}`);
}

const body = run("git", ["log", "-1", "--pretty=%b"], project);
if (!body.includes("Created with pnpm-migrate.") || !body.includes("https://github.com/santiweight/pnpm-migrate")) {
  throw new Error(`cleanup commit is missing pnpm-migrate attribution: ${body}`);
}

const proseStatuses: string[] = [];
const parseStatus = createAgentStatusParser("claude", (message) => {
  proseStatuses.push(message);
});
parseStatus(
  JSON.stringify({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      delta: {
        type: "text_delta",
        text: "docs/config files are already migrated. The",
      },
    },
  }) + "\n",
);
if (proseStatuses.length > 0) {
  throw new Error(`assistant prose should not become spinner status: ${proseStatuses.join(", ")}`);
}

console.log("cleanup agent smoke passed");
