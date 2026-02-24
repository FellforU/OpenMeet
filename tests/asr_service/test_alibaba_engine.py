"""Tests for the Alibaba Cloud ASR engine adapter."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from asr_service.engines.alibaba_asr_engine import AlibabaASREngine
from asr_service.engines.base import AudioInput


@pytest.fixture
def engine():
    return AlibabaASREngine()


def test_capabilities(engine):
    import asyncio
    caps = asyncio.get_event_loop().run_until_complete(engine.get_capabilities())
    assert caps.name == "alibaba-asr"
    assert "zh" in caps.supported_languages
    assert caps.model_sizes == ["paraformer-v2"]


def test_not_loaded_without_credentials(engine):
    assert not engine.is_loaded()


def test_is_loaded_with_credentials(engine):
    engine._access_key_id = "test-id"
    engine._access_key_secret = "test-secret"
    assert engine.is_loaded()


@pytest.mark.asyncio
async def test_load_model_from_env(engine):
    with patch.dict("os.environ", {
        "ALIBABA_ACCESS_KEY_ID": "ak-id",
        "ALIBABA_ACCESS_KEY_SECRET": "ak-secret",
    }):
        await engine.load_model("paraformer-v2")
    assert engine._access_key_id == "ak-id"
    assert engine._access_key_secret == "ak-secret"


@pytest.mark.asyncio
async def test_load_model_raises_without_credentials(engine):
    with patch.dict("os.environ", {}, clear=True):
        import os
        os.environ.pop("ALIBABA_ACCESS_KEY_ID", None)
        os.environ.pop("ALIBABA_ACCESS_KEY_SECRET", None)
        with pytest.raises(ValueError, match="ALIBABA_ACCESS_KEY"):
            await engine.load_model("paraformer-v2")


@pytest.mark.asyncio
async def test_unload_model(engine):
    engine._access_key_id = "id"
    engine._access_key_secret = "secret"
    await engine.unload_model()
    assert engine._access_key_id is None


@pytest.mark.asyncio
async def test_transcribe_calls_api(engine):
    engine._access_key_id = "test-id"
    engine._access_key_secret = "test-secret"

    mock_response = {
        "output": {
            "sentence": [
                {"begin_time": 0, "end_time": 5000, "text": "你好世界"},
                {"begin_time": 5000, "end_time": 10000, "text": "测试一下"},
            ]
        }
    }

    with patch("asr_service.engines.alibaba_asr_engine.AlibabaASREngine._call_api",
               new_callable=AsyncMock, return_value=mock_response):
        audio = AudioInput(file_path="/tmp/test.wav", language="zh")
        segments = await engine.transcribe(audio)

    assert len(segments) == 2
    assert segments[0].text == "你好世界"
    assert segments[0].start == 0.0
    assert segments[0].end == 5.0
    assert segments[1].text == "测试一下"


@pytest.mark.asyncio
async def test_transcribe_requires_credentials(engine):
    audio = AudioInput(file_path="/tmp/test.wav")
    with pytest.raises(RuntimeError, match="credentials"):
        await engine.transcribe(audio)
