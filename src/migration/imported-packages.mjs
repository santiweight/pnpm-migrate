#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

const SKIP_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".pnpm-store",
  ".svelte-kit",
  "build",
  "coverage",
  "dist",
  "dist-module",
  "node_modules",
  "out",
  "tmp",
]);

const DEV_DIRECTORY_NAMES = new Set([
  ".storybook",
  "__fixtures__",
  "__mocks__",
  "__tests__",
  "e2e",
  "fixture",
  "fixtures",
  "mock",
  "mocks",
  "spec",
  "specs",
  "stories",
  "storybook",
  "test",
  "tests",
]);

const BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

/**
 * @typedef {{ file: string, importedPackage: string }} ImportedPackageInstance
 * @typedef {"dev" | "prod"} ImportEnvironment
 * @typedef {{ deps: Set<string>, devDeps: Set<string>, unresolved: Set<string> }} RequiredDependencies
 */

function sourceKind(file) {
  switch (path.extname(file).toLowerCase()) {
    case ".js":
    case ".cjs":
    case ".mjs":
      return ts.ScriptKind.JS;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".tsx":
      return ts.ScriptKind.TSX;
    default:
      return ts.ScriptKind.TS;
  }
}

function packageNameFromSpecifier(specifier) {
  if (
    !specifier ||
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("#") ||
    specifier.includes(":") ||
    BUILTINS.has(specifier)
  ) {
    return null;
  }

  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }

  return specifier.split("/")[0] || null;
}

function stringArgument(node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function importedSpecifiers(sourceFile) {
  const specifiers = [];

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression
    ) {
      const value = stringArgument(node.moduleReference.expression);
      if (value) specifiers.push(value);
    } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamicImport || isRequire) {
        const value = stringArgument(node.arguments[0]);
        if (value) specifiers.push(value);
      }
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument)) {
        const value = stringArgument(argument.literal);
        if (value) specifiers.push(value);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function walkSourceFiles(dir, nestedPackageDirs, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (nestedPackageDirs.has(full)) continue;
      walkSourceFiles(full, nestedPackageDirs, files);
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(full);
    }
  }
  return files;
}

function findPackageJsons(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findPackageJsons(full, files);
    } else if (entry.name === "package.json") {
      files.push(full);
    }
  }
  return files;
}

/**
 * Collects literal external package imports without resolving modules or types.
 *
 * @param {string} packageDir
 * @param {{ nestedPackageDirs?: Set<string> }} [options]
 * @returns {ImportedPackageInstance[]}
 */
export function importedPackages(packageDir, options = {}) {
  const root = path.resolve(packageDir);
  const nestedPackageDirs = options.nestedPackageDirs ?? new Set();
  const instances = [];

  for (const file of walkSourceFiles(root, nestedPackageDirs)) {
    const source = fs.readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      false,
      sourceKind(file),
    );

    for (const specifier of importedSpecifiers(sourceFile)) {
      const importedPackage = packageNameFromSpecifier(specifier);
      if (importedPackage) {
        instances.push({
          file: path.relative(root, file) || path.basename(file),
          importedPackage,
        });
      }
    }
  }

  return instances;
}

/**
 * Classifies an import using only the importing file's path and filename.
 *
 * @param {ImportedPackageInstance} instance
 * @returns {ImportEnvironment}
 */
export function isImportTestOrProd(instance) {
  const normalized = instance.file.replaceAll("\\", "/").toLowerCase();
  const parts = normalized.split("/");
  const basename = parts.at(-1) ?? normalized;

  if (parts.some((part) => DEV_DIRECTORY_NAMES.has(part))) return "dev";
  if (/\.(?:test|spec|stories|story)\.[^.]+$/.test(basename)) return "dev";
  if (/^(?:eslint|jest|karma|playwright|postcss|prettier|rollup|storybook|tailwind|tsup|vite|vitest|webpack)\.config\./.test(basename)) {
    return "dev";
  }
  if (/^(?:gulpfile|gruntfile)\./.test(basename)) return "dev";
  if (basename.endsWith(".d.ts")) return "dev";

  return "prod";
}

function declared(pkg, name) {
  return Boolean(
    pkg.name === name ||
      pkg.dependencies?.[name] ||
      pkg.devDependencies?.[name] ||
      pkg.peerDependencies?.[name] ||
      pkg.optionalDependencies?.[name],
  );
}

