import path from "node:path";
import { readFileSync } from "node:fs";
import type { MigrationWorktree } from "./worktree.ts";
import { runLogged, type LoggedResult } from "../utils/command.ts";

export function runDeterministicMigration(
  enginePath: string,
  worktree: MigrationWorktree,
  tracePath: string,
  onTraceUpdate?: () => void,
): Promise<LoggedResult> {
  const logPath = path.join(worktree.runRoot, "deterministic-migration.log");

  return runLogged("bash", [enginePath, "--yes", "--agent", "manual"], {
    cwd: worktree.projectPath,
    env: {
      ...process.env,
      PNPM_MIGRATE_TRACE_FILE: tracePath,
    },
    logPath,
    onTick: onTraceUpdate,
  });
}

export function isRecoverableTs2742Failure(logPath: string): boolean {
  try {
    const log = readFileSync(logPath, "utf8");
    return (
      /\bTS2742\b/.test(log) &&
      /A type annotation is necessary/.test(log) &&
      /cannot be named without a reference to ['"]?\.pnpm\//.test(log)
    );
  } catch {
    return false;
  }
}

export function runDeterministicVerification(
  enginePath: string,
  worktree: MigrationWorktree,
  onTraceUpdate?: () => void,
): Promise<LoggedResult> {
  const logPath = path.join(worktree.runRoot, "post-cleanup-verification.log");

  return runLogged("bash", [enginePath, "--yes", "--agent", "manual", "--verify-only"], {
    cwd: worktree.projectPath,
    env: {
      ...process.env,
    },
    logPath,
    onTick: onTraceUpdate,
  });
}
