"""Tests for the WebSocket streaming transcription endpoint."""

import struct
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from starlette.testclient import TestClient

from asr_service.main import app
from asr_service.routers import jobs, engines, stream
from asr_service.job_manager import JobManager
from asr_service.models.job import Segment


def test_stream_websocket_requires_job_id():
    """WebSocket should reject connections without job_id."""
    manager = JobManager()
    jobs.set_manager(manager)
    engines.set_manager(manager)
    stream.set_manager(manager)

    client = TestClient(app)
    with client.websocket_connect("/ws/stream") as ws:
        data = ws.receive_json()
        assert "error" in data
        assert "job_id" in data["error"]


def test_stream_websocket_rejects_unknown_job():
    """WebSocket should reject connections with invalid job_id."""
    manager = JobManager()
    jobs.set_manager(manager)
    engines.set_manager(manager)
    stream.set_manager(manager)

    client = TestClient(app)
    with client.websocket_connect("/ws/stream?job_id=nonexistent") as ws:
        data = ws.receive_json()
        assert "error" in data
        assert "not found" in data["error"].lower()


def test_stream_websocket_accepts_valid_job():
    """WebSocket should accept connection with valid job_id and transition to running."""
    manager = JobManager()
    jobs.set_manager(manager)
    engines.set_manager(manager)
    stream.set_manager(manager)

    job = manager.create_job(engine="whisper")

    mock_engine = MagicMock()
    mock_engine.is_loaded.return_value = True
    mock_engine.transcribe = AsyncMock(return_value=[
        Segment(start=0.0, end=1.0, text="Hello"),
    ])
    manager._engines["whisper"] = mock_engine

    client = TestClient(app)

    # Generate 5 seconds of silence (16kHz, mono, 16-bit = 160000 bytes)
    sample_rate = 16000
    channels = 1
    silence = b"\x00" * (sample_rate * channels * 2 * 5)

    with client.websocket_connect(
        f"/ws/stream?job_id={job.id}&sample_rate={sample_rate}&channels={channels}"
    ) as ws:
        # Send PCM data
        ws.send_bytes(silence)

        # Should receive segment result
        data = ws.receive_json()
        assert data["type"] == "segment"
        assert data["text"] == "Hello"
        assert data["index"] == 0


def test_stream_buffer_segmentation():
    """StreamBuffer should segment data at proper intervals."""
    from asr_service.routers.stream import StreamBuffer

    buf = StreamBuffer(sample_rate=16000, channels=1)
    assert not buf.has_segment()

    # Add less than 5s of data
    buf.add_chunk(b"\x00" * 100)
    assert not buf.has_segment()

    # Add exactly 5s worth (16000 * 1 * 2 * 5 = 160000 bytes)
    buf.add_chunk(b"\x00" * (160000 - 100))
    assert buf.has_segment()

    segment = buf.pop_segment()
    assert len(segment) == 160000
    assert not buf.has_segment()

    # Flush remaining
    buf.add_chunk(b"\x00" * 50)
    remaining = buf.flush()
    assert remaining is not None
    assert len(remaining) == 50
