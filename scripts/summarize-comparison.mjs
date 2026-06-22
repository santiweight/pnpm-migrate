#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
let assertGreen = false;
const resultsPaths = [];

for (const arg of args) {
  if (arg === '--assert-green') {
    assertGreen = true;
  } else {
    resultsPaths.push(arg);
  }
}

if (resultsPaths.length === 0) {
  resultsPaths.push(path.join('.eval', 'methods', 'results.tsv'));
}

for (const resultsPath of resultsPaths) {
  if (!fs.existsSync(resultsPath)) {
    console.error(`results file not found: ${resultsPath}`);
    process.exit(1);
  }
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

function methodRows(rowsForRun, method) {
  if (method === 'tool') {
    return rowsForRun.filter((row) => row.phase === 'migrate');
  }
  if (method === 'claude') {
    return rowsForRun.filter((row) => row.phase.startsWith('claude-pass-'));
  }
  return rowsForRun.filter((row) => !row.phase.startsWith('baseline-') && !['validate', 'post-test'].includes(row.phase));
}

function sum(rowsForRun) {
  return rowsForRun.reduce((total, row) => total + row.durationSeconds, 0);
}

function maxChangedFiles(rowsForRun) {
  return rowsForRun.reduce((max, row) => Math.max(max, row.changedFiles), 0);
}

function summarizeRun(target, method, rowsForRun) {
  const baselineInstall = latest(rowsForRun, 'baseline-install');
  const baselineTest = latest(rowsForRun, 'baseline-test');
  const validate = latest(rowsForRun, 'validate');
  const postTest = latest(rowsForRun, 'post-test');
  const migrationRows = methodRows(rowsForRun, method);
  const baselinePassed = baselineInstall?.status === 0 && baselineTest?.status === 0;
  const migrationPassed = migrationRows.length > 0 && migrationRows.every((row) => row.status === 0);
  const validatePassed = validate?.status === 0;
  const postTestPassed = postTest?.status === 0;

  return {
    target,
    method,
    baselineSeconds: (baselineInstall?.durationSeconds ?? 0) + (baselineTest?.durationSeconds ?? 0),
    migrationSeconds: sum(migrationRows),
    verificationSeconds: (validate?.durationSeconds ?? 0) + (postTest?.durationSeconds ?? 0),
    changedFiles: maxChangedFiles(rowsForRun),
    baselinePassed,
    migrationPassed,
    validatePassed,
    postTestPassed,
    passed: baselinePassed && migrationPassed && validatePassed && postTestPassed,
  };
}

const summaries = [];
for (const [key, attempts] of attemptsByRun) {
  const [target, method] = key.split('\t');
  summaries.push(summarizeRun(target, method, attempts.at(-1)));
}

const byTarget = new Map();
for (const summary of summaries) {
  if (!byTarget.has(summary.target)) {
    byTarget.set(summary.target, {});
  }
  byTarget.get(summary.target)[summary.method] = summary;
}

const pairedTargets = [...byTarget.entries()]
  .filter(([, methods]) => methods.claude && methods.tool)
  .sort(([a], [b]) => a.localeCompare(b));

const passingPairs = pairedTargets.filter(([, methods]) => methods.claude.passed && methods.tool.passed);
const claudeTotal = passingPairs.reduce((total, [, methods]) => total + methods.claude.migrationSeconds, 0);
const toolTotal = passingPairs.reduce((total, [, methods]) => total + methods.tool.migrationSeconds, 0);
const savedTotal = claudeTotal - toolTotal;
const ratio = toolTotal > 0 ? claudeTotal / toolTotal : 0;

console.log('# Claude vs pnpm-migrate Comparison');
console.log('');
console.log('| Metric | Value |');
console.log('| --- | ---: |');
console.log(`| Paired repos | ${pairedTargets.length} |`);
console.log(`| Passing paired repos | ${passingPairs.length} |`);
console.log(`| Claude migration time | ${claudeTotal}s |`);
console.log(`| pnpm-migrate migration time | ${toolTotal}s |`);
console.log(`| Time saved | ${savedTotal}s |`);
console.log(`| Speed ratio | ${ratio.toFixed(1)}x |`);
console.log('');
console.log('| Repo | Baseline | Claude | pnpm-migrate | Saved | Validation | Post-test | Files |');
console.log('| --- | --- | ---: | ---: | ---: | --- | --- | ---: |');

for (const [target, methods] of pairedTargets) {
  const claude = methods.claude;
  const tool = methods.tool;
  const baseline = claude.baselinePassed && tool.baselinePassed ? 'pass' : 'fail';
  const validation = claude.validatePassed && tool.validatePassed ? 'pass' : 'fail';
  const postTest = claude.postTestPassed && tool.postTestPassed ? 'pass' : 'fail';
  const saved = claude.passed && tool.passed ? `${claude.migrationSeconds - tool.migrationSeconds}s` : '';
  console.log(`| \`${target}\` | ${baseline} | ${claude.migrationSeconds}s | ${tool.migrationSeconds}s | ${saved} | ${validation} | ${postTest} | ${tool.changedFiles} |`);
}

const failures = [];
for (const [target, methods] of pairedTargets) {
  for (const method of ['claude', 'tool']) {
    if (!methods[method].passed) {
      failures.push(`${target}/${method}`);
    }
  }
}

const unpaired = [...byTarget.entries()]
  .filter(([, methods]) => !methods.claude || !methods.tool)
  .map(([target, methods]) => `${target} (${Object.keys(methods).join(', ')})`);

if (unpaired.length > 0) {
  console.log('');
  console.log(`Unpaired runs: ${unpaired.join(', ')}`);
}

if (assertGreen && (failures.length > 0 || unpaired.length > 0)) {
  if (failures.length > 0) {
    console.error(`comparison failed: ${failures.join(', ')}`);
  }
  if (unpaired.length > 0) {
    console.error(`comparison has unpaired runs: ${unpaired.join(', ')}`);
  }
  process.exit(1);
}
