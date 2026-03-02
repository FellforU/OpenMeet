import { tauriFetch } from "./httpProxy";

const ASR_BASE_URL = "http://127.0.0.1:18090";

export interface ChatSource {
  project_id: string;
  project_title: string;
  source_type: string;
  text: string;
  metadata: Record<string, unknown>;
}

export interface ChatContextResult {
  question_type: string;
  context_text: string;
  sources: ChatSource[];
}

export interface ChatEvent {
  type: "context" | "token" | "sources" | "done";
  data?: Record<string, unknown>;
  text?: string;
  sources?: ChatSource[];
}

/**
 * Fetch retrieval context from ASR service without calling LLM.
 */
export async function fetchChatContext(
  question: string,
  context: "current" | "all",
  projectId?: string
): Promise<ChatContextResult> {
  const resp = await tauriFetch(`${ASR_BASE_URL}/chat/context`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      context,
      project_id: projectId || null,
    }),
  });

  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`Chat context failed: HTTP ${resp.status}`);
  }

  return JSON.parse(resp.body);
}

export async function* sendChatMessage(
  question: string,
  context: "current" | "all",
  projectId?: string,
  model?: string
): AsyncGenerator<ChatEvent> {
  // SSE streaming: fetch full response via Tauri proxy then parse events
  const resp = await tauriFetch(`${ASR_BASE_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      context,
      project_id: projectId,
      model: model || "qwen2.5:7b",
    }),
  });

  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`Chat failed: HTTP ${resp.status}`);
  }

  // Parse SSE events from the complete response body
  const lines = resp.body.split("\n");
  let dataBuffer = "";

  for (const line of lines) {
    if (line.startsWith("event: ")) {
      // Event type is embedded in the JSON data payload
    } else if (line.startsWith("data: ")) {
      dataBuffer = line.slice(6);
    } else if (line === "" && dataBuffer) {
      try {
        const parsed = JSON.parse(dataBuffer);
        yield parsed as ChatEvent;
      } catch {
        // Skip malformed events
      }
      dataBuffer = "";
    }
  }
}
