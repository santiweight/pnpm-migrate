import path from "node:path";
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
