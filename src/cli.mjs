#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
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

const deterministicStages = [
  {
    id: "worktree",
    label: "Create isolated git worktree",
  },
  {
    id: "config",
    label: "Migrate npm config -> pnpm",
    phases: [
      "select_agent",
      "preflight",
      "write_pnpm_workspace",
      "set_package_manager",
      "normalize_github_tarballs",
      "convert_lockfile",
      "repair_imported_transitive_deps",
      "remove_npm_lockfiles",
    ],
  },
  {
    id: "repo",
    label: "Rewrite scripts and workspace assumptions",
    phases: [
      "rewrite_package_scripts",
      "fix_karma_configs",
      "repair_workspace_import_deps",
      "repair_node_types_dependency",
    ],
  },
  {
    id: "install",
    label: "Install dependencies with pnpm",
    phases: ["install_deps"],
  },
  {
    id: "docs",
    label: "Migrate CI, Docker, documentation",
    phases: [
      "format_metadata",
      "rewrite_ci_npm_commands",
      "rewrite_markdown_npm_commands",
      "report_remaining_npm_commands",
      "run_agent",
    ],
  },
  {
    id: "verify",
    label: "Verify migration worked",
    phases: ["run_verification"],
  },
  {
    id: "commit",
    label: "Commit migration branch",
  },
];

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

function parseGitHubRemote(remoteUrl) {
  const match = remoteUrl.match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (!match) {
    return null;
  }

  return {
    owner: match[1],
    repo: match[2],
  };
}

function detectGitHubOwnerName(owner) {
  const response = runCapture(process.execPath, [
    "-e",
    `
const https = require("https");
const owner = process.argv[1];
const request = https.get({
  hostname: "api.github.com",
  path: \`/users/\${encodeURIComponent(owner)}\`,
  headers: { "User-Agent": "pnpm-migrate" },
  timeout: 1000,
}, (response) => {
  let body = "";
  response.setEncoding("utf8");
  response.on("data", (chunk) => { body += chunk; });
  response.on("end", () => {
    try {
      const user = JSON.parse(body);
      if (typeof user.name === "string" && user.name.trim()) {
        process.stdout.write(user.name.trim());
      }
    } catch {}
  });
});
request.on("timeout", () => request.destroy());
request.on("error", () => {});
`,
    owner,
  ]);

  return response.status === 0 && response.stdout ? response.stdout : null;
}

function detectRepoLabel(gitRoot, fallbackName) {
  const remote = runCapture("git", ["remote", "get-url", "origin"], { cwd: gitRoot });
  if (remote.status === 0) {
    const parsed = parseGitHubRemote(remote.stdout);
    if (parsed) {
      return `${detectGitHubOwnerName(parsed.owner) ?? parsed.owner} > ${parsed.repo}`;
    }
  }

  return fallbackName;
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
  let repoLabel = repoName;
  let projectRelativePath = ".";

  if (insideGit) {
    branch = runCapture("git", ["branch", "--show-current"], { cwd: gitRoot }).stdout || "HEAD";
    dirty = runCapture("git", ["status", "--porcelain"], { cwd: gitRoot }).stdout.length > 0;
    repoName = path.basename(gitRoot);
    repoLabel = detectRepoLabel(gitRoot, repoName);
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
    repoLabel,
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
      `${chalk.green("✓")} Git detected: ${env.repoLabel}`,
      `${chalk.green("✓")} Branch: ${env.branch}`,
      `${chalk.green("✓")} Agents available: ${env.agents.join(", ")}`,
    ].join("\n"),
    "Environment check",
  );
}

