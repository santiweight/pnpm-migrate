import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { spawnSync } from "node:child_process";
import {
  isPermissionDeniedPush,
  publishBranch,
  type LocalBranch,
  type PublishResult,
} from "../src/core/publish.ts";

type PublishScenario =
  | "direct"
  | "existing-fork"
  | "create-fork"
  | "network-failure"
  | "unrelated-repository"
  | "fork-push-failure";

type PublishingHarness = {
  branch: LocalBranch;
  calls(): string;
  forkHasBranch(): boolean;
  forkViewCount(): number;
  publish(): PublishResult;
  remoteUrl(name: string): string | null;
  statuses: string[];
  upstreamHasBranch(): boolean;
};

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function makePublishingHarness(t: TestContext, scenario: PublishScenario): PublishingHarness {
  const root = mkdtempSync(path.join(os.tmpdir(), "pnpm-migrate-publish-test."));
  const binDir = path.join(root, "bin");
  const project = path.join(root, "project");
  const upstream = path.join(root, "upstream.git");
  const fork = path.join(root, "fork.git");
  const forkMarker = path.join(root, "fork-created");
  const forkViewCountPath = path.join(root, "fork-view-count");
  const commandLog = path.join(root, "commands.log");
  const branchName = "pnpm-migrate/test-branch";
  const originalPath = process.env.PATH ?? "";
  mkdirSync(binDir);
  mkdirSync(project);

  const realGit = run("sh", ["-c", "command -v git"], project);
  run(realGit, ["init", "--bare", "-q", upstream], root);
  run(realGit, ["init", "--bare", "-q", fork], root);
  run(realGit, ["init", "-q", "-b", branchName], project);
  writeFileSync(path.join(project, "MIGRATION.md"), "migration\n");
  run(realGit, ["add", "MIGRATION.md"], project);
  run(realGit, ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-m", "migration"], project);
  run(realGit, ["remote", "add", "origin", "https://github.com/upstream/project.git"], project);

  const fakeGit = path.join(binDir, "git");
  writeFileSync(fakeGit, [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `printf 'git %s\\n' "$*" >> ${JSON.stringify(commandLog)}`,
    'if [ "${1:-}" = "push" ]; then',
    '  remote="${3:-}"',
    '  branch="${4:-}"',
    '  if [ "$remote" = "origin" ]; then',
    `    if [ ${JSON.stringify(scenario)} = direct ]; then exec ${JSON.stringify(realGit)} push ${JSON.stringify(upstream)} "$branch"; fi`,
    `    if [ ${JSON.stringify(scenario)} = network-failure ]; then echo 'fatal: Could not resolve host: github.com' >&2; exit 1; fi`,
    "    echo 'remote: Permission to upstream/project.git denied to alice.' >&2",
    "    echo 'fatal: unable to access repository: The requested URL returned error: 403' >&2",
    "    exit 1",
    "  fi",
    '  if [ "$remote" = "alice" ]; then',
    `    if [ ${JSON.stringify(scenario)} = fork-push-failure ]; then echo 'remote rejected migration branch' >&2; exit 1; fi`,
    `    exec ${JSON.stringify(realGit)} push ${JSON.stringify(fork)} "$branch"`,
    "  fi",
    "fi",
    `exec ${JSON.stringify(realGit)} "$@"`,
  ].join("\n"));
  chmodSync(fakeGit, 0o755);

  const validFork = '{"isFork":true,"parent":{"name":"project","owner":{"login":"upstream"}}}';
  const fakeGh = path.join(binDir, "gh");
  writeFileSync(fakeGh, [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `printf 'gh %s\\n' "$*" >> ${JSON.stringify(commandLog)}`,
    'if [ "${1:-}" = "--version" ]; then exit 0; fi',
    'if [ "${1:-} ${2:-}" = "api user" ]; then echo alice; exit 0; fi',
    'if [ "${1:-} ${2:-}" = "repo view" ]; then',
    `  if [ ${JSON.stringify(scenario)} = existing-fork ] || [ ${JSON.stringify(scenario)} = fork-push-failure ]; then echo ${JSON.stringify(validFork)}; exit 0; fi`,
    `  if [ ${JSON.stringify(scenario)} = unrelated-repository ]; then echo '{"isFork":false,"parent":null}'; exit 0; fi`,
    `  if [ ${JSON.stringify(scenario)} = create-fork ] && [ -f ${JSON.stringify(forkMarker)} ]; then`,
    `    count=$(cat ${JSON.stringify(forkViewCountPath)} 2>/dev/null || echo 0)`,
    "    count=$((count + 1))",
    `    echo "$count" > ${JSON.stringify(forkViewCountPath)}`,
    "    if [ \"$count\" -eq 1 ]; then echo '{\"isFork\":false,\"parent\":null}'; exit 0; fi",
    `    echo ${JSON.stringify(validFork)}`,
    "    exit 0",
    "  fi",
    "  exit 1",
    "fi",
    'if [ "${1:-} ${2:-}" = "repo fork" ]; then',
    `  if [ ${JSON.stringify(scenario)} != create-fork ]; then echo 'unexpected fork creation' >&2; exit 1; fi`,
    `  touch ${JSON.stringify(forkMarker)}`,
    "  exit 0",
    "fi",
    'if [ "${1:-} ${2:-}" = "pr create" ]; then echo https://github.com/upstream/project/pull/1; exit 0; fi',
    "echo \"unexpected gh command: $*\" >&2",
    "exit 1",
  ].join("\n"));
  chmodSync(fakeGh, 0o755);

  process.env.PATH = `${binDir}:${originalPath}`;
  t.after(() => {
    process.env.PATH = originalPath;
    rmSync(root, { recursive: true, force: true });
  });

  const branch: LocalBranch = { name: branchName, repositoryPath: project };
  const statuses: string[] = [];
  const hasBranch = (remote: string) => {
    const result = spawnSync(realGit, ["ls-remote", "--heads", remote, branchName], { encoding: "utf8" });
    return result.status === 0 && result.stdout.includes(`refs/heads/${branchName}`);
  };

  return {
    branch,
    calls: () => readFileSync(commandLog, "utf8"),
    forkHasBranch: () => hasBranch(fork),
    forkViewCount: () => Number(readFileSync(forkViewCountPath, "utf8")),
    publish: () => publishBranch(branch, "origin", "main", (message) => statuses.push(message)),
    remoteUrl: (name) => {
      const result = spawnSync(realGit, ["remote", "get-url", name], { cwd: project, encoding: "utf8" });
      return result.status === 0 ? result.stdout.trim() : null;
    },
    statuses,
    upstreamHasBranch: () => hasBranch(upstream),
  };
}

test("recognizes only permission-related push failures", () => {
  assert.equal(isPermissionDeniedPush("Permission to org/repo.git denied to user"), true);
  assert.equal(isPermissionDeniedPush("The requested URL returned error: 403"), true);
  assert.equal(isPermissionDeniedPush("Could not resolve host: github.com"), false);
});

test("publishes a local branch directly when upstream accepts writes", (t) => {
  const harness = makePublishingHarness(t, "direct");
  const result = harness.publish();

  assert.equal(result.error, null);
  assert.equal(result.remoteBranch, "origin/pnpm-migrate/test-branch");
  assert.equal(result.prUrl, "https://github.com/upstream/project/pull/1");
  assert.equal(harness.upstreamHasBranch(), true);
  assert.equal(harness.forkHasBranch(), false);
  assert.doesNotMatch(harness.calls(), /gh (api user|repo view|repo fork)/);
  assert.match(harness.calls().replace(/\s+/g, " "), /gh pr create .* --head pnpm-migrate\/test-branch(?! .* --repo)/);
});

test("publishes a local branch through an existing fork after upstream denies writes", (t) => {
  const harness = makePublishingHarness(t, "existing-fork");
  const result = harness.publish();

  assert.equal(result.error, null);
  assert.equal(result.remoteBranch, "alice/pnpm-migrate/test-branch");
  assert.equal(result.pullRequestRepo, "upstream/project");
  assert.equal(result.pullRequestHead, "alice:pnpm-migrate/test-branch");
  assert.equal(harness.upstreamHasBranch(), false);
  assert.equal(harness.forkHasBranch(), true);
  assert.equal(harness.remoteUrl("alice"), "https://github.com/alice/project.git");
  assert.doesNotMatch(harness.calls(), /gh repo fork/);
  assert.match(harness.calls().replace(/\s+/g, " "), /gh pr create .* --head alice:pnpm-migrate\/test-branch --repo upstream\/project/);
});

test("creates a fork, waits for metadata, and publishes the local branch", (t) => {
  const harness = makePublishingHarness(t, "create-fork");
  const result = harness.publish();

  assert.equal(result.error, null);
  assert.equal(result.remoteBranch, "alice/pnpm-migrate/test-branch");
  assert.equal(harness.upstreamHasBranch(), false);
  assert.equal(harness.forkHasBranch(), true);
  assert.ok(harness.forkViewCount() >= 2);
  assert.match(harness.calls(), /gh repo fork upstream\/project --clone=false/);
  assert.match(harness.statuses.join("\n"), /preparing alice\/project/);
  assert.match(harness.calls().replace(/\s+/g, " "), /gh pr create .* --head alice:pnpm-migrate\/test-branch --repo upstream\/project/);
});

test("does not create a fork for a non-permission push failure", (t) => {
  const harness = makePublishingHarness(t, "network-failure");
  const result = harness.publish();

  assert.equal(result.pushed, false);
  assert.match(result.error ?? "", /Could not resolve host/);
  assert.equal(harness.upstreamHasBranch(), false);
  assert.equal(harness.forkHasBranch(), false);
  assert.doesNotMatch(harness.calls(), /gh (api user|repo view|repo fork|pr create)/);
});

test("rejects an existing same-name repository that is not an upstream fork", (t) => {
  const harness = makePublishingHarness(t, "unrelated-repository");
  const result = harness.publish();

  assert.equal(result.pushed, false);
  assert.match(result.error ?? "", /exists but is not a fork/);
  assert.equal(harness.forkHasBranch(), false);
  assert.doesNotMatch(harness.calls(), /gh (repo fork|pr create)/);
});

test("does not create a pull request when pushing to the fork fails", (t) => {
  const harness = makePublishingHarness(t, "fork-push-failure");
  const result = harness.publish();

  assert.equal(result.pushed, false);
  assert.match(result.error ?? "", /Fork push failed/);
  assert.equal(harness.forkHasBranch(), false);
  assert.doesNotMatch(harness.calls(), /gh pr create/);
});
