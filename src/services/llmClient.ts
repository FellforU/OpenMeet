import { useSettingsStore, parseModelRef } from "../stores/settingsStore";
import { tauriFetch } from "./httpProxy";
import type { Summary } from "../types";

interface LLMResponse {
  text: string;
}

// Resolve model from per-type config with fallback chain
function resolveModel(
  config: { model?: string; modelByType?: Record<string, string | undefined> },
  type: "LLM" | "EMBEDDING" | "RERANK",
  fallback: string
): string {
  return config.modelByType?.[type] ?? config.model ?? fallback;
}

// Provider endpoint configurations
const PROVIDER_ENDPOINTS: Record<string, { url: string; isOllama?: boolean }> = {
  ollama: { url: "/api/generate", isOllama: true },
  openai: { url: "https://api.openai.com/v1/chat/completions" },
  deepseek: { url: "https://api.deepseek.com/v1/chat/completions" },
  qwen: { url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions" },
  zhipu: { url: "https://open.bigmodel.cn/api/paas/v4/chat/completions" },
  gemini: { url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions" },
  moonshot: { url: "https://api.moonshot.cn/v1/chat/completions" },
  wenxin: { url: "https://qianfan.baidubce.com/v2/chat/completions" },
  hunyuan: { url: "https://api.hunyuan.cloud.tencent.com/v1/chat/completions" },
  minimax: { url: "https://api.minimax.chat/v1/text/chatcompletion_v2" },
  siliconflow: { url: "https://api.siliconflow.cn/v1/chat/completions" },
  volcengine: { url: "https://ark.cn-beijing.volces.com/api/v3/chat/completions" },
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

  // Resolve provider and model from compound key (new) or fallback to old provider-based logic
  let providerKey: string;
  let modelOverride: string | undefined;

  const modelRef = general.defaultLLMModel;
  if (modelRef && modelRef.includes("/")) {
    const parsed = parseModelRef(modelRef);
    providerKey = parsed.provider;
    modelOverride = parsed.model;
  } else {
    providerKey = general.defaultLLMProvider;
  }

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
    const model = modelOverride || resolveModel(config, "LLM", "qwen2.5:7b");
    text = await callOllama(host, model, prompt);
  } else {
    const apiKey = config.apiKey;
    if (!apiKey) {
      throw new Error(`API key not configured for "${providerKey}"`);
    }
    const model = modelOverride || resolveModel(config, "LLM", providerKey);
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
  config: { apiKey?: string; host?: string; model?: string; modelByType?: Record<string, string | undefined> }
): Promise<{ success: boolean; message: string }> {
  const endpoint = PROVIDER_ENDPOINTS[providerKey];
  if (!endpoint) {
    return { success: false, message: `Unknown provider: ${providerKey}` };
  }

  try {
    if (endpoint.isOllama) {
      const host = config.host || "http://localhost:11434";
      const model = resolveModel(config, "LLM", "qwen2.5:7b");
      const text = await callOllama(host, model, "Hi, reply with OK");
      return { success: true, message: text.slice(0, 100) };
    } else {
      const apiKey = config.apiKey;
      if (!apiKey) {
        return { success: false, message: "API key not provided" };
      }
      const model = resolveModel(config, "LLM", providerKey);
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
  moonshot: { url: "https://api.moonshot.cn/v1/models" },
  wenxin: { url: "https://qianfan.baidubce.com/v2/models" },
  hunyuan: { url: "https://api.hunyuan.cloud.tencent.com/v1/models" },
  minimax: { url: "https://api.minimax.chat/v1/models" },
  siliconflow: { url: "https://api.siliconflow.cn/v1/models" },
  volcengine: { url: "https://ark.cn-beijing.volces.com/api/v3/models" },
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

/**
 * Generate chat completion tokens from user-configured LLM provider.
 *
 * Note: tauriFetch buffers the entire HTTP response before returning, so tokens
 * are parsed from the already-complete body. The AsyncGenerator interface allows
 * progressive UI updates during parsing but does NOT provide true SSE streaming.
 * True streaming requires Tauri-level streaming IPC support (future improvement).
 */
export async function* generateChatStream(
  systemPrompt: string,
  userPrompt: string
): AsyncGenerator<string> {
  const { general, llmProviders } = useSettingsStore.getState();

  // Resolve provider and model from compound key
  let providerKey: string;
  let modelOverride: string | undefined;

  const modelRef = general.defaultLLMModel;
  if (modelRef && modelRef.includes("/")) {
    const parsed = parseModelRef(modelRef);
    providerKey = parsed.provider;
    modelOverride = parsed.model;
  } else {
    providerKey = general.defaultLLMProvider;
  }

  const config = llmProviders[providerKey];
  if (!config?.enabled) {
    throw new Error(`LLM provider "${providerKey}" is not enabled`);
  }

  const endpoint = PROVIDER_ENDPOINTS[providerKey];
  if (!endpoint) {
    throw new Error(`Unknown LLM provider: ${providerKey}`);
  }

  if (endpoint.isOllama) {
    const host = config.host || "http://localhost:11434";
    const model = modelOverride || resolveModel(config, "LLM", "qwen2.5:7b");
    const resp = await tauriFetch(`${host}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: userPrompt,
        system: systemPrompt,
        stream: true,
      }),
    });
    if (resp.status !== 200) {
      throw new Error(`Ollama error: HTTP ${resp.status}`);
    }
    // Ollama streaming: newline-delimited JSON {"response": "token"}
    for (const line of resp.body.split("\n")) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.response) {
          yield obj.response;
        }
      } catch {
        // Skip malformed lines
      }
    }
  } else {
    const apiKey = config.apiKey;
    if (!apiKey) {
      throw new Error(`API key not configured for "${providerKey}"`);
    }
    const model = modelOverride || resolveModel(config, "LLM", providerKey);
    const resp = await tauriFetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: true,
      }),
    });
    if (resp.status !== 200) {
      throw new Error(`LLM API error: HTTP ${resp.status}`);
    }
    // OpenAI-compatible SSE: data: {"choices":[{"delta":{"content":"token"}}]}
    for (const line of resp.body.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") break;
      try {
        const obj = JSON.parse(payload);
        const content = obj.choices?.[0]?.delta?.content;
        if (content) {
          yield content;
        }
      } catch {
        // Skip malformed SSE lines
      }
    }
  }
}

export async function generateMeetingTitle(
  _createdAt: string,
  transcriptText: string
): Promise<string> {
  // Truncate transcript to ~500 chars
  const truncated =
    transcriptText.length > 500
      ? transcriptText.slice(0, 500) + "..."
      : transcriptText;

  const prompt = `Based on the following meeting transcript, generate a very short meeting title (5-10 Chinese characters, topic keywords only, no date, no time).

Transcript:
${truncated}

Reply with ONLY the short title, nothing else.`;

  const { text } = await generateText(prompt);

  // Clean up: remove quotes, periods, etc.
  const cleaned = text.replace(/["""''。.，,\n]/g, "").trim();

  return cleaned;
}

// -- Map-Reduce summary helpers --

const CHUNK_SIZE = 2500;

/** Split transcript into chunks at sentence boundaries. */
function splitTranscript(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= CHUNK_SIZE) {
      chunks.push(remaining);
      break;
    }

    // Find a sentence boundary near the chunk size limit
    let splitIdx = CHUNK_SIZE;
    const sentenceEnders = ["。", "！", "？", ".", "!", "?", "\n"];
    let bestIdx = -1;
    for (const ender of sentenceEnders) {
      const idx = remaining.lastIndexOf(ender, CHUNK_SIZE);
      if (idx > CHUNK_SIZE * 0.5 && idx > bestIdx) {
        bestIdx = idx;
      }
    }
    if (bestIdx > 0) {
      splitIdx = bestIdx + 1;
    }

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx);
  }

  return chunks;
}

/** Extract JSON from LLM response, handling markdown fences. */
function extractJson(text: string): string {
  let jsonStr = text;
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1];
  }
  return jsonStr.trim();
}

interface ChunkSummary {
  topics: string[];
  conclusions: string[];
  decisions: Array<{ decision?: string; made_by?: string; reasoning?: string }>;
  action_items: Array<{ assignee?: string; task?: string; deadline?: string | null; priority?: string; status?: string }>;
  discussion: Array<{ topic?: string; summary?: string; participants?: string[]; key_points?: string[] }>;
  technical_details: Array<{ category?: string; details?: string }>;
  next_steps: string[];
  key_data: string[];
  participants: string[];
}

/** Summarize a single chunk of transcript. */
async function summarizeChunk(chunk: string, chunkIndex: number, totalChunks: number): Promise<ChunkSummary> {
  const prompt = `你是一个专业的会议记录助手。请分析以下会议转录片段（第${chunkIndex + 1}/${totalChunks}段），提取所有关键信息。

要求：
- 提取所有讨论的话题（不遗漏任何话题，包括闲聊、建议、经验分享）
- 提取所有决策（明确做出的决定，包含决策内容、决策人和理由）
- 提取所有行动项（包括明确说的和隐含的），标注优先级(high/medium/low)和状态(not_started/in_progress/completed)
- 每个讨论话题标注参与者和关键要点
- 提取技术细节（架构、方案、技术选型等）
- 提取下一步行动计划
- 保留所有关键数据：金额、日期、数字、百分比、技术名词
- 识别参与讨论的人员名称或称呼
- 用中文输出

仅返回JSON格式，不要其他文字：
{
  "topics": ["话题1", "话题2"],
  "conclusions": ["结论1"],
  "decisions": [{"decision": "决策内容", "made_by": "决策人", "reasoning": "理由"}],
  "action_items": [{"assignee": "责任人", "task": "任务描述", "deadline": null, "priority": "medium", "status": "not_started"}],
  "discussion": [{"topic": "子话题", "summary": "详细摘要", "participants": ["参与者"], "key_points": ["要点1"]}],
  "technical_details": [{"category": "分类", "details": "技术细节描述"}],
  "next_steps": ["下一步行动1"],
  "key_data": ["100-200美金/月", "本周完成"],
  "participants": ["雨辰"]
}

转录片段：
${chunk}`;

  const { text } = await generateText(prompt, { maxTokens: 3000 });
  try {
    return JSON.parse(extractJson(text));
  } catch {
    return { topics: [], conclusions: [], decisions: [], action_items: [], discussion: [], technical_details: [], next_steps: [], key_data: [], participants: [] };
  }
}

/** Merge multiple chunk summaries into a final summary. */
async function mergeChunkSummaries(chunks: ChunkSummary[]): Promise<Summary> {
  const mergedData = JSON.stringify(chunks, null, 2);

  const prompt = `你是一个专业的会议记录助手。以下是一次会议多个片段的分段总结，请合并为一份完整的会议纪要。

合并要求：
1. 合并所有话题，去重但不遗漏任何讨论内容
2. 合并所有决策，去重并保留决策人和理由
3. 合并所有行动项，去除完全重复的，保留优先级和状态
4. 合并所有结论，按重要性排序
5. 合并技术细节、下一步行动、关键数据和参与者信息
6. 每个讨论要点的摘要应详细（50-150字），标注参与者和关键要点
7. 讨论要点应覆盖会议中提到的所有话题，包括非正式讨论

仅返回JSON格式：
{
  "topic": "会议主题（一句话概括，10-20字）",
  "conclusions": ["结论1", "结论2"],
  "decisions": [{"decision": "决策内容", "made_by": "决策人", "reasoning": "理由"}],
  "action_items": [{"assignee": "责任人", "task": "具体任务描述", "deadline": "截止时间或null", "priority": "high/medium/low", "status": "not_started/in_progress/completed"}],
  "discussion": [{"topic": "子话题名称", "summary": "详细摘要", "participants": ["参与者"], "key_points": ["要点1"]}],
  "technical_details": [{"category": "分类", "details": "技术细节描述"}],
  "next_steps": ["下一步行动1"],
  "key_data": ["关键数据1", "关键数据2"],
  "participants": ["参与者1", "参与者2"]
}

分段总结数据：
${mergedData}`;

  const { text } = await generateText(prompt, { maxTokens: 3000 });

  let parsed: {
    topic?: string;
    conclusions?: string[];
    decisions?: Array<{ decision?: string; made_by?: string; reasoning?: string }>;
    action_items?: Array<{ assignee?: string; task?: string; deadline?: string | null; priority?: string; status?: string }>;
    discussion?: Array<{ topic?: string; summary?: string; participants?: string[]; key_points?: string[] }>;
    technical_details?: Array<{ category?: string; details?: string }>;
    next_steps?: string[];
    key_data?: string[];
    participants?: string[];
  };

  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    return {
      topic: "",
      conclusions: [],
      decisions: [],
      actionItems: [],
      discussion: [],
      technicalDetails: [],
      nextSteps: [],
      keyData: [],
      participants: [],
      rawMarkdown: text,
      editedMarkdown: null,
    };
  }

  const topic = parsed.topic || "";
  const conclusions = parsed.conclusions || [];
  const decisions = (parsed.decisions || []).map((d) => ({
    decision: d.decision || "",
    madeBy: d.made_by || "",
    reasoning: d.reasoning || "",
  }));
  const actionItems = (parsed.action_items || []).map((item) => ({
    assignee: item.assignee || "",
    task: item.task || "",
    deadline: item.deadline || null,
    priority: item.priority || "medium",
    status: item.status || "not_started",
    done: false,
  }));
  const discussion = (parsed.discussion || []).map((d) => ({
    topic: d.topic || "",
    summary: d.summary || "",
    participants: d.participants || [],
    keyPoints: d.key_points || [],
  }));
  const technicalDetails = (parsed.technical_details || []).map((td) => ({
    category: td.category || "",
    details: td.details || "",
  }));
  const nextSteps = parsed.next_steps || [];
  const keyData = parsed.key_data || [];
  const participants = parsed.participants || [];

  // Build rawMarkdown from structured data
  const lines: string[] = [];
  if (topic) lines.push(`# ${topic}`, "");

  if (conclusions.length > 0) {
    lines.push("## 结论", "");
    for (const c of conclusions) lines.push(`- ${c}`);
    lines.push("");
  }

  if (decisions.length > 0) {
    lines.push("## 决策", "");
    for (const d of decisions) {
      let line = `- **${d.decision}**`;
      if (d.madeBy) line += ` (${d.madeBy})`;
      if (d.reasoning) line += ` — ${d.reasoning}`;
      lines.push(line);
    }
    lines.push("");
  }

  if (actionItems.length > 0) {
    lines.push("## 待办事项", "");
    for (const item of actionItems) {
      const priorityTag = item.priority === "high" ? " 🔴" : item.priority === "low" ? " 🟢" : "";
      let line = `- [ ] ${item.task}${priorityTag}`;
      if (item.assignee) line += ` (@${item.assignee})`;
      if (item.deadline) line += ` [截止: ${item.deadline}]`;
      lines.push(line);
    }
    lines.push("");
  }

  if (discussion.length > 0) {
    lines.push("## 讨论要点", "");
    for (const d of discussion) {
      lines.push(`### ${d.topic}`, "");
      if (d.participants.length > 0) {
        lines.push(`**参与者:** ${d.participants.join("、")}`, "");
      }
      lines.push(d.summary, "");
      if (d.keyPoints.length > 0) {
        lines.push("**关键要点:**", "");
        for (const kp of d.keyPoints) lines.push(`- ${kp}`);
        lines.push("");
      }
    }
  }

  if (technicalDetails.length > 0) {
    lines.push("## 技术细节", "");
    for (const td of technicalDetails) {
      lines.push(`- **${td.category}**: ${td.details}`);
    }
    lines.push("");
  }

  if (nextSteps.length > 0) {
    lines.push("## 下一步", "");
    for (const step of nextSteps) lines.push(`- ${step}`);
    lines.push("");
  }

  if (keyData.length > 0) {
    lines.push("## 关键数据", "");
    for (const data of keyData) lines.push(`- ${data}`);
    lines.push("");
  }

  if (participants.length > 0) {
    lines.push("## 参与者", "");
    lines.push(participants.map((p) => `@${p}`).join("、"), "");
  }

  return {
    topic,
    conclusions,
    decisions,
    actionItems,
    discussion,
    technicalDetails,
    nextSteps,
    keyData,
    participants,
    rawMarkdown: lines.join("\n"),
    editedMarkdown: null,
  };
}

export async function generateMeetingSummary(
  transcriptText: string
): Promise<Summary> {
  const chunks = splitTranscript(transcriptText);

  if (chunks.length === 1) {
    // Short transcript: single-pass summary with enhanced prompt
    const chunkResult = await summarizeChunk(chunks[0], 0, 1);
    return mergeChunkSummaries([chunkResult]);
  }

  // Map phase: summarize each chunk independently
  const chunkSummaries = await Promise.all(
    chunks.map((chunk, i) => summarizeChunk(chunk, i, chunks.length))
  );

  // Reduce phase: merge all chunk summaries
  return mergeChunkSummaries(chunkSummaries);
}
