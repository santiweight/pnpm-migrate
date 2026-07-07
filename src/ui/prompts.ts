import { confirm, isCancel, outro, select, settings } from "@clack/prompts";
import chalk from "chalk";
import type { Agent, AgentId } from "../agents/detect.ts";

settings.aliases.delete("escape");

export async function askToContinue(message: string, autoApprove: boolean): Promise<true> {
  if (autoApprove) {
    return true;
  }

  const answer = await confirm({
    message: chalk.red(message),
    active: "Continue",
    inactive: "Cancel",
    initialValue: true,
  });

  if (isCancel(answer) || answer !== true) {
    cancelAndExit();
  }

  return true;
}

export function cancelAndExit(): never {
  outro(chalk.yellow("Migration cancelled. No changes were made."));
  process.exit(130);
}

export async function chooseCleanupAgent(agents: Agent[]): Promise<AgentId | "skip"> {
  if (agents.length === 1) {
    const [agent] = agents;
    const answer = await confirm({
      message: chalk.red(`Run recommended cleanup with ${agent.label}?`),
      active: "Run cleanup",
      inactive: "Skip for now",
      initialValue: true,
    });

    if (isCancel(answer)) {
      cancelAndExit();
    }

    return answer === true ? agent.id : "skip";
  }

  const answer = await select({
    message: chalk.red("Choose cleanup agent"),
    options: [
      ...agents.map((agent, index) => ({
        label: `${agent.label}${index === 0 ? " (recommended)" : ""}`,
        value: agent.id,
      })),
      { label: "Skip for now", value: "skip" },
    ],
  });

  if (isCancel(answer)) {
    cancelAndExit();
  }

  return answer;
}

export async function chooseRemote(remotes: string[]): Promise<string | null> {
  if (remotes.length === 0) {
    return null;
  }

  if (remotes.length === 1) {
    return remotes[0];
  }

  const answer = await select({
    message: chalk.red("Choose remote for migration branch"),
    options: remotes.map((remote) => ({
      label: remote,
      value: remote,
    })),
  });

  if (isCancel(answer)) {
    cancelAndExit();
  }

  return answer;
}

export async function askCreatePullRequest(): Promise<boolean> {
  const answer = await confirm({
    message: chalk.red("Create a pull request with gh?"),
    active: "Yes - Create a PR",
    inactive: "No",
    initialValue: true,
  });

  if (isCancel(answer)) {
    cancelAndExit();
  }

  return answer === true;
}
