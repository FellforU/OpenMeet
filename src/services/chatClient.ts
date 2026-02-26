const ASR_BASE_URL = "http://127.0.0.1:18090";

export interface ChatEvent {
  type: "context" | "token" | "sources" | "done";
  data?: Record<string, unknown>;
  text?: string;
  sources?: Array<{
    project_id: string;
    project_title: string;
    source_type: string;
    text: string;
    metadata: Record<string, unknown>;
  }>;
}

export async function* sendChatMessage(
  question: string,
  context: "current" | "all",
  projectId?: string,
  model?: string
): AsyncGenerator<ChatEvent> {
  const resp = await fetch(`${ASR_BASE_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      context,
      project_id: projectId,
      model: model || "qwen2.5:7b",
    }),
  });

  if (!resp.ok) {
    throw new Error(`Chat failed: HTTP ${resp.status}`);
  }

  const reader = resp.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Parse SSE events from buffer
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    let dataBuffer = "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        // Event type is embedded in the JSON data payload
      } else if (line.startsWith("data: ")) {
        dataBuffer = line.slice(6);
      } else if (line === "" && dataBuffer) {
        // End of event
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
}
