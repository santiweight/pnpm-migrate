import path from "node:path";
import { readFileSync } from "node:fs";
import type { Agent, AgentId } from "../agents/detect.ts";
import { runAgent } from "../agents/run.ts";
import type { AgentStatusHandler } from "../agents/status.ts";
import { commitCleanup, type CommitResult } from "./summary.ts";
import type { MigrationWorktree } from "./worktree.ts";
import type { LoggedResult } from "../utils/command.ts";

export type CleanupResult = {
  agentId: AgentId;
  agentLabel: string;
  commit: CommitResult;
  logPath: string;
  run: LoggedResult;
};

function readLogExcerpt(logPath: string): string {
  try {
    const text = readFileSync(logPath, "utf8").trim();
    return text.split(/\r?\n/).slice(-80).join("\n");
  } catch {
    return "";
  }
}

function buildCleanupPrompt(worktree: MigrationWorktree, deterministicLogPath: string): string {
  const logExcerpt = readLogExcerpt(deterministicLogPath);

  return [
    "You are running inside a temporary git worktree created by pnpm-migrate.",
    "",
    "Goal: polish an npm-to-pnpm migration after deterministic tooling has already run.",
    "",
    "Do this:",
    "1. Inspect the migration commit and current working tree.",
    "2. Review README/docs, AGENTS.md, CLAUDE.md, Dockerfiles, GitHub Actions, package.json scripts, and workspace config for stale npm/package-lock/npx wording or commands.",
    "3. Fix only migration-related leftovers: docs wording, pnpm install/test commands, CI/Docker package-manager setup, and small pnpm-specific verification issues.",
    "4. Run focused verification when practical, preferring the package manager scripts already defined by the repo.",
    "5. Leave the worktree with only intended migration cleanup changes. Do not commit.",
    "",
    "Constraints:",
    "- Do not make unrelated product or feature changes.",
    "- Do not add generated dependency directories such as node_modules.",
    "- Do not rewrite publish/release commands unless the repo clearly expects those docs to describe contributor setup.",
    "- Prefer deterministic, minimal edits over broad rewrites.",
    "",
    `Worktree: ${worktree.worktreePath}`,
    `Project directory: ${worktree.projectPath}`,
    "",
    logExcerpt ? `Recent deterministic migration log:\n${logExcerpt}` : "",
  ].filter(Boolean).join("\n");
}

export async function runCleanup(
  agent: Agent,
  worktree: MigrationWorktree,
  deterministicLogPath: string,
  onStatus?: AgentStatusHandler,
): Promise<CleanupResult> {
  const logPath = path.join(worktree.runRoot, `cleanup-${agent.id}.log`);
  const run = await runAgent(agent.id, buildCleanupPrompt(worktree, deterministicLogPath), worktree, logPath, onStatus);

  if (run.code !== 0) {
    return {
      agentId: agent.id,
      agentLabel: agent.label,
      commit: {
        changedFileCount: 0,
        committed: false,
        error: `Cleanup agent exited with code ${run.code}`,
        worktree,
      },
      logPath,
      run,
    };
  }

  return {
    agentId: agent.id,
    agentLabel: agent.label,
    commit: commitCleanup(worktree),
    logPath,
    run,
  };
}
