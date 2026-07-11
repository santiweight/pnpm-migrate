import { mkdirSync } from "node:fs";
import path from "node:path";
import { runCommandOk } from "./process.ts";

export const fixtureRefs = {
  "npm-basic": "07993524141a0a6e18cb689e04063859f3ed8f10",
  "npm-workspace": "8157f74074405c88bcbe068e117b39154ed4b518",
  "npm-hoisted-import": "5a036c0ab07d69f5bacf1cfff5c631e9ec32773c",
} as const;

export type FixtureName = keyof typeof fixtureRefs;

export function materializeFixture(options: {
  name: FixtureName;
  parentDir: string;
  fixtureRepo: string;
}): string {
  const project = path.join(options.parentDir, options.name);
  mkdirSync(project, { recursive: true });

  const tag = `test/${options.name}`;
  const expectedCommit = fixtureRefs[options.name];
  runCommandOk("git", ["init", "-q"], { cwd: project });
  runCommandOk("git", ["remote", "add", "origin", options.fixtureRepo], { cwd: project });
  runCommandOk("git", ["fetch", "--depth", "1", "origin", `refs/tags/${tag}:refs/tags/${tag}`], { cwd: project });
  runCommandOk("git", ["checkout", "--detach", tag], { cwd: project });

  const actualCommit = runCommandOk("git", ["rev-parse", "HEAD"], { cwd: project }).stdout.trim();
  if (actualCommit !== expectedCommit) {
    throw new Error(`fixture ${tag} resolved to ${actualCommit}; expected ${expectedCommit}`);
  }

  return project;
}
