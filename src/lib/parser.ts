// Actual JSONL/JSON schema from ~/.claude/projects/**/*.jsonl and ~/.gemini/tmp/**/*.json
// Supports multiple providers: Claude, Gemini, Codex

import { Provider, detectProvider, PROVIDER_CONFIGS } from "./providers";

export interface RawEntry {
  type?: "user" | "assistant" | "gemini" | "info" | "error" | "file-history-snapshot" | string;
  uuid?: string;
  id?: string; // Gemini uses 'id' instead of 'uuid'
  parentUuid?: string;
  sessionId?: string;
  timestamp?: string;
  startTime?: string;
  cwd?: string;
  message?: RawMessage; // Claude style
  content?: string | RawContentBlock[]; // Gemini style direct content
  tokens?: RawUsage; // Gemini style direct tokens
  model?: string; // Gemini style direct model
  toolCalls?: any[]; // Gemini style tool calls
  messages?: RawEntry[]; // Nested messages in .json format
}

export interface RawMessage {
  role: "user" | "assistant";
  model?: string;
  content?: string | RawContentBlock[];
  usage?: RawUsage;
}

export interface RawUsage {
  [key: string]: number | undefined;
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  // Gemini fields
  input?: number;
  output?: number;
  cached?: number;
  total?: number;
}

export interface RawContentBlock {
  type?: "text" | "tool_use" | "tool_result" | "thinking" | "error" | string;
  text?: string;
  content?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
  functionResponse?: {
    name: string;
    response: { output: string };
  };
}

export interface ParsedMessage {
  uuid: string;
  role: "user" | "assistant";
  contentText: string;
  contentBlocks: RawContentBlock[];
  isToolUse: boolean;
  isToolResult: boolean;
  toolName?: string;
  toolUseId?: string;
  isToolError?: boolean;
  usage?: RawUsage;
  model?: string;
  timestamp: string;
}

