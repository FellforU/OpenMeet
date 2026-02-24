"""Tests for the PostProcessingPipeline."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from asr_service.models.job import Segment, TranscriptionJob, JobStatus
from asr_service.services.post_processing import PostProcessingPipeline


@pytest.fixture
def segments():
    return [
        Segment(start=0.0, end=5.0, text="Hello everyone"),
        Segment(start=5.0, end=10.0, text="Let us begin the meeting"),
    ]


@pytest.fixture
def job(segments):
    job = TranscriptionJob(engine="whisper", language="en")
    job.status = JobStatus.COMPLETED
    job.segments = segments
    job.audio_path = "/tmp/test.wav"
    return job


@pytest.fixture
def pipeline():
    return PostProcessingPipeline()


def test_pipeline_init(pipeline):
    assert pipeline._ollama_client is not None


@pytest.mark.asyncio
async def test_run_sets_post_processing_status(pipeline, job):
    """Pipeline should transition job to POST_PROCESSING then READY."""
    with patch.object(pipeline, "_run_diarization", new_callable=AsyncMock) as mock_diar, \
         patch.object(pipeline, "_run_punctuation", new_callable=AsyncMock) as mock_punc, \
         patch.object(pipeline, "_run_itn", new_callable=AsyncMock) as mock_itn, \
         patch.object(pipeline, "_run_summary", new_callable=AsyncMock) as mock_summary:

        mock_diar.return_value = job.segments
        mock_punc.return_value = job.segments
        mock_itn.return_value = job.segments

        await pipeline.run(job)

    assert job.status == JobStatus.READY


@pytest.mark.asyncio
async def test_run_calls_processors_in_order(pipeline, job):
    """Pipeline should call processors: ITN → Punctuation → Diarization → Summary."""
    call_order = []

    async def mock_itn(segs, lang):
        call_order.append("itn")
        return segs

    async def mock_punc(segs, lang):
        call_order.append("punctuation")
        return segs

    async def mock_diar(audio, segs, lang):
        call_order.append("diarization")
        return segs

    async def mock_summary(j):
        call_order.append("summary")

    with patch.object(pipeline, "_run_itn", side_effect=mock_itn), \
         patch.object(pipeline, "_run_punctuation", side_effect=mock_punc), \
         patch.object(pipeline, "_run_diarization", side_effect=mock_diar), \
         patch.object(pipeline, "_run_summary", side_effect=mock_summary):

        await pipeline.run(job)

    assert call_order == ["itn", "punctuation", "diarization", "summary"]


@pytest.mark.asyncio
async def test_run_skips_if_not_completed(pipeline, job):
    """Pipeline should skip if job is not in COMPLETED status."""
    job.status = JobStatus.RUNNING
    await pipeline.run(job)
    assert job.status == JobStatus.RUNNING


@pytest.mark.asyncio
async def test_run_handles_error_gracefully(pipeline, job):
    """Pipeline should set READY even on partial failure."""
    with patch.object(pipeline, "_run_itn", new_callable=AsyncMock, side_effect=Exception("ITN failed")), \
         patch.object(pipeline, "_run_punctuation", new_callable=AsyncMock) as mock_punc, \
         patch.object(pipeline, "_run_diarization", new_callable=AsyncMock) as mock_diar, \
         patch.object(pipeline, "_run_summary", new_callable=AsyncMock):

        mock_punc.return_value = job.segments
        mock_diar.return_value = job.segments

        await pipeline.run(job)

    # Should still reach READY despite ITN failure
    assert job.status == JobStatus.READY


@pytest.mark.asyncio
async def test_generate_summary_with_ollama(pipeline, job):
    """Summary generation should call Ollama and store result."""
    mock_response = json.dumps({
        "topic": "Project kickoff meeting",
        "conclusions": ["We will start on Monday"],
        "action_items": [{"action": "Prepare docs", "owner": "Alice", "deadline": "Friday"}],
        "discussion": "The team discussed project timelines.",
    })

    with patch.object(pipeline._ollama_client, "is_available", new_callable=AsyncMock, return_value=True), \
         patch.object(pipeline._ollama_client, "generate", new_callable=AsyncMock, return_value=mock_response):
        await pipeline._run_summary(job)

    assert job.summary is not None
    assert "topic" in job.summary


@pytest.mark.asyncio
async def test_summary_handles_ollama_unavailable(pipeline, job):
    """Summary should be skipped if Ollama is unavailable."""
    with patch.object(pipeline._ollama_client, "is_available", new_callable=AsyncMock, return_value=False):
        await pipeline._run_summary(job)

    assert job.summary is None


@pytest.mark.asyncio
async def test_pipeline_updates_segments(pipeline, job):
    """Pipeline should update job.segments with processed results."""
    processed = [
        Segment(start=0.0, end=5.0, text="Hello everyone.", speaker="Speaker_1"),
        Segment(start=5.0, end=10.0, text="Let us begin the meeting.", speaker="Speaker_2"),
    ]

    with patch.object(pipeline, "_run_itn", new_callable=AsyncMock, return_value=job.segments), \
         patch.object(pipeline, "_run_punctuation", new_callable=AsyncMock, return_value=job.segments), \
         patch.object(pipeline, "_run_diarization", new_callable=AsyncMock, return_value=processed), \
         patch.object(pipeline, "_run_summary", new_callable=AsyncMock):

        await pipeline.run(job)

    assert job.segments[0].speaker == "Speaker_1"
    assert job.segments[1].speaker == "Speaker_2"
