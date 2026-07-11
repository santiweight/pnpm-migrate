import type { AgentId } from "./detect.ts";
import { buildClaudeArgs } from "./claude.ts";
import type { MigrationWorktree } from "../core/worktree.ts";
import { runLogged, type LoggedResult } from "../utils/command.ts";
import { createAgentStatusParser, type AgentStatusHandler } from "./status.ts";

export function runAgent(
  agentId: AgentId,
  prompt: string,
  worktree: MigrationWorktree,
  logPath: string,
  onStatus?: AgentStatusHandler,
  options: { resumeSession?: boolean; sessionId?: string } = {},
): Promise<LoggedResult> {
  const parseStatus = createAgentStatusParser(agentId, onStatus);

  if (agentId === "claude") {
    return runLogged(
      "claude",
      buildClaudeArgs({
        prompt,
        resumeSession: options.resumeSession,
        sessionId: options.sessionId,
        worktreePath: worktree.worktreePath,
      }),
      {
        cwd: worktree.projectPath,
        logPath,
        onOutput: (chunk) => parseStatus(chunk),
      },
    );
  }

  return runLogged(
    "codex",
    [
      "exec",
      "--cd",
      worktree.projectPath,
      "--sandbox",
      "workspace-write",
      "--ask-for-approval",
      "never",
      "--color",
      "never",
      "--json",
      prompt,
    ],
    {
      cwd: worktree.projectPath,
      logPath,
      onOutput: (chunk) => parseStatus(chunk),
    },
  );
}
