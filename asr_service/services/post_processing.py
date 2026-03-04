"""Post-processing pipeline for completed transcriptions.

Orchestrates: Hallucination Detection → ITN → Filler Filter → Punctuation → Diarization.
Summary generation is handled by the frontend via llmClient.ts (Map-Reduce).
Auto-triggers when a job transitions to COMPLETED status.
"""

import logging
from dataclasses import dataclass, field
from typing import Optional

from asr_service.models.job import TranscriptionJob, JobStatus, Segment
from asr_service.processors.factory import create_pipeline
from asr_service.processors.diarization.factory import create_embedding_extractor

logger = logging.getLogger(__name__)


@dataclass
class PipelineConfig:
    """Configuration for which pipeline steps to enable."""
    enable_hallucination_detection: bool = True
    enable_itn: bool = True
    enable_filler_filter: bool = True
    enable_punctuation: bool = True
    enable_diarization: bool = True
    enable_embedding: bool = True


class PostProcessingPipeline:
    """Orchestrates post-processing steps after transcription completes."""

    def __init__(self, config: Optional[PipelineConfig] = None) -> None:
        self._config = config or PipelineConfig()

    # Engines that already produce punctuated output — skip CT-Transformer
    PUNCTUATED_ENGINES = {"qwen3", "whisper"}

    async def run(self, job: TranscriptionJob) -> None:
        """Run the full post-processing pipeline on a completed job.

        Steps: Hallucination Detection → ITN → Filler Filter → Punctuation → Diarization → Embedding
        Each step is fault-tolerant — failure skips to next step.
        Summary generation is handled by the frontend (Map-Reduce).
        """
        if job.status != JobStatus.COMPLETED:
            return

        job.status = JobStatus.POST_PROCESSING
        language = job.language or "zh"
        segments = job.segments

        # Step 1: Hallucination detection (remove ASR artifacts)
        if self._config.enable_hallucination_detection:
            try:
                segments = await self._run_hallucination_detection(segments, language)
            except Exception as e:
                logger.warning("Hallucination detection step failed: %s", e)

        # Step 2: ITN (Inverse Text Normalization)
        if self._config.enable_itn:
            try:
                segments = await self._run_itn(segments, language)
            except Exception as e:
                logger.warning("ITN step failed: %s", e)

        # Step 3: Filler word filtering
        if self._config.enable_filler_filter:
            try:
                segments = await self._run_filler_filter(segments, language)
            except Exception as e:
                logger.warning("Filler filter step failed: %s", e)

        # Step 4: Punctuation restoration (skip for engines that already produce punctuation)
        if self._config.enable_punctuation and job.engine not in self.PUNCTUATED_ENGINES:
            try:
                segments = await self._run_punctuation(segments, language)
            except Exception as e:
                logger.warning("Punctuation step failed: %s", e)
        elif job.engine in self.PUNCTUATED_ENGINES:
            logger.info("Skipping punctuation for engine '%s' (already punctuated)", job.engine)

        # Step 5: Speaker diarization
        if self._config.enable_diarization:
            try:
                segments = await self._run_diarization(job.audio_path, segments, language)
            except Exception as e:
                logger.warning("Diarization step failed: %s", e)

        # Step 6: Extract speaker embeddings for voiceprint matching
        if self._config.enable_embedding and job.audio_path:
            try:
                extractor = create_embedding_extractor()
                job.embeddings = await extractor.extract_embeddings(
                    job.audio_path, segments
                )
            except Exception as e:
                logger.warning("Embedding extraction failed: %s", e)
                job.embeddings = []
        else:
            job.embeddings = []

        job.segments = segments
        job.status = JobStatus.READY

    async def _run_hallucination_detection(
        self, segments: list[Segment], language: str
    ) -> list[Segment]:
        """Remove hallucinated segments from ASR output."""
        pipeline = create_pipeline(language)
        return pipeline.hallucination_detector.detect(segments, language)

    async def _run_itn(
        self, segments: list[Segment], language: str
    ) -> list[Segment]:
        """Apply Inverse Text Normalization."""
        pipeline = create_pipeline(language)
        if pipeline.itn is None:
            return segments
        return await pipeline.itn.normalize(segments, language)

    async def _run_filler_filter(
        self, segments: list[Segment], language: str
    ) -> list[Segment]:
        """Remove filler words and merge repetitions."""
        pipeline = create_pipeline(language)
        return await pipeline.filler_filter.filter(segments, language)

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
