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

    async def _embed_remote(self, texts: list[str]) -> np.ndarray:
        """Embed using OpenAI-compatible embedding API."""
        import httpx

        # Determine API URL based on provider
        if self._api_url:
            url = self._api_url
        elif self._provider == "ollama":
            url = "http://localhost:11434/api/embed"
        else:
            url = "https://api.openai.com/v1/embeddings"

        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        payload = {"model": self._model_name, "input": texts}

        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()

            # Handle Ollama response format
            if self._provider == "ollama" and "embeddings" in data:
                return np.array(data["embeddings"])

            # OpenAI-compatible format
            if "data" in data:
                return np.array([d["embedding"] for d in data["data"]])

            raise ValueError(f"Unexpected embedding API response format: {list(data.keys())}")
