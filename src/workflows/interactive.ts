import path from "node:path";
import { spinner } from "@clack/prompts";
import type { StageStatus } from "../migration/phases.ts";
import { commitMigration, buildMigrationSummary, countChangedFiles } from "../core/summary.ts";
import { runCleanup } from "../core/cleanup.ts";
import { createMigrationWorktree } from "../core/worktree.ts";
import { detectEnvironment } from "../core/preflight.ts";
import { runDeterministicMigration } from "../core/deterministic.ts";
import { createChecklistRenderer } from "../ui/checklist.ts";
import {
  showDeterministicComplete,
  showDeterministicFailure,
  showDeterministicIntro,
  showEnvironment,
  showFailures,
  showCleanupIntro,
  showCleanupSkipped,
  showCleanupSummary,
  showIntro,
  showMigrationSummary,
  showWorktreeSafety,
  showUncommittedFinish,
} from "../ui/cards.ts";
import { askToContinue, chooseCleanupAgent } from "../ui/prompts.ts";
import { minimumVisible, sectionPause } from "../ui/timing.ts";

export type InteractiveWorkflowOptions = {
  autoApprove: boolean;
  enginePath: string;
};

export async function runInteractiveWorkflow(options: InteractiveWorkflowOptions): Promise<void> {
  showIntro();

  const envSpinner = spinner();
  envSpinner.start("Checking environment");
  const env = await minimumVisible(() => detectEnvironment(options.enginePath));

  if (env.failures.length > 0) {
    envSpinner.stop("Environment check failed");
    showFailures(env.failures);
    process.exit(1);
  }

  envSpinner.stop("Environment check complete");
  await sectionPause();
  showEnvironment(env);
  await sectionPause();

  const worktreeSpinner = spinner();
  worktreeSpinner.start("Creating temporary git worktree");
  const worktree = await minimumVisible(() => createMigrationWorktree(env));
  worktreeSpinner.stop(`Git worktree created: ${worktree.branch}`);
  await sectionPause();
  showWorktreeSafety(worktree);
  await sectionPause();

  showDeterministicIntro();
  await sectionPause();
  await askToContinue("Run deterministic npm -> pnpm migration?", options.autoApprove);

  const tracePath = path.join(worktree.runRoot, "deterministic-phases.tsv");
  const checklist = createChecklistRenderer(tracePath);
  const checklistState: { commit: StageStatus; running: boolean; worktree: StageStatus } = {
    commit: "pending",
    running: true,
    worktree: "done",
  };
  checklist.render(checklistState);

  const result = await runDeterministicMigration(options.enginePath, worktree, tracePath, () => {
    checklist.render(checklistState);
  });
  checklistState.running = false;

  if (result.code !== 0) {
    checklist.render(checklistState);
    checklist.finish();
    showMigrationSummary(
      buildMigrationSummary(
        worktree,
        env.branch,
        {
          changedFileCount: countChangedFiles(worktree),
          committed: false,
          error: "Migration failed before commit",
          worktree,
        },
        result,
      ),
    );
    showDeterministicFailure();
  }

  checklistState.commit = "active";
  checklist.render(checklistState);
  const commitResult = commitMigration(worktree);
  checklistState.commit = commitResult.committed ? "done" : "failed";
  checklist.render(checklistState);
  checklist.finish();

  showMigrationSummary(buildMigrationSummary(worktree, env.branch, commitResult, result));
  await sectionPause();

  if (!commitResult.committed) {
    showUncommittedFinish();
  }

  showCleanupIntro();
  await sectionPause();

  if (options.autoApprove) {
    showCleanupSkipped("Agent cleanup is skipped in non-interactive auto-approve runs.");
    showDeterministicComplete(result);
    return;
  }

  const selectedAgentId = await chooseCleanupAgent(env.agents);
  if (selectedAgentId === "skip") {
    showCleanupSkipped("The migration branch is ready for manual review.");
    showDeterministicComplete(result);
    return;
  }

  const selectedAgent = env.agents.find((agent) => agent.id === selectedAgentId);
  if (!selectedAgent) {
    showCleanupSkipped("Selected cleanup agent is no longer available.");
    showDeterministicComplete(result);
    return;
  }

  const cleanupSpinner = spinner();
  cleanupSpinner.start(`Running cleanup with ${selectedAgent.label}`);
  const cleanup = await runCleanup(selectedAgent, worktree, result.logPath);
  cleanupSpinner.stop(
    cleanup.run.code === 0
      ? `Cleanup finished with ${selectedAgent.label}`
      : `Cleanup failed with ${selectedAgent.label}`,
  );
  showCleanupSummary(cleanup);
  await sectionPause();

  if (cleanup.run.code !== 0 || cleanup.commit.error) {
    process.exit(1);
  }

  showDeterministicComplete(result);
}
