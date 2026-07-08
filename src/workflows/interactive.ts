import path from "node:path";
import { randomUUID } from "node:crypto";
import { spinner } from "@clack/prompts";
import type { StageStatus } from "../migration/phases.ts";
import {
  commitMigration,
  buildMigrationSummary,
  countChangedFiles,
  type CommitResult,
} from "../core/summary.ts";
import { runCleanup } from "../core/cleanup.ts";
import {
  createPullRequest,
  hasGitHubCli,
  listRemotes,
  pushBranch,
  type PublishResult,
} from "../core/publish.ts";
import { ensurePullRequestGreen, type PullRequestGreenResult } from "../core/pr-green.ts";
import { createMigrationWorktree } from "../core/worktree.ts";
import { detectEnvironment } from "../core/preflight.ts";
import { runDeterministicMigration } from "../core/deterministic.ts";
import { createChecklistRenderer } from "../ui/checklist.ts";
import { createEnvironmentProgressRenderer } from "../ui/environment.ts";
import {
  showDeterministicComplete,
  showDeterministicFailure,
  showDeterministicIntro,
  showFailures,
  showCleanupIntro,
  showCleanupWaiting,
  showCleanupSkipped,
  showCleanupSummary,
  showFinalInstructions,
  showIntro,
  showMigrationSummary,
  showPublishFailure,
  showPublishSkipped,
  showPrFixWaiting,
  redTitle,
  showWorktreeSafety,
  showUncommittedFinish,
} from "../ui/cards.ts";
import { askToContinue, chooseRemote } from "../ui/prompts.ts";
import { clearTerminalView, minimumVisible, sectionPause, uiDelay, uiSpacer } from "../ui/timing.ts";
import type { PreflightEnvironment } from "../core/preflight.ts";
import { createTelemetry } from "../telemetry.ts";

export type InteractiveWorkflowOptions = {
  autoApprove: boolean;
  enginePath: string;
};

async function showEnvironmentProgress(
  env: PreflightEnvironment,
): Promise<void> {
  const renderer = createEnvironmentProgressRenderer(env);

  for (let index = 0; index < 3; index++) {
    renderer.render(index);
    await uiDelay(1500);
  }

  renderer.render(3);
  await uiDelay(500);
  renderer.finish();
}

async function runPublishPhase(
  worktree: ReturnType<typeof createMigrationWorktree>,
  baseBranch: string,
  autoApprove: boolean,
): Promise<PublishResult | null> {
  if (autoApprove) {
    showPublishSkipped("Branch publishing is skipped in non-interactive auto-approve runs.");
    return null;
  }

  const remoteName = await chooseRemote(listRemotes(worktree));
  if (!remoteName) {
    showPublishSkipped("No git remotes are configured for this repository.");
    return null;
  }

  const publishSpinner = spinner();
  publishSpinner.start(`Pushing branch to ${remoteName}`);
  const pushed = pushBranch(worktree, remoteName);
  publishSpinner.stop(pushed.pushed ? `Pushed branch to ${remoteName}` : `Push failed for ${remoteName}`);

  if (!pushed.pushed) {
    showPublishFailure(pushed.error ?? "git push failed");
    return pushed;
  }

  if (!hasGitHubCli()) {
    showPublishSkipped("GitHub CLI was not found, so no pull request was created.");
    return pushed;
  }

  const prSpinner = spinner();
  prSpinner.start("Creating pull request");
  const pr = createPullRequest(worktree, baseBranch, remoteName);
  prSpinner.stop(pr.prUrl ? "Pull request created" : "Pull request was not created");

  if (pr.error) {
    showPublishFailure(pr.error);
    return pr;
  }

  return pr;
}

