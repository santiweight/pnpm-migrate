import path from "node:path";
import { appendFileSync } from "node:fs";
import { commandOk, runCapture } from "../utils/command.ts";
import type { MigrationWorktree } from "./worktree.ts";

export type PublishResult = {
  error: string | null;
  pullRequestHead: string | null;
  pullRequestRepo: string | null;
  prUrl: string | null;
  pushed: boolean;
  remoteBranch: string | null;
  remoteName: string | null;
};

export type LocalBranch = {
  name: string;
  repositoryPath: string;
};

export function listRemotes(branch: LocalBranch): string[] {
  return runCapture("git", ["remote"], { cwd: branch.repositoryPath })
    .stdout.split(/\r?\n/)
    .map((remote) => remote.trim())
    .filter(Boolean);
}

export function hasGitHubCli(): boolean {
  return commandOk("gh", ["--version"]);
}

export function pushBranchToRemote(branch: LocalBranch, remoteName: string): PublishResult {
  const push = runCapture("git", ["push", "-u", remoteName, branch.name], {
    cwd: branch.repositoryPath,
  });

  if (push.status !== 0) {
    return {
      error: push.stderr || "git push failed",
      pullRequestHead: null,
      pullRequestRepo: null,
      prUrl: null,
      pushed: false,
      remoteBranch: null,
      remoteName,
    };
  }

  return {
    error: null,
    pullRequestHead: null,
    pullRequestRepo: null,
    prUrl: null,
    pushed: true,
    remoteBranch: `${remoteName}/${branch.name}`,
    remoteName,
  };
}

function remoteUrl(branch: LocalBranch, remoteName: string): string | null {
  const result = runCapture("git", ["remote", "get-url", remoteName], { cwd: branch.repositoryPath });
  return result.status === 0 ? result.stdout : null;
}

