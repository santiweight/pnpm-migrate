import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PhaseResult } from "../src/testing/migration-target-runner.ts";
import type { BenchmarkTarget } from "./targets.ts";

export function initializeBenchmarkResults(resultsPath: string): void {
  mkdirSync(path.dirname(resultsPath), { recursive: true });
  writeFileSync(resultsPath, "target\trepo\tcommit\tphase\tstatus\tduration_seconds\tchanged_files\n");
}

export function writeBenchmarkLog(logRoot: string, target: BenchmarkTarget, phase: PhaseResult): void {
  mkdirSync(logRoot, { recursive: true });
  writeFileSync(path.join(logRoot, `${target.id}-${phase.phase}.log`), phase.output);
}

export function appendBenchmarkResult(resultsPath: string, target: BenchmarkTarget, phase: PhaseResult): void {
  appendFileSync(
    resultsPath,
    [
      target.id,
      target.repo,
      target.commit,
      phase.phase,
      String(phase.status),
      String(phase.durationSeconds),
      String(phase.changedFiles),
    ].join("\t") + "\n",
  );
}

export function appendSkippedBenchmarkPhases(
  resultsPath: string,
  target: BenchmarkTarget,
  phases: string[],
  changedFiles = 0,
): void {
  for (const phase of phases) {
    appendBenchmarkResult(resultsPath, target, {
      phase,
      status: 125,
      durationSeconds: 0,
      output: "",
      changedFiles,
    });
  }
}
