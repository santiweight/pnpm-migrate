import { mkdirSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./repo.ts";
import { runOk } from "./process.ts";

export type FixtureName = "npm-basic" | "npm-workspace" | "npm-hoisted-import";

export function materializeFixture(name: FixtureName, parentDir: string): string {
  const fixtureRepo = process.env.PNPM_MIGRATE_FIXTURE_REPO || repoRoot;
  const project = path.join(parentDir, name);
  mkdirSync(project, { recursive: true });

  const tag = `test/${name}`;
  runOk("git", ["init", "-q"], { cwd: project });
  runOk("git", ["remote", "add", "origin", fixtureRepo], { cwd: project });
  runOk("git", ["fetch", "--depth", "1", "origin", `refs/tags/${tag}:refs/tags/${tag}`], { cwd: project });
  runOk("git", ["checkout", "--detach", tag], { cwd: project });

  return project;
}

