"""Tests for Chinese ITN (Inverse Text Normalization)."""

import pytest
from asr_service.processors.itn import ChineseITNProcessor, _basic_chinese_itn
from asr_service.models.job import Segment


def test_basic_itn_digit_sequence():
    """Basic ITN converts Chinese digits to Arabic."""
    assert _basic_chinese_itn("一二三") == "123"


def test_basic_itn_phone_number():
    assert _basic_chinese_itn("一三八一二三四五六七八") == "13812345678"


def test_basic_itn_percentage():
    assert _basic_chinese_itn("百分之八〇") == "80%"


def test_basic_itn_mixed_text():
    result = _basic_chinese_itn("今天是二〇二四年")
    assert "2024" in result


def test_basic_itn_no_change_for_non_digits():
    assert _basic_chinese_itn("你好世界") == "你好世界"


async def test_itn_processor_non_chinese_passthrough():
    """ITN processor should pass through non-Chinese text unchanged."""
    processor = ChineseITNProcessor()
    segments = [Segment(start=0.0, end=1.0, text="Hello world")]

    result = await processor.normalize(segments, language="en")
    assert result[0].text == "Hello world"


async def test_itn_processor_fallback():
    """Without WeTextProcessing, uses basic regex fallback."""
    processor = ChineseITNProcessor()
    segments = [
        Segment(start=0.0, end=2.0, text="一二三四五"),
        Segment(start=2.0, end=4.0, text="百分之九五"),
    ]

    result = await processor.normalize(segments, language="zh")
    assert result[0].text == "12345"
    assert "95%" in result[1].text


async def test_itn_processor_preserves_metadata():
    """ITN should preserve segment start, end, speaker, confidence."""
    processor = ChineseITNProcessor()
    segments = [
        Segment(start=1.5, end=3.0, text="一二三", speaker="Speaker A", confidence=-0.3),
    ]

    result = await processor.normalize(segments, language="zh")
    assert result[0].start == 1.5
    assert result[0].end == 3.0
    assert result[0].speaker == "Speaker A"
    assert result[0].confidence == -0.3
