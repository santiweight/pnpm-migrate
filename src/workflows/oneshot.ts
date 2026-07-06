import type { InteractiveWorkflowOptions } from "./interactive.ts";
import { runInteractiveWorkflow } from "./interactive.ts";

export type OneShotWorkflowOptions = Omit<InteractiveWorkflowOptions, "autoApprove">;

export function runOneShotWorkflow(options: OneShotWorkflowOptions): Promise<void> {
  return runInteractiveWorkflow({ ...options, autoApprove: true });
}
