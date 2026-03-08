"""Post-processing pipeline for completed transcriptions.

Orchestrates: Hallucination Detection → ITN → Filler Filter → LLM Correction
→ Segmentation → Punctuation → Diarization → Embedding.
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

# Module-level LLM client reference, set by main.py
_llm_client = None

# Module-level pipeline toggle config, set by /config endpoint
_pipeline_toggles: dict = {}


def set_llm_client(client):
    global _llm_client
    _llm_client = client


def set_pipeline_config(toggles: dict):
    """Store pipeline toggle settings from frontend."""
    global _pipeline_toggles
    _pipeline_toggles = toggles
    logger.info("Pipeline config updated: %s", toggles)


@dataclass
class PipelineConfig:
    """Configuration for which pipeline steps to enable."""
    enable_hallucination_detection: bool = True
    enable_itn: bool = True
    enable_filler_filter: bool = True
    enable_segmentation: bool = True
    enable_punctuation: bool = True
    enable_diarization: bool = True
    enable_embedding: bool = True
    enable_llm_correction: bool = True
    segmentation_strategy: str = "hybrid"  # time/semantic/hybrid
    num_speakers: Optional[int] = None


class PostProcessingPipeline:
    """Orchestrates post-processing steps after transcription completes."""

    def __init__(self, config: Optional[PipelineConfig] = None) -> None:
        if config is not None:
            self._config = config
        elif _pipeline_toggles:
            # Build config from frontend toggle settings
            self._config = PipelineConfig(**{
                k: v for k, v in _pipeline_toggles.items()
                if hasattr(PipelineConfig, k)
            })
        else:
            self._config = PipelineConfig()

    # Engines that already produce punctuated output — skip CT-Transformer
    PUNCTUATED_ENGINES = {"qwen3", "whisper"}

    async def run(self, job: TranscriptionJob) -> None:
        """Run the full post-processing pipeline on a completed job.

        Steps: Hallucination Detection → ITN → Filler Filter → LLM Correction
        → Segmentation → Punctuation → Diarization → Embedding.
        Each step is fault-tolerant — failure skips to next step.
        Summary generation is handled by the frontend (Map-Reduce).
        """
        if job.status != JobStatus.COMPLETED:
            return

        # Release GPU memory from ASR engine before post-processing
        self._release_gpu_memory()

        job.status = JobStatus.POST_PROCESSING
        language = job.language or "zh"
        segments = job.segments

        # Create pipeline ONCE and reuse across all steps
        pipeline = create_pipeline(
            language,
            segmentation_strategy=self._config.segmentation_strategy,
        )

        # Step 1: Hallucination detection (remove ASR artifacts)
        if self._config.enable_hallucination_detection:
            try:
                segments = pipeline.hallucination_detector.detect(segments, language)
            except Exception as e:
                logger.warning("Hallucination detection step failed: %s", e)

        # Step 2: ITN (Inverse Text Normalization)
        if self._config.enable_itn and pipeline.itn is not None:
            try:
                segments = await pipeline.itn.normalize(segments, language)
            except Exception as e:
                logger.warning("ITN step failed: %s", e)

        # Step 3: Filler word filtering
        if self._config.enable_filler_filter:
            try:
                segments = await pipeline.filler_filter.filter(segments, language)
            except Exception as e:
                logger.warning("Filler filter step failed: %s", e)

        # Step 4: LLM-based ASR error correction
        if self._config.enable_llm_correction and _llm_client is not None:
            try:
                from asr_service.processors.llm_correction import LLMCorrector
                corrector = LLMCorrector(_llm_client)
                segments = await corrector.correct(segments)
            except Exception as e:
                logger.warning("LLM correction step failed: %s", e)

        # Step 5: Semantic segmentation (paragraph boundaries)
        if self._config.enable_segmentation:
            try:
                segments = pipeline.segmenter.process(segments)
            except Exception as e:
                logger.warning("Segmentation step failed: %s", e)

        # Step 6: Punctuation restoration (skip for engines that already produce punctuation)
        if self._config.enable_punctuation and job.engine not in self.PUNCTUATED_ENGINES:
            try:
                if pipeline.punctuator is not None:
                    segments = await pipeline.punctuator.restore(segments)
            except Exception as e:
                logger.warning("Punctuation step failed: %s", e)
        elif job.engine in self.PUNCTUATED_ENGINES:
            logger.info("Skipping punctuation for engine '%s' (already punctuated)", job.engine)

        # Step 7: Speaker diarization
        if self._config.enable_diarization and job.audio_path:
            try:
                segments = await pipeline.diarizer.process(
                    job.audio_path, segments,
                    num_speakers=self._config.num_speakers,
                )
            except Exception as e:
                logger.warning("Diarization step failed: %s", e)

        # Step 8: Extract speaker embeddings for voiceprint matching
        # Prefer pyannote's built-in embedding model (already loaded during
        # diarization) over a separate ECAPA-TDNN model download
        if self._config.enable_embedding and job.audio_path:
            job.embeddings = []
            # Try pyannote first (uses wespeaker-voxceleb-resnet34-LM, no extra download)
            try:
                if hasattr(pipeline.diarizer, 'extract_embeddings'):
                    job.embeddings = await pipeline.diarizer.extract_embeddings(
                        job.audio_path, segments
                    )
                    has_valid = any(e is not None for e in job.embeddings)
                    if has_valid:
                        logger.info("Embeddings extracted via pyannote")
            except Exception as e:
                logger.warning("pyannote embedding extraction failed: %s", e)

            # Fallback to ECAPA-TDNN if pyannote embeddings unavailable
            if not job.embeddings or not any(e is not None for e in job.embeddings):
                try:
                    extractor = create_embedding_extractor()
                    job.embeddings = await extractor.extract_embeddings(
                        job.audio_path, segments
                    )
                except Exception as e:
                    logger.warning("ECAPA-TDNN embedding extraction failed: %s", e)
                    job.embeddings = []
        else:
            job.embeddings = []

        job.segments = segments
        job.status = JobStatus.READY

    @staticmethod
    def _release_gpu_memory() -> None:
        """Release GPU memory from previous ASR engine before post-processing."""
        try:
            import gc
            gc.collect()
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

    async def close(self) -> None:
        """Clean up resources (no-op, kept for API compatibility)."""
