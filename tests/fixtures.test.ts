import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { materializeFixture, type FixtureName } from "../src/testing/fixtures.ts";
import { runMigrationAndValidate } from "../src/testing/migration-target-runner.ts";
import { runCommandOk } from "../src/testing/process.ts";
import { formatValidationResult } from "../src/validation/migration.ts";
import { repoRoot } from "./helpers/repo.ts";
import { makeTempDir } from "./helpers/temp.ts";

function readJson(filePath: string): any {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function runFixture(name: FixtureName, tmpDir: string): string {
  const project = materializeFixture({
    name,
    parentDir: tmpDir,
    fixtureRepo: process.env.PNPM_MIGRATE_FIXTURE_REPO || repoRoot,
  });
  runCommandOk("npm", ["install", "--package-lock-only"], { cwd: project });

  const result = runMigrationAndValidate({ projectPath: project, repoRoot });
  assert.match(result.migration.output, /\[pnpm-migrate\] state directory: \/tmp\/pnpm-migrate\./);
  assert.equal(result.failed, false, `${result.migration.output}\n${formatValidationResult(result.validation)}`);

  assert.equal(existsSync(path.join(project, "pnpm-lock.yaml")), true);
  assert.equal(existsSync(path.join(project, "package-lock.json")), false);
  assert.match(readJson(path.join(project, "package.json")).packageManager ?? "", /^pnpm@/);

  const workflow = readFileSync(path.join(project, ".github/workflows/ci.yml"), "utf8");
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /pnpm test/);

  const lines = workflow.split(/\r?\n/);
  const setup = lines.findIndex((line) => line.includes("actions/setup-node@"));
  assert.ok(setup >= 1);
  assert.equal(lines[setup - 1]?.trim(), "- run: corepack enable");

  return project;
}

test("migrates basic npm fixture from tag", (t) => {
  const tmpDir = makeTempDir(t, "pnpm-migrate-fixtures.");
  const project = runFixture("npm-basic", tmpDir);

  const readme = readFileSync(path.join(project, "README.md"), "utf8");
  assert.match(readme, /pnpm install/);
  assert.match(readme, /pnpm start/);
  assert.match(readme, /pnpm build/);
  assert.match(readme, /pnpm test/);
  assert.match(readme, /pnpm dlx cowsay hello/);
  assert.match(readme, /npm install npm-basic --save/);
  assert.match(readme, /npm install --save-dev npm-basic/);
  assert.match(readme, /npm publish/);
  assert.match(readme, /Contributor checks: `pnpm test && pnpm build`/);

  const scripts = readJson(path.join(project, "package.json")).scripts;
  assert.equal(scripts.prepare, "pnpm run patch");
  assert.equal(scripts.patch, "node -e \"process.exit(0)\"");
});

test("migrates npm workspace fixture from tag", (t) => {
  const tmpDir = makeTempDir(t, "pnpm-migrate-fixtures.");
  const project = runFixture("npm-workspace", tmpDir);

  assert.equal(existsSync(path.join(project, "pnpm-workspace.yaml")), true);
  assert.match(readFileSync(path.join(project, "pnpm-workspace.yaml"), "utf8"), /packages\/\*/);

  const scripts = readJson(path.join(project, "package.json")).scripts;
  assert.equal(scripts.lint, "pnpm -r build");
  assert.equal(scripts.package, "pnpm --filter @fixture/a build");
});

test("repairs hoisted import fixture from tag", (t) => {
  const tmpDir = makeTempDir(t, "pnpm-migrate-fixtures.");
  const project = runFixture("npm-hoisted-import", tmpDir);

  const pkg = readJson(path.join(project, "package.json"));
  assert.ok(pkg.devDependencies?.["ansi-styles"]);
});
