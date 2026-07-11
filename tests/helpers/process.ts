import { spawnSync, type SpawnSyncOptions, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";

export type RunResult = {
  status: number;
  stdout: string;
  stderr: string;
  output: string;
};

export type RunOptions = Omit<SpawnSyncOptions, "encoding">;

export function run(
  command: string,
  args: string[],
  options: RunOptions = {},
): RunResult {
  const spawnOptions: SpawnSyncOptionsWithStringEncoding = {
    ...options,
    encoding: "utf8",
  };
  const result = spawnSync(command, args, spawnOptions);

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

export function runOk(
  command: string,
  args: string[],
  options: RunOptions = {},
): RunResult {
  const result = run(command, args, options);
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
