#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const resultsPaths = process.argv.slice(2);
if (resultsPaths.length === 0) {
  resultsPaths.push(path.join('.eval', 'methods', 'results.tsv'));
}

const missing = resultsPaths.filter((resultsPath) => !fs.existsSync(resultsPath));
if (missing.length > 0) {
  for (const resultsPath of missing) {
    console.error(`results file not found: ${resultsPath}`);
  }
  process.exit(1);
}

const rows = resultsPaths.flatMap((resultsPath) => fs.readFileSync(resultsPath, 'utf8')
  .trim()
  .split(/\r?\n/)
  .slice(1))
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

const byRun = new Map();

for (const row of rows) {
  const key = `${row.target}\t${row.method}`;
  if (!byRun.has(key)) {
    byRun.set(key, [[]]);
  }
  const attempts = byRun.get(key);
  if (row.phase === 'baseline-install' && attempts.at(-1).length > 0) {
    attempts.push([]);
  }
  attempts.at(-1).push(row);
}

function latest(rowsForRun, phase) {
  return rowsForRun.filter((row) => row.phase === phase).at(-1);
}

function sum(rowsForRun, phasePattern) {
  return rowsForRun
    .filter((row) => phasePattern.test(row.phase))
    .reduce((total, row) => total + row.durationSeconds, 0);
}

function maxChangedFiles(rowsForRun) {
  return rowsForRun.reduce((max, row) => Math.max(max, row.changedFiles), 0);
}

const summaries = [];

for (const [key, attempts] of byRun) {
  const rowsForRun = attempts.at(-1);
  const [target, method] = key.split('\t');
  const baselineInstall = latest(rowsForRun, 'baseline-install');
  const baselineTest = latest(rowsForRun, 'baseline-test');
  const validate = latest(rowsForRun, 'validate');
  const postTest = latest(rowsForRun, 'post-test');
  const migrationRows = rowsForRun.filter((row) => !row.phase.startsWith('baseline-'));
  const migrationSeconds = migrationRows.reduce((total, row) => total + row.durationSeconds, 0);
  const baselineComplete = Boolean(baselineInstall && baselineTest);
  const baselinePassed = baselineComplete && baselineInstall.status === 0 && baselineTest.status === 0;
  const migrationComplete = Boolean(validate && postTest);
  const pass = migrationComplete && validate.status === 0 && postTest.status === 0 && migrationRows.every((row) => row.status === 0 || method === 'claude');
  const result = !baselineComplete || (baselinePassed && !migrationComplete)
    ? 'running'
    : pass
      ? 'pass'
      : 'fail';

  summaries.push({
    target,
    method,
    baseline: baselineComplete
      ? `${baselinePassed ? 'pass' : 'fail'} (${baselineInstall.durationSeconds + baselineTest.durationSeconds}s)`
      : 'missing',
    result,
    migrationSeconds,
    changedFiles: maxChangedFiles(rowsForRun),
  });
}

const paired = new Map();
for (const summary of summaries) {
  if (!paired.has(summary.target)) {
    paired.set(summary.target, {});
  }
  paired.get(summary.target)[summary.method] = summary;
}

console.log('| Repo | Method | Baseline | Result | Migration time | Changed files | Time saved vs Claude |');
console.log('| --- | --- | --- | --- | ---: | ---: | ---: |');

for (const target of [...paired.keys()].sort()) {
  const methods = paired.get(target);
  for (const method of ['claude', 'tool']) {
    const summary = methods[method];
    if (!summary) continue;
    const saved = method === 'tool' && methods.claude && summary.result === 'pass' && methods.claude.result === 'pass'
      ? `${methods.claude.migrationSeconds - summary.migrationSeconds}s`
      : '';
    console.log(`| \`${summary.target}\` | ${summary.method} | ${summary.baseline} | ${summary.result} | ${summary.migrationSeconds}s | ${summary.changedFiles} | ${saved} |`);
  }
}
