import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

type Target = {
  id: string;
  repo: string;
  commit: string;
  verification: "migration" | "scripts";
  notes: string;
};

type RunResult = {
  status: number;
  output: string;
  durationSeconds: number;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function usage(): void {
  console.log(`Usage:
  tsx benchmarks/deterministic.ts

Environment:
  TARGETS                         Space-separated target ids. Default: all targets.
  TARGETS_FILE                    TSV with columns: id, repo, commit, verification, notes.
  PNPM_MIGRATE_BENCH_ROOT         Directory for temp clones, logs, and results. Default: mktemp.
  PNPM_MIGRATE_BENCH_KEEP_ROOT=1  Keep auto-created temp root after the run.
  PNPM_MIGRATE_BENCH_SKIP_INSTALL=1
                                  Pass --skip-install to benchmark lockfile-only deterministic rewrites.
  PNPM_MIGRATE_BENCH_TIMEOUT_SECONDS
                                  Per phase timeout. Default: 900.
`);
}

function readTargets(filePath: string): Target[] {
  const lines = readFileSync(filePath, "utf8").trim().split(/\r?\n/);
  return lines.slice(1).filter(Boolean).map((line) => {
    const [id, repo, commit, verification, notes = ""] = line.split("\t");
    if (!id || !repo || !commit) {
      throw new Error(`invalid benchmark target row: ${line}`);
    }
    if (verification !== "migration" && verification !== "scripts") {
      throw new Error(`invalid benchmark verification mode for ${id}: ${verification}`);
    }
    return { id, repo, commit, verification, notes };
  });
}

function run(command: string, args: string[], cwd: string, timeoutSeconds: number): RunResult {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      CI: "1",
      COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    },
    timeout: timeoutSeconds > 0 ? timeoutSeconds * 1000 : undefined,
  });
  const durationSeconds = Math.round((Date.now() - started) / 1000);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const status = result.status ?? (result.signal ? 124 : 1);
  return { status, output, durationSeconds };
}

function changedFiles(worktree: string): string {
  const result = spawnSync("git", ["-C", worktree, "status", "--short"], { encoding: "utf8" });
  if (result.status !== 0) {
    return "0";
  }
  return String((result.stdout ?? "").split(/\r?\n/).filter(Boolean).length);
}

function record(
  resultsPath: string,
  target: Target,
  phase: string,
  status: number,
  durationSeconds: number,
  worktree: string,
): void {
  appendFileSync(
    resultsPath,
    [
      target.id,
      target.repo,
      target.commit,
      phase,
      String(status),
      String(durationSeconds),
      changedFiles(worktree),
    ].join("\t") + "\n",
  );
}

function runPhase(
  logRoot: string,
  resultsPath: string,
  target: Target,
  phase: string,
  worktree: string,
  command: string,
  args: string[],
  timeoutSeconds: number,
): number {
  console.log(`[bench:${target.id}] ${phase}`);
  console.log(`$ ${[command, ...args].map((part) => JSON.stringify(part)).join(" ")}`);
  const result = run(command, args, worktree, timeoutSeconds);
  process.stdout.write(result.output);
  writeFileSync(path.join(logRoot, `${target.id}-${phase}.log`), result.output);
  record(resultsPath, target, phase, result.status, result.durationSeconds, worktree);
  return result.status;
}

function runTarget(
  benchRoot: string,
  logRoot: string,
  resultsPath: string,
  target: Target,
  skipInstall: boolean,
  timeoutSeconds: number,
): number {
  const worktree = path.join(benchRoot, "repos", target.id);
  rmSync(worktree, { recursive: true, force: true });
  mkdirSync(path.dirname(worktree), { recursive: true });

  console.log(`[bench:${target.id}] clone https://github.com/${target.repo}.git @ ${target.commit}`);
  const cloneStatus = runPhase(
    logRoot,
    resultsPath,
    target,
    "clone",
    benchRoot,
    "git",
    ["clone", `https://github.com/${target.repo}.git`, worktree],
    timeoutSeconds,
  );
  if (cloneStatus !== 0) {
    record(resultsPath, target, "migrate", 125, 0, worktree);
    record(resultsPath, target, "validate", 125, 0, worktree);
    return 1;
  }

  const checkoutStatus = runPhase(
    logRoot,
    resultsPath,
    target,
    "checkout",
    worktree,
    "git",
    ["checkout", "--detach", target.commit],
    timeoutSeconds,
  );
  if (checkoutStatus !== 0) {
    record(resultsPath, target, "migrate", 125, 0, worktree);
    record(resultsPath, target, "validate", 125, 0, worktree);
    return 1;
  }

  const migrateArgs = [path.join(repoRoot, "pnpm-migrate.sh"), "--yes", "--skip-agent"];
  if (target.verification === "migration") {
    migrateArgs.push("--no-tests");
  }
  if (skipInstall) {
    migrateArgs.push("--skip-install");
  }

  let failed = 0;
  if (runPhase(logRoot, resultsPath, target, "migrate", worktree, "bash", migrateArgs, timeoutSeconds) !== 0) {
    failed = 1;
  }
  if (
    runPhase(
      logRoot,
      resultsPath,
      target,
      "validate",
      worktree,
      "node",
      [path.join(repoRoot, "scripts/validate-migration.mjs"), worktree],
      timeoutSeconds,
    ) !== 0
  ) {
    failed = 1;
  }
  return failed;
}

if (process.argv.includes("-h") || process.argv.includes("--help")) {
  usage();
  process.exit(0);
}

const targetsFile = process.env.TARGETS_FILE || path.join(repoRoot, "benchmarks/targets.tsv");
const allTargets = readTargets(targetsFile);
const requested = new Set((process.env.TARGETS || allTargets.map((target) => target.id).join(" ")).split(/\s+/).filter(Boolean));
const targets = allTargets.filter((target) => requested.has(target.id));
if (targets.length !== requested.size) {
  const known = new Set(allTargets.map((target) => target.id));
  const unknown = [...requested].filter((target) => !known.has(target));
  throw new Error(`unknown benchmark target(s): ${unknown.join(", ")}`);
}

const keepRoot = process.env.PNPM_MIGRATE_BENCH_KEEP_ROOT === "1";
const skipInstall = process.env.PNPM_MIGRATE_BENCH_SKIP_INSTALL === "1";
const timeoutSeconds = Number(process.env.PNPM_MIGRATE_BENCH_TIMEOUT_SECONDS || 900);
const explicitRoot = process.env.PNPM_MIGRATE_BENCH_ROOT;
const benchRoot = explicitRoot || mkdtempSync(path.join(os.tmpdir(), "pnpm-migrate-bench."));
const logRoot = path.join(benchRoot, "logs");
const resultsPath = path.join(benchRoot, "results.tsv");
mkdirSync(logRoot, { recursive: true });
writeFileSync(resultsPath, "target\trepo\tcommit\tphase\tstatus\tduration_seconds\tchanged_files\n");

let failed = 0;
try {
  for (const target of targets) {
    if (runTarget(benchRoot, logRoot, resultsPath, target, skipInstall, timeoutSeconds) !== 0) {
      failed = 1;
    }
  }

  console.log(`\nResults: ${resultsPath}`);
  process.stdout.write(readFileSync(resultsPath, "utf8"));
  if (explicitRoot || keepRoot) {
    console.log(`\nBenchmark root: ${benchRoot}`);
  }
} finally {
  if (!explicitRoot && !keepRoot) {
    rmSync(benchRoot, { recursive: true, force: true });
  }
}

process.exit(failed);