export interface SessionData {
  sessionId: string;
  project: string;
  filePath: string;
  messages: ParsedMessage[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  model: string;
  provider: Provider;
  startTime: string;
  endTime: string;
  parseErrors: number;
}

export function parseSession(raw: string, sessionId: string, project: string, filePath: string): SessionData {
  const isJsonArray = raw.trim().startsWith('{') && raw.trim().endsWith('}') && !raw.trim().includes('\n{');
  
  if (isJsonArray) {
    try {
      const data = JSON.parse(raw);
      if (data.messages && Array.isArray(data.messages)) {
        return processGeminiJsonObject(data, sessionId, project, filePath);
      }
    } catch (e) {
      // Fallback to line-by-line if JSON parse fails
    }
  }

  return parseJsonl(raw, sessionId, project, filePath);
}

function processGeminiJsonObject(data: any, sessionId: string, project: string, filePath: string): SessionData {
  const messages: ParsedMessage[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheCreationTokens = 0;
  let model = data.model || "gemini-unknown";
  let startTime = data.startTime || "";
  let endTime = data.lastUpdated || "";

  for (const msg of data.messages) {
    const parsed = normalizeEntry(msg);
    if (parsed) {
      messages.push(parsed);
      if (parsed.usage) {
        totalInputTokens += parsed.usage.input ?? parsed.usage.input_tokens ?? 0;
        totalOutputTokens += parsed.usage.output ?? parsed.usage.output_tokens ?? 0;
        totalCacheReadTokens += parsed.usage.cached ?? parsed.usage.cache_read_input_tokens ?? 0;
      }
    }
  }

  return {
    sessionId: data.sessionId || sessionId,
    project,
    filePath,
    messages,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheCreationTokens,
    model,
    provider: "gemini",
    startTime,
    endTime,
    parseErrors: 0,
  };
}

function parseJsonl(raw: string, sessionId: string, project: string, filePath: string): SessionData {
  const lines = raw.split("\n").filter(l => l.trim().length > 0);
  const messages: ParsedMessage[] = [];
  let parseErrors = 0;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheCreationTokens = 0;
  let model = "unknown";
  let provider: Provider = "claude"; 
  let startTime = "";
  let endTime = "";

  for (const line of lines) {
    if (line.startsWith('{"$set"')) continue;

    let entry: RawEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      parseErrors++;
      continue;
    }

    if (entry.sessionId && !entry.type) {
      if (entry.startTime) startTime = entry.startTime;
      continue;
    }

    if (entry.type === "file-history-snapshot" || entry.type === "info") continue;

    const parsed = normalizeEntry(entry);
    if (!parsed) continue;

    if (parsed.model) {
      model = parsed.model;
      provider = detectProvider(model);
    }

    const timestamp = parsed.timestamp;
    if (!startTime || (timestamp && timestamp < startTime)) startTime = timestamp;
    if (timestamp && timestamp > endTime) endTime = timestamp;

    if (parsed.usage) {
      const config = PROVIDER_CONFIGS[provider];
      const fieldNames = config.jsonlFormat.usageFieldNames;

      totalInputTokens += parsed.usage[fieldNames.input] ?? parsed.usage.input ?? 0;
      totalOutputTokens += parsed.usage[fieldNames.output] ?? parsed.usage.output ?? 0;

      if (config.supportsCache) {
        totalCacheReadTokens += (fieldNames.cacheRead ? parsed.usage[fieldNames.cacheRead] : 0) ?? parsed.usage.cached ?? 0;
      }
    }

    messages.push(parsed);
  }

  return {
    sessionId, project, filePath, messages,
    totalInputTokens, totalOutputTokens, totalCacheReadTokens, totalCacheCreationTokens,
    model, provider, startTime, endTime, parseErrors,
  };
}

function normalizeEntry(entry: RawEntry): ParsedMessage | null {
  let role: "user" | "assistant" | undefined;
  let content: string | RawContentBlock[] | undefined;
  let usage: RawUsage | undefined;
  let model: string | undefined;

  if (entry.message) {
    // Claude style
    role = entry.message.role;
    content = entry.message.content;
    usage = entry.message.usage;
    model = entry.message.model;
  } else if (entry.type === "user" || entry.type === "gemini" || entry.type === "assistant") {
    // Gemini style
    role = (entry.type === "gemini" || entry.type === "assistant") ? "assistant" : "user";
    content = entry.content;
    usage = entry.tokens;
    model = entry.model;
  }

  if (!role) return null;

  const blocks: RawContentBlock[] = Array.isArray(content) ? content : [];
  const toolCalls = entry.toolCalls ?? [];
  const isToolUse = toolCalls.length > 0 || blocks.some(b => b.type === "tool_use");
  const isToolResult = blocks.some(b => b.type === "tool_result" || b.functionResponse);

  let contentText = "";
  if (typeof content === "string") {
    contentText = content;
  } else if (Array.isArray(content)) {
    contentText = blocks
      .map(b => b.text ?? b.content ?? b.functionResponse?.response?.output ?? "")
      .filter(t => typeof t === "string")
      .join("\n");
  }

  if (!contentText && toolCalls.length > 0) {
    contentText = toolCalls.map(tc => `Calling ${tc.name}...`).join("\n");
  }

  return {
    uuid: entry.id ?? entry.uuid ?? Math.random().toString(36).substring(7),
    role,
    contentText,
    contentBlocks: blocks,
    isToolUse,
    isToolResult,
    toolName: toolCalls[0]?.name || blocks.find(b => b.type === "tool_use")?.name,
    toolUseId: toolCalls[0]?.id || blocks.find(b => b.type === "tool_use")?.id || (blocks.find(b => b.functionResponse) as any)?.functionResponse?.id,
    isToolError: blocks.some(b => b.is_error || b.type === "error"),
    usage,
    model,
    timestamp: entry.timestamp || "",
  };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

export interface ClaudeSection {
  heading: string;
  content: string;
  estimatedTokens: number;
}

export function parseClaudeMd(content: string): ClaudeSection[] {
  if (!content.trim()) return [];
  const lines = content.split("\n");
  const sections: ClaudeSection[] = [];
  let currentHeading = "(preface)";
  let currentLines: string[] = [];

  const flush = () => {
    const text = currentLines.join("\n").trim();
    if (text) {
      sections.push({
        heading: currentHeading,
        content: text,
        estimatedTokens: estimateTokens(text),
      });
    }
  };

  for (const line of lines) {
    if (line.startsWith("## ")) {
      flush();
      currentHeading = line.slice(3).trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  flush();
  return sections;
}
