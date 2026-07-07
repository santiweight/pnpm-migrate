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
