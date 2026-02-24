"""Tests for the auto-degradation strategy."""

from unittest.mock import patch

import pytest

from asr_service.services.degradation import (
    EngineMode,
    get_recommended_engine,
)


def test_engine_mode_local():
    assert EngineMode.LOCAL.value == "local"


def test_engine_mode_cloud():
    assert EngineMode.CLOUD.value == "cloud"


def test_recommendation_with_high_vram():
    """With enough VRAM, should recommend local engine."""
    result = get_recommended_engine(
        language="zh",
        available_vram_gb=8.0,
        has_openai_key=False,
        has_alibaba_key=False,
    )
    assert result.mode == EngineMode.LOCAL
    assert result.engine in ("whisper", "qwen3", "paraformer")


def test_recommendation_chinese_prefers_qwen3():
    """For Chinese, should prefer Qwen3 when VRAM is sufficient."""
    result = get_recommended_engine(
        language="zh",
        available_vram_gb=8.0,
        has_openai_key=True,
        has_alibaba_key=True,
    )
    assert result.engine == "qwen3"
    assert result.mode == EngineMode.LOCAL


def test_recommendation_english_prefers_whisper():
    """For English, should prefer Whisper."""
    result = get_recommended_engine(
        language="en",
        available_vram_gb=8.0,
        has_openai_key=False,
        has_alibaba_key=False,
    )
    assert result.engine == "whisper"
    assert result.mode == EngineMode.LOCAL


def test_recommendation_low_vram_smaller_model():
    """With low VRAM, should recommend smaller model size."""
    result = get_recommended_engine(
        language="en",
        available_vram_gb=1.5,
        has_openai_key=False,
        has_alibaba_key=False,
    )
    assert result.engine == "whisper"
    assert result.model_size == "base"


def test_recommendation_no_vram_falls_to_cloud_openai():
    """With no VRAM and OpenAI key, should fall back to cloud."""
    result = get_recommended_engine(
        language="en",
        available_vram_gb=0.0,
        has_openai_key=True,
        has_alibaba_key=False,
    )
    assert result.engine == "openai-whisper"
    assert result.mode == EngineMode.CLOUD


def test_recommendation_no_vram_chinese_falls_to_alibaba():
    """With no VRAM and Chinese, prefer Alibaba Cloud."""
    result = get_recommended_engine(
        language="zh",
        available_vram_gb=0.0,
        has_openai_key=True,
        has_alibaba_key=True,
    )
    assert result.engine == "alibaba-asr"
    assert result.mode == EngineMode.CLOUD


def test_recommendation_no_vram_no_keys_uses_tiny():
    """With no VRAM and no cloud keys, fall back to smallest local model."""
    result = get_recommended_engine(
        language="en",
        available_vram_gb=0.0,
        has_openai_key=False,
        has_alibaba_key=False,
    )
    assert result.engine == "whisper"
    assert result.model_size == "tiny"
    assert result.mode == EngineMode.LOCAL
