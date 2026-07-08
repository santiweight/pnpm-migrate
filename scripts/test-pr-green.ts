import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ensurePullRequestGreen } from "../src/core/pr-green.ts";
import type { PublishResult } from "../src/core/publish.ts";
import type { MigrationWorktree } from "../src/core/worktree.ts";

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr}`);
  }
  return result.stdout.trim();
}

const root = mkdtempSync(path.join(os.tmpdir(), "pnpm-migrate-pr-green-test."));
const binDir = path.join(root, "bin");
const project = path.join(root, "project");
const remote = path.join(root, "remote.git");
mkdirSync(binDir);
mkdirSync(project);

const fakeGh = path.join(binDir, "gh");
writeFileSync(
  fakeGh,
  [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "if [ \"$1 $2\" != \"pr checks\" ]; then",
    "  echo \"unexpected gh command: $*\" >&2",
    "  exit 1",
    "fi",
    "count_file=\"$PNPM_MIGRATE_TEST_ROOT/check-count\"",
    "count=0",
    "[ -f \"$count_file\" ] && count=\"$(cat \"$count_file\")\"",
    "count=$((count + 1))",
    "printf '%s' \"$count\" > \"$count_file\"",
    "for arg in \"$@\"; do",
    "  if [ \"$arg\" = \"--json\" ]; then",
    "    printf '%s\\n' '[{\"name\":\"CI\",\"bucket\":\"fail\",\"state\":\"failure\",\"link\":\"https://example.invalid/check\",\"workflow\":\"CI\"}]'",
    "    exit 0",
    "  fi",
    "done",
    "if [ \"$count\" -eq 1 ]; then",
    "  echo \"CI failed\"",
    "  exit 1",
    "fi",
    "echo \"CI passed\"",
  ].join("\n"),
);
chmodSync(fakeGh, 0o755);

const fakeClaude = path.join(binDir, "claude");
writeFileSync(
  fakeClaude,
  [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "printf '%s\\n' \"$@\" > pr-green-agent.args",
    "printf '%s\\n' '{\"type\":\"tool_use\",\"name\":\"Bash\"}'",
    "printf 'ci fixed\\n' > CI_FIX.md",
  ].join("\n"),
);
chmodSync(fakeClaude, 0o755);

run("git", ["init", "--bare", "-q", remote], root);
writeFileSync(path.join(project, "package.json"), '{"name":"pr-green-test","version":"1.0.0"}\n');
run("git", ["init", "-q"], project);
run("git", ["checkout", "-b", "pnpm-migrate/pr-green-test"], project);
run("git", ["remote", "add", "origin", remote], project);
run("git", ["add", "-A"], project);
run("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-m", "init"], project);

const originalPath = process.env.PATH;
process.env.PATH = `${binDir}:${originalPath}`;
process.env.PNPM_MIGRATE_TEST_ROOT = root;

const worktree: MigrationWorktree = {
  branch: "pnpm-migrate/pr-green-test",
  projectPath: project,
  runRoot: root,
  worktreePath: project,
};
const publish: PublishResult = {
  error: null,
  prUrl: "https://github.com/example/repo/pull/1",
  pushed: true,
  remoteBranch: "origin/pnpm-migrate/pr-green-test",
  remoteName: "origin",
};

const statuses: string[] = [];
const result = await ensurePullRequestGreen(
  { id: "claude", label: "Claude Code" },
  worktree,
  publish,
  {
    maxFixAttempts: 2,
    onStatus: (message) => statuses.push(message),
    sessionId: "00000000-0000-4000-8000-000000000002",
  },
);

if (!result.passed) {
  throw new Error(`PR green loop should pass after one fix: ${result.error ?? "unknown error"}`);
}

if (result.attempts !== 1) {
  throw new Error(`expected one fix attempt, got ${result.attempts}`);
}

if (!existsSync(path.join(project, "CI_FIX.md"))) {
  throw new Error("fake Claude did not write the CI fix");
}

const agentArgs = readFileSync(path.join(project, "pr-green-agent.args"), "utf8");
if (!agentArgs.includes("00000000-0000-4000-8000-000000000002")) {
  throw new Error("PR green agent must receive the shared session id");
}

if (!agentArgs.includes("make the migration pull request go green")) {
  throw new Error("PR green prompt was not passed to the agent");
}

if (!statuses.includes("Running verification commands")) {
  throw new Error(`PR green status callback did not receive streamed activity: ${statuses.join(", ")}`);
}

const subject = run("git", ["log", "-1", "--pretty=%s"], project);
if (subject !== "Fix pnpm migration CI") {
  throw new Error(`unexpected CI fix commit subject: ${subject}`);
}

const remoteHeads = run("git", ["ls-remote", "--heads", "origin", "pnpm-migrate/pr-green-test"], project);
if (!remoteHeads.includes("pnpm-migrate/pr-green-test")) {
  throw new Error("CI fix commit was not pushed to the remote branch");
}

console.log("PR green smoke passed");
