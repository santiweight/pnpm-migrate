import path from "node:path";
import { spinner } from "@clack/prompts";
import type { StageStatus } from "../migration/phases.ts";
import { commitMigration, buildMigrationSummary, countChangedFiles } from "../core/summary.ts";
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
  showMigrationSummary,
  showWorktreeSafety,
  showUncommittedFinish,
} from "../ui/cards.ts";
import { askToContinue } from "../ui/prompts.ts";

export type InteractiveWorkflowOptions = {
  autoApprove: boolean;
  enginePath: string;
};

export async function runInteractiveWorkflow(options: InteractiveWorkflowOptions): Promise<void> {
  const env = detectEnvironment(options.enginePath);

  if (env.failures.length > 0) {
    showFailures(env.failures);
    process.exit(1);
  }

  showEnvironment(env);

  const worktreeSpinner = spinner();
  worktreeSpinner.start("Creating temporary git worktree");
  const worktree = createMigrationWorktree(env);
  worktreeSpinner.stop(`Git worktree created: ${worktree.branch}`);
  showWorktreeSafety(worktree);

  showDeterministicIntro();
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

  if (!commitResult.committed) {
    showUncommittedFinish();
  }

  showDeterministicComplete(result);
}
