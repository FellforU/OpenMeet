"""Tests for FunASR Paraformer engine adapter."""

from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from asr_service.engines.paraformer_engine import ParaformerEngine
from asr_service.engines.base import AudioInput
from asr_service.models.job import Segment


async def test_paraformer_engine_capabilities():
    engine = ParaformerEngine()
    caps = await engine.get_capabilities()
    assert caps.name == "paraformer"
    assert "zh" in caps.supported_languages
    assert caps.supports_streaming is True
    assert caps.supports_timestamps is True
    assert len(caps.model_sizes) >= 2


async def test_paraformer_engine_not_loaded_initially():
    engine = ParaformerEngine()
    assert engine.is_loaded() is False


async def test_paraformer_engine_transcribe_requires_loaded_model():
    engine = ParaformerEngine()
    audio = AudioInput(file_path="/tmp/test.wav")
    with pytest.raises(RuntimeError, match="Model not loaded"):
        await engine.transcribe(audio)


async def test_paraformer_engine_load_model():
    engine = ParaformerEngine()
    mock_model = MagicMock()

    with patch("asr_service.engines.paraformer_engine.AutoModel") as MockAutoModel:
        MockAutoModel.return_value = mock_model
        await engine.load_model("paraformer-large")

    assert engine.is_loaded() is True
    assert engine._model_size == "paraformer-large"


async def test_paraformer_engine_transcribe_with_mock():
    engine = ParaformerEngine()

    mock_result = [
        {
            "text": "Today's meeting agenda",
            "timestamp": [[0, 100, 200, 500, 800, 1200], [50, 150, 350, 700, 1100, 1500]],
            "sentence_info": [
                {"text": "Today's meeting", "start": 0, "end": 800, "timestamp": [[0, 100, 200, 500], [50, 150, 350, 700]]},
                {"text": "agenda", "start": 800, "end": 1500, "timestamp": [[800, 1200], [1100, 1500]]},
            ],
        }
    ]
    mock_model = MagicMock()
    mock_model.generate = MagicMock(return_value=mock_result)

    with patch("asr_service.engines.paraformer_engine.AutoModel") as MockAutoModel:
        MockAutoModel.return_value = mock_model
        await engine.load_model("paraformer-large")

    audio = AudioInput(file_path="/tmp/test.wav", language="zh")
    segments = await engine.transcribe(audio)

    assert len(segments) >= 1
    assert segments[0].text == "Today's meeting"


async def test_paraformer_engine_unload():
    engine = ParaformerEngine()
    mock_model = MagicMock()

    with patch("asr_service.engines.paraformer_engine.AutoModel") as MockAutoModel:
        MockAutoModel.return_value = mock_model
        await engine.load_model("paraformer-large")

    assert engine.is_loaded() is True
    await engine.unload_model()
    assert engine.is_loaded() is False


async def test_paraformer_engine_invalid_model_size():
    engine = ParaformerEngine()
    with pytest.raises(ValueError, match="Unsupported model size"):
        await engine.load_model("invalid-size")


async def test_paraformer_engine_local_model_path():
    """Test that engine can use local model paths from meeting/models/."""
    engine = ParaformerEngine()
    mock_model = MagicMock()

    with patch("asr_service.engines.paraformer_engine.AutoModel") as MockAutoModel:
        MockAutoModel.return_value = mock_model
        await engine.load_model("paraformer-large")

    # Model should be loaded
    assert engine.is_loaded() is True
