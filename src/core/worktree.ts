import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { rmSync, symlinkSync } from "node:fs";
import type { PreflightEnvironment } from "./preflight.ts";

export type MigrationWorktree = {
  branch: string;
  projectPath: string;
  runRoot: string;
  worktreePath: string;
};

function sanitizeBranchSegment(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "repo"
  );
}

export function createMigrationWorktree(env: PreflightEnvironment): MigrationWorktree {
  const parent = spawnSync(
    "mktemp",
    ["-d", path.join(process.env.PNPM_MIGRATE_STATE_ROOT || os.tmpdir(), "pnpm-migrate.XXXXXX")],
    { encoding: "utf8" },
  );

  if (parent.status !== 0) {
    throw new Error(parent.stderr?.trim() || "failed to create temporary directory");
  }

  const runRoot = parent.stdout.trim();
  const branch = `pnpm-migrate/${sanitizeBranchSegment(env.repoName)}-${Date.now()}`;
  const worktreePath = path.join(runRoot, env.repoName);
  const result = spawnSync("git", ["worktree", "add", "-b", branch, worktreePath, "HEAD"], {
    cwd: env.gitRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || "failed to create temporary git worktree");
  }

  return {
    branch,
    projectPath: path.join(worktreePath, env.projectRelativePath),
    runRoot,
    worktreePath,
  };
}

export function displayWorktreePath(worktree: MigrationWorktree): string {
  const shortRoot = process.env.PNPM_MIGRATE_SHORT_PATH_ROOT || "/tmp";
  const shortPath = path.join(shortRoot, `${path.basename(worktree.runRoot)}-worktree`);

  try {
    rmSync(shortPath, { force: true, recursive: true });
    symlinkSync(worktree.worktreePath, shortPath);
    return shortPath;
  } catch {
    return worktree.worktreePath;
  }
}
