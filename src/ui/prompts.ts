import { confirm, isCancel, outro } from "@clack/prompts";
import chalk from "chalk";

export async function askToContinue(message: string, autoApprove: boolean): Promise<true> {
  if (autoApprove) {
    return true;
  }

  const answer = await confirm({
    message,
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
