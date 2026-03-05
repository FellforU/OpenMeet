"""Tests for SemanticSegmenter paragraph segmentation."""

import pytest

from asr_service.models.job import Segment
from asr_service.processors.segmenter import (
    SemanticSegmenter,
    SegmenterConfig,
    ParagraphFormatter,
)


def _seg(start: float, end: float, text: str) -> Segment:
    return Segment(start=start, end=end, text=text)


class TestTimeBasedSegmentation:
    def test_splits_on_large_gap(self):
        segs = [
            _seg(0.0, 1.0, "hello"),
            _seg(1.1, 2.0, "world"),
            _seg(5.0, 6.0, "new topic"),
        ]
        segmenter = SemanticSegmenter(SegmenterConfig(strategy="time", gap_threshold=1.5))
        result = segmenter.process(segs)
        assert len(result) == 3
        # Paragraph boundary marker on "world"
        assert result[1].text == "world\n\n"
        assert result[2].text == "new topic"

    def test_no_split_on_small_gap(self):
        segs = [
            _seg(0.0, 1.0, "hello"),
            _seg(1.2, 2.0, "world"),
        ]
        segmenter = SemanticSegmenter(SegmenterConfig(strategy="time", gap_threshold=1.5))
        result = segmenter.process(segs)
        assert len(result) == 2
        assert result[0].text == "hello"
        assert result[1].text == "world"

    def test_empty_input(self):
        segmenter = SemanticSegmenter(SegmenterConfig(strategy="time"))
        assert segmenter.process([]) == []


class TestSemanticSegmentation:
    def test_splits_on_topic_marker(self):
        segs = [
            _seg(0.0, 1.0, "first topic"),
            _seg(1.0, 2.0, "still first"),
            _seg(2.0, 3.0, "另外我们讨论一下"),
        ]
        segmenter = SemanticSegmenter(
            SegmenterConfig(strategy="semantic", language="zh")
        )
        result = segmenter.process(segs)
        assert result[1].text == "still first\n\n"

    def test_no_split_on_short_paragraph(self):
        """Should not split when current paragraph has fewer than 2 segments."""
        segs = [
            _seg(0.0, 1.0, "另外第一句"),
            _seg(1.0, 2.0, "另外第二句"),
        ]
        segmenter = SemanticSegmenter(
            SegmenterConfig(strategy="semantic", language="zh")
        )
        result = segmenter.process(segs)
        # Only 1 segment before marker → no split
        assert all("\n\n" not in s.text for s in result)


class TestHybridSegmentation:
    def test_splits_on_gap_and_duration(self):
        segs = [
            _seg(0.0, 10.0, "long segment"),
            _seg(10.1, 20.0, "still going"),
            _seg(25.0, 30.0, "after gap"),
        ]
        segmenter = SemanticSegmenter(
            SegmenterConfig(
                strategy="hybrid",
                gap_threshold=1.5,
                min_segment_duration=5.0,
                max_segment_duration=60.0,
            )
        )
        result = segmenter.process(segs)
        assert result[1].text == "still going\n\n"

    def test_respects_min_duration(self):
        """Should not split if current paragraph is too short."""
        segs = [
            _seg(0.0, 1.0, "short"),
            _seg(5.0, 6.0, "另外 after gap"),
        ]
        segmenter = SemanticSegmenter(
            SegmenterConfig(
                strategy="hybrid",
                gap_threshold=1.5,
                min_segment_duration=5.0,
                language="zh",
            )
        )
        result = segmenter.process(segs)
        # Duration of first paragraph (1s) < min_segment_duration (5s) → no split
        assert all("\n\n" not in s.text for s in result)


class TestDisabled:
    def test_disabled_returns_unchanged(self):
        segs = [_seg(0.0, 1.0, "hello"), _seg(5.0, 6.0, "world")]
        segmenter = SemanticSegmenter(SegmenterConfig(enabled=False))
        result = segmenter.process(segs)
        assert result is segs  # same reference


class TestParagraphFormatter:
    def test_format_paragraphs(self):
        paragraphs = [
            [_seg(0.0, 1.0, "hello"), _seg(1.0, 2.0, "world")],
            [_seg(5.0, 6.0, "new para")],
        ]
        text = ParagraphFormatter.format_paragraphs(paragraphs)
        assert text == "hello\nworld\n\nnew para"

    def test_get_boundaries(self):
        paragraphs = [
            [_seg(0.0, 1.0, "a"), _seg(1.0, 2.0, "b")],
            [_seg(5.0, 6.0, "c")],
        ]
        boundaries = ParagraphFormatter.get_paragraph_boundaries(paragraphs)
        assert boundaries == [(0.0, 2.0), (5.0, 6.0)]
