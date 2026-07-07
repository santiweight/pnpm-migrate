import type { AgentId } from "./detect.ts";

export type AgentStatusHandler = (message: string) => void;

function compactText(value: string): string | null {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text.length < 8) {
    return null;
  }

  return text.length > 82 ? `${text.slice(0, 79)}...` : text;
}

function toolStatus(name: string): string {
  const normalized = name.toLowerCase();

  if (/\b(read|grep|glob|ls|find|search)\b/.test(normalized)) {
    return "Inspecting migration files";
  }

  if (/\b(edit|write|patch|multi_edit)\b/.test(normalized)) {
    return "Applying cleanup edits";
  }

  if (/\b(bash|shell|exec|command)\b/.test(normalized)) {
    return "Running verification commands";
  }

  return `Using ${name}`;
}

function extractJsonStatuses(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const statuses: string[] = [];

  const type = typeof record.type === "string" ? record.type : "";
  const name = typeof record.name === "string" ? record.name : "";
  const toolName = typeof record.tool_name === "string" ? record.tool_name : "";

  if (type.includes("tool") && (name || toolName)) {
    statuses.push(toolStatus(name || toolName));
  }

  if (type === "content_block_delta" && record.delta && typeof record.delta === "object") {
    const delta = record.delta as Record<string, unknown>;
    if (typeof delta.text === "string") {
      const text = compactText(delta.text);
      if (text) statuses.push(text);
    }
  }

  if (typeof record.message === "string") {
    const text = compactText(record.message);
    if (text) statuses.push(text);
  }

  if (typeof record.text === "string") {
    const text = compactText(record.text);
    if (text) statuses.push(text);
  }

  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        statuses.push(...extractJsonStatuses(item));
      }
    } else if (value && typeof value === "object") {
      statuses.push(...extractJsonStatuses(value));
    }
  }

  return statuses;
}

function extractPlainStatuses(line: string): string[] {
  const lower = line.toLowerCase();
  if (/\b(read|search|inspect|scan)\b/.test(lower)) {
    return ["Inspecting migration files"];
  }
  if (/\b(edit|write|patch|update|fix)\b/.test(lower)) {
    return ["Applying cleanup edits"];
  }
  if (/\b(test|verify|install|pnpm|command)\b/.test(lower)) {
    return ["Running verification commands"];
  }

  const text = compactText(line);
  return text ? [text] : [];
}

export function createAgentStatusParser(_agentId: AgentId, onStatus?: AgentStatusHandler): (chunk: string) => void {
  let buffer = "";
  let lastMessage = "";
  let lastAt = 0;

  function emit(message: string): void {
    if (!onStatus || message === lastMessage) {
      return;
    }

    const now = Date.now();
    if (now - lastAt < 650) {
      return;
    }

    lastMessage = message;
    lastAt = now;
    onStatus(message);
  }

  return (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      try {
        const parsed = JSON.parse(trimmed);
        for (const status of extractJsonStatuses(parsed)) {
          emit(status);
        }
      } catch {
        for (const status of extractPlainStatuses(trimmed)) {
          emit(status);
        }
      }
    }
  };
}
