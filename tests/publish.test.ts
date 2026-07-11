import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import {
  createPullRequest,
  isPermissionDeniedPush,
  pushBranchWithForkFallback,
} from "../src/core/publish.ts";
import type { MigrationWorktree } from "../src/core/worktree.ts";

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test("recognizes only permission-related push failures", () => {
  assert.equal(isPermissionDeniedPush("Permission to org/repo.git denied to user"), true);
  assert.equal(isPermissionDeniedPush("The requested URL returned error: 403"), true);
  assert.equal(isPermissionDeniedPush("Could not resolve host: github.com"), false);
});

test("creates and publishes through a fork when upstream denies writes", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pnpm-migrate-publish-test."));
  const binDir = path.join(root, "bin");
  const project = path.join(root, "project");
  const forkMarker = path.join(root, "fork-created");
  const ghCalls = path.join(root, "gh-calls");
  const originalPath = process.env.PATH ?? "";
  mkdirSync(binDir);
  mkdirSync(project);
  t.after(() => {
    process.env.PATH = originalPath;
  });

  const realGit = run("sh", ["-c", "command -v git"], project);
  const fakeGit = path.join(binDir, "git");
  writeFileSync(fakeGit, [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'if [ "${1:-}" = "push" ] && [ "${3:-}" = "origin" ]; then',
    "  echo 'remote: Permission to upstream/project.git denied to alice.' >&2",
    "  echo 'fatal: unable to access repository: The requested URL returned error: 403' >&2",
    "  exit 1",
    "fi",
    'if [ "${1:-}" = "push" ] && [ "${3:-}" = "alice" ]; then',
    "  exit 0",
    "fi",
    `exec ${JSON.stringify(realGit)} "$@"`,
  ].join("\n"));
  chmodSync(fakeGit, 0o755);

  const fakeGh = path.join(binDir, "gh");
  writeFileSync(fakeGh, [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `printf '%s\\n' "$*" >> ${JSON.stringify(ghCalls)}`,
    'if [ "${1:-}" = "--version" ]; then exit 0; fi',
    'if [ "${1:-} ${2:-}" = "api user" ]; then echo alice; exit 0; fi',
    'if [ "${1:-} ${2:-}" = "repo view" ]; then',
    `  if [ -f ${JSON.stringify(forkMarker)} ]; then`,
    "    echo '{\"isFork\":true,\"parent\":{\"nameWithOwner\":\"upstream/project\"}}'",
    "    exit 0",
    "  fi",
    "  exit 1",
    "fi",
    'if [ "${1:-} ${2:-}" = "repo fork" ]; then',
    `  touch ${JSON.stringify(forkMarker)}`,
    "  exit 0",
    "fi",
    'if [ "${1:-} ${2:-}" = "pr create" ]; then',
    "  echo https://github.com/upstream/project/pull/1",
    "  exit 0",
    "fi",
    "echo \"unexpected gh command: $*\" >&2",
    "exit 1",
  ].join("\n"));
  chmodSync(fakeGh, 0o755);

  run(realGit, ["init", "-q", "-b", "pnpm-migrate/test"], project);
  run(realGit, ["remote", "add", "origin", "https://github.com/upstream/project.git"], project);

  process.env.PATH = `${binDir}:${originalPath}`;
  const worktree: MigrationWorktree = {
    branch: "pnpm-migrate/test",
    projectPath: project,
    runRoot: root,
    worktreePath: project,
  };
  const statuses: string[] = [];
  const pushed = pushBranchWithForkFallback(worktree, "origin", (message) => statuses.push(message));

  assert.equal(pushed.pushed, true, pushed.error ?? "push failed");
  assert.equal(pushed.remoteName, "alice");
  assert.equal(pushed.remoteBranch, "alice/pnpm-migrate/test");
  assert.equal(pushed.pullRequestRepo, "upstream/project");
  assert.equal(pushed.pullRequestHead, "alice:pnpm-migrate/test");
  assert.equal(existsSync(forkMarker), true);
  assert.match(statuses.join("\n"), /preparing alice\/project/);
  assert.equal(
    run(realGit, ["remote", "get-url", "alice"], project),
    "https://github.com/alice/project.git",
  );

  const published = createPullRequest(worktree, "main", pushed);
  assert.equal(published.prUrl, "https://github.com/upstream/project/pull/1");
  const calls = readFileSync(ghCalls, "utf8");
  assert.match(calls, /repo fork upstream\/project --clone=false/);
  assert.match(calls.replace(/\s+/g, " "), /pr create .* --head alice:pnpm-migrate\/test --repo upstream\/project/);
});
