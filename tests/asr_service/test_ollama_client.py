"""Tests for the Ollama HTTP client."""

from unittest.mock import AsyncMock, patch, MagicMock

import httpx
import pytest

from asr_service.services.ollama_client import OllamaClient, DEFAULT_HOST, DEFAULT_MODEL


@pytest.fixture
def client():
    return OllamaClient()


def test_default_host():
    c = OllamaClient()
    assert c.host == DEFAULT_HOST


def test_custom_host():
    c = OllamaClient(host="http://myhost:5000/")
    assert c.host == "http://myhost:5000"


@pytest.mark.asyncio
async def test_is_available_returns_true(client):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    with patch.object(client._client, "get", new_callable=AsyncMock, return_value=mock_resp):
        result = await client.is_available()
    assert result is True


@pytest.mark.asyncio
async def test_is_available_returns_false_on_error(client):
    with patch.object(client._client, "get", side_effect=httpx.ConnectError("refused")):
        result = await client.is_available()
    assert result is False


@pytest.mark.asyncio
async def test_list_models_success(client):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "models": [
            {"name": "qwen2.5:7b", "size": 4000000000},
            {"name": "mistral:7b", "size": 3800000000},
        ]
    }
    with patch.object(client._client, "get", new_callable=AsyncMock, return_value=mock_resp):
        models = await client.list_models()
    assert len(models) == 2
    assert models[0]["name"] == "qwen2.5:7b"


@pytest.mark.asyncio
async def test_list_models_returns_empty_on_error(client):
    with patch.object(client._client, "get", side_effect=httpx.ConnectError("refused")):
        models = await client.list_models()
    assert models == []


@pytest.mark.asyncio
async def test_generate_sends_correct_payload(client):
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {"response": "This is a summary."}

    with patch.object(client._client, "post", new_callable=AsyncMock, return_value=mock_resp) as mock_post:
        result = await client.generate("Summarize this", system="You are helpful")

    assert result == "This is a summary."
    call_args = mock_post.call_args
    payload = call_args.kwargs.get("json") or call_args[1].get("json")
    assert payload["model"] == DEFAULT_MODEL
    assert payload["prompt"] == "Summarize this"
    assert payload["system"] == "You are helpful"
    assert payload["stream"] is False


@pytest.mark.asyncio
async def test_generate_without_system(client):
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {"response": "ok"}

    with patch.object(client._client, "post", new_callable=AsyncMock, return_value=mock_resp) as mock_post:
        await client.generate("Hello")

    payload = mock_post.call_args.kwargs.get("json") or mock_post.call_args[1].get("json")
    assert "system" not in payload


@pytest.mark.asyncio
async def test_close(client):
    with patch.object(client._client, "aclose", new_callable=AsyncMock) as mock_close:
        await client.close()
    mock_close.assert_called_once()
