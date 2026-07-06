import { intro, note, outro } from "@clack/prompts";
import chalk from "chalk";
import type { PreflightEnvironment } from "../core/preflight.ts";
import type { CommitResult, MigrationSummary } from "../core/summary.ts";
import type { MigrationWorktree } from "../core/worktree.ts";
import type { LoggedResult } from "../utils/command.ts";
import type { CleanupResult } from "../core/cleanup.ts";

export function showFailures(failures: string[]): void {
  intro(`${chalk.bold("pnpm-migrate")} ${chalk.dim("npm -> pnpm")}`);
  note(failures.map((failure) => `${chalk.red("✗")} ${failure}`).join("\n"), "Cannot continue");
  outro(chalk.red("Fix the failing conditions and run pnpm-migrate again."));
}

export function showEnvironment(env: PreflightEnvironment): void {
  intro(`${chalk.bold("pnpm-migrate")} ${chalk.dim("npm -> pnpm")}`);
  note(
    [
      `${chalk.green("✓")} Git detected: ${env.repoLabel}`,
      `${chalk.green("✓")} Branch: ${env.branch}`,
      `${chalk.green("✓")} Agents available: ${env.agents.map((agent) => agent.label).join(", ")}`,
    ].join("\n"),
    "Environment check",
  );
}

export function showWorktreeSafety(worktree: MigrationWorktree): void {
  note(
    [
      "pnpm-migrate acts in total isolation.",
      `All work will be done in ${worktree.worktreePath}`,
      "Your current directory is not modified.",
    ].join("\n"),
    chalk.yellow("pnpm-migrate will not touch your work"),
  );
}

export function showDeterministicIntro(): void {
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
}

export function showMigrationSummary(summary: MigrationSummary): void {
  note(summary.lines.join("\n"), "Migration branch ready");
}

export function showCleanupIntro(): void {
  note(
    [
      "A coding agent will now review and polish the migration:",
      "- README/docs wording",
      "- pnpm-specific install/test issues",
      "- CI/Docker edge cases",
      "- remaining migration warnings",
    ].join("\n"),
    "Recommended cleanup",
  );
}

export function showCleanupSkipped(reason: string): void {
  note(reason, "Cleanup skipped");
}

export function showCleanupSummary(result: CleanupResult): void {
  note(
    [
      `Agent: ${result.agentLabel}`,
      `Committed: ${result.commit.committed ? "yes" : "no"}`,
      `Changed files: ${result.commit.changedFileCount}`,
      `Log: ${result.logPath}`,
      result.commit.error ? `Commit note: ${result.commit.error}` : "",
    ].filter(Boolean).join("\n"),
    "Cleanup complete",
  );
}

export function buildFailedCommitResult(worktree: MigrationWorktree, changedFileCount: number): CommitResult {
  return {
    changedFileCount,
    committed: false,
    error: "Migration failed before commit",
    worktree,
  };
}

export function showDeterministicFailure(): never {
  outro(chalk.red("Deterministic migration did not complete. The worktree was kept for inspection."));
  process.exit(1);
}

export function showUncommittedFinish(): never {
  outro(chalk.yellow("Deterministic migration finished, but the result was left uncommitted in the worktree."));
  process.exit(1);
}

export function showDeterministicComplete(_engineResult: LoggedResult): void {
  outro(chalk.green("Migration complete."));
}
