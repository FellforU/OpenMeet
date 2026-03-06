"""Text embedding supporting local (sentence-transformers) and remote (OpenAI-compatible) backends."""

import asyncio
import logging

import numpy as np

logger = logging.getLogger(__name__)


class Embedder:
    """Wrapper for text embedding with local and remote API support."""

    DEFAULT_MODEL = "BAAI/bge-small-zh-v1.5"
    DIMENSION = 512

    def __init__(self):
        self._model = None
        self._provider = "local"
        self._model_name = self.DEFAULT_MODEL
        self._api_key: str | None = None
        self._api_url: str | None = None
        self._actual_dimension: int | None = None

    def configure(
        self,
        provider: str = "local",
        model_name: str = "",
        api_key: str | None = None,
        api_url: str | None = None,
    ) -> None:
        """Configure embedding backend from frontend settings."""
        new_provider = provider or "local"
        new_model = model_name or self.DEFAULT_MODEL

        # Only reload if configuration actually changed
        if (
            new_provider != self._provider
            or new_model != self._model_name
            or api_key != self._api_key
            or api_url != self._api_url
        ):
            self._provider = new_provider
            self._model_name = new_model
            self._api_key = api_key
            self._api_url = api_url
            self._model = None  # Force reload on next use
            self._actual_dimension = None  # Reset cached dimension
            logger.info(
                "Embedder configured: provider=%s, model=%s",
                self._provider,
                self._model_name,
            )

    def is_loaded(self) -> bool:
        return self._model is not None

    async def load(self) -> None:
        """Load the local embedding model. Downloads on first use."""
        if self._model is not None:
            return

        if self._provider != "local":
            return  # Remote API doesn't need local model

        model_name = self._model_name

        def _load():
            from sentence_transformers import SentenceTransformer

            return SentenceTransformer(model_name)

        self._model = await asyncio.to_thread(_load)

    async def unload(self) -> None:
        self._model = None

    async def embed(self, texts: list[str]) -> np.ndarray:
        """Embed a list of texts. Returns (N, DIMENSION) array."""
        if self._provider == "local":
            return await self._embed_local(texts)
        return await self._embed_remote(texts)

    async def embed_query(self, query: str) -> np.ndarray:
        """Embed a single query. Returns (DIMENSION,) array."""
        result = await self.embed([query])
        return result[0]

    async def get_dimension(self) -> int:
        """Get the actual embedding dimension by probing the model.

        Caches the result until configuration changes.
        """
        if self._actual_dimension is not None:
            return self._actual_dimension

        try:
            probe = await self.embed(["dimension probe"])
            self._actual_dimension = probe.shape[1]
            logger.info(
                "Detected embedding dimension: %d (model=%s)",
                self._actual_dimension,
                self._model_name,
            )
        except Exception:
            logger.warning(
                "Failed to probe embedding dimension, using default %d",
                self.DIMENSION,
            )
            self._actual_dimension = self.DIMENSION

        return self._actual_dimension

    async def _embed_local(self, texts: list[str]) -> np.ndarray:
        """Embed using local sentence-transformers model."""
        if self._model is None:
            await self.load()

        model = self._model

        def _encode():
            return model.encode(texts, normalize_embeddings=True)

        return await asyncio.to_thread(_encode)

    # Provider-specific configuration for embedding API calls.
    # - default_url: fallback when api_url is not configured
    # - extra_payload: additional fields merged into request body
    # - batch_size: max texts per API call (avoids provider batch limits)
    # Providers not listed here use OpenAI-compatible defaults.
    _PROVIDER_CONFIG: dict[str, dict] = {
        "ollama": {
            "default_url": "http://localhost:11434/api/embed",
            "batch_size": 32,
        },
        "qwen": {
            # DashScope text-embedding-v3 requires dimensions; v2 ignores it.
            # Batch limit: 6 texts per request for compatible-mode API.
            "extra_payload": {"dimensions": 1024, "encoding_format": "float"},
            "batch_size": 6,
        },
        "zhipu": {
            "extra_payload": {"dimensions": 1024},
            "batch_size": 16,
        },
        "openai": {"batch_size": 100},
        "deepseek": {"batch_size": 16},
        "siliconflow": {"batch_size": 32},
        "volcengine": {"batch_size": 16},
    }

    # Default batch size for providers not in _PROVIDER_CONFIG
    _DEFAULT_BATCH_SIZE = 16

    def _build_embed_request(
        self, texts: list[str]
    ) -> tuple[str, dict[str, str], dict]:
        """Build (url, headers, payload) for the embedding API call.

        Adapts request format based on provider configuration.
        """
        cfg = self._PROVIDER_CONFIG.get(self._provider, {})

        # URL: prefer configured api_url, then provider default, then OpenAI
        url = (
            self._api_url
            or cfg.get("default_url")
            or "https://api.openai.com/v1/embeddings"
        )

        # Headers
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        # Payload: base + provider-specific extra fields
        payload: dict = {"model": self._model_name, "input": texts}
        extra = cfg.get("extra_payload")
        if extra:
            payload.update(extra)

        return url, headers, payload

    def _get_batch_size(self) -> int:
        """Return max texts per API call for the current provider."""
        cfg = self._PROVIDER_CONFIG.get(self._provider, {})
        return cfg.get("batch_size", self._DEFAULT_BATCH_SIZE)

    async def _embed_remote(self, texts: list[str]) -> np.ndarray:
        """Embed using remote embedding API with automatic batching.

        Supports Ollama, OpenAI-compatible, and provider-specific formats.
        Splits large input into batches per provider limits.
        """
        import httpx

        batch_size = self._get_batch_size()

        # Split into batches
        if len(texts) <= batch_size:
            batches = [texts]
        else:
            batches = [
                texts[i:i + batch_size]
                for i in range(0, len(texts), batch_size)
            ]
            logger.info(
                "Splitting %d texts into %d batches (batch_size=%d, provider=%s)",
                len(texts), len(batches), batch_size, self._provider,
            )

        all_embeddings: list[np.ndarray] = []

        async with httpx.AsyncClient(timeout=60.0) as client:
            for batch_idx, batch in enumerate(batches):
                url, headers, payload = self._build_embed_request(batch)

                resp = await client.post(url, json=payload, headers=headers)
                if resp.status_code != 200:
                    logger.warning(
                        "Embedding API error: status=%d, provider=%s, model=%s, "
                        "url=%s, batch=%d/%d, texts=%d, response=%s",
                        resp.status_code, self._provider, self._model_name,
                        url, batch_idx + 1, len(batches), len(batch),
                        resp.text[:500],
                    )
                resp.raise_for_status()
                data = resp.json()

                # Ollama format: {"embeddings": [[...]]}
                if self._provider == "ollama" and "embeddings" in data:
                    all_embeddings.append(np.array(data["embeddings"]))
                    continue

                # OpenAI-compatible format: {"data": [{"embedding": [...]}]}
                if "data" in data:
                    all_embeddings.append(
                        np.array([d["embedding"] for d in data["data"]])
                    )
                    continue

                raise ValueError(
                    f"Unexpected embedding response from {self._provider}: "
                    f"{list(data.keys())}"
                )

        return np.vstack(all_embeddings) if len(all_embeddings) > 1 else all_embeddings[0]
