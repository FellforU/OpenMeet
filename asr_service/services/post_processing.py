"""Post-processing pipeline for completed transcriptions.

Orchestrates: ITN → Punctuation → Diarization.
Summary generation is handled by the frontend via llmClient.ts.
Auto-triggers when a job transitions to COMPLETED status.
"""

import logging
from typing import Optional

from asr_service.models.job import TranscriptionJob, JobStatus, Segment
from asr_service.processors.factory import create_pipeline

logger = logging.getLogger(__name__)


class PostProcessingPipeline:
    """Orchestrates post-processing steps after transcription completes."""

    def __init__(self) -> None:
        pass

    async def run(self, job: TranscriptionJob) -> None:
        """Run the full post-processing pipeline on a completed job.

        Steps: ITN → Punctuation → Diarization
        Each step is fault-tolerant — failure skips to next step.
        Summary generation is handled by the frontend.
        """
        if job.status != JobStatus.COMPLETED:
            return

        job.status = JobStatus.POST_PROCESSING
        language = job.language or "zh"
        segments = job.segments

        # Step 1: ITN (Inverse Text Normalization)
        try:
            segments = await self._run_itn(segments, language)
        except Exception as e:
            logger.warning("ITN step failed: %s", e)

        # Step 2: Punctuation restoration
        try:
            segments = await self._run_punctuation(segments, language)
        except Exception as e:
            logger.warning("Punctuation step failed: %s", e)

        # Step 3: Speaker diarization
        try:
            segments = await self._run_diarization(job.audio_path, segments, language)
        except Exception as e:
            logger.warning("Diarization step failed: %s", e)

        job.segments = segments
        job.status = JobStatus.READY

    async def _run_itn(
        self, segments: list[Segment], language: str
    ) -> list[Segment]:
        """Apply Inverse Text Normalization."""
        pipeline = create_pipeline(language)
        if pipeline.itn is None:
            return segments
        return await pipeline.itn.normalize(segments, language)

    async def _run_punctuation(
        self, segments: list[Segment], language: str
    ) -> list[Segment]:
        """Apply punctuation restoration."""
        pipeline = create_pipeline(language)
        if pipeline.punctuator is None:
            return segments
        return await pipeline.punctuator.restore(segments)

    async def _run_diarization(
        self, audio_path: Optional[str], segments: list[Segment], language: str
    ) -> list[Segment]:
        """Apply speaker diarization."""
        if not audio_path:
            return segments
        pipeline = create_pipeline(language)
        return await pipeline.diarizer.process(audio_path, segments)

    async def close(self) -> None:
        """Clean up resources (no-op, kept for API compatibility)."""
