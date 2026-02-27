"""Tests for Qwen3-ASR engine adapter."""

from unittest.mock import MagicMock, patch
import pytest

from asr_service.engines.qwen3_engine import Qwen3Engine
from asr_service.engines.base import AudioInput
from asr_service.models.job import Segment


async def test_qwen3_engine_capabilities():
    engine = Qwen3Engine()
    caps = await engine.get_capabilities()
    assert caps.name == "qwen3"
    assert "zh" in caps.supported_languages
    assert caps.supports_streaming is True
    assert caps.supports_timestamps is False
    assert len(caps.model_sizes) >= 2


async def test_qwen3_engine_not_loaded_initially():
    engine = Qwen3Engine()
    assert engine.is_loaded() is False


async def test_qwen3_engine_transcribe_requires_loaded_model():
    engine = Qwen3Engine()
    audio = AudioInput(file_path="/tmp/test.wav")
    with pytest.raises(RuntimeError, match="Model not loaded"):
        await engine.transcribe(audio)


async def test_qwen3_engine_load_model():
    engine = Qwen3Engine()
    mock_model = MagicMock()

    with patch("asr_service.engines.qwen3_engine.Qwen3ASRModel") as MockQwenASR:
        MockQwenASR.from_pretrained.return_value = mock_model
        await engine.load_model("qwen3-asr-0.6B")

    assert engine.is_loaded() is True
    assert engine._model_size == "qwen3-asr-0.6B"


async def test_qwen3_engine_transcribe_with_mock():
    engine = Qwen3Engine()

    # Mock result objects with .text attribute
    mock_item = MagicMock()
    mock_item.text = "Hello world"
    mock_result = [mock_item]

    mock_model = MagicMock()
    mock_model.transcribe = MagicMock(return_value=mock_result)

    with patch("asr_service.engines.qwen3_engine.Qwen3ASRModel") as MockQwenASR:
        MockQwenASR.from_pretrained.return_value = mock_model
        await engine.load_model("qwen3-asr-0.6B")

    audio = AudioInput(file_path="/tmp/test.wav", language="zh")
    segments = await engine.transcribe(audio)

    assert len(segments) == 1
    assert segments[0].text == "Hello world"
    assert segments[0].start == 0.0
    assert segments[0].end == 0.0


async def test_qwen3_engine_unload():
    engine = Qwen3Engine()
    mock_model = MagicMock()

    with patch("asr_service.engines.qwen3_engine.Qwen3ASRModel") as MockQwenASR:
        MockQwenASR.from_pretrained.return_value = mock_model
        await engine.load_model("qwen3-asr-0.6B")

    assert engine.is_loaded() is True
    await engine.unload_model()
    assert engine.is_loaded() is False


async def test_qwen3_engine_invalid_model_size():
    engine = Qwen3Engine()
    with pytest.raises(ValueError, match="Unsupported model size"):
        await engine.load_model("invalid-size")


async def test_qwen3_engine_model_map():
    """Verify MODEL_MAP has correct HuggingFace model IDs."""
    from asr_service.engines.qwen3_engine import MODEL_MAP
    assert MODEL_MAP["qwen3-asr-0.6B"] == "Qwen/Qwen3-ASR-0.6B"
    assert MODEL_MAP["qwen3-asr-1.7B"] == "Qwen/Qwen3-ASR-1.7B"


async def test_qwen3_engine_get_model_path_invalid_size():
    engine = Qwen3Engine()
    assert engine.get_model_path("nonexistent") is None


async def test_qwen3_engine_get_model_path_not_downloaded():
    engine = Qwen3Engine()
    # In test environment, model is not downloaded
    result = engine.get_model_path("qwen3-asr-0.6B")
    assert result is None
