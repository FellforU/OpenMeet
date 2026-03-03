"""Factory for selecting the appropriate diarizer based on language."""

from asr_service.processors.diarization.campplus import CAMPPlusDiarizer
from asr_service.processors.diarization.ecapa_tdnn import EcapaTdnnExtractor
from asr_service.processors.diarization.pyannote_diarizer import PyAnnoteDiarizer


def create_diarizer(language: str):
    """Select diarizer based on language.

    Chinese → CAMPPlus (lightweight, optimized for Chinese)
    Other → pyannote-audio (multilingual, highest quality)
    """
    chinese_codes = {"zh", "yue", "wuu", "min_nan", "gan", "hakka", "xiang"}

    if language in chinese_codes:
        return CAMPPlusDiarizer()
    return PyAnnoteDiarizer()


_cached_embedding_extractor: EcapaTdnnExtractor | None = None


def create_embedding_extractor():
    """Get or create the cached ECAPA-TDNN embedding extractor."""
    global _cached_embedding_extractor
    if _cached_embedding_extractor is None:
        _cached_embedding_extractor = EcapaTdnnExtractor()
    return _cached_embedding_extractor
