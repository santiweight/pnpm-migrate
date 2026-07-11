import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { materializeFixture, type FixtureName } from "./helpers/fixture.ts";
import { repoRoot } from "./helpers/repo.ts";
import { runOk } from "./helpers/process.ts";

function readJson(filePath: string): any {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function runFixture(name: FixtureName, tmpDir: string): string {
  const project = materializeFixture(name, tmpDir);
  runOk("npm", ["install", "--package-lock-only"], { cwd: project });

  const migrate = runOk("bash", [path.join(repoRoot, "pnpm-migrate.sh"), "--yes", "--skip-agent"], { cwd: project });
  assert.match(migrate.output, /\[pnpm-migrate\] state directory: \/tmp\/pnpm-migrate\./);

  assert.equal(existsSync(path.join(project, "pnpm-lock.yaml")), true);
  assert.equal(existsSync(path.join(project, "package-lock.json")), false);
  assert.match(readJson(path.join(project, "package.json")).packageManager ?? "", /^pnpm@/);

  runOk("node", [path.join(repoRoot, "scripts/validate-migration.mjs"), project], { cwd: project });

  const workflow = readFileSync(path.join(project, ".github/workflows/ci.yml"), "utf8");
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /pnpm test/);

  const lines = workflow.split(/\r?\n/);
  const setup = lines.findIndex((line) => line.includes("actions/setup-node@"));
  assert.ok(setup >= 1);
  assert.equal(lines[setup - 1]?.trim(), "- run: corepack enable");

  return project;
}

test("migrates basic npm fixture from tag", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "pnpm-migrate-fixtures."));
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

test("migrates npm workspace fixture from tag", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "pnpm-migrate-fixtures."));
  const project = runFixture("npm-workspace", tmpDir);

  assert.equal(existsSync(path.join(project, "pnpm-workspace.yaml")), true);
  assert.match(readFileSync(path.join(project, "pnpm-workspace.yaml"), "utf8"), /packages\/\*/);

  const scripts = readJson(path.join(project, "package.json")).scripts;
  assert.equal(scripts.lint, "pnpm -r build");
  assert.equal(scripts.package, "pnpm --filter @fixture/a build");
});

test("repairs hoisted import fixture from tag", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "pnpm-migrate-fixtures."));
  const project = runFixture("npm-hoisted-import", tmpDir);

  const pkg = readJson(path.join(project, "package.json"));
  assert.ok(pkg.devDependencies?.["ansi-styles"]);
});

