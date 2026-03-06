import { tauriFetch } from "./httpProxy";
import { useSettingsStore, parseModelRef } from "../stores/settingsStore";

const ASR_BASE_URL = "http://127.0.0.1:18090";

// Map provider keys to OpenAI-compatible chat/completions API endpoints
const LLM_ENDPOINTS: Record<string, string> = {
  ollama: "",  // Uses host + /api/generate
  openai: "https://api.openai.com/v1/chat/completions",
  deepseek: "https://api.deepseek.com/v1/chat/completions",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
  zhipu: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  moonshot: "https://api.moonshot.cn/v1/chat/completions",
  wenxin: "https://qianfan.baidubce.com/v2/chat/completions",
  hunyuan: "https://api.hunyuan.cloud.tencent.com/v1/chat/completions",
  minimax: "https://api.minimax.chat/v1/text/chatcompletion_v2",
  siliconflow: "https://api.siliconflow.cn/v1/chat/completions",
  volcengine: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
};

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

// Map provider keys to Cohere-compatible rerank API endpoints
const RERANK_ENDPOINTS: Record<string, string> = {
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1/rerank",
  siliconflow: "https://api.siliconflow.cn/v1/rerank",
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

  // Build rerank configuration from settings
  let rerankConfig: Record<string, unknown> | undefined;
  if (general.enableRerank) {
    const rerankRef = general.defaultRerankModel;
    if (rerankRef) {
      const { provider, model } = parseModelRef(rerankRef);
      const providerCfg = llmProviders[provider];
      const apiUrl = RERANK_ENDPOINTS[provider] ?? "";
      rerankConfig = {
        provider,
        model,
        api_key: providerCfg?.apiKey || null,
        api_url: apiUrl || null,
      };
    }
  }

  // Build LLM configuration for backend post-processing (ASR error correction)
  let llmConfig: Record<string, unknown> | undefined;
  const llmModelRef = general.defaultLLMModel;
  if (llmModelRef) {
    let llmProvider: string;
    let llmModel: string;
    if (llmModelRef.includes("/")) {
      const parsed = parseModelRef(llmModelRef);
      llmProvider = parsed.provider;
      llmModel = parsed.model;
    } else {
      llmProvider = general.defaultLLMProvider;
      llmModel = llmModelRef;
    }
    const llmProviderCfg = llmProviders[llmProvider];
    if (llmProviderCfg?.enabled) {
      const apiUrl = LLM_ENDPOINTS[llmProvider] ?? "";
      llmConfig = {
        provider: llmProvider,
        model: llmModel,
        api_key: llmProviderCfg.apiKey || null,
        api_url: apiUrl || null,
        host: llmProviderCfg.host || null,
      };
    }
  }

  // Build pipeline toggle configuration
  const pipelineConfig = {
    enable_hallucination_detection: general.enableHallucinationDetection,
    enable_itn: general.enableItn,
    enable_filler_filter: general.enableSpeechCleaning,
    enable_llm_correction: general.enableLlmCorrection,
    enable_segmentation: general.enableSegmentation,
    enable_punctuation: general.enablePunctuation,
    enable_diarization: general.enableDiarization,
    enable_embedding: general.enableDiarization, // Embedding depends on diarization
  };

  const { cacheDir, enableHfMirror, hfMirror } = general;
  const resp = await tauriFetch(`${ASR_BASE_URL}/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_data_dir: appDataDir,
      embedding_config: embeddingConfig,
      rerank_config: rerankConfig,
      llm_config: llmConfig,
      pipeline_config: pipelineConfig,
      cache_dir: cacheDir || "",
      hf_mirror: (enableHfMirror && hfMirror) || "",
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
