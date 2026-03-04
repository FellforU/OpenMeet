"""Tests for meeting summary prompt templates."""

from asr_service.services.summary_templates import (
    get_summary_prompt,
    get_chunk_summary_prompt,
    get_merge_summary_prompt,
    format_transcript,
    SYSTEM_PROMPT_ZH,
    SYSTEM_PROMPT_EN,
)
from asr_service.models.job import Segment


def test_get_summary_prompt_zh():
    system, user = get_summary_prompt("会议内容", language="zh")
    assert system == SYSTEM_PROMPT_ZH
    assert "会议内容" in user
    assert "JSON" in user


def test_get_summary_prompt_en():
    system, user = get_summary_prompt("Meeting content", language="en")
    assert system == SYSTEM_PROMPT_EN
    assert "Meeting content" in user
    assert "JSON" in user


def test_get_summary_prompt_cantonese_uses_zh():
    system, _ = get_summary_prompt("test", language="yue")
    assert system == SYSTEM_PROMPT_ZH


def test_get_summary_prompt_wuu_uses_zh():
    system, _ = get_summary_prompt("test", language="wuu")
    assert system == SYSTEM_PROMPT_ZH


def test_get_summary_prompt_default_is_zh():
    system, _ = get_summary_prompt("test")
    assert system == SYSTEM_PROMPT_ZH


def test_get_summary_prompt_japanese_uses_en():
    system, _ = get_summary_prompt("test", language="ja")
    assert system == SYSTEM_PROMPT_EN


def test_summary_prompt_contains_enhanced_fields():
    """Enhanced prompt should request key_data and participants."""
    _, user = get_summary_prompt("测试内容", language="zh")
    assert "key_data" in user
    assert "participants" in user
    assert "action_items" in user
    assert "discussion" in user


def test_summary_prompt_discussion_is_array():
    """Discussion field should be an array of objects, not a string."""
    _, user = get_summary_prompt("测试内容", language="zh")
    assert '"topic":' in user and '"summary":' in user


# --- Chunk summary prompts ---

def test_get_chunk_summary_prompt_zh():
    system, user = get_chunk_summary_prompt("片段内容", language="zh")
    assert system == SYSTEM_PROMPT_ZH
    assert "片段内容" in user
    assert "topics" in user
    assert "key_data" in user


def test_get_chunk_summary_prompt_en():
    system, user = get_chunk_summary_prompt("chunk content", language="en")
    assert system == SYSTEM_PROMPT_EN
    assert "chunk content" in user
    assert "topics" in user


# --- Merge summary prompts ---

def test_get_merge_summary_prompt_zh():
    system, user = get_merge_summary_prompt('[{"topics": ["test"]}]', language="zh")
    assert system == SYSTEM_PROMPT_ZH
    assert "test" in user
    assert "去重" in user or "合并" in user


def test_get_merge_summary_prompt_en():
    system, user = get_merge_summary_prompt('[{"topics": ["test"]}]', language="en")
    assert system == SYSTEM_PROMPT_EN
    assert "test" in user
    assert "deduplicate" in user.lower() or "merge" in user.lower()


# --- Format transcript ---

def test_format_transcript_with_speaker():
    segments = [
        Segment(start=0.0, end=5.0, text="Hello everyone", speaker="Speaker_1"),
        Segment(start=65.5, end=70.0, text="Let's begin", speaker="Speaker_2"),
    ]
    result = format_transcript(segments)
    lines = result.split("\n")
    assert len(lines) == 2
    assert "[00:00] [Speaker_1] Hello everyone" == lines[0]
    assert "[01:05] [Speaker_2] Let's begin" == lines[1]


def test_format_transcript_without_speaker():
    segments = [
        Segment(start=130.0, end=135.0, text="This is a test"),
    ]
    result = format_transcript(segments)
    assert "[02:10] This is a test" == result


def test_format_transcript_empty():
    result = format_transcript([])
    assert result == ""
