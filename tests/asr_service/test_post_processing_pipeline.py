"""Tests for the PostProcessingPipeline."""

from unittest.mock import AsyncMock, patch

import pytest

from asr_service.models.job import Segment, TranscriptionJob, JobStatus
from asr_service.services.post_processing import PostProcessingPipeline, PipelineConfig


@pytest.fixture
def segments():
    return [
        Segment(start=0.0, end=5.0, text="Hello everyone"),
        Segment(start=5.0, end=10.0, text="Let us begin the meeting"),
    ]


@pytest.fixture
def job(segments):
    """Job with a non-punctuated engine (paraformer) so punctuation step runs."""
    job = TranscriptionJob(engine="paraformer", language="en")
    job.status = JobStatus.COMPLETED
    job.segments = segments
    job.audio_path = "/tmp/test.wav"
    return job


@pytest.fixture
def pipeline():
    return PostProcessingPipeline()


def test_pipeline_init(pipeline):
    assert isinstance(pipeline, PostProcessingPipeline)


def test_pipeline_config_defaults():
    config = PipelineConfig()
    assert config.enable_hallucination_detection is True
    assert config.enable_itn is True
    assert config.enable_filler_filter is True
    assert config.enable_punctuation is True
    assert config.enable_diarization is True
    assert config.enable_embedding is True


@pytest.mark.asyncio
async def test_run_sets_post_processing_status(pipeline, job):
    """Pipeline should transition job to POST_PROCESSING then READY."""
    with patch.object(pipeline, "_run_hallucination_detection", new_callable=AsyncMock) as mock_hall, \
         patch.object(pipeline, "_run_diarization", new_callable=AsyncMock) as mock_diar, \
         patch.object(pipeline, "_run_punctuation", new_callable=AsyncMock) as mock_punc, \
         patch.object(pipeline, "_run_filler_filter", new_callable=AsyncMock) as mock_filler, \
         patch.object(pipeline, "_run_itn", new_callable=AsyncMock) as mock_itn:

        mock_hall.return_value = job.segments
        mock_diar.return_value = job.segments
        mock_punc.return_value = job.segments
        mock_filler.return_value = job.segments
        mock_itn.return_value = job.segments

        await pipeline.run(job)

    assert job.status == JobStatus.READY


@pytest.mark.asyncio
async def test_run_calls_processors_in_order(pipeline, job):
    """Pipeline should call processors: Hallucination → ITN → Filler → Punctuation → Diarization."""
    call_order = []

    async def mock_hall(segs, lang):
        call_order.append("hallucination")
        return segs

    async def mock_itn(segs, lang):
        call_order.append("itn")
        return segs

    async def mock_filler(segs, lang):
        call_order.append("filler")
        return segs

    async def mock_punc(segs, lang):
        call_order.append("punctuation")
        return segs

    async def mock_diar(audio, segs, lang):
        call_order.append("diarization")
        return segs

    with patch.object(pipeline, "_run_hallucination_detection", side_effect=mock_hall), \
         patch.object(pipeline, "_run_itn", side_effect=mock_itn), \
         patch.object(pipeline, "_run_filler_filter", side_effect=mock_filler), \
         patch.object(pipeline, "_run_punctuation", side_effect=mock_punc), \
         patch.object(pipeline, "_run_diarization", side_effect=mock_diar):

        await pipeline.run(job)

    assert call_order == ["hallucination", "itn", "filler", "punctuation", "diarization"]


@pytest.mark.asyncio
async def test_run_skips_if_not_completed(pipeline, job):
    """Pipeline should skip if job is not in COMPLETED status."""
    job.status = JobStatus.RUNNING
    await pipeline.run(job)
    assert job.status == JobStatus.RUNNING


@pytest.mark.asyncio
async def test_run_handles_error_gracefully(pipeline, job):
    """Pipeline should set READY even on partial failure."""
    with patch.object(pipeline, "_run_hallucination_detection", new_callable=AsyncMock, return_value=job.segments), \
         patch.object(pipeline, "_run_itn", new_callable=AsyncMock, side_effect=Exception("ITN failed")), \
         patch.object(pipeline, "_run_filler_filter", new_callable=AsyncMock) as mock_filler, \
         patch.object(pipeline, "_run_punctuation", new_callable=AsyncMock) as mock_punc, \
         patch.object(pipeline, "_run_diarization", new_callable=AsyncMock) as mock_diar:

        mock_filler.return_value = job.segments
        mock_punc.return_value = job.segments
        mock_diar.return_value = job.segments

        await pipeline.run(job)

    # Should still reach READY despite ITN failure
    assert job.status == JobStatus.READY


