"""Tests for full-text search across transcriptions."""

import pytest
from httpx import ASGITransport, AsyncClient

from asr_service.main import app
from asr_service.routers import jobs, engines, stream, search
from asr_service.job_manager import JobManager
from asr_service.models.job import Segment, JobStatus


@pytest.fixture
async def client_with_jobs():
    """Create a client with multiple completed jobs."""
    manager = JobManager()
    jobs.set_manager(manager)
    engines.set_manager(manager)
    stream.set_manager(manager)
    search.set_manager(manager)

    job1 = manager.create_job(engine="whisper", language="en")
    job1.status = JobStatus.READY
    job1.segments = [
        Segment(start=0.0, end=5.0, text="We discussed the project timeline"),
        Segment(start=5.0, end=10.0, text="The deadline is next Friday"),
    ]

    job2 = manager.create_job(engine="whisper", language="zh")
    job2.status = JobStatus.READY
    job2.segments = [
        Segment(start=0.0, end=5.0, text="今天讨论项目进度"),
        Segment(start=5.0, end=10.0, text="下周五之前完成"),
    ]

    job3 = manager.create_job(engine="whisper", language="en")
    job3.status = JobStatus.RUNNING
    job3.segments = [
        Segment(start=0.0, end=5.0, text="This should not appear in search"),
    ]

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c, [job1, job2, job3]

    jobs.set_manager(None)
    engines.set_manager(None)
    stream.set_manager(None)
    search.set_manager(None)


@pytest.mark.asyncio
async def test_search_finds_matching_segments(client_with_jobs):
    client, _ = client_with_jobs
    resp = await client.get("/search?q=project")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["results"]) == 1
    assert data["results"][0]["text"] == "We discussed the project timeline"


@pytest.mark.asyncio
async def test_search_case_insensitive(client_with_jobs):
    client, _ = client_with_jobs
    resp = await client.get("/search?q=DEADLINE")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["results"]) == 1


@pytest.mark.asyncio
async def test_search_chinese(client_with_jobs):
    client, _ = client_with_jobs
    resp = await client.get("/search?q=项目")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["results"]) == 1
    assert "项目" in data["results"][0]["text"]


@pytest.mark.asyncio
async def test_search_returns_job_context(client_with_jobs):
    client, job_list = client_with_jobs
    resp = await client.get("/search?q=Friday")
    data = resp.json()
    assert len(data["results"]) == 1
    result = data["results"][0]
    assert "job_id" in result
    assert result["job_id"] == job_list[0].id


@pytest.mark.asyncio
async def test_search_excludes_non_ready_jobs(client_with_jobs):
    client, _ = client_with_jobs
    resp = await client.get("/search?q=should+not+appear")
    data = resp.json()
    assert len(data["results"]) == 0


@pytest.mark.asyncio
async def test_search_empty_query(client_with_jobs):
    client, _ = client_with_jobs
    resp = await client.get("/search?q=")
    assert resp.status_code == 422  # FastAPI validates min_length=1


@pytest.mark.asyncio
async def test_search_no_results(client_with_jobs):
    client, _ = client_with_jobs
    resp = await client.get("/search?q=nonexistentword")
    data = resp.json()
    assert len(data["results"]) == 0
