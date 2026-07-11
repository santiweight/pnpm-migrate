export type ClaudeRunOptions = {
  prompt: string;
  resumeSession?: boolean;
  sessionId?: string;
  worktreePath: string;
};

export function buildClaudeArgs(options: ClaudeRunOptions): string[] {
  const sessionArgs = options.sessionId
    ? [options.resumeSession ? "--resume" : "--session-id", options.sessionId]
    : [];
  const authArgs = process.env.ANTHROPIC_API_KEY ? ["--bare"] : [];
  const budgetArgs = process.env.PNPM_MIGRATE_CLAUDE_MAX_BUDGET_USD
    ? ["--max-budget-usd", process.env.PNPM_MIGRATE_CLAUDE_MAX_BUDGET_USD]
    : [];

  return [
    ...authArgs,
    "-p",
    options.prompt,
    ...budgetArgs,
    ...sessionArgs,
    "--permission-mode",
    "auto",
    "--add-dir",
    options.worktreePath,
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
  ];
}
