import { invoke as tauriInvoke } from "@tauri-apps/api/core";

const API_BASE = "http://127.0.0.1:8000";

function hasTauriRuntime(): boolean {
  return typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__);
}

export async function appInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (hasTauriRuntime()) {
    return tauriInvoke<T>(command, args);
  }

  if (command === "list_sessions") {
    const response = await fetch(`${API_BASE}/tokenscope/sessions`);
    return parseResponse<T>(response);
  }

  if (command === "read_session") {
    const response = await fetch(`${API_BASE}/tokenscope/read-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: args?.path }),
    });
    return parseResponse<T>(response);
  }

  if (
    command === "read_claude_md" ||
    command === "read_gemini_md" ||
    command === "read_codex_md"
  ) {
    return "" as T;
  }

  if (command === "get_home_dir") {
    return "~" as T;
  }

  throw new Error(`${command} is only available in the desktop app`);
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}
