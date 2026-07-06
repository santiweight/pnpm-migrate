import { commandOk } from "../utils/command.ts";

export type AgentId = "claude" | "codex";

export type Agent = {
  id: AgentId;
  label: string;
};

export function detectAgents(): Agent[] {
  const agents: Agent[] = [];

  if (commandOk("claude", ["auth", "status"])) {
    agents.push({ id: "claude", label: "Claude Code" });
  }

  if (commandOk("codex", ["--version"])) {
    agents.push({ id: "codex", label: "Codex" });
  }

  return agents;
}
