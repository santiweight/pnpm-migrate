import { readFileSync } from "node:fs";

export type BenchmarkTarget = {
  id: string;
  repo: string;
  commit: string;
  notes: string;
};

export function readBenchmarkTargets(filePath: string): BenchmarkTarget[] {
  const input = readFileSync(filePath, "utf8").trim();
  if (!input) {
    return [];
  }

  return input.split(/\r?\n/).slice(1).filter(Boolean).map((line) => {
    const [id, repo, commit, notes = ""] = line.split("\t");
    if (!id || !repo || !commit) {
      throw new Error(`invalid benchmark target row: ${line}`);
    }
    return { id, repo, commit, notes };
  });
}

export function selectBenchmarkTargets(allTargets: BenchmarkTarget[], requestedIds: string[]): BenchmarkTarget[] {
  const requested = new Set(requestedIds);
  const selected = allTargets.filter((target) => requested.has(target.id));

  if (selected.length !== requested.size) {
    const known = new Set(allTargets.map((target) => target.id));
    const unknown = [...requested].filter((target) => !known.has(target));
    throw new Error(`unknown benchmark target(s): ${unknown.join(", ")}`);
  }

  return selected;
}
