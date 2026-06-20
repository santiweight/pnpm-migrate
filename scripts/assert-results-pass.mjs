#!/usr/bin/env node
import fs from 'node:fs';

const args = process.argv.slice(2);
let expectCount = null;
const paths = [];

for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (arg === '--expect') {
    expectCount = Number(args[++index]);
  } else {
    paths.push(arg);
  }
}

if (paths.length === 0) {
  paths.push('.eval/methods/results.tsv');
}

const rows = paths.flatMap((resultsPath) => {
  if (!fs.existsSync(resultsPath)) {
    throw new Error(`results file not found: ${resultsPath}`);
  }

  return fs.readFileSync(resultsPath, 'utf8')
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const [target, method, phase, status, durationSeconds, changedFiles] = line.split('\t');
      return {
        target,
        method,
        phase,
        status: Number(status),
        durationSeconds: Number(durationSeconds),
        changedFiles: Number(changedFiles),
      };
    });
});

const attemptsByRun = new Map();

for (const row of rows) {
  const key = `${row.target}\t${row.method}`;
  if (!attemptsByRun.has(key)) {
    attemptsByRun.set(key, [[]]);
  }
  const attempts = attemptsByRun.get(key);
  if (row.phase === 'baseline-install' && attempts.at(-1).length > 0) {
    attempts.push([]);
  }
  attempts.at(-1).push(row);
}

function latest(rowsForRun, phase) {
  return rowsForRun.filter((row) => row.phase === phase).at(-1);
}

const failures = [];
let passCount = 0;

for (const [key, attempts] of attemptsByRun) {
  const [target, method] = key.split('\t');
  const rowsForRun = attempts.at(-1);
  const baselineInstall = latest(rowsForRun, 'baseline-install');
  const baselineTest = latest(rowsForRun, 'baseline-test');
  const validate = latest(rowsForRun, 'validate');
  const postTest = latest(rowsForRun, 'post-test');
  const migrationRows = rowsForRun.filter((row) => !row.phase.startsWith('baseline-'));

  const baselinePassed = baselineInstall?.status === 0 && baselineTest?.status === 0;
  const migrationPassed = validate?.status === 0 && postTest?.status === 0 && migrationRows.every((row) => {
    return row.status === 0 || method === 'claude';
  });

  if (baselinePassed && migrationPassed) {
    passCount++;
  } else {
    failures.push(`${target}/${method}`);
  }
}

if (expectCount !== null && passCount !== expectCount) {
  failures.push(`expected ${expectCount} passes, got ${passCount}`);
}

if (failures.length > 0) {
  console.error(`eval assertion failed: ${failures.join(', ')}`);
  process.exit(1);
}

console.log(`eval assertion passed: ${passCount} latest runs passed`);
