import { runCapture, type LoggedResult } from "../utils/command.ts";
import type { MigrationWorktree } from "./worktree.ts";

const nonDependencyPathspec = ["--", ".", ":!node_modules", ":!**/node_modules"];

export type CommitResult = {
  changedFileCount: number;
  committed: boolean;
  error: string | null;
  worktree: MigrationWorktree;
};

export type MigrationSummary = {
  lines: string[];
};

export function countChangedFiles(worktree: MigrationWorktree): number {
  return runCapture("git", ["status", "--short", ...nonDependencyPathspec], { cwd: worktree.worktreePath })
    .stdout.split("\n")
    .filter(Boolean).length;
}

export function commitMigration(worktree: MigrationWorktree): CommitResult {
  const changedFileCount = countChangedFiles(worktree);

  if (changedFileCount === 0) {
    return { changedFileCount: 0, committed: false, error: "No migration changes were produced", worktree };
  }

  const add = runCapture("git", ["add", "-A", ...nonDependencyPathspec], { cwd: worktree.worktreePath });
  if (add.status !== 0) {
    return { changedFileCount, committed: false, error: add.stderr || "git add failed", worktree };
  }

  const commit = runCapture(
    "git",
    [
      "-c",
      "user.name=pnpm-migrate",
      "-c",
      "user.email=pnpm-migrate@example.invalid",
      "commit",
      "-m",
      "Migrate from npm to pnpm",
    ],
    { cwd: worktree.worktreePath },
  );

  if (commit.status !== 0) {
    return { changedFileCount, committed: false, error: commit.stderr || "git commit failed", worktree };
  }

  return { changedFileCount, committed: true, error: null, worktree };
}

export function buildMigrationSummary(
  worktree: MigrationWorktree,
  baseBranch: string,
  commitResult: CommitResult,
  engineResult?: LoggedResult,
): MigrationSummary {
  const diffStat = commitResult.committed
    ? runCapture("git", ["diff", "--stat", `${baseBranch}...HEAD`], { cwd: worktree.worktreePath }).stdout
    : runCapture("git", ["diff", "--stat", ...nonDependencyPathspec], { cwd: worktree.worktreePath }).stdout;

  return {
    lines: [
      `Branch: ${worktree.branch}`,
      `Worktree: ${worktree.worktreePath}`,
      `Committed: ${commitResult.committed ? "yes" : "no"}`,
      `Changed files: ${commitResult.changedFileCount}`,
      engineResult?.logPath ? `Log: ${engineResult.logPath}` : "",
      commitResult.error ? `Commit note: ${commitResult.error}` : "",
      diffStat ? `\n${diffStat}` : "",
    ].filter(Boolean),
  };
}
