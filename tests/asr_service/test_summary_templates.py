"""Tests for meeting summary prompt templates."""

from asr_service.services.summary_templates import (
    get_summary_prompt,
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
