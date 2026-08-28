"""Tests for hallucination detector."""

import pytest
from asr_service.models.job import Segment
from asr_service.processors.hallucination_detector import (
    HallucinationDetector,
    Sensitivity,
    _normalize_for_comparison,
    _text_similarity,
)


@pytest.fixture
def detector():
    return HallucinationDetector(sensitivity=Sensitivity.MEDIUM)


@pytest.fixture
def detector_high():
    return HallucinationDetector(sensitivity=Sensitivity.HIGH)


# --- Template phrase detection ---

def test_detect_removes_template_phrases_zh(detector):
    segments = [
        Segment(start=0.0, end=3.0, text="今天开会讨论项目"),
        Segment(start=3.0, end=6.0, text="请订阅我的频道"),
        Segment(start=6.0, end=9.0, text="下周继续讨论"),
    ]
    result = detector.detect(segments, "zh")
    assert len(result) == 2
    assert all("订阅" not in s.text for s in result)


def test_detect_removes_template_phrases_en(detector):
    segments = [
        Segment(start=0.0, end=3.0, text="Let's discuss the project"),
        Segment(start=3.0, end=6.0, text="Thank you for watching"),
        Segment(start=6.0, end=9.0, text="Next topic please"),
    ]
    result = detector.detect(segments, "en")
    assert len(result) == 2


def test_detect_custom_blocked_phrases():
    detector = HallucinationDetector(blocked_phrases=["自定义幻觉"])
    segments = [
        Segment(start=0.0, end=3.0, text="自定义幻觉出现了"),
        Segment(start=3.0, end=6.0, text="正常内容"),
    ]
    result = detector.detect(segments, "zh")
    assert len(result) == 1
    assert result[0].text == "正常内容"


# --- Repetition detection ---

def test_detect_removes_repeated_segments(detector):
    segments = [
        Segment(start=0.0, end=2.0, text="开会讨论"),
        Segment(start=2.0, end=4.0, text="开会讨论"),
        Segment(start=4.0, end=6.0, text="开会讨论"),
        Segment(start=6.0, end=8.0, text="下一个议题"),
    ]
    result = detector.detect(segments, "zh")
    # Should keep first occurrence + last segment
    assert len(result) == 2
    assert result[0].text == "开会讨论"
    assert result[1].text == "下一个议题"


def test_no_false_positives_for_similar_segments(detector):
    segments = [
        Segment(start=0.0, end=2.0, text="今天讨论项目进展"),
        Segment(start=2.0, end=4.0, text="明天讨论技术方案"),
    ]
    result = detector.detect(segments, "zh")
    assert len(result) == 2


# --- Language switch detection ---

def test_detect_language_switch_in_chinese_meeting(detector):
    segments = [
        Segment(start=0.0, end=3.0, text="今天我们讨论项目"),
        Segment(start=3.0, end=6.0, text="This is a completely random English segment that should not appear here"),
        Segment(start=6.0, end=9.0, text="继续讨论下一个话题"),
    ]
    result = detector.detect(segments, "zh")
    assert len(result) == 2


def test_allows_mixed_language_terms(detector):
    """Single English words in Chinese text should NOT be flagged."""
    segments = [
        Segment(start=0.0, end=3.0, text="我们用Google云服务器"),
    ]
    result = detector.detect(segments, "zh")
    assert len(result) == 1


# --- Low confidence detection ---

def test_detect_low_confidence_suspicious(detector):
    segments = [
        Segment(start=0.0, end=3.0, text="正常内容", confidence=0.9),
        Segment(start=3.0, end=6.0, text=".", confidence=0.05),
        Segment(start=6.0, end=9.0, text="另一段内容", confidence=0.8),
    ]
    result = detector.detect(segments, "zh")
    assert len(result) == 2


def test_keeps_low_confidence_with_real_content(detector):
    """Low confidence but meaningful text should not be removed."""
    segments = [
        Segment(start=0.0, end=3.0, text="这是一段有意义的内容", confidence=0.15),
    ]
    result = detector.detect(segments, "zh")
    assert len(result) == 1


# --- Timestamp anomaly detection ---

def test_detect_negative_duration(detector):
    segments = [
        Segment(start=5.0, end=3.0, text="负时长"),
        Segment(start=6.0, end=9.0, text="正常"),
    ]
    result = detector.detect(segments, "zh")
    assert len(result) == 1
    assert result[0].text == "正常"


def test_detect_excessive_duration(detector):
    segments = [
        Segment(start=0.0, end=120.0, text="过长的段"),
        Segment(start=120.0, end=125.0, text="正常"),
    ]
    result = detector.detect(segments, "zh")
    assert len(result) == 1
    assert result[0].text == "正常"


# --- Empty input ---

def test_detect_empty_segments(detector):
    result = detector.detect([], "zh")
    assert result == []


# --- Helper function tests ---

def test_normalize_for_comparison():
    assert _normalize_for_comparison("  Hello, World!  ") == "helloworld"
    assert _normalize_for_comparison("你好，世界！") == "你好世界"


def test_text_similarity_identical():
    assert _text_similarity("hello", "hello") == 1.0


def test_text_similarity_empty():
    assert _text_similarity("", "") == 1.0
    assert _text_similarity("hello", "") == 0.0


def test_text_similarity_partial():
    sim = _text_similarity("abcdef", "abcxyz")
    assert 0.0 < sim < 1.0
