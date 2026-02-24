"""Tests for speaker diarization processors."""

from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from asr_service.models.job import Segment
from asr_service.processors.diarization.factory import create_diarizer
from asr_service.processors.diarization.campplus import CAMPPlusDiarizer, _build_speaker_map
from asr_service.processors.diarization.pyannote_diarizer import PyAnnoteDiarizer


def test_factory_chinese_returns_campplus():
    d = create_diarizer("zh")
    assert isinstance(d, CAMPPlusDiarizer)


def test_factory_cantonese_returns_campplus():
    d = create_diarizer("yue")
    assert isinstance(d, CAMPPlusDiarizer)


def test_factory_english_returns_pyannote():
    d = create_diarizer("en")
    assert isinstance(d, PyAnnoteDiarizer)


def test_factory_other_returns_pyannote():
    d = create_diarizer("ja")
    assert isinstance(d, PyAnnoteDiarizer)


def test_campplus_not_available_initially():
    d = CAMPPlusDiarizer()
    assert d.is_available() is False


def test_pyannote_not_available_initially():
    d = PyAnnoteDiarizer()
    assert d.is_available() is False


async def test_campplus_fallback_without_model():
    """When model not loadable, segments returned unchanged."""
    d = CAMPPlusDiarizer()
    segments = [
        Segment(start=0.0, end=2.0, text="Hello"),
        Segment(start=2.0, end=4.0, text="World"),
    ]

    with patch("asr_service.processors.diarization.campplus.CAMPPlusDiarizer.load") as mock_load:
        mock_load.return_value = None  # model fails to load
        result = await d.process("/tmp/test.wav", segments)

    # Segments returned unchanged when model unavailable
    assert len(result) == 2
    assert result[0].text == "Hello"
    assert result[1].text == "World"


async def test_pyannote_fallback_without_model():
    """When model not loadable, segments returned unchanged."""
    d = PyAnnoteDiarizer()
    segments = [
        Segment(start=0.0, end=2.0, text="Hello"),
    ]

    result = await d.process("/tmp/test.wav", segments)
    assert len(result) == 1
    assert result[0].text == "Hello"


def test_build_speaker_map_with_turns():
    segments = [
        Segment(start=0.0, end=2.0, text="A speaks"),
        Segment(start=2.0, end=4.0, text="B speaks"),
    ]
    diarization_result = [
        {"start": 0.0, "end": 2.5, "spk": "A"},
        {"start": 2.5, "end": 5.0, "spk": "B"},
    ]

    speaker_map = _build_speaker_map(diarization_result, segments)
    assert speaker_map[0] == "Speaker A"
    assert speaker_map[1] == "Speaker B"


def test_build_speaker_map_empty():
    segments = [Segment(start=0.0, end=1.0, text="test")]
    assert _build_speaker_map([], segments) == {}
    assert _build_speaker_map(None, segments) == {}
