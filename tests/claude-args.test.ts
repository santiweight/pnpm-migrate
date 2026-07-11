import assert from "node:assert/strict";
import test from "node:test";
import { buildClaudeArgs } from "../src/agents/claude.ts";

test("Claude args use bare API-key auth when ANTHROPIC_API_KEY is configured", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const originalBudget = process.env.PNPM_MIGRATE_CLAUDE_MAX_BUDGET_USD;
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.PNPM_MIGRATE_CLAUDE_MAX_BUDGET_USD = "1";
  try {
    const args = buildClaudeArgs({
      prompt: "fix migration",
      sessionId: "00000000-0000-4000-8000-000000000001",
      worktreePath: "/tmp/worktree",
    });

    assert.deepEqual(args.slice(0, 3), ["--bare", "-p", "fix migration"]);
    assert.ok(args.includes("--max-budget-usd"));
    assert.ok(args.includes("1"));
    assert.ok(args.includes("--session-id"));
    assert.ok(args.includes("00000000-0000-4000-8000-000000000001"));
    assert.ok(args.includes("--permission-mode"));
    assert.ok(args.includes("auto"));
  } finally {
    if (originalKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalKey;
    }
    if (originalBudget === undefined) {
      delete process.env.PNPM_MIGRATE_CLAUDE_MAX_BUDGET_USD;
    } else {
      process.env.PNPM_MIGRATE_CLAUDE_MAX_BUDGET_USD = originalBudget;
    }
  }
});

test("Claude args keep resume session wiring", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const args = buildClaudeArgs({
      prompt: "fix ci",
      resumeSession: true,
      sessionId: "00000000-0000-4000-8000-000000000002",
      worktreePath: "/tmp/worktree",
    });

    assert.equal(args.includes("--bare"), false);
    assert.ok(args.includes("--resume"));
    assert.ok(args.includes("00000000-0000-4000-8000-000000000002"));
  } finally {
    if (originalKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalKey;
    }
  }
});
