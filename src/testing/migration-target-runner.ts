import path from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { runCommand, runCommandOk, shellQuote, type CommandResult } from "./process.ts";
import { formatValidationResult, validateMigration } from "../validation/migration.ts";

export type PhaseResult = {
  phase: string;
  status: number;
  durationSeconds: number;
  output: string;
  changedFiles: number;
};

export type PhaseObserver = (result: PhaseResult) => void;

export function countChangedFiles(worktree: string): number {
  const result = runCommand("git", ["status", "--short"], { cwd: worktree });
  if (result.status !== 0) {
    return 0;
  }
  return result.stdout.split(/\r?\n/).filter(Boolean).length;
}

export function emitCommandPhase(
  phase: string,
  worktree: string,
  command: string,
  args: string[],
  options: {
    timeoutSeconds?: number;
    env?: NodeJS.ProcessEnv;
    onPhase?: PhaseObserver;
    print?: boolean;
  } = {},
): CommandResult {
  if (options.print) {
    console.log(`[target] ${phase}`);
    console.log(`$ ${shellQuote(command, args)}`);
  }

  const result = runCommand(command, args, {
    cwd: worktree,
    timeoutSeconds: options.timeoutSeconds,
    env: {
      ...process.env,
      CI: "1",
      COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
      ...options.env,
    },
  });

  if (options.print) {
    process.stdout.write(result.output);
  }

  options.onPhase?.({
    phase,
    status: result.status,
    durationSeconds: result.durationSeconds,
    output: result.output,
    changedFiles: countChangedFiles(worktree),
  });

  return result;
}

export function materializeGitHubTarget(options: {
  id: string;
  repo: string;
  commit: string;
  parentDir: string;
  timeoutSeconds?: number;
  onPhase?: PhaseObserver;
  print?: boolean;
}): string {
  const worktree = path.join(options.parentDir, options.id);
  rmSync(worktree, { recursive: true, force: true });
  mkdirSync(path.dirname(worktree), { recursive: true });

  const clone = emitCommandPhase(
    "clone",
    options.parentDir,
    "git",
    ["clone", `https://github.com/${options.repo}.git`, worktree],
    {
      timeoutSeconds: options.timeoutSeconds,
      onPhase: options.onPhase,
      print: options.print,
    },
  );
  if (clone.status !== 0) {
    throw new Error(`failed to clone ${options.repo}`);
  }

  const checkout = emitCommandPhase(
    "checkout",
    worktree,
    "git",
    ["checkout", "--detach", options.commit],
    {
      timeoutSeconds: options.timeoutSeconds,
      onPhase: options.onPhase,
      print: options.print,
    },
  );
  if (checkout.status !== 0) {
    throw new Error(`failed to checkout ${options.repo}@${options.commit}`);
  }

  return worktree;
}

export function runMigrationAndValidate(options: {
  projectPath: string;
  repoRoot: string;
  skipInstall?: boolean;
  timeoutSeconds?: number;
  onPhase?: PhaseObserver;
  print?: boolean;
}): { failed: boolean; migration: CommandResult; validation: ReturnType<typeof validateMigration> } {
  const migrateArgs = [path.join(options.repoRoot, "pnpm-migrate.sh"), "--yes", "--skip-agent", "--no-tests"];
  if (options.skipInstall) {
    migrateArgs.push("--skip-install");
  }

  const migration = emitCommandPhase(
    "migrate",
    options.projectPath,
    "bash",
    migrateArgs,
    {
      timeoutSeconds: options.timeoutSeconds,
      onPhase: options.onPhase,
      print: options.print,
    },
  );

  const started = Date.now();
  const validation = validateMigration(options.projectPath);
  const validationOutput = formatValidationResult(validation);
  const validationStatus = validation.errors.length > 0 ? 1 : 0;
  if (options.print) {
    process.stdout.write(validationOutput);
  }
  options.onPhase?.({
    phase: "validate",
    status: validationStatus,
    durationSeconds: Math.round((Date.now() - started) / 1000),
    output: validationOutput,
    changedFiles: countChangedFiles(options.projectPath),
  });

  return {
    failed: migration.status !== 0 || validationStatus !== 0,
    migration,
    validation,
  };
}

export function runGitOk(args: string[], cwd: string): CommandResult {
  return runCommandOk("git", args, { cwd });
}
