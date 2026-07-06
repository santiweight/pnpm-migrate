#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { confirm, intro, isCancel, note, outro, spinner } from "@clack/prompts";
import chalk from "chalk";
import { Command } from "commander";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const enginePath = path.join(root, "pnpm-migrate.sh");

new Command()
  .name("pnpm-migrate")
  .description("Migrate an npm project to pnpm from a temporary git worktree.")
  .allowExcessArguments(false)
  .allowUnknownOption(false)
  .parse(process.argv);

const autoApprove = process.env.PNPM_MIGRATE_AUTO_APPROVE === "1";

function fail(message) {
  console.error(chalk.red(`pnpm-migrate: ${message}`));
  process.exit(1);
}

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: process.env,
    encoding: "utf8",
  });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

function commandOk(command, args = ["--version"]) {
  return spawnSync(command, args, { stdio: "ignore" }).status === 0;
}

function detectAgent() {
  const agents = [];

  if (commandOk("claude", ["auth", "status"])) {
    agents.push("Claude Code");
  }

  if (commandOk("codex", ["--version"])) {
    agents.push("Codex");
  }

  return agents;
}

function detectEnvironment() {
  const failures = [];
  const gitRootResult = runCapture("git", ["rev-parse", "--show-toplevel"]);
  const insideGit = gitRootResult.status === 0 && gitRootResult.stdout.length > 0;
  const gitRoot = insideGit ? gitRootResult.stdout : null;
  const projectDir = process.cwd();
  const packageJson = path.join(projectDir, "package.json");
  const lockfiles = ["package-lock.json", "npm-shrinkwrap.json"].filter((file) => {
    return existsSync(path.join(projectDir, file));
  });
  const agents = detectAgent();

  if (!existsSync(enginePath)) {
    failures.push(`Migration engine not found at ${enginePath}`);
  }

  if (!insideGit) {
    failures.push("Not inside a git repository");
  }

  if (!existsSync(packageJson)) {
    failures.push("No package.json found in the current directory");
  }

  if (lockfiles.length === 0) {
    failures.push("No npm lockfile found; expected package-lock.json or npm-shrinkwrap.json");
  }

  if (agents.length === 0) {
    failures.push("No supported coding agent found; install/login Claude Code or Codex");
  }

  let branch = "";
  let dirty = false;
  let repoName = path.basename(projectDir);
  let projectRelativePath = ".";

  if (insideGit) {
    branch = runCapture("git", ["branch", "--show-current"], { cwd: gitRoot }).stdout || "HEAD";
    dirty = runCapture("git", ["status", "--porcelain"], { cwd: gitRoot }).stdout.length > 0;
    repoName = path.basename(gitRoot);
    projectRelativePath = path.relative(gitRoot, projectDir) || ".";

    if (dirty) {
      failures.push("Git working tree has uncommitted changes; commit or stash them first");
    }
  }

  return {
    agents,
    branch,
    dirty,
    failures,
    gitRoot,
    lockfiles,
    packageJson,
    projectDir,
    projectRelativePath,
    repoName,
  };
}

function showFailures(failures) {
  intro(`${chalk.bold("pnpm-migrate")} ${chalk.dim("npm -> pnpm")}`);
  note(failures.map((failure) => `${chalk.red("✗")} ${failure}`).join("\n"), "Cannot continue");
  outro(chalk.red("Fix the failing conditions and run pnpm-migrate again."));
}

function showEnvironment(env) {
  intro(`${chalk.bold("pnpm-migrate")} ${chalk.dim("npm -> pnpm")}`);
  note(
    [
      `${chalk.green("✓")} Git repo detected: ${env.gitRoot}`,
      `${chalk.green("✓")} Branch: ${env.branch}`,
      `${chalk.green("✓")} npm project: ${env.projectDir}`,
      `${chalk.green("✓")} npm lockfile: ${env.lockfiles.join(", ")}`,
      `${chalk.green("✓")} Agents available: ${env.agents.join(", ")}`,
    ].join("\n"),
    "Environment check",
  );
  note(
    [
      "pnpm-migrate creates a temporary git worktree and migrates there.",
      "Your current checkout is not touched.",
      "At the end, the migrated repo is available as a branch you can inspect.",
    ].join("\n"),
    "Safe by default",
  );
}

