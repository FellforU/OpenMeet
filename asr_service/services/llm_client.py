"""Provider-aware LLM client supporting OpenAI-compatible and Ollama APIs.

Used by post-processing pipeline for ASR error correction.
Configuration is injected from frontend via /config endpoint.
"""

import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# Default timeout for LLM API calls (seconds).
# 云端模型（尤其带思考模式的）生成几千 token 可能超过 2 分钟
_DEFAULT_TIMEOUT = 300.0


# Provider-specific chat completion endpoints
_PROVIDER_ENDPOINTS: dict[str, str] = {
    "ollama": "",  # Uses host + /api/generate
    "openai": "https://api.openai.com/v1/chat/completions",
    "deepseek": "https://api.deepseek.com/v1/chat/completions",
    "qwen": "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    "zhipu": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    "moonshot": "https://api.moonshot.cn/v1/chat/completions",
    "wenxin": "https://qianfan.baidubce.com/v2/chat/completions",
    "hunyuan": "https://api.hunyuan.cloud.tencent.com/v1/chat/completions",
    "minimax": "https://api.minimax.chat/v1/text/chatcompletion_v2",
    "siliconflow": "https://api.siliconflow.cn/v1/chat/completions",
    "volcengine": "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
}


class LLMClient:
    """Provider-aware LLM client for text generation."""

    def __init__(self):
        self._provider: str = ""
        self._model: str = ""
        self._api_key: Optional[str] = None
        self._api_url: Optional[str] = None
        self._host: Optional[str] = None  # Ollama host

    def configure(
        self,
        provider: str,
        model: str,
        api_key: Optional[str] = None,
        api_url: Optional[str] = None,
        host: Optional[str] = None,
    ) -> None:
        """Configure LLM backend from frontend settings."""
        self._provider = provider
        self._model = model
        self._api_key = api_key
        self._api_url = api_url
        self._host = host
        logger.info(
            "LLMClient configured: provider=%s, model=%s",
            provider, model,
        )

    def is_configured(self) -> bool:
        return bool(self._provider and self._model)

    async def generate(
        self,
        prompt: str,
        max_tokens: int = 4000,
        temperature: float = 0.3,
    ) -> str:
        """Generate text using configured LLM provider.

        Returns the generated text string.
        Raises on API errors.
        """
        if not self.is_configured():
            raise RuntimeError("LLMClient not configured")

        if self._provider == "ollama":
            return await self._generate_ollama(prompt)
        return await self._generate_openai_compatible(
            prompt, max_tokens, temperature,
        )

    async def _generate_ollama(self, prompt: str) -> str:
        """Call Ollama /api/generate endpoint."""
        host = self._host or self._api_url or "http://localhost:11434"
        host = host.rstrip("/")
        url = f"{host}/api/generate"

        async with httpx.AsyncClient(timeout=_DEFAULT_TIMEOUT) as client:
            resp = await client.post(url, json={
                "model": self._model,
                "prompt": prompt,
                "stream": False,
            })
            if resp.status_code != 200:
                logger.warning(
                    "Ollama error: status=%d, url=%s, response=%s",
                    resp.status_code, url, resp.text[:500],
                )
            resp.raise_for_status()
            return resp.json().get("response", "")

    async def _generate_openai_compatible(
        self,
        prompt: str,
        max_tokens: int,
        temperature: float,
    ) -> str:
        """Call OpenAI-compatible chat/completions endpoint."""
        url = (
            self._api_url
            or _PROVIDER_ENDPOINTS.get(self._provider, "")
        )
        if not url:
            raise RuntimeError(
                f"No endpoint configured for provider: {self._provider}"
            )

        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        payload = {
            "model": self._model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "temperature": temperature,
        }

        async with httpx.AsyncClient(timeout=_DEFAULT_TIMEOUT) as client:
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code != 200:
                logger.warning(
                    "LLM API error: status=%d, provider=%s, model=%s, "
                    "url=%s, response=%s",
                    resp.status_code, self._provider, self._model,
                    url, resp.text[:500],
                )
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]
