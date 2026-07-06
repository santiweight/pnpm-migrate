import { existsSync } from "node:fs";
import path from "node:path";
import { detectAgents, type Agent } from "../agents/detect.ts";
import { runCapture } from "../utils/command.ts";

export type PreflightEnvironment = {
  agents: Agent[];
  branch: string;
  dirty: boolean;
  failures: string[];
  gitRoot: string;
  lockfiles: string[];
  packageJson: string;
  projectDir: string;
  projectRelativePath: string;
  repoLabel: string;
  repoName: string;
};

function parseGitHubRemote(remoteUrl: string): { owner: string; repo: string } | null {
  const match = remoteUrl.match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (!match) {
    return null;
  }

  return {
    owner: match[1],
    repo: match[2],
  };
}

function detectGitHubOwnerName(owner: string): string | null {
  const response = runCapture(process.execPath, [
    "-e",
    `
const https = require("https");
const owner = process.argv[1];
const request = https.get({
  hostname: "api.github.com",
  path: \`/users/\${encodeURIComponent(owner)}\`,
  headers: { "User-Agent": "pnpm-migrate" },
  timeout: 1000,
}, (response) => {
  let body = "";
  response.setEncoding("utf8");
  response.on("data", (chunk) => { body += chunk; });
  response.on("end", () => {
    try {
      const user = JSON.parse(body);
      if (typeof user.name === "string" && user.name.trim()) {
        process.stdout.write(user.name.trim());
      }
    } catch {}
  });
});
request.on("timeout", () => request.destroy());
request.on("error", () => {});
`,
    owner,
  ]);

  return response.status === 0 && response.stdout ? response.stdout : null;
}

function detectRepoLabel(gitRoot: string, fallbackName: string): string {
  const remote = runCapture("git", ["remote", "get-url", "origin"], { cwd: gitRoot });
  if (remote.status === 0) {
    const parsed = parseGitHubRemote(remote.stdout);
    if (parsed) {
      return `${detectGitHubOwnerName(parsed.owner) ?? parsed.owner} > ${parsed.repo}`;
    }
  }

  return fallbackName;
}

export function detectEnvironment(enginePath: string): PreflightEnvironment {
  const failures: string[] = [];
  const gitRootResult = runCapture("git", ["rev-parse", "--show-toplevel"]);
  const insideGit = gitRootResult.status === 0 && gitRootResult.stdout.length > 0;
  const gitRoot = insideGit ? gitRootResult.stdout : "";
  const projectDir = process.cwd();
  const packageJson = path.join(projectDir, "package.json");
  const lockfiles = ["package-lock.json", "npm-shrinkwrap.json"].filter((file) => {
    return existsSync(path.join(projectDir, file));
  });
  const agents = detectAgents();

  if (!existsSync(enginePath)) {
    failures.push(`Migration engine not found at ${enginePath}`);
  }

  if (!insideGit) {
    failures.push("Not inside a git repository");
  }

  if (!existsSync(packageJson)) {
    failures.push("No package.json found in the current directory");
  }

  if (lockfiles.length === 0) {
    failures.push("No npm lockfile found; expected package-lock.json or npm-shrinkwrap.json");
  }

  if (agents.length === 0) {
    failures.push("No supported coding agent found; install/login Claude Code or Codex");
  }

  let branch = "";
  let dirty = false;
  let repoName = path.basename(projectDir);
  let repoLabel = repoName;
  let projectRelativePath = ".";

  if (insideGit) {
    branch = runCapture("git", ["branch", "--show-current"], { cwd: gitRoot }).stdout || "HEAD";
    dirty = runCapture("git", ["status", "--porcelain"], { cwd: gitRoot }).stdout.length > 0;
    repoName = path.basename(gitRoot);
    repoLabel = detectRepoLabel(gitRoot, repoName);
    projectRelativePath = path.relative(gitRoot, projectDir) || ".";

    if (dirty) {
      failures.push("Git working tree has uncommitted changes; commit or stash them first");
    }
  }

  return {
    agents,
    branch,
    dirty,
    failures,
    gitRoot,
    lockfiles,
    packageJson,
    projectDir,
    projectRelativePath,
    repoLabel,
    repoName,
  };
}
