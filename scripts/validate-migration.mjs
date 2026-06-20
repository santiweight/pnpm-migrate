#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const errors = [];
const warnings = [];

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.pnpm-store') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else {
      files.push(full);
    }
  }
  return files;
}

function relative(file) {
  return path.relative(root, file);
}

if (!exists('package.json')) {
  errors.push('package.json is missing');
} else {
  const pkg = readJson('package.json');
  if (!/^pnpm@/.test(pkg.packageManager || '')) {
    errors.push('package.json packageManager must be set to pnpm@<version>');
  }

  const workspaces = Array.isArray(pkg.workspaces)
    ? pkg.workspaces
    : Array.isArray(pkg.workspaces?.packages)
      ? pkg.workspaces.packages
      : [];
  if (workspaces.length > 0 && !exists('pnpm-workspace.yaml')) {
    errors.push('package.json declares workspaces but pnpm-workspace.yaml is missing');
  }
}

if (!exists('pnpm-lock.yaml')) {
  errors.push('pnpm-lock.yaml is missing');
}

for (const lockfile of ['package-lock.json', 'npm-shrinkwrap.json']) {
  if (exists(lockfile)) {
    errors.push(`${lockfile} should be removed after pnpm import`);
  }
}

const hardNpmPattern = /\b(?:npm\s+(?:ci|install|run|test|exec)|npx)\b/;
const auditPattern = /\bnpm\s+audit\b/;
const badPnpmPattern = /\bpnpm\s+(?:exec\s+-(?:y|yes)|install\s+-g|(?:exec|dlx)\s+(?:-[^\s]+\s+)*npm@?[^\s]*)\b|\binstall\/\b/;
const removedLockfilePattern = /\b(?:package-lock\.json|npm-shrinkwrap\.json)\b/;
const unsupportedPnpmLockfileLintPattern = /\blockfile-lint\b.*--path\s+pnpm-lock\.yaml\b/;
const publishPattern = /\bnpm\s+(?:publish|version)\b/;
const releaseScriptNamePattern = /^(pre|post)?(?:pack|publish|version)$|^release(?::|$)/;

for (const file of walk(root).filter((entry) => path.basename(entry) === 'package.json')) {
  const rel = relative(file);
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    warnings.push(`${rel} is not valid JSON; skipped nested package script validation`);
    continue;
  }
  for (const [name, script] of Object.entries(pkg.scripts || {})) {
    if (typeof script === 'string' && hardNpmPattern.test(script) && releaseScriptNamePattern.test(name)) {
      warnings.push(`${rel} release script "${name}" contains npm/npx command requiring maintainer review: ${script}`);
    } else if (typeof script === 'string' && hardNpmPattern.test(script)) {
      errors.push(`${rel} script "${name}" still contains npm/npx command: ${script}`);
    }
    if (typeof script === 'string' && badPnpmPattern.test(script)) {
      errors.push(`${rel} script "${name}" contains suspicious pnpm rewrite: ${script}`);
    }
    if (typeof script === 'string' && removedLockfilePattern.test(script)) {
      errors.push(`${rel} script "${name}" still references removed npm lockfile: ${script}`);
    }
    if (typeof script === 'string' && unsupportedPnpmLockfileLintPattern.test(script)) {
      errors.push(`${rel} script "${name}" points lockfile-lint at pnpm-lock.yaml, but lockfile-lint does not support pnpm lockfiles: ${script}`);
    }
    if (typeof script === 'string' && auditPattern.test(script)) {
      warnings.push(`${rel} script "${name}" contains npm audit command requiring maintainer review: ${script}`);
    }
    if (typeof script === 'string' && publishPattern.test(script)) {
      warnings.push(`${rel} script "${name}" contains release npm command requiring maintainer review: ${script}`);
    }
  }
}

const commandFiles = walk(root).filter((file) => {
  const rel = relative(file);
  return rel.startsWith('.github/workflows/') || rel === 'Dockerfile';
});

for (const file of commandFiles) {
  const rel = relative(file);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.trim().startsWith('#')) {
      return;
    }

    if (hardNpmPattern.test(line)) {
      errors.push(`${rel}:${index + 1} still contains npm/npx command: ${line.trim()}`);
    } else if (badPnpmPattern.test(line)) {
      errors.push(`${rel}:${index + 1} contains suspicious pnpm rewrite: ${line.trim()}`);
    } else if (removedLockfilePattern.test(line)) {
      errors.push(`${rel}:${index + 1} still references removed npm lockfile: ${line.trim()}`);
    } else if (unsupportedPnpmLockfileLintPattern.test(line)) {
      errors.push(`${rel}:${index + 1} points lockfile-lint at pnpm-lock.yaml, but lockfile-lint does not support pnpm lockfiles: ${line.trim()}`);
    } else if (auditPattern.test(line)) {
      warnings.push(`${rel}:${index + 1} contains npm audit command requiring maintainer review: ${line.trim()}`);
    } else if (publishPattern.test(line)) {
      warnings.push(`${rel}:${index + 1} contains release npm command requiring maintainer review: ${line.trim()}`);
    }

    const setupNodeMatch = line.match(/^(\s*)-\s+uses:\s+actions\/setup-node@/);
    if (
      setupNodeMatch &&
      lines[index + 1]?.trim() === '- run: corepack enable' &&
      lines[index + 2]?.trim() === 'with:'
    ) {
      errors.push(`${rel}:${index + 2} inserts corepack inside the actions/setup-node step; move it after the setup-node with: block`);
    }
  });
}

const proseFiles = walk(root).filter((file) => relative(file).endsWith('.md'));

for (const file of proseFiles) {
  const rel = relative(file);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (hardNpmPattern.test(line) || publishPattern.test(line)) {
      warnings.push(`${rel}:${index + 1} contains npm wording requiring doc review: ${line.trim()}`);
    }
  });
}

if (warnings.length > 0) {
  console.log('Migration warnings:');
  warnings.slice(0, 120).forEach((warning) => console.log(`  - ${warning}`));
  if (warnings.length > 120) {
    console.log(`  - ... ${warnings.length - 120} additional warnings omitted`);
  }
}

if (errors.length > 0) {
  console.error('Migration validation failed:');
  errors.forEach((error) => console.error(`  - ${error}`));
  process.exit(1);
}

console.log('Migration validation passed');
