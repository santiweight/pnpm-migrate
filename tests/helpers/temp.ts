import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";

export function makeTempDir(t: TestContext, prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));

  if (process.env.PNPM_MIGRATE_KEEP_TEST_TMP === "1") {
    console.log(`Keeping test temp dir: ${dir}`);
    return dir;
  }

  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  return dir;
}
