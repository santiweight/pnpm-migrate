import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { runInteractiveWorkflow } from "./workflows/interactive.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const enginePath = path.join(root, "pnpm-migrate.sh");

new Command()
  .name("pnpm-migrate")
  .description("Migrate an npm project to pnpm from a temporary git worktree.")
  .allowExcessArguments(false)
  .allowUnknownOption(false)
  .parse(process.argv);

await runInteractiveWorkflow({
  autoApprove: process.env.PNPM_MIGRATE_AUTO_APPROVE === "1",
  enginePath,
});
