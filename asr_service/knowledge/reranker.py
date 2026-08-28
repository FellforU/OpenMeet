"""Cohere-compatible rerank API client."""

import logging
from typing import Optional
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

# Provider endpoint mapping
RERANK_ENDPOINTS: dict[str, str] = {
    "qwen": "https://dashscope.aliyuncs.com/compatible-mode/v1/rerank",
    "siliconflow": "https://api.siliconflow.cn/v1/rerank",
}


class Reranker:
    """Rerank API client supporting Cohere-compatible endpoints."""

    def __init__(self) -> None:
        self._provider: Optional[str] = None
        self._model_name: Optional[str] = None
        self._api_key: Optional[str] = None
        self._api_url: Optional[str] = None

    def configure(
        self,
        provider: str,
        model_name: str,
        api_key: Optional[str] = None,
        api_url: Optional[str] = None,
    ) -> None:
        """Configure the reranker with provider credentials."""
        self._provider = provider
        self._model_name = model_name
        self._api_key = api_key
        # Use explicit api_url or fall back to known endpoint, validate URL
        url = api_url or RERANK_ENDPOINTS.get(provider, "")
        if url:
            parsed = urlparse(url)
            if not parsed.scheme or not parsed.netloc:
                logger.warning("Invalid rerank URL: %s", url)
                url = ""
        self._api_url = url
        logger.info("Reranker configured: provider=%s model=%s", provider, model_name)

    def is_configured(self) -> bool:
        """Check if the reranker has been configured with valid settings."""
        return bool(self._api_url and self._model_name and self._api_key)

    async def rerank(
        self,
        query: str,
        documents: list[str],
        top_k: int = 5,
    ) -> list[dict]:
        """Rerank documents by relevance to query.

        Returns sorted list of {"index": int, "relevance_score": float}.
        """
        if not self.is_configured():
            logger.warning("Reranker not configured, returning original order")
            return [{"index": i, "relevance_score": 0.0} for i in range(min(top_k, len(documents)))]

        if not documents:
            return []

        payload = {
            "model": self._model_name,
            "query": query,
            "documents": documents,
            "top_n": top_k,
        }

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self._api_key}",
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(self._api_url, json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()

            results = data.get("results", [])
            return [
                {
                    "index": r["index"],
                    "relevance_score": r.get("relevance_score", 0.0),
                }
                for r in results
            ]
        except Exception as e:
            logger.error("Rerank API call failed: %s", e)
            # Fallback: return original order
            return [{"index": i, "relevance_score": 0.0} for i in range(min(top_k, len(documents)))]