@pytest.mark.asyncio
async def test_pipeline_updates_segments(pipeline, job):
    """Pipeline should update job.segments with processed results."""
    processed = [
        Segment(start=0.0, end=5.0, text="Hello everyone.", speaker="Speaker_1"),
        Segment(start=5.0, end=10.0, text="Let us begin the meeting.", speaker="Speaker_2"),
    ]

    with patch.object(pipeline, "_run_hallucination_detection", new_callable=AsyncMock, return_value=job.segments), \
         patch.object(pipeline, "_run_itn", new_callable=AsyncMock, return_value=job.segments), \
         patch.object(pipeline, "_run_filler_filter", new_callable=AsyncMock, return_value=job.segments), \
         patch.object(pipeline, "_run_punctuation", new_callable=AsyncMock, return_value=job.segments), \
         patch.object(pipeline, "_run_diarization", new_callable=AsyncMock, return_value=processed):

        await pipeline.run(job)

    assert job.segments[0].speaker == "Speaker_1"
    assert job.segments[1].speaker == "Speaker_2"


@pytest.mark.asyncio
async def test_skips_punctuation_for_whisper(pipeline, segments):
    """Pipeline should skip punctuation for engines that already produce punctuation."""
    job = TranscriptionJob(engine="whisper", language="en")
    job.status = JobStatus.COMPLETED
    job.segments = segments
    job.audio_path = "/tmp/test.wav"

    with patch.object(pipeline, "_run_hallucination_detection", new_callable=AsyncMock, return_value=segments), \
         patch.object(pipeline, "_run_itn", new_callable=AsyncMock, return_value=segments), \
         patch.object(pipeline, "_run_filler_filter", new_callable=AsyncMock, return_value=segments), \
         patch.object(pipeline, "_run_punctuation", new_callable=AsyncMock) as mock_punc, \
         patch.object(pipeline, "_run_diarization", new_callable=AsyncMock, return_value=segments):

        await pipeline.run(job)

    mock_punc.assert_not_called()


@pytest.mark.asyncio
async def test_skips_punctuation_for_qwen3(pipeline, segments):
    """Pipeline should skip punctuation for Qwen3 engine."""
    job = TranscriptionJob(engine="qwen3", language="zh")
    job.status = JobStatus.COMPLETED
    job.segments = segments
    job.audio_path = "/tmp/test.wav"

    with patch.object(pipeline, "_run_hallucination_detection", new_callable=AsyncMock, return_value=segments), \
         patch.object(pipeline, "_run_itn", new_callable=AsyncMock, return_value=segments), \
         patch.object(pipeline, "_run_filler_filter", new_callable=AsyncMock, return_value=segments), \
         patch.object(pipeline, "_run_punctuation", new_callable=AsyncMock) as mock_punc, \
         patch.object(pipeline, "_run_diarization", new_callable=AsyncMock, return_value=segments):

        await pipeline.run(job)

    mock_punc.assert_not_called()


@pytest.mark.asyncio
async def test_pipeline_configurable_disable_steps(segments):
    """Pipeline should skip disabled steps."""
    config = PipelineConfig(
        enable_hallucination_detection=False,
        enable_filler_filter=False,
    )
    pipeline = PostProcessingPipeline(config)
    job = TranscriptionJob(engine="paraformer", language="en")
    job.status = JobStatus.COMPLETED
    job.segments = segments
    job.audio_path = "/tmp/test.wav"

    with patch.object(pipeline, "_run_hallucination_detection", new_callable=AsyncMock) as mock_hall, \
         patch.object(pipeline, "_run_itn", new_callable=AsyncMock, return_value=segments), \
         patch.object(pipeline, "_run_filler_filter", new_callable=AsyncMock) as mock_filler, \
         patch.object(pipeline, "_run_punctuation", new_callable=AsyncMock, return_value=segments), \
         patch.object(pipeline, "_run_diarization", new_callable=AsyncMock, return_value=segments):

        await pipeline.run(job)

    mock_hall.assert_not_called()
    mock_filler.assert_not_called()


@pytest.mark.asyncio
async def test_close_is_noop(pipeline):
    """close() should be a no-op."""
    await pipeline.close()
