export type ProviderScope = "all" | "claude" | "gemini" | "codex" | "cursor" | "wiki";

export interface ProviderQaRequest {
  provider: ProviderScope;
  question: string;
}

export interface ProviderQaResponse {
  answer: string;
  provider: ProviderScope;
  sessions_used: number;
  sources: string[];
  scope_summary: string;
}

export interface ProviderQaHistoryItem {
  timestamp: string;
  provider: ProviderScope;
  question: string;
  answer: string;
  sessions_used: number;
  sources: string[];
  scope_summary: string;
}

export async function requestProviderQa(payload: ProviderQaRequest, signal?: AbortSignal): Promise<ProviderQaResponse> {
  const response = await fetch("http://127.0.0.1:8000/tokenscope/provider-qa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Provider question request failed: ${response.status}`);
  }

  return response.json();
}

export async function requestProviderQaHistory(provider: ProviderScope, limit = 10): Promise<ProviderQaHistoryItem[]> {
  const response = await fetch(`http://127.0.0.1:8000/tokenscope/provider-qa/history?provider=${encodeURIComponent(provider)}&limit=${limit}`);

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Provider QA history request failed: ${response.status}`);
  }

  return response.json();
}
