export type ImportedPackageInstance = {
  file: string;
  importedPackage: string;
};

export type ImportEnvironment = "dev" | "prod";

export type RequiredDependencies = {
  deps: Set<string>;
  devDeps: Set<string>;
  unresolved: Set<string>;
};

export function importedPackages(
  packageDir: string,
  options?: { nestedPackageDirs?: Set<string> },
): ImportedPackageInstance[];

export function isImportTestOrProd(
  instance: ImportedPackageInstance,
): ImportEnvironment;

export function requiredDependencies(
  instances: ImportedPackageInstance[],
  lock: object,
  pkg?: object,
): RequiredDependencies;

export function repairImportedDependencies(projectDir?: string): void;
