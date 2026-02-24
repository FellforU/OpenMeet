import pytest

from asr_service.engines.whisper_engine import WhisperEngine
from asr_service.engines.base import AudioInput


async def test_whisper_engine_capabilities():
    engine = WhisperEngine()
    caps = await engine.get_capabilities()
    assert caps.name == "whisper"
    assert "en" in caps.supported_languages
    assert "zh" in caps.supported_languages
    assert caps.supports_timestamps is True
    assert "base" in caps.model_sizes


async def test_whisper_engine_not_loaded_initially():
    engine = WhisperEngine()
    assert engine.is_loaded() is False


async def test_whisper_engine_transcribe_requires_loaded_model():
    engine = WhisperEngine()
    audio = AudioInput(file_path="test.wav")
    with pytest.raises(RuntimeError, match="Model not loaded"):
        await engine.transcribe(audio)
