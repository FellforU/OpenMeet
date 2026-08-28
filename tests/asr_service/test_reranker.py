"""Tests for the Reranker module."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from asr_service.knowledge.reranker import Reranker


@pytest.fixture
def reranker():
    return Reranker()


@pytest.fixture
def configured_reranker():
    r = Reranker()
    r.configure(
        provider="qwen",
        model_name="gte-rerank",
        api_key="test-key",
        api_url="https://dashscope.aliyuncs.com/compatible-mode/v1/rerank",
    )
    return r


def test_initial_state(reranker):
    assert not reranker.is_configured()


def test_configure(reranker):
    reranker.configure(
        provider="qwen",
        model_name="gte-rerank",
        api_key="test-key",
    )
    assert reranker.is_configured()
    assert reranker._provider == "qwen"
    assert reranker._model_name == "gte-rerank"
    assert reranker._api_key == "test-key"
    # Should use known endpoint for qwen
    assert "dashscope" in reranker._api_url


def test_configure_with_custom_url(reranker):
    reranker.configure(
        provider="custom",
        model_name="my-model",
        api_key="key",
        api_url="https://custom.example.com/rerank",
    )
    assert reranker.is_configured()
    assert reranker._api_url == "https://custom.example.com/rerank"


def test_configure_without_key_not_configured(reranker):
    reranker.configure(provider="qwen", model_name="gte-rerank")
    assert not reranker.is_configured()


def test_configure_unknown_provider_without_url(reranker):
    reranker.configure(provider="unknown", model_name="model", api_key="key")
    # No known endpoint and no api_url → not configured
    assert not reranker.is_configured()


@pytest.mark.asyncio
async def test_rerank_not_configured(reranker):
    results = await reranker.rerank("query", ["doc1", "doc2"], top_k=2)
    assert len(results) == 2
    assert results[0]["index"] == 0
    assert results[1]["index"] == 1


@pytest.mark.asyncio
async def test_rerank_empty_documents(configured_reranker):
    results = await configured_reranker.rerank("query", [], top_k=5)
    assert results == []


@pytest.mark.asyncio
async def test_rerank_success(configured_reranker):
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {
        "results": [
            {"index": 1, "relevance_score": 0.95},
            {"index": 0, "relevance_score": 0.80},
        ]
    }

    with patch("asr_service.knowledge.reranker.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client_cls.return_value = mock_client

        results = await configured_reranker.rerank("query", ["doc A", "doc B"], top_k=2)

    assert len(results) == 2
    assert results[0]["index"] == 1
    assert results[0]["relevance_score"] == 0.95
    assert results[1]["index"] == 0


@pytest.mark.asyncio
async def test_rerank_api_error_fallback(configured_reranker):
    with patch("asr_service.knowledge.reranker.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(side_effect=Exception("Connection error"))
        mock_client_cls.return_value = mock_client

        results = await configured_reranker.rerank("query", ["d1", "d2", "d3"], top_k=2)

    # Should fallback to original order, limited by top_k
    assert len(results) == 2
    assert results[0]["index"] == 0
    assert results[1]["index"] == 1
