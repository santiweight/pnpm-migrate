import path from "node:path";
import { appendFileSync } from "node:fs";
import { commandOk, runCapture } from "../utils/command.ts";
import type { MigrationWorktree } from "./worktree.ts";

export type PublishResult = {
  error: string | null;
  prUrl: string | null;
  pushed: boolean;
  remoteBranch: string | null;
  remoteName: string | null;
};

export function listRemotes(worktree: MigrationWorktree): string[] {
  return runCapture("git", ["remote"], { cwd: worktree.worktreePath })
    .stdout.split(/\r?\n/)
    .map((remote) => remote.trim())
    .filter(Boolean);
}

export function hasGitHubCli(): boolean {
  return commandOk("gh", ["--version"]);
}

export function pushBranch(worktree: MigrationWorktree, remoteName: string): PublishResult {
  const push = runCapture("git", ["push", "-u", remoteName, worktree.branch], {
    cwd: worktree.worktreePath,
  });

  if (push.status !== 0) {
    return {
      error: push.stderr || "git push failed",
      prUrl: null,
      pushed: false,
      remoteBranch: null,
      remoteName,
    };
  }

  return {
    error: null,
    prUrl: null,
    pushed: true,
    remoteBranch: `${remoteName}/${worktree.branch}`,
    remoteName,
  };
}

export function createPullRequest(
  worktree: MigrationWorktree,
  baseBranch: string,
  remoteName: string,
): PublishResult {
  const body = [
    "Migrates this project from npm to pnpm.",
    "",
    "Created with pnpm-migrate.",
    "https://github.com/santiweight/pnpm-migrate",
  ].join("\n");
  const pr = runCapture(
    "gh",
    [
      "pr",
      "create",
      "--title",
      "Migrate project from npm to pnpm",
      "--body",
      body,
      "--base",
      baseBranch,
      "--head",
      worktree.branch,
    ],
    { cwd: worktree.worktreePath },
  );

  if (pr.status !== 0) {
    return {
      error: pr.stderr || "gh pr create failed",
      prUrl: null,
      pushed: true,
      remoteBranch: `${remoteName}/${worktree.branch}`,
      remoteName,
    };
  }

  return {
    error: null,
    prUrl: pr.stdout.split(/\r?\n/).find((line) => /^https?:\/\//.test(line.trim())) ?? pr.stdout,
    pushed: true,
    remoteBranch: `${remoteName}/${worktree.branch}`,
    remoteName,
  };
}

export type PullRequestChecksResult = {
  error: string | null;
  logPath: string;
  passed: boolean;
};

type PullRequestCheck = {
  bucket?: string;
  link?: string;
  name?: string;
  state?: string;
  workflow?: string;
};

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function parseChecks(stdout: string): PullRequestCheck[] {
  if (!stdout.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(stdout) as unknown;
    return Array.isArray(parsed) ? parsed as PullRequestCheck[] : [];
  } catch {
    return [];
  }
}

function checkState(checks: PullRequestCheck[]): "failed" | "passed" | "pending" {
  if (checks.length === 0) {
    return "pending";
  }

  if (checks.some((check) => check.bucket === "fail" || check.bucket === "cancel")) {
    return "failed";
  }

  if (checks.every((check) => check.bucket === "pass" || check.bucket === "skipping")) {
    return "passed";
  }

  return "pending";
}

export function getPullRequestCheckSummary(worktree: MigrationWorktree, prUrl: string): string {
  const checks = runCapture(
    "gh",
    [
      "pr",
      "checks",
      prUrl,
      "--json",
      "name,bucket,state,link,workflow",
    ],
    { cwd: worktree.worktreePath },
  );

  if (checks.status !== 0) {
    return checks.stderr || checks.stdout || "Could not read pull request checks.";
  }

  return checks.stdout;
}

export async function waitForPullRequestChecks(
  worktree: MigrationWorktree,
  prUrl: string,
  attempt: number,
): Promise<PullRequestChecksResult> {
  const logPath = path.join(worktree.runRoot, `pr-checks-${attempt}.log`);
  const deadline = Date.now() + 15 * 60 * 1000;

  while (Date.now() < deadline) {
    const checks = runCapture(
      "gh",
      [
        "pr",
        "checks",
        prUrl,
        "--json",
        "name,bucket,state,link,workflow",
      ],
      { cwd: worktree.worktreePath },
    );
    appendFileSync(
      logPath,
      [
        `$ gh pr checks ${prUrl} --json name,bucket,state,link,workflow`,
        `status=${checks.status}`,
        checks.stdout,
        checks.stderr,
        "",
      ].filter(Boolean).join("\n"),
    );

    const parsed = parseChecks(checks.stdout);
    const state = checkState(parsed);

    if (state === "passed") {
      return {
        error: null,
        logPath,
        passed: true,
      };
    }

    if (state === "failed") {
      return {
        error: "Pull request checks failed",
        logPath,
        passed: false,
      };
    }

    sleep(10_000);
  }

  return {
    error: "Timed out waiting for pull request checks",
    logPath,
    passed: false,
  };
}
