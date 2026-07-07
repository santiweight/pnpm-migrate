import chalk from "chalk";
import type { PreflightEnvironment } from "../core/preflight.ts";

type EnvironmentItem = {
  done: string;
  pending: string;
};

type EnvironmentItemStatus = "active" | "done" | "pending";

export type EnvironmentProgressRenderer = {
  finish: (options?: { clear?: boolean }) => void;
  render: (activeIndex: number) => void;
};

const symbols = {
  active: chalk.cyan("◒"),
  done: chalk.green("✓"),
  pending: chalk.dim("○"),
};

function lineFor(item: EnvironmentItem, status: EnvironmentItemStatus): string {
  return `│  ${symbols[status]} ${status === "done" ? item.done : item.pending}`;
}

export function createEnvironmentProgressRenderer(
  env: PreflightEnvironment,
): EnvironmentProgressRenderer {
  const items: EnvironmentItem[] = [
    {
      done: `Git detected: ${env.repoLabel}`,
      pending: "Checking Git repository",
    },
    {
      done: `Branch: ${env.branch}`,
      pending: "Checking current branch",
    },
    {
      done: `Agents available: ${env.agents.map((agent) => agent.label).join(", ")}`,
      pending: "Checking coding agents",
    },
  ];
  let previousLines = 0;
  let previousText = "";

  function render(activeIndex: number): void {
    const lines = [
      `◇  ${chalk.red("Environment Check")}`,
      "│",
      ...items.map((item, index) => {
        const status =
          index < activeIndex
            ? "done"
            : index === activeIndex
              ? "active"
              : "pending";
        return lineFor(item, status);
      }),
      "│",
    ];
    const text = lines.join("\n");

    if (text === previousText) {
      return;
    }

    if (!process.stdout.isTTY) {
      if (activeIndex === items.length) {
        process.stdout.write(`${text}\n`);
      }
      previousText = text;
      return;
    }

    if (process.stdout.isTTY && previousLines > 0) {
      process.stdout.write(`\x1b[${previousLines}A\x1b[J`);
    }

    process.stdout.write(`${text}\n`);

    previousLines = lines.length + 1;
    previousText = text;
  }

  function finish(options: { clear?: boolean } = {}): void {
    if (options.clear && process.stdout.isTTY && previousLines > 0) {
      process.stdout.write(`\x1b[${previousLines}A\x1b[J`);
    }

    previousLines = 0;
    previousText = "";
  }

  return { finish, render };
}
