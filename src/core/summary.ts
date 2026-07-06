import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { runCapture, type LoggedResult } from "../utils/command.ts";
import type { MigrationWorktree } from "./worktree.ts";

const nonDependencyPathspec = ["--", ".", ":!node_modules", ":!**/node_modules"];
const generatedDependencyDirs = new Set(["node_modules", ".pnpm-store"]);

export type CommitResult = {
  changedFileCount: number;
  committed: boolean;
  error: string | null;
  worktree: MigrationWorktree;
};

type CommitOptions = {
  allowNoChanges?: boolean;
  message: string;
};

export type MigrationSummary = {
  lines: string[];
};

export function countChangedFiles(worktree: MigrationWorktree): number {
  return runCapture("git", ["status", "--short", ...nonDependencyPathspec], { cwd: worktree.worktreePath })
    .stdout.split("\n")
    .filter(Boolean).length;
}

function hasTrackedFiles(worktree: MigrationWorktree, dirPath: string): boolean {
  const relativePath = path.relative(worktree.worktreePath, dirPath) || ".";
  const result = runCapture("git", ["ls-files", "--", `${relativePath}/`], { cwd: worktree.worktreePath });
  return result.stdout.length > 0;
}

function pruneGeneratedDependencyDirs(worktree: MigrationWorktree, dirPath = worktree.worktreePath): void {
  let entries;
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === ".git") {
      continue;
    }

    const childPath = path.join(dirPath, entry.name);
    if (generatedDependencyDirs.has(entry.name)) {
      if (!hasTrackedFiles(worktree, childPath)) {
        rmSync(childPath, { force: true, recursive: true });
      }
      continue;
    }

    pruneGeneratedDependencyDirs(worktree, childPath);
  }
}

export function commitWorktree(worktree: MigrationWorktree, options: CommitOptions): CommitResult {
  pruneGeneratedDependencyDirs(worktree);

  const changedFileCount = countChangedFiles(worktree);

  if (changedFileCount === 0) {
    return {
      changedFileCount: 0,
      committed: false,
      error: options.allowNoChanges ? null : "No migration changes were produced",
      worktree,
    };
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
      options.message,
    ],
    { cwd: worktree.worktreePath },
  );

  if (commit.status !== 0) {
    return { changedFileCount, committed: false, error: commit.stderr || "git commit failed", worktree };
  }

  return { changedFileCount, committed: true, error: null, worktree };
}

export function commitMigration(worktree: MigrationWorktree): CommitResult {
  return commitWorktree(worktree, {
    allowNoChanges: false,
    message: "Migrate from npm to pnpm",
  });
}

export function commitCleanup(worktree: MigrationWorktree): CommitResult {
  return commitWorktree(worktree, {
    allowNoChanges: true,
    message: "Polish pnpm migration cleanup",
  });
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
