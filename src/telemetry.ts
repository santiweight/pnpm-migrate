import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type TelemetryEvent =
  | "run_started"
  | "environment_check_passed"
  | "environment_check_failed"
  | "worktree_created"
  | "deterministic_migration_passed"
  | "deterministic_migration_failed"
  | "agent_cleanup_started"
  | "agent_cleanup_passed"
  | "agent_cleanup_failed"
  | "agent_cleanup_skipped"
  | "branch_pushed"
  | "pr_created"
  | "pr_skipped"
  | "ci_passed"
  | "ci_failed"
  | "ci_skipped"
  | "run_completed"
  | "run_failed";

export type TelemetryProperties = Record<
  string,
  boolean | number | string | null | undefined
>;

export type Telemetry = {
  capture: (event: TelemetryEvent, properties?: TelemetryProperties) => Promise<void>;
  enabled: boolean;
  runId: string;
};

function packageVersion(): string {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const root = path.resolve(path.dirname(currentFile), "..");
    const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      version?: unknown;
    };

    return typeof packageJson.version === "string" ? packageJson.version : "unknown";
  } catch {
    return "unknown";
  }
}

function stableProperties(): TelemetryProperties {
  return {
    node_major: Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10),
    tool_version: packageVersion(),
  };
}

function sanitize(properties: TelemetryProperties): TelemetryProperties {
  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => {
      return (
        typeof value === "boolean"
        || typeof value === "number"
        || typeof value === "string"
        || value === null
      );
    }),
  );
}

export function createTelemetry(runId: string): Telemetry {
  const token = process.env.PNPM_MIGRATE_POSTHOG_KEY;
  const host = process.env.PNPM_MIGRATE_POSTHOG_HOST || "https://us.i.posthog.com";
  const enabled = process.env.PNPM_MIGRATE_TELEMETRY !== "0" && Boolean(token);
  const common = stableProperties();

  return {
    enabled,
    runId,
    async capture(event, properties = {}) {
      if (!enabled || !token) {
        return;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1200);

      try {
        await fetch(`${host.replace(/\/$/, "")}/capture/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            api_key: token,
            distinct_id: runId,
            event,
            properties: sanitize({
              ...common,
              ...properties,
              telemetry_version: 1,
            }),
          }),
          signal: controller.signal,
        });
      } catch {
        // Telemetry must never affect migration behavior.
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
