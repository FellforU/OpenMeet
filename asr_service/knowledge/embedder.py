"""Text embedding using BGE-small-zh-v1.5 model."""

import asyncio

import numpy as np


class Embedder:
    """Wrapper around sentence-transformers for text embedding."""

    MODEL_NAME = "BAAI/bge-small-zh-v1.5"
    DIMENSION = 512

    def __init__(self):
        self._model = None

    def is_loaded(self) -> bool:
        return self._model is not None

    async def load(self) -> None:
        """Load the embedding model. Downloads on first use."""
        if self._model is not None:
            return

        def _load():
            from sentence_transformers import SentenceTransformer

            return SentenceTransformer(self.MODEL_NAME)

        self._model = await asyncio.to_thread(_load)

    async def unload(self) -> None:
        self._model = None

    async def embed(self, texts: list[str]) -> np.ndarray:
        """Embed a list of texts. Returns (N, DIMENSION) array."""
        if self._model is None:
            await self.load()

        model = self._model

        def _encode():
            return model.encode(texts, normalize_embeddings=True)

        return await asyncio.to_thread(_encode)

    async def embed_query(self, query: str) -> np.ndarray:
        """Embed a single query. Returns (DIMENSION,) array."""
        result = await self.embed([query])
        return result[0]
