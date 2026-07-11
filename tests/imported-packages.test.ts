import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  importedPackages,
  isImportTestOrProd,
  requiredDependencies,
} from "../src/migration/imported-packages.mjs";

test("collects literal external imports with their source files", () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "pnpm-migrate-imports."));
  writeFileSync(path.join(project, "index.js"), [
    'const ansiStyles = require("ansi-styles");',
    'export { red } from "colors/safe";',
    'void import("@scope/package/subpath");',
    'require("./local.js");',
    'require("node:path");',
    "",
  ].join("\n"));

  assert.deepEqual(importedPackages(project), [
    { file: "index.js", importedPackage: "ansi-styles" },
    { file: "index.js", importedPackage: "colors" },
    { file: "index.js", importedPackage: "@scope/package" },
  ]);
});

test("classifies obvious development files and defaults to production", () => {
  assert.equal(isImportTestOrProd({ file: "src/index.ts", importedPackage: "example" }), "prod");
  assert.equal(isImportTestOrProd({ file: "src/index.spec.ts", importedPackage: "example" }), "dev");
  assert.equal(isImportTestOrProd({ file: "tests/index.ts", importedPackage: "example" }), "dev");
});

test("aggregates production, development, and DefinitelyTyped dependencies", () => {
  const lock = {
    packages: {
      "node_modules/ansi-styles": { version: "4.3.0" },
      "node_modules/supports-color": { version: "7.2.0" },
      "node_modules/@types/geojson": { version: "7946.0.16" },
    },
  };
  const required = requiredDependencies([
    { file: "src/index.ts", importedPackage: "ansi-styles" },
    { file: "src/index.test.ts", importedPackage: "ansi-styles" },
    { file: "src/index.test.ts", importedPackage: "supports-color" },
    { file: "src/map.ts", importedPackage: "geojson" },
  ], lock);

  assert.deepEqual([...required.deps], ["ansi-styles"]);
  assert.deepEqual([...required.devDeps], ["supports-color", "@types/geojson"]);
  assert.deepEqual([...required.unresolved], []);
});
