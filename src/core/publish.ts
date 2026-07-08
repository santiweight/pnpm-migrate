import path from "node:path";
import { commandOk, runCapture, runLogged } from "../utils/command.ts";
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
  const checks = await runLogged(
    "gh",
    [
      "pr",
      "checks",
      prUrl,
      "--watch",
      "--fail-fast",
      "--interval",
      "10",
    ],
    { cwd: worktree.worktreePath, logPath },
  );

  return {
    error: checks.code === 0 ? null : `Pull request checks exited with code ${checks.code}`,
    logPath,
    passed: checks.code === 0,
  };
}
