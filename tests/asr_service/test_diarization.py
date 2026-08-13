"""Tests for speaker diarization processors."""

from unittest.mock import patch
import numpy as np
import pytest

from asr_service.models.job import Segment
from asr_service.processors.diarization.factory import create_diarizer
from asr_service.processors.diarization.campplus import (
    CAMPPlusDiarizer,
    _cluster_embeddings,
    _energy_vad_split,
)
from asr_service.processors.diarization.pyannote_diarizer import PyAnnoteDiarizer


def test_factory_chinese_returns_pyannote():
    # pyannote 对所有语言优先，不可用时才在运行时回退 CAMPPlus
    d = create_diarizer("zh")
    assert isinstance(d, PyAnnoteDiarizer)


def test_factory_cantonese_returns_pyannote():
    d = create_diarizer("yue")
    assert isinstance(d, PyAnnoteDiarizer)


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


def test_cluster_embeddings_single():
    """Single embedding returns one speaker."""
    embs = [np.array([1.0, 0.0, 0.0])]
    result = _cluster_embeddings(embs)
    assert result == {0: "Speaker 1"}


def test_cluster_embeddings_two_speakers():
    """Two distinct embeddings produce two speaker labels."""
    embs = [
        np.array([1.0, 0.0, 0.0]),
        np.array([0.0, 1.0, 0.0]),
        np.array([1.0, 0.1, 0.0]),  # similar to first
        np.array([0.1, 1.0, 0.0]),  # similar to second
    ]
    result = _cluster_embeddings(embs)
    assert len(result) == 4
    # First and third should be same speaker
    assert result[0] == result[2]
    # Second and fourth should be same speaker
    assert result[1] == result[3]
    # Different groups
    assert result[0] != result[1]


def test_cluster_embeddings_with_none():
    """None embeddings are skipped."""
    embs = [np.array([1.0, 0.0]), None, np.array([0.0, 1.0])]
    result = _cluster_embeddings(embs)
    assert 0 in result
    assert 1 not in result
    assert 2 in result


def test_cluster_embeddings_empty():
    """Empty input returns empty map."""
    assert _cluster_embeddings([]) == {}
    assert _cluster_embeddings([None, None]) == {}


def test_energy_vad_split_short_audio():
    """Short audio region returns as-is."""
    # 1 second of silence + speech
    sr = 16000
    audio = np.zeros(sr * 2, dtype=np.float32)
    # Add speech-like energy in second half
    audio[sr:] = np.random.randn(sr).astype(np.float32) * 0.5

    regions = _energy_vad_split(audio, sr, 0.0, 2.0, len(audio))
    assert len(regions) >= 1
    # All regions should be within [0, 2]
    for s, e in regions:
        assert s >= 0.0
        assert e <= 2.0


def test_energy_vad_split_silence():
    """Pure silence returns the full region as fallback."""
    sr = 16000
    audio = np.zeros(sr * 5, dtype=np.float32)

    regions = _energy_vad_split(audio, sr, 0.0, 5.0, len(audio))
    assert len(regions) >= 1


def test_energy_vad_split_mixed():
    """Audio with speech-silence-speech pattern produces multiple regions."""
    sr = 16000
    audio = np.zeros(sr * 10, dtype=np.float32)
    # Speech at 0-3s
    audio[:sr * 3] = np.random.randn(sr * 3).astype(np.float32) * 0.8
    # Silence at 3-7s
    # Speech at 7-10s
    audio[sr * 7:] = np.random.randn(sr * 3).astype(np.float32) * 0.8

    regions = _energy_vad_split(audio, sr, 0.0, 10.0, len(audio))
    # Should detect at least 2 speech regions
    assert len(regions) >= 2
