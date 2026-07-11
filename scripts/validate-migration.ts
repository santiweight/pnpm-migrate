#!/usr/bin/env tsx
import path from "node:path";
import { formatValidationResult, validateMigration } from "../src/validation/migration.ts";

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const result = validateMigration(root);
const output = formatValidationResult(result);

if (result.errors.length > 0) {
  console.error(output.trimEnd());
  process.exit(1);
}

process.stdout.write(output);
