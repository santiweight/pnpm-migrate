import { spawn, spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";

export type CaptureResult = {
  status: number;
  stdout: string;
  stderr: string;
};

export type LoggedResult = {
  code: number;
  logPath: string;
  signal: NodeJS.Signals | null;
};

export function runCapture(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): CaptureResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    encoding: "utf8",
  });

  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

export function commandOk(command: string, args: string[] = ["--version"]): boolean {
  return spawnSync(command, args, { stdio: "ignore" }).status === 0;
}

export function runLogged(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    logPath: string;
    onTick?: () => void;
  },
): Promise<LoggedResult> {
  return new Promise((resolve) => {
    const log = createWriteStream(options.logPath, { flags: "a" });
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const interval = setInterval(() => options.onTick?.(), 300);

    child.stdout.pipe(log);
    child.stderr.pipe(log);

    child.on("exit", (code, signal) => {
      clearInterval(interval);
      options.onTick?.();
      log.end(() => {
        resolve({ code: signal ? 1 : code ?? 1, logPath: options.logPath, signal });
      });
    });

    child.on("error", (error) => {
      clearInterval(interval);
      log.write(`${error.stack ?? error.message}\n`);
      log.end(() => {
        resolve({ code: 1, logPath: options.logPath, signal: null });
      });
    });
  });
}
