"""Tests for the Embedder module."""

import pytest
import numpy as np
from unittest.mock import MagicMock, patch

from asr_service.knowledge.embedder import Embedder


@pytest.fixture
def embedder():
    return Embedder()


def test_initial_state(embedder):
    assert not embedder.is_loaded()


@pytest.mark.asyncio
async def test_load_and_unload(embedder):
    with patch("asr_service.knowledge.embedder.asyncio.to_thread") as mock_thread:
        mock_model = MagicMock()
        mock_thread.return_value = mock_model

        await embedder.load()
        assert embedder.is_loaded()

        await embedder.unload()
        assert not embedder.is_loaded()


@pytest.mark.asyncio
async def test_embed_returns_correct_shape(embedder):
    mock_model = MagicMock()
    mock_model.encode.return_value = np.random.rand(3, 512).astype(np.float32)
    embedder._model = mock_model

    result = await embedder.embed(["hello", "world", "test"])
    assert result.shape == (3, 512)
    mock_model.encode.assert_called_once()


@pytest.mark.asyncio
async def test_embed_query_returns_1d(embedder):
    mock_model = MagicMock()
    mock_model.encode.return_value = np.random.rand(1, 512).astype(np.float32)
    embedder._model = mock_model

    result = await embedder.embed_query("test query")
    assert result.shape == (512,)


@pytest.mark.asyncio
async def test_embed_auto_loads(embedder):
    with patch("asr_service.knowledge.embedder.asyncio.to_thread") as mock_thread:
        mock_model = MagicMock()
        mock_model.encode.return_value = np.random.rand(1, 512).astype(np.float32)
        mock_thread.side_effect = [mock_model, mock_model.encode.return_value]

        result = await embedder.embed(["test"])
        assert embedder.is_loaded()
