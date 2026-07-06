import type { AgentId } from "./detect.ts";
import type { MigrationWorktree } from "../core/worktree.ts";
import { runLogged, type LoggedResult } from "../utils/command.ts";

export function runAgent(
  agentId: AgentId,
  prompt: string,
  worktree: MigrationWorktree,
  logPath: string,
): Promise<LoggedResult> {
  if (agentId === "claude") {
    return runLogged("claude", ["-p", prompt, "--permission-mode", "auto", "--add-dir", worktree.worktreePath], {
      cwd: worktree.projectPath,
      logPath,
    });
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
      prompt,
    ],
    {
      cwd: worktree.projectPath,
      logPath,
    },
  );
}
