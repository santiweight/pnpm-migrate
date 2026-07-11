import { spawnSync, type SpawnSyncOptions, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";

export type CommandResult = {
  command: string;
  args: string[];
  cwd: string;
  status: number;
  stdout: string;
  stderr: string;
  output: string;
  durationSeconds: number;
};

export type CommandOptions = Omit<SpawnSyncOptions, "encoding"> & {
  timeoutSeconds?: number;
};

export function runCommand(command: string, args: string[], options: CommandOptions = {}): CommandResult {
  const cwd = options.cwd?.toString() ?? process.cwd();
  const started = Date.now();
  const spawnOptions: SpawnSyncOptionsWithStringEncoding = {
    ...options,
    encoding: "utf8",
    timeout: options.timeoutSeconds && options.timeoutSeconds > 0 ? options.timeoutSeconds * 1000 : undefined,
  };
  delete (spawnOptions as { timeoutSeconds?: number }).timeoutSeconds;

  const result = spawnSync(command, args, spawnOptions);
  const durationSeconds = Math.round((Date.now() - started) / 1000);
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  return {
    command,
    args,
    cwd,
    status: result.status ?? (result.signal ? 124 : 1),
    stdout,
    stderr,
    output: `${stdout}${stderr}`,
    durationSeconds,
  };
}

export function runCommandOk(command: string, args: string[], options: CommandOptions = {}): CommandResult {
  const result = runCommand(command, args, options);
  if (result.status !== 0) {
    throw new Error(
      [
        `${command} ${args.join(" ")} failed with status ${result.status}`,
        result.stdout,
        result.stderr,
      ].filter(Boolean).join("\n"),
    );
  }
  return result;
}

export function shellQuote(command: string, args: string[]): string {
  return [command, ...args].map((part) => JSON.stringify(part)).join(" ");
}
