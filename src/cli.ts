import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { runInteractiveWorkflow } from "./workflows/interactive.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const enginePath = path.join(root, "pnpm-migrate.sh");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
  version?: string;
};

new Command()
  .name("pnpm-migrate")
  .description("Migrate an npm project to pnpm from a temporary git worktree.")
  .version(packageJson.version ?? "0.0.0")
  .allowExcessArguments(false)
  .allowUnknownOption(false)
  .parse(process.argv);

await runInteractiveWorkflow({
  autoApprove: process.env.PNPM_MIGRATE_AUTO_APPROVE === "1",
  enginePath,
});
