import type { AgentId } from "./detect.ts";
import type { MigrationWorktree } from "../core/worktree.ts";
import { runLogged, type LoggedResult } from "../utils/command.ts";
import { createAgentStatusParser, type AgentStatusHandler } from "./status.ts";

export function runAgent(
  agentId: AgentId,
  prompt: string,
  worktree: MigrationWorktree,
  logPath: string,
  onStatus?: AgentStatusHandler,
): Promise<LoggedResult> {
  const parseStatus = createAgentStatusParser(agentId, onStatus);

  if (agentId === "claude") {
    return runLogged(
      "claude",
      [
        "-p",
        prompt,
        "--permission-mode",
        "auto",
        "--add-dir",
        worktree.worktreePath,
        "--output-format",
        "stream-json",
        "--include-partial-messages",
        "--verbose",
      ],
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
