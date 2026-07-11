import { mkdirSync } from "node:fs";
import path from "node:path";
import { countChangedFiles, materializeGitHubTarget, runMigrationAndValidate, type PhaseResult } from "../src/testing/migration-target-runner.ts";
import { appendBenchmarkResult, appendSkippedBenchmarkPhases, initializeBenchmarkResults, writeBenchmarkLog } from "./results.ts";
import type { BenchmarkTarget } from "./targets.ts";

export type BenchmarkRunOptions = {
  targets: BenchmarkTarget[];
  repoRoot: string;
  benchRoot: string;
  skipInstall: boolean;
  timeoutSeconds: number;
  print?: boolean;
};

export type BenchmarkRunSummary = {
  failed: boolean;
  benchRoot: string;
  logRoot: string;
  resultsPath: string;
};

function observePhase(options: {
  target: BenchmarkTarget;
  logRoot: string;
  resultsPath: string;
  print?: boolean;
}): (phase: PhaseResult) => void {
  return (phase) => {
    writeBenchmarkLog(options.logRoot, options.target, phase);
    appendBenchmarkResult(options.resultsPath, options.target, phase);
  };
}

function runTarget(options: BenchmarkRunOptions & { target: BenchmarkTarget; logRoot: string; resultsPath: string }): boolean {
  const reposRoot = path.join(options.benchRoot, "repos");
  const onPhase = observePhase({
    target: options.target,
    logRoot: options.logRoot,
    resultsPath: options.resultsPath,
    print: options.print,
  });

  let worktree = "";
  try {
    if (options.print) {
      console.log(`[bench:${options.target.id}] clone https://github.com/${options.target.repo}.git @ ${options.target.commit}`);
    }
    worktree = materializeGitHubTarget({
      id: options.target.id,
      repo: options.target.repo,
      commit: options.target.commit,
      parentDir: reposRoot,
      timeoutSeconds: options.timeoutSeconds,
      onPhase,
      print: options.print,
    });
  } catch {
    appendSkippedBenchmarkPhases(options.resultsPath, options.target, ["migrate", "validate"], worktree ? countChangedFiles(worktree) : 0);
    return true;
  }

  const result = runMigrationAndValidate({
    projectPath: worktree,
    repoRoot: options.repoRoot,
    runProjectVerification: options.target.verification !== "migration",
    verificationScripts: options.target.verification === "migration"
      ? undefined
      : options.target.verification.replace(/,/g, " "),
    skipInstall: options.skipInstall,
    timeoutSeconds: options.timeoutSeconds,
    onPhase,
    print: options.print,
  });
  return result.failed;
}

export function runDeterministicBenchmark(options: BenchmarkRunOptions): BenchmarkRunSummary {
  const logRoot = path.join(options.benchRoot, "logs");
  const resultsPath = path.join(options.benchRoot, "results.tsv");
  mkdirSync(logRoot, { recursive: true });
  initializeBenchmarkResults(resultsPath);

  let failed = false;
  for (const target of options.targets) {
    if (runTarget({ ...options, target, logRoot, resultsPath })) {
      failed = true;
    }
  }

  return { failed, benchRoot: options.benchRoot, logRoot, resultsPath };
}
