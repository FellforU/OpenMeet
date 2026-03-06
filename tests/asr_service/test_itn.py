"""Tests for Chinese ITN (Inverse Text Normalization)."""

import pytest
from asr_service.processors.itn import (
    ChineseITNProcessor,
    _smart_number_normalize,
    _arabic_to_chinese_fallback,
    _is_chinese_char,
)
from asr_service.models.job import Segment


# --- Smart number normalization (new fallback) ---

def test_smart_normalize_converts_arabic_in_chinese_context():
    """Arabic digits surrounded by Chinese should be converted."""
    assert _smart_number_normalize("1个月") == "一个月"
    assert _smart_number_normalize("3到5年") == "三到五年"


def test_smart_normalize_preserves_chinese_digits():
    """Chinese digits should not be changed."""
    assert _smart_number_normalize("一两百美金") == "一两百美金"
    assert _smart_number_normalize("三到五年") == "三到五年"


def test_smart_normalize_preserves_years():
    """Years like 2024年 should stay in Arabic."""
    assert _smart_number_normalize("2024年") == "2024年"


def test_smart_normalize_preserves_long_numbers():
    """Long digit sequences should not be converted."""
    assert _smart_number_normalize("13812345678") == "13812345678"


def test_smart_normalize_preserves_ip():
    text = "192.168.1.1"
    assert _smart_number_normalize(text) == text


def test_smart_normalize_no_change_for_pure_chinese():
    assert _smart_number_normalize("你好世界") == "你好世界"


# --- Arabic to Chinese fallback (old, utility) ---

def test_arabic_to_chinese_fallback():
    assert _arabic_to_chinese_fallback("123") == "一二三"
    assert _arabic_to_chinese_fallback("hello") == "hello"


# --- Chinese char detection ---

def test_is_chinese_char():
    assert _is_chinese_char("中") is True
    assert _is_chinese_char("a") is False
    assert _is_chinese_char("") is False
    assert _is_chinese_char("1") is False


# --- Processor tests ---

async def test_itn_processor_non_chinese_passthrough():
    """ITN processor should pass through non-Chinese text unchanged."""
    processor = ChineseITNProcessor()
    segments = [Segment(start=0.0, end=1.0, text="Hello world")]

    result = await processor.normalize(segments, language="en")
    assert result[0].text == "Hello world"


async def test_itn_processor_fallback_normalizes_smart():
    """Without WeTextProcessing, uses smart number fallback."""
    processor = ChineseITNProcessor()
    segments = [
        Segment(start=0.0, end=2.0, text="1个月的费用"),
        Segment(start=2.0, end=4.0, text="大概3到5年"),
    ]

    result = await processor.normalize(segments, language="zh")
    assert "一个月" in result[0].text
    assert "三" in result[1].text and "五" in result[1].text


async def test_itn_processor_preserves_metadata():
    """ITN should preserve segment start, end, speaker, confidence."""
    processor = ChineseITNProcessor()
    segments = [
        Segment(start=1.5, end=3.0, text="测试文本", speaker="Speaker A", confidence=-0.3),
    ]

    result = await processor.normalize(segments, language="zh")
    assert result[0].start == 1.5
    assert result[0].end == 3.0
    assert result[0].speaker == "Speaker A"
    assert result[0].confidence == -0.3
