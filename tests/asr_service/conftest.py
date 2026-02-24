import pytest
from httpx import ASGITransport, AsyncClient

from asr_service.main import app
from asr_service.routers import jobs, engines
from asr_service.job_manager import JobManager


@pytest.fixture
async def client():
    """Create a test client with a fresh JobManager for each test."""
    manager = JobManager()
    jobs.set_manager(manager)
    engines.set_manager(manager)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c

    jobs.set_manager(None)
    engines.set_manager(None)