function githubRepository(remote: string): string | null {
  const normalized = remote.replace(/[?#].*$/, "").replace(/\/$/, "");
  const match = normalized.match(/github\.com[:/]([^/]+)\/([^/]+)$/i);
  if (!match) {
    return null;
  }
  return `${match[1]}/${match[2].replace(/\.git$/i, "")}`;
}

export function isPermissionDeniedPush(error: string): boolean {
  return /(?:permission .* denied|write access .* not granted|requested url returned error:\s*403|http 403)/i.test(error);
}

function authenticatedGitHubUser(branch: LocalBranch): string | null {
  const result = runCapture("gh", ["api", "user", "--jq", ".login"], { cwd: branch.repositoryPath });
  return result.status === 0 && result.stdout ? result.stdout : null;
}

function existingForkIsValid(branch: LocalBranch, forkRepo: string, upstreamRepo: string): boolean | null {
  const result = runCapture(
    "gh",
    ["repo", "view", forkRepo, "--json", "isFork,parent"],
    { cwd: branch.repositoryPath },
  );
  if (result.status !== 0) {
    return null;
  }

  try {
    const details = JSON.parse(result.stdout) as {
      isFork?: boolean;
      parent?: {
        name?: string;
        nameWithOwner?: string;
        owner?: { login?: string };
      } | null;
    };
    const parentName = details.parent?.nameWithOwner
      ?? (details.parent?.owner?.login && details.parent.name
        ? `${details.parent.owner.login}/${details.parent.name}`
        : null);
    return details.isFork === true
      && parentName?.toLowerCase() === upstreamRepo.toLowerCase();
  } catch {
    return false;
  }
}

function ensureFork(branch: LocalBranch, forkRepo: string, upstreamRepo: string): string | null {
  const existing = existingForkIsValid(branch, forkRepo, upstreamRepo);
  if (existing === true) {
    return null;
  }
  if (existing === false) {
    return `${forkRepo} exists but is not a fork of ${upstreamRepo}`;
  }

  const created = runCapture(
    "gh",
    ["repo", "fork", upstreamRepo, "--clone=false"],
    { cwd: branch.repositoryPath },
  );
  if (created.status !== 0) {
    if (existingForkIsValid(branch, forkRepo, upstreamRepo) === true) {
      return null;
    }
    return created.stderr || created.stdout || `Could not create fork ${forkRepo}`;
  }

  for (let attempt = 0; attempt < 20; attempt++) {
    const valid = existingForkIsValid(branch, forkRepo, upstreamRepo);
    if (valid === true) {
      return null;
    }
    // GitHub can expose a newly created repository before its fork metadata
    // and parent relationship are available through the API.
    sleep(500);
  }

  return `Created ${forkRepo}, but could not verify the fork`;
}

function ensureForkRemote(branch: LocalBranch, login: string, forkUrl: string): string | null {
  for (const remoteName of listRemotes(branch)) {
    if (remoteUrl(branch, remoteName)?.replace(/\.git$/i, "") === forkUrl.replace(/\.git$/i, "")) {
      return remoteName;
    }
  }

  const remotes = new Set(listRemotes(branch));
  const remoteName = remotes.has(login) ? "pnpm-migrate-fork" : login;
  if (remotes.has(remoteName)) {
    return null;
  }

  const added = runCapture("git", ["remote", "add", remoteName, forkUrl], { cwd: branch.repositoryPath });
  return added.status === 0 ? remoteName : null;
}

function pushBranchWithForkFallback(
  branch: LocalBranch,
  remoteName: string,
  githubAvailable: boolean,
  onStatus?: (message: string) => void,
): PublishResult {
  const direct = pushBranchToRemote(branch, remoteName);
  if (direct.pushed || !isPermissionDeniedPush(direct.error ?? "") || !githubAvailable) {
    return direct;
  }

  const upstreamRepo = remoteUrl(branch, remoteName);
  const upstream = upstreamRepo ? githubRepository(upstreamRepo) : null;
  const login = authenticatedGitHubUser(branch);
  if (!upstream || !login) {
    return direct;
  }

  const repoName = upstream.split("/")[1];
  const forkRepo = `${login}/${repoName}`;
  onStatus?.(`No write access to ${remoteName}; preparing ${forkRepo}`);
  const forkError = ensureFork(branch, forkRepo, upstream);
  if (forkError) {
    return { ...direct, error: `${direct.error}\n\nFork fallback failed: ${forkError}` };
  }

  const forkRemote = ensureForkRemote(branch, login, `https://github.com/${forkRepo}.git`);
  if (!forkRemote) {
    return { ...direct, error: `${direct.error}\n\nFork fallback failed: could not configure a fork remote` };
  }

  onStatus?.(`Pushing migration branch to ${forkRepo}`);
  const forkPush = pushBranchToRemote(branch, forkRemote);
  if (!forkPush.pushed) {
    return { ...forkPush, error: `${direct.error}\n\nFork push failed: ${forkPush.error}` };
  }

  return {
    ...forkPush,
    pullRequestHead: `${login}:${branch.name}`,
    pullRequestRepo: upstream,
  };
}

function createPullRequest(
  branch: LocalBranch,
  baseBranch: string,
  pushed: PublishResult,
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
      pushed.pullRequestHead ?? branch.name,
      ...(pushed.pullRequestRepo ? ["--repo", pushed.pullRequestRepo] : []),
    ],
    { cwd: branch.repositoryPath },
  );

  if (pr.status !== 0) {
    return {
      ...pushed,
      error: pr.stderr || "gh pr create failed",
      prUrl: null,
      pushed: true,
    };
  }

  return {
    ...pushed,
    error: null,
    prUrl: pr.stdout.split(/\r?\n/).find((line) => /^https?:\/\//.test(line.trim())) ?? pr.stdout,
    pushed: true,
  };
}

export function publishBranch(
  branch: LocalBranch,
  upstreamRemote: string,
  baseBranch: string,
  onStatus?: (message: string) => void,
): PublishResult {
  const githubAvailable = hasGitHubCli();
  const pushed = pushBranchWithForkFallback(branch, upstreamRemote, githubAvailable, onStatus);
  if (!pushed.pushed || !githubAvailable) {
    return pushed;
  }

  onStatus?.("Creating PR");
  return createPullRequest(branch, baseBranch, pushed);
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
    return checks.stderr || checks.stdout || "Could not read PR checks.";
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
        error: "PR checks failed",
        logPath,
        passed: false,
      };
    }

    sleep(10_000);
  }

  return {
    error: "Timed out waiting for PR checks",
    logPath,
    passed: false,
  };
}
