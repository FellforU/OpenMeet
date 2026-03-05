"""Tests for filler word filter processor."""

import pytest
from asr_service.models.job import Segment
from asr_service.processors.filler_filter import (
    FillerFilterProcessor,
    FillerFilterConfig,
    FilterLevel,
    _merge_repetitions,
    _clean_whitespace,
)


# --- Repetition merging tests ---

def test_merge_chinese_repetitions():
    """Consecutive repeated Chinese phrases should be deduplicated."""
    assert _merge_repetitions("一个一个一个", is_chinese=True, min_count=2) == "一个"


def test_merge_chinese_triple_char():
    """Triple single-char repetitions (stuttering) should be merged."""
    assert _merge_repetitions("对对对", is_chinese=True, min_count=2) == "对"
    assert _merge_repetitions("我我我我", is_chinese=True, min_count=2) == "我"


def test_merge_chinese_double_char_preserved():
    """Natural doubled chars like 天天、人人、慢慢 should be preserved (only 2 repetitions)."""
    assert _merge_repetitions("天天", is_chinese=True, min_count=2) == "天天"
    assert _merge_repetitions("人人", is_chinese=True, min_count=2) == "人人"
    assert _merge_repetitions("慢慢", is_chinese=True, min_count=2) == "慢慢"


def test_merge_chinese_no_change_if_below_min():
    assert _merge_repetitions("好好", is_chinese=True, min_count=3) == "好好"


def test_merge_chinese_two_char_repetition():
    """Two-char phrase repetitions should be merged."""
    assert _merge_repetitions("这个这个这个", is_chinese=True, min_count=2) == "这个"


def test_merge_english_repetitions():
    assert _merge_repetitions("the the the", is_chinese=False, min_count=2) == "the"


def test_merge_english_no_change_for_different_words():
    assert _merge_repetitions("hello world", is_chinese=False, min_count=2) == "hello world"


def test_merge_chinese_mixed_content_preserved():
    """Non-repeated content around repetitions should be preserved."""
    result = _merge_repetitions("我觉得这个这个这个东西很好", is_chinese=True, min_count=2)
    assert "这个这个这个" not in result
    assert "这个" in result
    assert "我觉得" in result
    assert "东西很好" in result


# --- Filler filter processor tests ---

@pytest.fixture
def processor_light():
    return FillerFilterProcessor(FillerFilterConfig(level=FilterLevel.LIGHT))


@pytest.fixture
def processor_medium():
    return FillerFilterProcessor(FillerFilterConfig(level=FilterLevel.MEDIUM))


@pytest.fixture
def processor_heavy():
    return FillerFilterProcessor(FillerFilterConfig(
        level=FilterLevel.HEAVY,
        remove_mid_fillers=True,
    ))


async def test_filter_removes_start_fillers_chinese(processor_medium):
    segments = [
        Segment(start=0.0, end=3.0, text="呃，我们今天开会"),
    ]
    result = await processor_medium.filter(segments, "zh")
    assert len(result) == 1
    assert not result[0].text.startswith("呃")
    assert "开会" in result[0].text


async def test_filter_preserves_non_filler_content(processor_light):
    segments = [
        Segment(start=0.0, end=3.0, text="今天天气很好"),
    ]
    result = await processor_light.filter(segments, "zh")
    assert result[0].text == "今天天气很好"


async def test_filter_drops_empty_segments(processor_heavy):
    segments = [
        Segment(start=0.0, end=1.0, text="嗯"),
        Segment(start=1.0, end=3.0, text="我们开始吧"),
    ]
    result = await processor_heavy.filter(segments, "zh")
    assert len(result) == 1
    assert "开始" in result[0].text


async def test_filter_merges_repetitions(processor_medium):
    segments = [
        Segment(start=0.0, end=3.0, text="一个一个一个问题"),
    ]
    result = await processor_medium.filter(segments, "zh")
    assert "一个一个一个" not in result[0].text


async def test_filter_english_fillers(processor_medium):
    segments = [
        Segment(start=0.0, end=3.0, text="um, like, you know, the meeting"),
    ]
    result = await processor_medium.filter(segments, "en")
    assert len(result) == 1
    assert "meeting" in result[0].text


async def test_filter_preserves_metadata():
    processor = FillerFilterProcessor()
    segments = [
        Segment(start=1.5, end=3.0, text="呃，很好", speaker="Alice", confidence=0.95),
    ]
    result = await processor.filter(segments, "zh")
    assert result[0].start == 1.5
    assert result[0].end == 3.0
    assert result[0].speaker == "Alice"
    assert result[0].confidence == 0.95


async def test_filter_non_chinese_passthrough():
    processor = FillerFilterProcessor()
    segments = [
        Segment(start=0.0, end=1.0, text="Bonjour le monde"),
    ]
    result = await processor.filter(segments, "fr")
    assert result[0].text == "Bonjour le monde"


async def test_filter_custom_fillers():
    config = FillerFilterConfig(
        level=FilterLevel.LIGHT,
        custom_fillers_zh={"我跟你讲"},
        remove_start_fillers=True,
    )
    processor = FillerFilterProcessor(config)
    segments = [
        Segment(start=0.0, end=3.0, text="我跟你讲，今天开会了"),
    ]
    result = await processor.filter(segments, "zh")
    assert "我跟你讲" not in result[0].text


async def test_filter_excluded_fillers():
    config = FillerFilterConfig(
        level=FilterLevel.MEDIUM,
        excluded_fillers={"然后"},
        remove_mid_fillers=True,
    )
    processor = FillerFilterProcessor(config)
    segments = [
        Segment(start=0.0, end=3.0, text="然后我们开始讨论"),
    ]
    result = await processor.filter(segments, "zh")
    # "然后" should NOT be removed because it's excluded
    assert "然后" in result[0].text


# --- Whitespace cleanup tests ---

def test_clean_whitespace_collapses_spaces():
    assert _clean_whitespace("hello   world", is_chinese=False) == "hello world"


def test_clean_whitespace_removes_leading_punctuation():
    assert _clean_whitespace("，今天开会", is_chinese=True) == "今天开会"


def test_clean_whitespace_removes_double_punctuation():
    assert _clean_whitespace("好的，，我知道了", is_chinese=True) == "好的，我知道了"
