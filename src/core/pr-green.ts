import path from "node:path";
import type { Agent } from "../agents/detect.ts";
import { runAgent } from "../agents/run.ts";
import type { AgentStatusHandler } from "../agents/status.ts";
import { pushBranch, getPullRequestCheckSummary, waitForPullRequestChecks, type PublishResult } from "./publish.ts";
import { commitCiFix, type CommitResult } from "./summary.ts";
import type { MigrationWorktree } from "./worktree.ts";

export type PullRequestGreenResult = {
  attempts: number;
  error: string | null;
  lastLogPath: string | null;
  passed: boolean;
  skipped: boolean;
};

function buildGreenPrompt(prUrl: string, checkSummary: string, attempt: number): string {
  return [
    "You are continuing the pnpm-migrate cleanup session in the same temporary git worktree.",
    "",
    "Goal: make the migration pull request go green.",
    "",
    `Pull request: ${prUrl}`,
    `CI fix attempt: ${attempt} of 2`,
    "",
    "Do this:",
    "1. Inspect the failed CI/check information below.",
    "2. Make only migration-related fixes needed for pnpm compatibility.",
    "3. Run the closest local verification command you can reasonably run.",
    "4. Leave changes in the worktree. Do not commit or push.",
    "5. If the failure is unrelated to the pnpm migration or cannot be fixed safely, stop and say so.",
    "",
    "Failed check summary:",
    checkSummary,
  ].join("\n");
}

export async function ensurePullRequestGreen(
  agent: Agent,
  worktree: MigrationWorktree,
  publish: PublishResult,
  options: {
    maxFixAttempts?: number;
    onFixAttempt?: (attempt: number) => void;
    onStatus?: AgentStatusHandler;
    sessionId?: string;
  } = {},
): Promise<PullRequestGreenResult> {
  const maxFixAttempts = options.maxFixAttempts ?? 2;

  if (!publish.prUrl || !publish.remoteName) {
    return {
      attempts: 0,
      error: "No pull request was created.",
      lastLogPath: null,
      passed: false,
      skipped: true,
    };
  }

  let lastLogPath: string | null = null;

  for (let attempt = 0; attempt <= maxFixAttempts; attempt++) {
    const checks = await waitForPullRequestChecks(worktree, publish.prUrl, attempt + 1);
    lastLogPath = checks.logPath;

    if (checks.passed) {
      return {
        attempts: attempt,
        error: null,
        lastLogPath,
        passed: true,
        skipped: false,
      };
    }

    if (attempt === maxFixAttempts) {
      return {
        attempts: attempt,
        error: checks.error,
        lastLogPath,
        passed: false,
        skipped: false,
      };
    }

    const checkSummary = getPullRequestCheckSummary(worktree, publish.prUrl);
    options.onFixAttempt?.(attempt + 1);
    const fixLogPath = path.join(worktree.runRoot, `pr-green-${agent.id}-${attempt + 1}.log`);
    const fix = await runAgent(
      agent.id,
      buildGreenPrompt(publish.prUrl, checkSummary, attempt + 1),
      worktree,
      fixLogPath,
      options.onStatus,
      { resumeSession: true, sessionId: options.sessionId },
    );
    lastLogPath = fixLogPath;

    if (fix.code !== 0) {
      return {
        attempts: attempt + 1,
        error: `PR green agent exited with code ${fix.code}`,
        lastLogPath,
        passed: false,
        skipped: false,
      };
    }

    const commit: CommitResult = commitCiFix(worktree);
    if (commit.error) {
      return {
        attempts: attempt + 1,
        error: commit.error,
        lastLogPath,
        passed: false,
        skipped: false,
      };
    }

    if (commit.committed) {
      const pushed = pushBranch(worktree, publish.remoteName);
      if (!pushed.pushed) {
        return {
          attempts: attempt + 1,
          error: pushed.error ?? "Failed to push CI fix",
          lastLogPath,
          passed: false,
          skipped: false,
        };
      }
    }
  }

  return {
    attempts: maxFixAttempts,
    error: "Pull request checks did not pass.",
    lastLogPath,
    passed: false,
    skipped: false,
  };
}