export async function runInteractiveWorkflow(
  options: InteractiveWorkflowOptions,
): Promise<void> {
  const runStartedAt = Date.now();
  const telemetry = createTelemetry(randomUUID());
  await telemetry.capture("run_started", {
    auto_approve: options.autoApprove,
    telemetry_enabled: telemetry.enabled,
  });

  clearTerminalView();
  showIntro();

  const env = await minimumVisible(
    () => detectEnvironment(options.enginePath),
    1000,
  );

  if (env.failures.length > 0) {
    await telemetry.capture("environment_check_failed", {
      agent_count: env.agents.length,
      failure_count: env.failures.length,
      has_git_repo: Boolean(env.gitRoot),
      has_lockfile: env.lockfiles.length > 0,
    });
    await telemetry.capture("run_failed", {
      duration_ms: Date.now() - runStartedAt,
      failure_stage: "environment_check",
    });
    showFailures(env.failures);
    process.exit(1);
  }

  await telemetry.capture("environment_check_passed", {
    agent_count: env.agents.length,
    has_claude: env.agents.some((agent) => agent.id === "claude"),
    has_codex: env.agents.some((agent) => agent.id === "codex"),
  });

  await showEnvironmentProgress(env);
  await sectionPause();

  const worktreeSpinner = spinner();
  worktreeSpinner.start("Creating temporary git worktree");
  const worktree = await minimumVisible(() => createMigrationWorktree(env));
  worktreeSpinner.stop(redTitle(`Git worktree created: ${worktree.branch}`));
  await telemetry.capture("worktree_created");
  await sectionPause();
  showWorktreeSafety(worktree);
  await sectionPause(3000);

  showDeterministicIntro();
  await sectionPause(1200);
  await askToContinue(
    "Run pnpm migration?",
    options.autoApprove,
  );
  uiSpacer();
  await sectionPause(250);

  const tracePath = path.join(worktree.runRoot, "deterministic-phases.tsv");
  const checklist = createChecklistRenderer(tracePath);
  const checklistState: {
    commit: StageStatus;
    running: boolean;
    worktree: StageStatus;
  } = {
    commit: "pending",
    running: true,
    worktree: "done",
  };
  checklist.render(checklistState);

  const result = await runDeterministicMigration(
    options.enginePath,
    worktree,
    tracePath,
    () => {
      checklist.render(checklistState);
    },
  );
  checklistState.running = false;

  if (result.code !== 0) {
    await telemetry.capture("deterministic_migration_failed", {
      duration_ms: result.durationMs,
      exit_code: result.code,
    });
    await telemetry.capture("run_failed", {
      duration_ms: Date.now() - runStartedAt,
      failure_stage: "deterministic_migration",
    });
    checklist.render(checklistState);
    checklist.finish();
    showMigrationSummary(
      buildMigrationSummary(
        worktree,
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

  await telemetry.capture("deterministic_migration_passed", {
    committed: commitResult.committed,
    duration_ms: result.durationMs,
  });

  if (!commitResult.committed) {
    showUncommittedFinish();
  }

  showCleanupIntro();
  await sectionPause();

  if (options.autoApprove) {
    await telemetry.capture("agent_cleanup_skipped", {
      reason: "auto_approve",
    });
    await telemetry.capture("pr_skipped", {
      reason: "auto_approve",
    });
    await telemetry.capture("ci_skipped", {
      reason: "auto_approve",
    });
    await telemetry.capture("run_completed", {
      duration_ms: Date.now() - runStartedAt,
    });
    showCleanupSkipped(
      "Agent cleanup is skipped in non-interactive auto-approve runs.",
    );
    showMigrationSummary(buildMigrationSummary(worktree, commitResult, result));
    showFinalInstructions(worktree, null);
    return;
  }

  const selectedAgent = env.agents[0];
  if (!selectedAgent) {
    await telemetry.capture("agent_cleanup_skipped", {
      reason: "no_agent",
    });
    showCleanupSkipped("No cleanup agent is available.");
    const publish = await runPublishPhase(worktree, env.branch, options.autoApprove);
    if (publish?.pushed) {
      await telemetry.capture("branch_pushed");
    }
    if (publish?.prUrl) {
      await telemetry.capture("pr_created");
    } else {
      await telemetry.capture("pr_skipped", {
        reason: publish?.error ? "error" : "not_created",
      });
      await telemetry.capture("ci_skipped", {
        reason: "no_pr",
      });
    }
    await telemetry.capture("run_completed", {
      duration_ms: Date.now() - runStartedAt,
    });
    showMigrationSummary(buildMigrationSummary(worktree, commitResult, result));
    showFinalInstructions(worktree, publish);
    return;
  }

  const agentSessionId = selectedAgent.id === "claude" ? randomUUID() : undefined;
  const cleanupSpinner = spinner();
  uiSpacer();
  showCleanupWaiting();
  await sectionPause(1000);
  await telemetry.capture("agent_cleanup_started", {
    agent: selectedAgent.id,
  });
  cleanupSpinner.start(`Running cleanup with ${selectedAgent.label}`);
  const cleanup = await runCleanup(
    selectedAgent,
    worktree,
    result.logPath,
    (message) => {
      cleanupSpinner.message(`${selectedAgent.label}: ${message}`);
    },
    { sessionId: agentSessionId },
  );
  cleanupSpinner.stop(
    cleanup.run.code === 0
      ? `Cleanup finished with ${selectedAgent.label}`
      : `Cleanup failed with ${selectedAgent.label}`,
  );
  uiSpacer();
  showCleanupSummary(cleanup);
  await sectionPause();

  if (cleanup.run.code !== 0 || cleanup.commit.error) {
    await telemetry.capture("agent_cleanup_failed", {
      agent: selectedAgent.id,
      duration_ms: cleanup.run.durationMs,
      exit_code: cleanup.run.code,
    });
    await telemetry.capture("run_failed", {
      duration_ms: Date.now() - runStartedAt,
      failure_stage: "agent_cleanup",
    });
    process.exit(1);
  }

  await telemetry.capture("agent_cleanup_passed", {
    agent: selectedAgent.id,
    duration_ms: cleanup.run.durationMs,
  });

  const finalCommitResult: CommitResult = {
    ...commitResult,
    changedFileCount: commitResult.changedFileCount + cleanup.commit.changedFileCount,
  };
  const publish = await runPublishPhase(worktree, env.branch, options.autoApprove);
  let prGreen: PullRequestGreenResult | null = null;

  if (publish?.pushed) {
    await telemetry.capture("branch_pushed");
  }

  if (publish?.prUrl) {
    await telemetry.capture("pr_created");
  } else {
    await telemetry.capture("pr_skipped", {
      reason: publish?.error ? "error" : "not_created",
    });
  }

  if (publish?.prUrl) {
    const prGreenSpinner = spinner();
    uiSpacer();
    prGreenSpinner.start("Waiting for pull request checks");
    prGreen = await ensurePullRequestGreen(selectedAgent, worktree, publish, {
      maxFixAttempts: 2,
      onFixAttempt: () => {
        prGreenSpinner.stop("Pull request checks failed");
        uiSpacer();
        showPrFixWaiting();
        uiSpacer();
        prGreenSpinner.start(`Running CI fix with ${selectedAgent.label}`);
      },
      onStatus: (message) => {
        prGreenSpinner.message(`${selectedAgent.label}: ${message}`);
      },
      sessionId: agentSessionId,
    });
    prGreenSpinner.stop(
      prGreen.passed
        ? "Pull request checks passed"
        : "Pull request checks did not pass",
    );
    await telemetry.capture(prGreen.passed ? "ci_passed" : "ci_failed", {
      attempts: prGreen.attempts,
    });
    uiSpacer();
  } else {
    await telemetry.capture("ci_skipped", {
      reason: "no_pr",
    });
  }

  await telemetry.capture("run_completed", {
    ci_passed: prGreen?.passed ?? null,
    created_pr: Boolean(publish?.prUrl),
    duration_ms: Date.now() - runStartedAt,
  });

  showMigrationSummary(buildMigrationSummary(worktree, finalCommitResult, result));
  showFinalInstructions(worktree, publish, prGreen);
}