function showWorktreeSafety(worktree) {
  note(
    [
      "pnpm-migrate acts in total isolation.",
      `All work will be done in ${worktree.worktreePath}`,
      "Your current directory is not modified.",
    ].join("\n"),
    chalk.yellow("pnpm-migrate will not touch your work"),
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

function readTrace(tracePath) {
  if (!tracePath || !existsSync(tracePath)) {
    return new Map();
  }

  return new Map(
    readFileSync(tracePath, "utf8")
      .trim()
      .split(/\r?\n/)
      .slice(1)
      .filter(Boolean)
      .map((line) => {
        const [phase, status] = line.split("\t");
        return [phase, Number(status)];
      }),
  );
}

function resolveStageStatuses(tracePath, state) {
  const trace = readTrace(tracePath);
  const statuses = deterministicStages.map((stage) => {
    if (stage.id === "worktree") {
      return { ...stage, status: state.worktree };
    }

    if (stage.id === "commit") {
      return { ...stage, status: state.commit };
    }

    const phases = stage.phases ?? [];
    if (phases.some((phase) => trace.get(phase) > 0)) {
      return { ...stage, status: "failed" };
    }

    if (phases.every((phase) => trace.get(phase) === 0)) {
      return { ...stage, status: "done" };
    }

    return { ...stage, status: "pending" };
  });

  const active = statuses.find((stage) => stage.status === "pending");
  if (active && state.running) {
    active.status = "active";
  }

  return statuses;
}

function createChecklistRenderer(tracePath) {
  let previousLines = 0;
  let previousText = "";

  function lineFor(stage) {
    const symbols = {
      active: chalk.cyan("◒"),
      done: chalk.green("✓"),
      failed: chalk.red("✗"),
      pending: chalk.dim("○"),
    };
    return `│  ${symbols[stage.status] ?? symbols.pending} ${stage.label}`;
  }

  function render(state) {
    if (!process.stdout.isTTY) {
      return;
    }

    const statuses = resolveStageStatuses(tracePath, state);
    const active = statuses.find((stage) => stage.status === "active");
    const failed = statuses.find((stage) => stage.status === "failed");
    const lines = [
      "◇  Deterministic migration",
      "│",
      ...statuses.map(lineFor),
      "│",
      failed
        ? `│  Failed: ${failed.label}`
        : active
          ? `│  Current: ${active.label}`
          : "│  Current: complete",
      "│",
    ];
    const text = lines.join("\n");

    if (text === previousText) {
      return;
    }

    if (previousLines > 0) {
      process.stdout.write(`\x1b[${previousLines}A\x1b[J`);
    }

    process.stdout.write(`${text}\n`);
    previousLines = lines.length;
    previousText = text;
  }

  function finish() {
    previousLines = 0;
    previousText = "";
  }

  return { finish, render };
}

function runEngine(worktree, tracePath, onTraceUpdate) {
  return new Promise((resolve) => {
    const logPath = path.join(worktree.runRoot, "deterministic-migration.log");
    const log = createWriteStream(logPath, { flags: "a" });
    const child = spawn("bash", [enginePath, "--yes", "--agent", "manual"], {
      cwd: worktree.projectPath,
      env: {
        ...process.env,
        PNPM_MIGRATE_TRACE_FILE: tracePath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const interval = setInterval(() => onTraceUpdate?.(), 300);

    child.stdout.pipe(log);
    child.stderr.pipe(log);

    child.on("exit", (code, signal) => {
      clearInterval(interval);
      onTraceUpdate?.();
      log.end(() => {
        resolve({ code: signal ? 1 : code ?? 1, logPath, signal });
      });
    });

    child.on("error", (error) => {
      clearInterval(interval);
      log.write(`${error.stack ?? error.message}\n`);
      log.end(() => {
        resolve({ code: 1, logPath, signal: null });
      });
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

function summarizeWorktree(worktree, baseBranch, commitResult, engineResult) {
  const diffStat = commitResult.committed
    ? runCapture("git", ["diff", "--stat", `${baseBranch}...HEAD`], { cwd: worktree.worktreePath }).stdout
    : runCapture("git", ["diff", "--stat"], { cwd: worktree.worktreePath }).stdout;

  note(
    [
      `Branch: ${worktree.branch}`,
      `Worktree: ${worktree.worktreePath}`,
      `Committed: ${commitResult.committed ? "yes" : "no"}`,
      `Changed files: ${commitResult.changedFileCount}`,
      engineResult?.logPath ? `Log: ${engineResult.logPath}` : "",
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

  const s = spinner();
  s.start("Creating temporary git worktree");
  const worktree = createMigrationWorktree(env);
  s.stop(`Git worktree created: ${worktree.branch}`);
  showWorktreeSafety(worktree);

  note(
    [
      "This stage runs the basic no-regrets migration:",
      "- migrate npm config -> pnpm",
      "- migrate CI, Docker, documentation",
      "- verify migration worked",
      "",
      "No coding agent is involved in this stage.",
    ].join("\n"),
    "Deterministic steps",
  );
  await askToContinue("Run deterministic npm -> pnpm migration?");

  const tracePath = path.join(worktree.runRoot, "deterministic-phases.tsv");
  const checklist = createChecklistRenderer(tracePath);
  const checklistState = {
    commit: "pending",
    running: true,
    worktree: "done",
  };
  checklist.render(checklistState);

  const result = await runEngine(worktree, tracePath, () => checklist.render(checklistState));
  checklistState.running = false;

  if (result.code !== 0) {
    checklist.render(checklistState);
    checklist.finish();
    summarizeWorktree(worktree, env.branch, {
      committed: false,
      changedFileCount: runCapture("git", ["status", "--short"], { cwd: worktree.worktreePath })
        .stdout
        .split("\n")
        .filter(Boolean).length,
      error: "Migration failed before commit",
    }, result);
    outro(chalk.red("Deterministic migration did not complete. The worktree was kept for inspection."));
    process.exit(result.code);
  }

  checklistState.commit = "active";
  checklist.render(checklistState);
  const commitResult = commitMigration(worktree);
  checklistState.commit = commitResult.committed ? "done" : "failed";
  checklist.render(checklistState);
  checklist.finish();
  summarizeWorktree(worktree, env.branch, commitResult, result);

  if (!commitResult.committed) {
    outro(chalk.yellow("Deterministic migration finished, but the result was left uncommitted in the worktree."));
    process.exit(1);
  }

  outro(chalk.green("Deterministic migration complete. Cleanup/agent stage is next to design."));
}

await main();
