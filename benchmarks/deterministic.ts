import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDeterministicBenchmark } from "./runner.ts";
import { readBenchmarkTargets, selectBenchmarkTargets } from "./targets.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function usage(): void {
  console.log(`Usage:
  tsx benchmarks/deterministic.ts

Environment:
  TARGETS                         Space-separated target ids. Default: all targets.
  TARGETS_FILE                    TSV with columns: id, repo, commit, notes.
  PNPM_MIGRATE_BENCH_ROOT         Directory for temp clones, logs, and results. Default: mktemp.
  PNPM_MIGRATE_BENCH_KEEP_ROOT=1  Keep auto-created temp root after the run.
  PNPM_MIGRATE_BENCH_SKIP_INSTALL=1
                                  Pass --skip-install to benchmark lockfile-only deterministic rewrites.
  PNPM_MIGRATE_BENCH_TIMEOUT_SECONDS
                                  Per phase timeout. Default: 900.
`);
}

function selectedTargetIds(allTargetIds: string[]): string[] {
  return (process.env.TARGETS || allTargetIds.join(" ")).split(/\s+/).filter(Boolean);
}

if (process.argv.includes("-h") || process.argv.includes("--help")) {
  usage();
  process.exit(0);
}

const targetsFile = process.env.TARGETS_FILE || path.join(repoRoot, "benchmarks/targets.tsv");
const allTargets = readBenchmarkTargets(targetsFile);
const targets = selectBenchmarkTargets(allTargets, selectedTargetIds(allTargets.map((target) => target.id)));
const keepRoot = process.env.PNPM_MIGRATE_BENCH_KEEP_ROOT === "1";
const skipInstall = process.env.PNPM_MIGRATE_BENCH_SKIP_INSTALL === "1";
const timeoutSeconds = Number(process.env.PNPM_MIGRATE_BENCH_TIMEOUT_SECONDS || 900);
const explicitRoot = process.env.PNPM_MIGRATE_BENCH_ROOT;
const benchRoot = explicitRoot || mkdtempSync(path.join(os.tmpdir(), "pnpm-migrate-bench."));

let failed = false;
try {
  const summary = runDeterministicBenchmark({
    targets,
    repoRoot,
    benchRoot,
    skipInstall,
    timeoutSeconds,
    print: true,
  });
  failed = summary.failed;

  console.log(`\nResults: ${summary.resultsPath}`);
  process.stdout.write(readFileSync(summary.resultsPath, "utf8"));
  if (explicitRoot || keepRoot) {
    console.log(`\nBenchmark root: ${summary.benchRoot}`);
  }
} finally {
  if (!explicitRoot && !keepRoot) {
    rmSync(benchRoot, { recursive: true, force: true });
  }
}

process.exit(failed ? 1 : 0);