async function askToContinue(message) {
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

function cancelAndExit() {
  outro(chalk.yellow("Migration cancelled. No changes were made."));
  process.exit(130);
}

function sanitizeBranchSegment(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "repo";
}

function createMigrationWorktree(env) {
  const parent = spawnSync("mktemp", ["-d", path.join(process.env.PNPM_MIGRATE_STATE_ROOT || os.tmpdir(), "pnpm-migrate.XXXXXX")], {
    encoding: "utf8",
  });
  if (parent.status !== 0) {
    fail(parent.stderr?.trim() || "failed to create temporary directory");
  }

  const runRoot = parent.stdout.trim();
  const branch = `pnpm-migrate/${sanitizeBranchSegment(env.repoName)}-${Date.now()}`;
  const worktreePath = path.join(runRoot, env.repoName);
  const result = spawnSync("git", ["worktree", "add", "-b", branch, worktreePath, "HEAD"], {
    cwd: env.gitRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    fail(result.stderr?.trim() || "failed to create temporary git worktree");
  }

  return {
    branch,
    projectPath: path.join(worktreePath, env.projectRelativePath),
    runRoot,
    worktreePath,
  };
}

function runEngine(worktree) {
  return new Promise((resolve) => {
    const child = spawn("bash", [enginePath, "--yes", "--agent", "manual"], {
      cwd: worktree.projectPath,
      env: process.env,
      stdio: "inherit",
    });

    child.on("exit", (code, signal) => {
      resolve({ code: signal ? 1 : code ?? 1, signal });
    });

    child.on("error", (error) => {
      console.error(chalk.red(error.message));
      resolve({ code: 1, signal: null });
    });
  });
}

function commitMigration(worktree) {
  const changedFiles = runCapture("git", ["status", "--short"], { cwd: worktree.worktreePath })
    .stdout
    .split("\n")
    .filter(Boolean);

  if (changedFiles.length === 0) {
    return { committed: false, changedFileCount: 0, error: "No migration changes were produced" };
  }

  const add = runCapture("git", ["add", "-A"], { cwd: worktree.worktreePath });
  if (add.status !== 0) {
    return { committed: false, changedFileCount: changedFiles.length, error: add.stderr || "git add failed" };
  }

  const commit = runCapture(
    "git",
    [
      "-c",
      "user.name=pnpm-migrate",
      "-c",
      "user.email=pnpm-migrate@example.invalid",
      "commit",
      "-m",
      "Migrate from npm to pnpm",
    ],
    { cwd: worktree.worktreePath },
  );

  if (commit.status !== 0) {
    return { committed: false, changedFileCount: changedFiles.length, error: commit.stderr || "git commit failed" };
  }

  return { committed: true, changedFileCount: changedFiles.length, error: null };
}

function summarizeWorktree(worktree, baseBranch, commitResult) {
  const diffStat = commitResult.committed
    ? runCapture("git", ["diff", "--stat", `${baseBranch}...HEAD`], { cwd: worktree.worktreePath }).stdout
    : runCapture("git", ["diff", "--stat"], { cwd: worktree.worktreePath }).stdout;

  note(
    [
      `Branch: ${worktree.branch}`,
      `Worktree: ${worktree.worktreePath}`,
      `Committed: ${commitResult.committed ? "yes" : "no"}`,
      `Changed files: ${commitResult.changedFileCount}`,
      commitResult.error ? `Commit note: ${commitResult.error}` : "",
      diffStat ? `\n${diffStat}` : "",
    ].filter(Boolean).join("\n"),
    "Migration branch ready",
  );
}

async function main() {
  const env = detectEnvironment();

  if (env.failures.length > 0) {
    showFailures(env.failures);
    process.exit(1);
  }

  showEnvironment(env);
  await askToContinue("Start migration in a temporary worktree?");

  note(
    [
      "This stage only runs deterministic tooling:",
      "- lockfiles, package metadata, workspaces",
      "- scripts, CI, Docker, obvious contributor docs",
      "- pnpm install and project verification",
      "",
      "No coding agent is involved in this stage.",
    ].join("\n"),
    "Deterministic migration",
  );
  await askToContinue("Run deterministic npm -> pnpm migration?");

  const s = spinner();
  s.start("Creating temporary git worktree");
  const worktree = createMigrationWorktree(env);
  s.stop(`Git worktree created: ${worktree.branch}`);

  const result = await runEngine(worktree);

  if (result.code !== 0) {
    summarizeWorktree(worktree, env.branch, {
      committed: false,
      changedFileCount: runCapture("git", ["status", "--short"], { cwd: worktree.worktreePath })
        .stdout
        .split("\n")
        .filter(Boolean).length,
      error: "Migration failed before commit",
    });
    outro(chalk.red("Deterministic migration did not complete. The worktree was kept for inspection."));
    process.exit(result.code);
  }

  const commitResult = commitMigration(worktree);
  summarizeWorktree(worktree, env.branch, commitResult);

  if (!commitResult.committed) {
    outro(chalk.yellow("Deterministic migration finished, but the result was left uncommitted in the worktree."));
    process.exit(1);
  }

  outro(chalk.green("Deterministic migration complete. Cleanup/agent stage is next to design."));
}

await main();
