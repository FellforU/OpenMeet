"""Language-adaptive processor pipeline factory.

Chinese path: FSMN-VAD + CT-Transformer + WeTextProcessing ITN + CAMPPlus
General path: Silero-VAD + pyannote diarization
"""

from dataclasses import dataclass
from typing import Optional

from asr_service.processors.vad.fsmn_vad import FSMNVadProcessor
from asr_service.processors.vad.silero_vad import SileroVadProcessor
from asr_service.processors.punctuation.ct_transformer import CTTransformerPunctuator
from asr_service.processors.itn import ChineseITNProcessor
from asr_service.processors.diarization.factory import create_diarizer


@dataclass
class ProcessorPipeline:
    """Collection of processors selected for a given language."""
    vad: object  # FSMNVadProcessor or SileroVadProcessor
    punctuator: Optional[CTTransformerPunctuator]
    itn: Optional[ChineseITNProcessor]
    diarizer: object  # CAMPPlusDiarizer or PyAnnoteDiarizer


def create_pipeline(language: str) -> ProcessorPipeline:
    """Create a language-adaptive processor pipeline.

    Chinese → FSMN-VAD + CT-Transformer + ITN + CAMPPlus
    Other → Silero-VAD + pyannote
    """
    chinese_codes = {"zh", "yue", "wuu", "min_nan", "gan", "hakka", "xiang"}

    if language in chinese_codes:
        return ProcessorPipeline(
            vad=FSMNVadProcessor(),
            punctuator=CTTransformerPunctuator(),
            itn=ChineseITNProcessor(),
            diarizer=create_diarizer(language),
        )

    return ProcessorPipeline(
        vad=SileroVadProcessor(),
        punctuator=None,
        itn=None,
        diarizer=create_diarizer(language),
    )
