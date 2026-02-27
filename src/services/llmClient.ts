import { useSettingsStore } from "../stores/settingsStore";
import { tauriFetch } from "./httpProxy";
import type { Summary } from "../types";

interface LLMResponse {
  text: string;
}

// Provider endpoint configurations
const PROVIDER_ENDPOINTS: Record<string, { url: string; isOllama?: boolean }> = {
  ollama: { url: "/api/generate", isOllama: true },
  openai: { url: "https://api.openai.com/v1/chat/completions" },
  deepseek: { url: "https://api.deepseek.com/v1/chat/completions" },
  qwen: { url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions" },
  zhipu: { url: "https://open.bigmodel.cn/api/paas/v4/chat/completions" },
  gemini: { url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions" },
};

async function callOllama(
  host: string,
  model: string,
  prompt: string
): Promise<string> {
  const resp = await tauriFetch(`${host}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: false }),
  });
  if (resp.status !== 200) {
    throw new Error(`Ollama error: HTTP ${resp.status}`);
  }
  const data = JSON.parse(resp.body);
  return data.response;
}

async function callOpenAICompatible(
  url: string,
  apiKey: string,
  model: string,
  prompt: string,
  maxTokens = 100
): Promise<string> {
  const resp = await tauriFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.3,
    }),
  });
  if (resp.status !== 200) {
    throw new Error(`LLM API error: HTTP ${resp.status}`);
  }
  const data = JSON.parse(resp.body);
  return data.choices[0].message.content;
}

export async function generateText(
  prompt: string,
  options?: { maxTokens?: number }
): Promise<LLMResponse> {
  const { general, llmProviders } = useSettingsStore.getState();
  const providerKey = general.defaultLLMProvider;
  const config = llmProviders[providerKey];

  if (!config?.enabled) {
    throw new Error(`LLM provider "${providerKey}" is not enabled`);
  }

  const endpoint = PROVIDER_ENDPOINTS[providerKey];
  if (!endpoint) {
    throw new Error(`Unknown LLM provider: ${providerKey}`);
  }

  let text: string;

  if (endpoint.isOllama) {
    const host = config.host || "http://localhost:11434";
    const model = config.model || "qwen2.5:7b";
    text = await callOllama(host, model, prompt);
  } else {
    const apiKey = config.apiKey;
    if (!apiKey) {
      throw new Error(`API key not configured for "${providerKey}"`);
    }
    const model = config.model || providerKey;
    text = await callOpenAICompatible(
      endpoint.url,
      apiKey,
      model,
      prompt,
      options?.maxTokens ?? 100
    );
  }

  return { text: text.trim() };
}

export async function testLLMConnection(
  providerKey: string,
  config: { apiKey?: string; host?: string; model?: string }
): Promise<{ success: boolean; message: string }> {
  const endpoint = PROVIDER_ENDPOINTS[providerKey];
  if (!endpoint) {
    return { success: false, message: `Unknown provider: ${providerKey}` };
  }

  try {
    if (endpoint.isOllama) {
      const host = config.host || "http://localhost:11434";
      const model = config.model || "qwen2.5:7b";
      const text = await callOllama(host, model, "Hi, reply with OK");
      return { success: true, message: text.slice(0, 100) };
    } else {
      const apiKey = config.apiKey;
      if (!apiKey) {
        return { success: false, message: "API key not provided" };
      }
      const model = config.model || providerKey;
      const text = await callOpenAICompatible(endpoint.url, apiKey, model, "Hi, reply with OK");
      return { success: true, message: text.slice(0, 100) };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: msg };
  }
}

// Model listing endpoints per provider
const MODEL_LIST_ENDPOINTS: Record<string, { url: string; isOllama?: boolean; isGemini?: boolean }> = {
  ollama: { url: "/api/tags", isOllama: true },
  openai: { url: "https://api.openai.com/v1/models" },
  deepseek: { url: "https://api.deepseek.com/v1/models" },
  qwen: { url: "https://dashscope.aliyuncs.com/compatible-mode/v1/models" },
  zhipu: { url: "https://open.bigmodel.cn/api/paas/v4/models" },
  gemini: { url: "https://generativelanguage.googleapis.com/v1beta/models", isGemini: true },
};

export async function fetchModelList(
  providerKey: string,
  config: { apiKey?: string; host?: string }
): Promise<string[]> {
  const endpoint = MODEL_LIST_ENDPOINTS[providerKey];
  if (!endpoint) return [];

  if (endpoint.isOllama) {
    const host = config.host || "http://localhost:11434";
    const resp = await tauriFetch(`${host}/api/tags`, { method: "GET" });
    if (resp.status !== 200) throw new Error(`Ollama error: HTTP ${resp.status}`);
    const data = JSON.parse(resp.body);
    return (data.models || []).map((m: { name: string }) => m.name);
  }

  if (endpoint.isGemini) {
    if (!config.apiKey) throw new Error("API key required");
    const resp = await tauriFetch(`${endpoint.url}?key=${config.apiKey}`, { method: "GET" });
    if (resp.status !== 200) throw new Error(`Gemini error: HTTP ${resp.status}`);
    const data = JSON.parse(resp.body);
    return (data.models || [])
      .map((m: { name: string }) => m.name.replace("models/", ""))
      .filter((name: string) => name.includes("gemini"));
  }

  // OpenAI-compatible endpoints
  if (!config.apiKey) throw new Error("API key required");
  const resp = await tauriFetch(endpoint.url, {
    method: "GET",
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (resp.status !== 200) throw new Error(`API error: HTTP ${resp.status}`);
  const data = JSON.parse(resp.body);
  return (data.data || []).map((m: { id: string }) => m.id).sort();
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export async function generateMeetingTitle(
  createdAt: string,
  transcriptText: string
): Promise<string> {
  const date = new Date(createdAt);
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const weekday = `周${WEEKDAYS[date.getDay()]}`;

  // Truncate transcript to ~500 chars
  const truncated =
    transcriptText.length > 500
      ? transcriptText.slice(0, 500) + "..."
      : transcriptText;

  const prompt = `Based on the following meeting transcript, generate a very short meeting title (5-10 Chinese characters, topic keywords only, no date).

Transcript:
${truncated}

Reply with ONLY the short title, nothing else.`;

  const { text } = await generateText(prompt);

  // Clean up: remove quotes, periods, etc.
  const cleaned = text.replace(/["""''。.，,\n]/g, "").trim();

  return `${dateStr} ${weekday} ${cleaned}`;
}

export async function generateMeetingSummary(
  transcriptText: string
): Promise<Summary> {
  // Truncate to ~3000 chars to fit context window of smaller models
  const truncated =
    transcriptText.length > 3000
      ? transcriptText.slice(0, 3000) + "\n...(truncated)"
      : transcriptText;

  const prompt = `You are a meeting summarizer. Analyze the transcript below and produce a JSON summary.

Return ONLY valid JSON with this exact structure (no markdown fences, no extra text):
{
  "topic": "meeting topic in Chinese (10-20 chars)",
  "conclusions": ["conclusion 1", "conclusion 2"],
  "action_items": [{"assignee": "person", "task": "task description", "deadline": null}],
  "discussion": [{"topic": "subtopic", "summary": "brief summary"}]
}

Rules:
- Write all content in Chinese
- Keep conclusions concise (1 sentence each)
- Include 1-5 action items if mentioned, otherwise empty array
- Include 1-5 discussion topics

Transcript:
${truncated}`;

  const { text } = await generateText(prompt, { maxTokens: 2000 });

  // Extract JSON from the response (handle markdown fences)
  let jsonStr = text;
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1];
  }
  jsonStr = jsonStr.trim();

  let parsed: {
    topic?: string;
    conclusions?: string[];
    action_items?: Array<{ assignee?: string; task?: string; deadline?: string | null }>;
    discussion?: Array<{ topic?: string; summary?: string }>;
  };

  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    // Fallback: treat entire response as raw text summary
    return {
      topic: "",
      conclusions: [],
      actionItems: [],
      discussion: [],
      rawMarkdown: text,
      editedMarkdown: null,
    };
  }

  const topic = parsed.topic || "";
  const conclusions = parsed.conclusions || [];
  const actionItems = (parsed.action_items || []).map((item) => ({
    assignee: item.assignee || "",
    task: item.task || "",
    deadline: item.deadline || null,
    done: false,
  }));
  const discussion = (parsed.discussion || []).map((d) => ({
    topic: d.topic || "",
    summary: d.summary || "",
  }));

  // Build rawMarkdown from structured data
  const lines: string[] = [];
  if (topic) lines.push(`# ${topic}`, "");
  if (conclusions.length > 0) {
    lines.push("## 结论", "");
    for (const c of conclusions) lines.push(`- ${c}`);
    lines.push("");
  }
  if (actionItems.length > 0) {
    lines.push("## 待办事项", "");
    for (const item of actionItems) {
      let line = `- [ ] ${item.task}`;
      if (item.assignee) line += ` (@${item.assignee})`;
      if (item.deadline) line += ` [截止: ${item.deadline}]`;
      lines.push(line);
    }
    lines.push("");
  }
  if (discussion.length > 0) {
    lines.push("## 讨论要点", "");
    for (const d of discussion) {
      lines.push(`### ${d.topic}`, "", d.summary, "");
    }
  }

  return {
    topic,
    conclusions,
    actionItems,
    discussion,
    rawMarkdown: lines.join("\n"),
    editedMarkdown: null,
  };
}
