import { confirm, isCancel, outro, select, settings } from "@clack/prompts";
import chalk from "chalk";

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