function lockedVersion(lock, name) {
  const direct = lock.packages?.[`node_modules/${name}`]?.version;
  if (direct) return direct;

  const legacy = lock.dependencies?.[name]?.version;
  if (legacy) return legacy;

  const suffix = `/node_modules/${name}`;
  for (const [location, entry] of Object.entries(lock.packages ?? {})) {
    if ((location === `node_modules/${name}` || location.endsWith(suffix)) && entry?.version) {
      return entry.version;
    }
  }

  return null;
}

function typesPackageName(name) {
  if (name.startsWith("@")) {
    const [scope, packageName] = name.split("/");
    return packageName ? `@types/${scope.slice(1)}__${packageName}` : null;
  }
  return `@types/${name}`;
}

function lockedDependencyForImport(lock, name) {
  const version = lockedVersion(lock, name);
  if (version) return { name, version, isTypesPackage: name.startsWith("@types/") };

  const typesName = typesPackageName(name);
  const typesVersion = typesName ? lockedVersion(lock, typesName) : null;
  if (typesName && typesVersion) {
    return { name: typesName, version: typesVersion, isTypesPackage: true };
  }

  return null;
}

/**
 * Aggregates imported packages. Production usage wins over development-only usage.
 * The npm lockfile supplies package identity and version information.
 *
 * @param {ImportedPackageInstance[]} instances
 * @param {object} lock
 * @param {object} pkg
 * @returns {RequiredDependencies}
 */
export function requiredDependencies(instances, lock, pkg = {}) {
  const environments = new Map();
  for (const instance of instances) {
    const environment = isImportTestOrProd(instance);
    const previous = environments.get(instance.importedPackage);
    if (previous !== "prod") environments.set(instance.importedPackage, environment);
  }

  const deps = new Set();
  const devDeps = new Set();
  const unresolved = new Set();

  for (const [importedPackage, environment] of environments) {
    if (declared(pkg, importedPackage)) continue;
    const locked = lockedDependencyForImport(lock, importedPackage);
    if (!locked) {
      unresolved.add(importedPackage);
      continue;
    }
    if (declared(pkg, locked.name)) continue;

    if (locked.isTypesPackage || environment === "dev") {
      devDeps.add(locked.name);
    } else {
      deps.add(locked.name);
    }
  }

  for (const name of deps) devDeps.delete(name);
  return { deps, devDeps, unresolved };
}

function addRequiredDependencies(pkgPath, lock, packageDirs) {
  const original = fs.readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(original);
  const packageDir = path.dirname(pkgPath);
  const nestedPackageDirs = new Set(
    [...packageDirs].filter((candidate) => {
      if (candidate === packageDir) return false;
      const relative = path.relative(packageDir, candidate);
      return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
    }),
  );
  const instances = importedPackages(packageDir, { nestedPackageDirs });
  const required = requiredDependencies(instances, lock, pkg);
  let changed = false;

  for (const [section, names] of [
    ["dependencies", required.deps],
    ["devDependencies", required.devDeps],
  ]) {
    if (names.size === 0) continue;
    pkg[section] ||= {};
    for (const name of [...names].sort()) {
      const version = lockedVersion(lock, name);
      if (!version || declared(pkg, name)) continue;
      pkg[section][name] = `^${version}`;
      console.log(`${pkgPath}: added ${section === "dependencies" ? "dependency" : "devDependency"} ${name}@^${version}`);
      changed = true;
    }
  }

  if (changed) {
    const indent = original.match(/\n([ \t]+)"/)?.[1] || "  ";
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, indent)}\n`);
  }
}

export function repairImportedDependencies(projectDir = process.cwd()) {
  const root = path.resolve(projectDir);
  const lockPath = ["package-lock.json", "npm-shrinkwrap.json"]
    .map((name) => path.join(root, name))
    .find((candidate) => fs.existsSync(candidate));
  if (!lockPath) return;

  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  const packageFiles = findPackageJsons(root);
  const packageDirs = new Set(packageFiles.map((file) => path.dirname(file)));
  for (const pkgPath of packageFiles) addRequiredDependencies(pkgPath, lock, packageDirs);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  repairImportedDependencies(process.argv[2] ?? process.cwd());
}
