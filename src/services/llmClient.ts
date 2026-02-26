import { useSettingsStore } from "../stores/settingsStore";

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
  const resp = await fetch(`${host}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: false }),
  });
  if (!resp.ok) {
    throw new Error(`Ollama error: HTTP ${resp.status}`);
  }
  const data = await resp.json();
  return data.response;
}

async function callOpenAICompatible(
  url: string,
  apiKey: string,
  model: string,
  prompt: string
): Promise<string> {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 100,
      temperature: 0.3,
    }),
  });
  if (!resp.ok) {
    throw new Error(`LLM API error: HTTP ${resp.status}`);
  }
  const data = await resp.json();
  return data.choices[0].message.content;
}

export async function generateText(prompt: string): Promise<LLMResponse> {
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
    text = await callOpenAICompatible(endpoint.url, apiKey, model, prompt);
  }

  return { text: text.trim() };
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
