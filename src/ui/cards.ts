import { intro, note, outro } from "@clack/prompts";
import chalk from "chalk";
import type { PreflightEnvironment } from "../core/preflight.ts";
import type { CommitResult, MigrationSummary } from "../core/summary.ts";
import { displayWorktreePath, type MigrationWorktree } from "../core/worktree.ts";
import type { LoggedResult } from "../utils/command.ts";
import type { CleanupResult } from "../core/cleanup.ts";
import type { PublishResult } from "../core/publish.ts";
import type { PullRequestGreenResult } from "../core/pr-green.ts";

export function redTitle(value: string): string {
  return chalk.red(value);
}

export function showIntro(): void {
  intro(`${chalk.yellow("⚠")} ${chalk.yellow.bold("pnpm-migrate")} ${chalk.yellow("⚠")} ${chalk.dim("npm -> pnpm")}`);
}

export function showFailures(failures: string[]): void {
  note(failures.map((failure) => `${chalk.red("✗")} ${failure}`).join("\n"), "Cannot continue");
  outro(chalk.red("Fix the failing conditions and run pnpm-migrate again."));
}

export function showEnvironment(env: PreflightEnvironment): void {
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
  const orange = chalk.hex("#f97316");
  note(
    [
      orange("pnpm-migrate acts in an isolated environment."),
      "",
      `All work will be done in ${displayWorktreePath(worktree)}`,
      "",
      orange("Your current directory will not be modified."),
    ].join("\n"),
    orange("⚠ pnpm-migrate will not touch your work ⚠"),
  );
}

export function showDeterministicIntro(): void {
  note(
    [
      "The migration will perform the following steps:",
      "1. deterministic migrations",
      "2. agent will polish the migration (docs, CI, Dockerfiles)",
      "3. agent will test the migration works",
      "4. PR created",
      "5. agent nurses the PR to green",
    ].join("\n"),
    chalk.red("Run pnpm-migrate"),
  );
}

export function showMigrationSummary(summary: MigrationSummary): void {
  note(summary.lines.join("\n"), redTitle("Migration branch ready"));
}

export function showPublishSkipped(reason: string): void {
  note(reason, redTitle("Publish skipped"));
}

export function showPublishFailure(error: string): void {
  note(chalk.red(error), redTitle("Publish failed"));
}

export function showFinalInstructions(
  worktree: MigrationWorktree,
  publish: PublishResult | null,
  prGreen: PullRequestGreenResult | null = null,
): void {
  const orange = chalk.hex("#f97316");
  const localCheckout = `git checkout ${worktree.branch}`;
  const remoteCheckout = publish?.remoteBranch ? `git checkout ${publish.remoteBranch}` : "not pushed";
  const commandLines = [
    `  ${chalk.green(localCheckout)}`,
    `  ${publish?.remoteBranch ? chalk.green(remoteCheckout) : remoteCheckout}`,
    publish?.prUrl ? `  ${chalk.green(publish.prUrl)}` : null,
    prGreen?.passed ? `  ${chalk.green("PR checks passed")}` : null,
    prGreen && !prGreen.skipped && !prGreen.passed
      ? `  ${chalk.red(`PR checks still need attention${prGreen.lastLogPath ? `: ${prGreen.lastLogPath}` : ""}`)}`
      : null,
  ].filter((line): line is string => line !== null);

  process.stdout.write(
    [
      "",
      chalk.green("Your pnpm migration is complete"),
      "",
      ...commandLines,
      "",
      orange("Thank you for using pnpm-migrate, brought to you by Santi Weight :) Have a great day!"),
      "",
      "",
      "",
    ].join("\n"),
  );
}

export function showCleanupIntro(): void {
  note(
    [
      "Coding agent will now review and polish the migration:",
      "- README/docs wording",
      "- pnpm-specific install/test issues",
      "- CI/Docker edge cases",
      "- remaining migration warnings",
    ].join("\n"),
    redTitle("Agentic Cleanup"),
  );
}

export function showCleanupSkipped(reason: string): void {
  note(reason, redTitle("Cleanup skipped"));
}

export function showCleanupSummary(result: CleanupResult): void {
  note(
    [
      `Agent: ${result.agentLabel}`,
      `Committed: ${result.commit.committed ? "yes" : "no"}`,
      result.commit.error ? `Commit note: ${result.commit.error}` : "",
    ].filter(Boolean).join("\n"),
    redTitle("Cleanup complete"),
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
