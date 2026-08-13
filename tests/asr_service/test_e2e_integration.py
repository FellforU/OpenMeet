"""
End-to-end integration test for the transcription flow.

Tests the complete backend pipeline:
  Create job → Start with audio → Poll status → Get result with segments

Uses mocked whisper engine to avoid requiring model download.
"""

import asyncio
from unittest.mock import AsyncMock, patch, MagicMock

from asr_service.models.job import Segment


async def test_full_transcription_flow(client):
    """E2E: create job → start → poll until completed → get segments."""
    fake_segments = [
        Segment(start=0.0, end=2.5, text="Hello world", confidence=-0.3),
        Segment(start=2.5, end=5.0, text="This is a test", confidence=-0.4),
        Segment(start=5.0, end=8.2, text="Of the transcription system", confidence=-0.35),
    ]

    mock_engine = MagicMock()
    mock_engine.is_loaded.return_value = True
    mock_engine.unload_model = AsyncMock()
    mock_engine.load_model = AsyncMock()
    mock_engine.transcribe = AsyncMock(return_value=fake_segments)

    with patch(
        "asr_service.job_manager.preprocess_audio",
        new=AsyncMock(return_value="/tmp/test_16k.wav"),
    ):
        # Step 1: Create job
        create_resp = await client.post("/jobs", json={
            "engine": "whisper",
            "model_size": "base",
            "language": "en",
        })
        assert create_resp.status_code == 200
        job_data = create_resp.json()
        job_id = job_data["id"]
        assert job_data["status"] == "idle"
        assert job_data["engine"] == "whisper"

        # Step 2: Inject mock engine and start transcription
        from asr_service.routers.jobs import get_manager
        manager = get_manager()
        manager._engines["whisper"] = mock_engine

        start_resp = await client.post(
            f"/jobs/{job_id}/start?audio_path=/tmp/test.wav"
        )
        assert start_resp.status_code == 200
        assert start_resp.json()["status"] == "running"

        # Step 3: Poll until completion (with timeout)
        # After transcription, PostProcessingPipeline runs and may
        # transition status from completed → post_processing → ready
        # 本机 HF 缓存里存在真实 pyannote 模型时，后处理会真的加载它
        # （约 3 秒），所以轮询预算要给足
        terminal_statuses = {"completed", "ready"}
        for _ in range(100):
            poll_resp = await client.get(f"/jobs/{job_id}")
            assert poll_resp.status_code == 200
            status = poll_resp.json()["status"]
            if status in terminal_statuses:
                break
            await asyncio.sleep(0.1)
        else:
            raise AssertionError("Job did not complete within timeout")

        # Verify progress reached 100%
        assert poll_resp.json()["progress"] == 100.0
        assert poll_resp.json()["segment_count"] == 3

        # Step 4: Get result with segments
        result_resp = await client.get(f"/jobs/{job_id}/result")
        assert result_resp.status_code == 200
        result = result_resp.json()
        assert result["status"] in terminal_statuses
        assert len(result["segments"]) == 3

        # Verify segment content
        seg0 = result["segments"][0]
        assert seg0["start"] == 0.0
        assert seg0["end"] == 2.5
        assert seg0["text"] == "Hello world"
        assert seg0["confidence"] == -0.3

        seg2 = result["segments"][2]
        assert seg2["text"] == "Of the transcription system"
        assert seg2["start"] == 5.0


async def test_cancel_running_job(client):
    """E2E: start a long-running job then cancel it."""
    # Create a slow mock engine
    async def slow_transcribe(audio, on_progress=None):
        await asyncio.sleep(10)
        return []

    mock_engine = MagicMock()
    mock_engine.is_loaded.return_value = True
    mock_engine.unload_model = AsyncMock()
    mock_engine.load_model = AsyncMock()
    mock_engine.transcribe = slow_transcribe

    with patch(
        "asr_service.job_manager.preprocess_audio",
        new=AsyncMock(return_value="/tmp/test_16k.wav"),
    ):
        # Create and start
        create_resp = await client.post("/jobs", json={"engine": "whisper"})
        job_id = create_resp.json()["id"]

        from asr_service.routers.jobs import get_manager
        manager = get_manager()
        manager._engines["whisper"] = mock_engine

        await client.post(f"/jobs/{job_id}/start?audio_path=/tmp/test.wav")

        # Wait briefly for task to start running
        await asyncio.sleep(0.1)

        # Cancel
        cancel_resp = await client.put(f"/jobs/{job_id}/cancel")
        assert cancel_resp.status_code == 200
        assert cancel_resp.json()["status"] == "cancelled"

        # Result should not be available
        result_resp = await client.get(f"/jobs/{job_id}/result")
        assert result_resp.status_code == 400


async def test_multiple_jobs_independent(client):
    """E2E: multiple jobs can be created and tracked independently."""
    # Create two jobs
    resp1 = await client.post("/jobs", json={"engine": "whisper", "model_size": "base"})
    resp2 = await client.post("/jobs", json={"engine": "whisper", "model_size": "small"})

    job1 = resp1.json()
    job2 = resp2.json()

    assert job1["id"] != job2["id"]
    assert job1["model_size"] == "base"
    assert job2["model_size"] == "small"

    # Both accessible independently
    get1 = await client.get(f"/jobs/{job1['id']}")
    get2 = await client.get(f"/jobs/{job2['id']}")
    assert get1.status_code == 200
    assert get2.status_code == 200
    assert get1.json()["model_size"] == "base"
    assert get2.json()["model_size"] == "small"


async def test_upload_and_start_flow(client):
    """E2E: upload audio file then start transcription."""
    import io

    # Create job
    create_resp = await client.post("/jobs", json={"engine": "whisper"})
    job_id = create_resp.json()["id"]

    # Upload a fake audio file
    fake_audio = io.BytesIO(b"RIFF" + b"\x00" * 100)
    upload_resp = await client.post(
        f"/jobs/{job_id}/upload",
        files={"file": ("test.wav", fake_audio, "audio/wav")},
    )
    assert upload_resp.status_code == 200

    # Verify audio_path is set on the job
    job_resp = await client.get(f"/jobs/{job_id}")
    assert job_resp.status_code == 200


async def test_job_lifecycle_status_transitions(client):
    """E2E: verify correct status transitions through job lifecycle."""
    fake_segments = [Segment(start=0.0, end=1.0, text="Test")]

    mock_engine = MagicMock()
    mock_engine.is_loaded.return_value = True
    mock_engine.unload_model = AsyncMock()
    mock_engine.load_model = AsyncMock()
    mock_engine.transcribe = AsyncMock(return_value=fake_segments)

    with patch(
        "asr_service.job_manager.preprocess_audio",
        new=AsyncMock(return_value="/tmp/test_16k.wav"),
    ):
        # IDLE
        create_resp = await client.post("/jobs", json={"engine": "whisper"})
        job_id = create_resp.json()["id"]
        assert create_resp.json()["status"] == "idle"

        from asr_service.routers.jobs import get_manager
        manager = get_manager()
        manager._engines["whisper"] = mock_engine

        # IDLE → RUNNING
        start_resp = await client.post(f"/jobs/{job_id}/start?audio_path=/tmp/test.wav")
        assert start_resp.json()["status"] == "running"

        # RUNNING → COMPLETED → (post-processing) → READY
        terminal_statuses = {"completed", "ready"}
        for _ in range(100):
            poll = await client.get(f"/jobs/{job_id}")
            if poll.json()["status"] in terminal_statuses:
                break
            await asyncio.sleep(0.1)

        assert poll.json()["status"] in terminal_statuses
        assert poll.json()["progress"] == 100.0
