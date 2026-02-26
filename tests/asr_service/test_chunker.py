"""Tests for the text chunker."""

import pytest

from asr_service.knowledge.chunker import chunk_text, chunk_segments, Chunk


def test_short_text_single_chunk():
    result = chunk_text("Hello world")
    assert len(result) == 1
    assert result[0] == "Hello world"


def test_empty_text():
    result = chunk_text("")
    assert len(result) == 0


def test_long_text_multiple_chunks():
    # Build text > 500 chars with sentence boundaries
    text = "This is a sentence. " * 30  # ~600 chars
    result = chunk_text(text, chunk_size=200, overlap=20)
    assert len(result) > 1
    # Each chunk should be non-empty
    for chunk in result:
        assert len(chunk) > 0


def test_chunk_segments_basic():
    segments = [
        {"id": "s1", "start_time": 0, "end_time": 5, "text": "Hello", "speaker": "A", "confidence": 0.9},
        {"id": "s2", "start_time": 5, "end_time": 10, "text": "World", "speaker": "B", "confidence": 0.8},
    ]
    result = chunk_segments(segments, "p1")
    assert len(result) > 0
    assert all(isinstance(c, Chunk) for c in result)
    assert all(c.source_type == "segment" for c in result)
    assert all(c.project_id == "p1" for c in result)


def test_chunk_segments_empty():
    result = chunk_segments([], "p1")
    assert len(result) == 0
