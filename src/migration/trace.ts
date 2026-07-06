import { existsSync, readFileSync } from "node:fs";
import { deterministicStages, type DeterministicStage, type StageStatus } from "./phases.ts";

export type ChecklistState = {
  commit: StageStatus;
  running: boolean;
  worktree: StageStatus;
};

export function readTrace(tracePath: string): Map<string, number> {
  if (!tracePath || !existsSync(tracePath)) {
    return new Map();
  }

  return new Map(
    readFileSync(tracePath, "utf8")
      .trim()
      .split(/\r?\n/)
      .slice(1)
      .filter(Boolean)
      .map((line) => {
        const [phase, status] = line.split("\t");
        return [phase, Number(status)];
      }),
  );
}

export function resolveStageStatuses(tracePath: string, state: ChecklistState): DeterministicStage[] {
  const trace = readTrace(tracePath);
  const statuses = deterministicStages.map((stage) => {
    if (stage.id === "worktree") {
      return { ...stage, status: state.worktree };
    }

    if (stage.id === "commit") {
      return { ...stage, status: state.commit };
    }

    const phases = stage.phases ?? [];
    if (phases.some((phase) => (trace.get(phase) ?? -1) > 0)) {
      return { ...stage, status: "failed" as const };
    }

    if (phases.every((phase) => trace.get(phase) === 0)) {
      return { ...stage, status: "done" as const };
    }

    return { ...stage, status: "pending" as const };
  });

  const active = statuses.find((stage) => stage.status === "pending");
  if (active && state.running) {
    active.status = "active";
  }

  return statuses;
}
