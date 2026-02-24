"""Tests for meeting export functionality."""

import json
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient

from asr_service.main import app
from asr_service.routers import jobs, engines, stream
from asr_service.job_manager import JobManager
from asr_service.models.job import Segment, JobStatus


@pytest.fixture
async def client_with_job():
    """Create a test client with a completed job that has segments and summary."""
    manager = JobManager()
    jobs.set_manager(manager)
    engines.set_manager(manager)
    stream.set_manager(manager)

    job = manager.create_job(engine="whisper", language="en")
    job.status = JobStatus.READY
    job.segments = [
        Segment(start=0.0, end=5.0, text="Hello everyone.", speaker="Speaker_1"),
        Segment(start=5.0, end=12.0, text="Let us begin the meeting.", speaker="Speaker_2"),
    ]
    job.summary = {
        "topic": "Project kickoff meeting",
        "conclusions": ["We agreed on the timeline."],
        "action_items": [{"action": "Write proposal", "owner": "Alice", "deadline": "Friday"}],
        "discussion": "The team discussed project scope.",
    }

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c, job

    jobs.set_manager(None)
    engines.set_manager(None)
    stream.set_manager(None)


@pytest.mark.asyncio
async def test_export_markdown(client_with_job):
    client, job = client_with_job
    resp = await client.get(f"/jobs/{job.id}/export?format=markdown")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "text/markdown; charset=utf-8"
    content = resp.text
    assert "Project kickoff meeting" in content
    assert "Speaker_1" in content
    assert "Hello everyone." in content


@pytest.mark.asyncio
async def test_export_json(client_with_job):
    client, job = client_with_job
    resp = await client.get(f"/jobs/{job.id}/export?format=json")
    assert resp.status_code == 200
    assert "application/json" in resp.headers["content-type"]
    data = resp.json()
    assert "segments" in data
    assert "summary" in data
    assert len(data["segments"]) == 2


@pytest.mark.asyncio
async def test_export_txt(client_with_job):
    client, job = client_with_job
    resp = await client.get(f"/jobs/{job.id}/export?format=txt")
    assert resp.status_code == 200
    assert "text/plain" in resp.headers["content-type"]
    content = resp.text
    assert "Hello everyone." in content


@pytest.mark.asyncio
async def test_export_not_ready():
    manager = JobManager()
    jobs.set_manager(manager)
    engines.set_manager(manager)
    stream.set_manager(manager)

    job = manager.create_job(engine="whisper")
    job.status = JobStatus.RUNNING

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get(f"/jobs/{job.id}/export?format=markdown")
        assert resp.status_code == 400


@pytest.mark.asyncio
async def test_export_invalid_format(client_with_job):
    client, job = client_with_job
    resp = await client.get(f"/jobs/{job.id}/export?format=invalid")
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_export_nonexistent_job():
    manager = JobManager()
    jobs.set_manager(manager)
    engines.set_manager(manager)
    stream.set_manager(manager)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/jobs/nonexistent/export?format=markdown")
        assert resp.status_code == 404
