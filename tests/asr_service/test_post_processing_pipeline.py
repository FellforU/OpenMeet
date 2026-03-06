"""Tests for the PostProcessingPipeline."""

from unittest.mock import AsyncMock, MagicMock, patch

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


def _make_mock_pipeline(segments):
    """Create a mock ProcessorPipeline whose processors return segments unchanged."""
    mock_pp = MagicMock()
    mock_pp.hallucination_detector.detect.return_value = segments
    mock_pp.itn = MagicMock()
    mock_pp.itn.normalize = AsyncMock(return_value=segments)
    mock_pp.filler_filter.filter = AsyncMock(return_value=segments)
    mock_pp.segmenter.process.return_value = segments
    mock_pp.punctuator = MagicMock()
    mock_pp.punctuator.restore = AsyncMock(return_value=segments)
    mock_pp.diarizer.process = AsyncMock(return_value=segments)
    return mock_pp


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
    mock_pp = _make_mock_pipeline(job.segments)

    with patch("asr_service.services.post_processing.create_pipeline", return_value=mock_pp), \
         patch("asr_service.services.post_processing.create_embedding_extractor") as mock_ext:
        mock_extractor = MagicMock()
        mock_extractor.extract_embeddings = AsyncMock(return_value=[])
        mock_ext.return_value = mock_extractor

        await pipeline.run(job)

    assert job.status == JobStatus.READY


@pytest.mark.asyncio
async def test_run_calls_processors_in_order(pipeline, job):
    """Pipeline should call processors: Hallucination -> ITN -> Filler -> Segmentation -> Punctuation -> Diarization."""
    call_order = []

    mock_pp = MagicMock()

    def mock_detect(segs, lang):
        call_order.append("hallucination")
        return segs
    mock_pp.hallucination_detector.detect.side_effect = mock_detect

    mock_pp.itn = MagicMock()
    async def mock_normalize(segs, lang):
        call_order.append("itn")
        return segs
    mock_pp.itn.normalize = mock_normalize

    async def mock_filter(segs, lang):
        call_order.append("filler")
        return segs
    mock_pp.filler_filter.filter = mock_filter

    def mock_segment(segs):
        call_order.append("segmentation")
        return segs
    mock_pp.segmenter.process.side_effect = mock_segment

    mock_pp.punctuator = MagicMock()
    async def mock_restore(segs):
        call_order.append("punctuation")
        return segs
    mock_pp.punctuator.restore = mock_restore

    async def mock_diarize(audio, segs):
        call_order.append("diarization")
        return segs
    mock_pp.diarizer.process = mock_diarize

    with patch("asr_service.services.post_processing.create_pipeline", return_value=mock_pp), \
         patch("asr_service.services.post_processing.create_embedding_extractor") as mock_ext:
        mock_extractor = MagicMock()
        mock_extractor.extract_embeddings = AsyncMock(return_value=[])
        mock_ext.return_value = mock_extractor

        await pipeline.run(job)

    assert call_order == ["hallucination", "itn", "filler", "segmentation", "punctuation", "diarization"]


@pytest.mark.asyncio
async def test_run_skips_if_not_completed(pipeline, job):
    """Pipeline should skip if job is not in COMPLETED status."""
    job.status = JobStatus.RUNNING
    await pipeline.run(job)
    assert job.status == JobStatus.RUNNING


@pytest.mark.asyncio
async def test_run_handles_error_gracefully(pipeline, job):
    """Pipeline should set READY even on partial failure."""
    mock_pp = _make_mock_pipeline(job.segments)
    # Make ITN raise an error
    mock_pp.itn.normalize = AsyncMock(side_effect=Exception("ITN failed"))

    with patch("asr_service.services.post_processing.create_pipeline", return_value=mock_pp), \
         patch("asr_service.services.post_processing.create_embedding_extractor") as mock_ext:
        mock_extractor = MagicMock()
        mock_extractor.extract_embeddings = AsyncMock(return_value=[])
        mock_ext.return_value = mock_extractor

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

    mock_pp = _make_mock_pipeline(job.segments)
    # Diarizer returns processed segments with speaker labels
    mock_pp.diarizer.process = AsyncMock(return_value=processed)

    with patch("asr_service.services.post_processing.create_pipeline", return_value=mock_pp), \
         patch("asr_service.services.post_processing.create_embedding_extractor") as mock_ext:
        mock_extractor = MagicMock()
        mock_extractor.extract_embeddings = AsyncMock(return_value=[])
        mock_ext.return_value = mock_extractor

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

    mock_pp = _make_mock_pipeline(segments)

    with patch("asr_service.services.post_processing.create_pipeline", return_value=mock_pp), \
         patch("asr_service.services.post_processing.create_embedding_extractor") as mock_ext:
        mock_extractor = MagicMock()
        mock_extractor.extract_embeddings = AsyncMock(return_value=[])
        mock_ext.return_value = mock_extractor

        await pipeline.run(job)

    mock_pp.punctuator.restore.assert_not_called()


@pytest.mark.asyncio
async def test_skips_punctuation_for_qwen3(pipeline, segments):
    """Pipeline should skip punctuation for Qwen3 engine."""
    job = TranscriptionJob(engine="qwen3", language="zh")
    job.status = JobStatus.COMPLETED
    job.segments = segments
    job.audio_path = "/tmp/test.wav"

    mock_pp = _make_mock_pipeline(segments)

    with patch("asr_service.services.post_processing.create_pipeline", return_value=mock_pp), \
         patch("asr_service.services.post_processing.create_embedding_extractor") as mock_ext:
        mock_extractor = MagicMock()
        mock_extractor.extract_embeddings = AsyncMock(return_value=[])
        mock_ext.return_value = mock_extractor

        await pipeline.run(job)

    mock_pp.punctuator.restore.assert_not_called()


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

    mock_pp = _make_mock_pipeline(segments)

    with patch("asr_service.services.post_processing.create_pipeline", return_value=mock_pp), \
         patch("asr_service.services.post_processing.create_embedding_extractor") as mock_ext:
        mock_extractor = MagicMock()
        mock_extractor.extract_embeddings = AsyncMock(return_value=[])
        mock_ext.return_value = mock_extractor

        await pipeline.run(job)

    mock_pp.hallucination_detector.detect.assert_not_called()
    mock_pp.filler_filter.filter.assert_not_called()


@pytest.mark.asyncio
async def test_close_is_noop(pipeline):
    """close() should be a no-op."""
    await pipeline.close()
