"""Tests for the OpenAI Whisper API engine adapter."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from asr_service.engines.openai_api_engine import OpenAIWhisperEngine
from asr_service.engines.base import AudioInput


@pytest.fixture
def engine():
    return OpenAIWhisperEngine()


def test_capabilities(engine):
    import asyncio
    caps = asyncio.get_event_loop().run_until_complete(engine.get_capabilities())
    assert caps.name == "openai-whisper"
    assert "en" in caps.supported_languages
    assert "zh" in caps.supported_languages
    assert caps.model_sizes == ["whisper-1"]


def test_not_loaded_without_api_key(engine):
    assert not engine.is_loaded()


def test_is_loaded_with_api_key(engine):
    engine._api_key = "sk-test-key"
    assert engine.is_loaded()


@pytest.mark.asyncio
async def test_load_model_sets_api_key(engine):
    with patch.dict("os.environ", {"OPENAI_API_KEY": "sk-test-123"}):
        await engine.load_model("whisper-1")
    assert engine._api_key == "sk-test-123"


@pytest.mark.asyncio
async def test_load_model_raises_without_key(engine):
    with patch.dict("os.environ", {}, clear=True):
        # Remove the key if it exists
        import os
        os.environ.pop("OPENAI_API_KEY", None)
        with pytest.raises(ValueError, match="OPENAI_API_KEY"):
            await engine.load_model("whisper-1")


@pytest.mark.asyncio
async def test_unload_model(engine):
    engine._api_key = "sk-test"
    await engine.unload_model()
    assert engine._api_key is None


@pytest.mark.asyncio
async def test_transcribe_calls_openai_api(engine, tmp_path):
    engine._api_key = "sk-test-key"

    # Create a dummy wav file
    wav_file = tmp_path / "test.wav"
    wav_file.write_bytes(b"\x00" * 100)

    mock_segment = MagicMock()
    mock_segment.start = 0.0
    mock_segment.end = 5.0
    mock_segment.text = "Hello world"
    mock_segment.avg_logprob = -0.3

    mock_response = MagicMock()
    mock_response.segments = [mock_segment]

    mock_client = MagicMock()
    mock_client.audio = MagicMock()
    mock_client.audio.transcriptions = MagicMock()
    mock_client.audio.transcriptions.create = MagicMock(return_value=mock_response)

    with patch("asr_service.engines.openai_api_engine._create_openai_client", return_value=mock_client):
        audio = AudioInput(file_path=str(wav_file), language="en")
        segments = await engine.transcribe(audio)

    assert len(segments) == 1
    assert segments[0].text == "Hello world"
    assert segments[0].start == 0.0
    assert segments[0].end == 5.0


@pytest.mark.asyncio
async def test_transcribe_requires_api_key(engine):
    audio = AudioInput(file_path="/tmp/test.wav")
    with pytest.raises(RuntimeError, match="API key"):
        await engine.transcribe(audio)
