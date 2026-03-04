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
from asr_service.processors.diarization.factory import create_diarizer


@dataclass
class ProcessorPipeline:
    """Collection of processors selected for a given language."""
    vad: object  # FSMNVadProcessor or SileroVadProcessor
    punctuator: Optional[CTTransformerPunctuator]
    itn: Optional[ChineseITNProcessor]
    filler_filter: FillerFilterProcessor
    hallucination_detector: HallucinationDetector
    diarizer: object  # CAMPPlusDiarizer or PyAnnoteDiarizer


def create_pipeline(language: str) -> ProcessorPipeline:
    """Create a language-adaptive processor pipeline.

    Chinese → FSMN-VAD + CT-Transformer + ITN + FillerFilter + HallucinationDetector + CAMPPlus
    Other → Silero-VAD + FillerFilter + HallucinationDetector + pyannote
    """
    chinese_codes = {"zh", "yue", "wuu", "min_nan", "gan", "hakka", "xiang"}

    if language in chinese_codes:
        return ProcessorPipeline(
            vad=FSMNVadProcessor(),
            punctuator=CTTransformerPunctuator(),
            itn=ChineseITNProcessor(),
            filler_filter=FillerFilterProcessor(),
            hallucination_detector=HallucinationDetector(),
            diarizer=create_diarizer(language),
        )

    return ProcessorPipeline(
        vad=SileroVadProcessor(),
        punctuator=None,
        itn=None,
        filler_filter=FillerFilterProcessor(),
        hallucination_detector=HallucinationDetector(),
        diarizer=create_diarizer(language),
    )
