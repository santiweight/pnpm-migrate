#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cancel, intro, isCancel, note, outro, select, spinner } from "@clack/prompts";
import chalk from "chalk";
import { Command } from "commander";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const enginePath = path.join(root, "pnpm-migrate.sh");

const program = new Command()
  .name("pnpm-migrate")
  .description("Migrate an npm project to pnpm with deterministic rewrites and optional agent cleanup.")
  .option("--agent <agent>", "agent to use after deterministic migration: manual or claude")
  .option("--yes", "accept prompts")
  .option("--dry-run", "print planned changes without modifying files")
  .option("--skip-agent", "do not run an agent after migration")
  .option("--skip-install", "do not install dependencies")
  .option("--no-tests", "do not run package verification scripts")
  .option("--trust-lockfile", "trust the generated pnpm lockfile during install")
  .allowUnknownOption(false)
  .parse(process.argv);

const options = program.opts();

function fail(message) {
  console.error(chalk.red(`pnpm-migrate: ${message}`));
  process.exit(1);
}

function validateAgent(agent) {
  if (!agent) return;
  if (!["manual", "claude"].includes(agent)) {
    fail(`unsupported agent "${agent}". Expected manual or claude.`);
  }
}

async function chooseAgent() {
  validateAgent(options.agent);

  if (options.skipAgent) return "manual";
  if (options.agent) return options.agent;
  if (options.yes) return "manual";

  intro(`${chalk.bold("pnpm-migrate")} ${chalk.dim("npm -> pnpm")}`);
  note(
    [
      "The deterministic migration runs first.",
      "Agent cleanup is optional and only handles repo-specific leftovers.",
    ].join("\n"),
    "Migration flow",
  );

  const choice = await select({
    message: "Choose cleanup mode",
    options: [
      {
        value: "claude",
        label: "Claude Code",
        hint: "use existing Claude CLI login",
      },
      {
        value: "manual",
        label: "Manual only",
        hint: "deterministic rewrites + review report",
      },
    ],
    initialValue: "manual",
  });

  if (isCancel(choice)) {
    cancel("Migration cancelled.");
    process.exit(130);
  }

  return choice;
}

function buildEngineArgs(agent) {
  const args = [];
  args.push("--agent", agent);

  if (options.yes) args.push("--yes");
  if (options.dryRun) args.push("--dry-run");
  if (options.skipAgent) args.push("--skip-agent");
  if (options.skipInstall) args.push("--skip-install");
  if (options.noTests) args.push("--no-tests");
  if (options.trustLockfile) args.push("--trust-lockfile");

  return args;
}

function runEngine(args) {
  return new Promise((resolve) => {
    const child = spawn("bash", [enginePath, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        resolve({ code: 1, signal });
      } else {
        resolve({ code: code ?? 1, signal: null });
      }
    });

    child.on("error", (error) => {
      console.error(chalk.red(error.message));
      resolve({ code: 1, signal: null });
    });
  });
}

async function main() {
  if (!existsSync(enginePath)) {
    fail(`migration engine not found at ${enginePath}`);
  }

  const agent = await chooseAgent();
  const args = buildEngineArgs(agent);
  const s = spinner();
  s.start("Starting deterministic migration engine");
  s.stop(`Running ${chalk.cyan("pnpm-migrate.sh")} with ${chalk.bold(agent)} cleanup`);

  const result = await runEngine(args);
  if (result.code !== 0) {
    outro(chalk.red("Migration did not complete."));
    process.exit(result.code);
  }

  outro(chalk.green("Migration complete. Review the git diff before opening a PR."));
}

await main();
