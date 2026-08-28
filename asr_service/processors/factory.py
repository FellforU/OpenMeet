"""Language-adaptive processor pipeline factory.

Chinese path: FSMN-VAD + CT-Transformer + WeTextProcessing ITN + FillerFilter + HallucinationDetector + CAMPPlus
General path: Silero-VAD + FillerFilter + HallucinationDetector + pyannote diarization
"""

from dataclasses import dataclass
from typing import Optional

from asr_service.processors.vad.fsmn_vad import FSMNVadProcessor
from asr_service.processors.vad.silero_vad import SileroVadProcessor
from asr_service.processors.punctuation.ct_transformer import CTTransformerPunctuator
from asr_service.processors.itn import ChineseITNProcessor
from asr_service.processors.filler_filter import FillerFilterProcessor
from asr_service.processors.hallucination_detector import HallucinationDetector
from asr_service.processors.segmenter import SemanticSegmenter, SegmenterConfig
from asr_service.processors.diarization.factory import create_diarizer

# Module-level singletons so loaded models survive across jobs
# (mirrors the caching in diarization/factory.py) — previously the
# punctuation model was reloaded from disk on every job
_cached_punctuator: Optional[CTTransformerPunctuator] = None
_cached_itn: Optional[ChineseITNProcessor] = None


def _get_punctuator() -> CTTransformerPunctuator:
    global _cached_punctuator
    if _cached_punctuator is None:
        _cached_punctuator = CTTransformerPunctuator()
    return _cached_punctuator


def _get_itn() -> ChineseITNProcessor:
    global _cached_itn
    if _cached_itn is None:
        _cached_itn = ChineseITNProcessor()
    return _cached_itn


@dataclass
class ProcessorPipeline:
    """Collection of processors selected for a given language."""
    vad: object  # FSMNVadProcessor or SileroVadProcessor
    punctuator: Optional[CTTransformerPunctuator]
    itn: Optional[ChineseITNProcessor]
    filler_filter: FillerFilterProcessor
    hallucination_detector: HallucinationDetector
    segmenter: SemanticSegmenter
    diarizer: object  # PyAnnoteDiarizer (primary) or CAMPPlusDiarizer (fallback)


def create_pipeline(
    language: str,
    segmentation_strategy: str = "hybrid",
) -> ProcessorPipeline:
    """Create a language-adaptive processor pipeline.

    Chinese → FSMN-VAD + CT-Transformer + ITN + FillerFilter + HallucinationDetector + Segmenter + CAMPPlus
    Other → Silero-VAD + FillerFilter + HallucinationDetector + Segmenter + pyannote
    """
    chinese_codes = {"zh", "yue", "wuu", "min_nan", "gan", "hakka", "xiang"}

    segmenter_config = SegmenterConfig(
        language=language,
        strategy=segmentation_strategy,
    )

    if language in chinese_codes:
        return ProcessorPipeline(
            vad=FSMNVadProcessor(),
            punctuator=_get_punctuator(),
            itn=_get_itn(),
            filler_filter=FillerFilterProcessor(),
            hallucination_detector=HallucinationDetector(),
            segmenter=SemanticSegmenter(segmenter_config),
            diarizer=create_diarizer(language),
        )

    return ProcessorPipeline(
        vad=SileroVadProcessor(),
        punctuator=None,
        itn=None,
        filler_filter=FillerFilterProcessor(),
        hallucination_detector=HallucinationDetector(),
        segmenter=SemanticSegmenter(segmenter_config),
        diarizer=create_diarizer(language),
    )
