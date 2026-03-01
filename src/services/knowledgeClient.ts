import { tauriFetch } from "./httpProxy";
import { useSettingsStore, parseModelRef } from "../stores/settingsStore";

const ASR_BASE_URL = "http://127.0.0.1:18090";

// Map provider keys to OpenAI-compatible embedding API endpoints
const EMBEDDING_ENDPOINTS: Record<string, string> = {
  ollama: "", // Uses host + /api/embed
  openai: "https://api.openai.com/v1/embeddings",
  deepseek: "https://api.deepseek.com/v1/embeddings",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings",
  zhipu: "https://open.bigmodel.cn/api/paas/v4/embeddings",
  wenxin: "https://qianfan.baidubce.com/v2/embeddings",
  hunyuan: "https://api.hunyuan.cloud.tencent.com/v1/embeddings",
  siliconflow: "https://api.siliconflow.cn/v1/embeddings",
  volcengine: "https://ark.cn-beijing.volces.com/api/v3/embeddings",
};

export async function configureKnowledge(
  appDataDir: string
): Promise<{ status: string; sqlite_path: string | null; lance_path: string | null }> {
  const { general, llmProviders } = useSettingsStore.getState();

  // Build embedding configuration from settings
  let embeddingConfig: Record<string, unknown> | undefined;
  const embeddingRef = general.defaultEmbeddingModel;
  if (embeddingRef) {
    const { provider, model } = parseModelRef(embeddingRef);
    const providerCfg = llmProviders[provider];
    let apiUrl = EMBEDDING_ENDPOINTS[provider] ?? "";
    // Ollama: use configured host for embedding
    if (provider === "ollama" && providerCfg?.host) {
      apiUrl = `${providerCfg.host}/api/embed`;
    }
    embeddingConfig = {
      provider,
      model,
      api_key: providerCfg?.apiKey || null,
      api_url: apiUrl || null,
    };
  }

  const { modelCacheDir, hfMirror } = general;
  const resp = await tauriFetch(`${ASR_BASE_URL}/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_data_dir: appDataDir,
      embedding_config: embeddingConfig,
      model_cache_dir: modelCacheDir || "",
      hf_mirror: hfMirror || "",
    }),
  });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`Config failed: HTTP ${resp.status}`);
  }
  return JSON.parse(resp.body);
}

export async function indexProject(
  projectId: string
): Promise<{ project_id: string; chunks_indexed: number }> {
  const resp = await tauriFetch(`${ASR_BASE_URL}/index/project/${projectId}`, {
    method: "POST",
  });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`Index failed: HTTP ${resp.status}`);
  }
  return JSON.parse(resp.body);
}

export async function indexAll(): Promise<{
  projects: Record<string, number>;
  total_chunks: number;
}> {
  const resp = await tauriFetch(`${ASR_BASE_URL}/index/all`, {
    method: "POST",
  });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`Index all failed: HTTP ${resp.status}`);
  }
  return JSON.parse(resp.body);
}
