import chalk from "chalk";
import { resolveStageStatuses, type ChecklistState } from "../migration/trace.ts";
import type { DeterministicStage, StageStatus } from "../migration/phases.ts";

export type ChecklistRenderer = {
  finish: () => void;
  render: (state: ChecklistState) => void;
};

function symbolFor(status: StageStatus | undefined): string {
  const symbols = {
    active: chalk.cyan("◒"),
    done: chalk.green("✓"),
    failed: chalk.red("✗"),
    pending: chalk.dim("○"),
  };
  return symbols[status ?? "pending"];
}

function lineFor(stage: DeterministicStage): string {
  return `│  ${symbolFor(stage.status)} ${stage.label}`;
}

export function createChecklistRenderer(tracePath: string): ChecklistRenderer {
  let previousLines = 0;
  let previousText = "";

  function render(state: ChecklistState): void {
    if (!process.stdout.isTTY) {
      return;
    }

    const statuses = resolveStageStatuses(tracePath, state);
    const failed = statuses.find((stage) => stage.status === "failed");
    const statusLine = failed ? `│  Failed: ${failed.label}` : null;
    const lines = [
      `◇  ${chalk.red("Deterministic Migration")}`,
      "│",
      ...statuses.map(lineFor),
      ...(statusLine ? ["│", statusLine, "│"] : ["│"]),
    ];
    const text = lines.join("\n");

    if (text === previousText) {
      return;
    }

    if (previousLines > 0) {
      process.stdout.write(`\x1b[${previousLines}A\x1b[J`);
    }

    process.stdout.write(`${text}\n`);
    previousLines = lines.length + 1;
    previousText = text;
  }

  function finish(): void {
    previousLines = 0;
    previousText = "";
  }

  return { finish, render };
}
