"""Factory for selecting the appropriate diarizer based on language."""

from asr_service.processors.diarization.campplus import CAMPPlusDiarizer
from asr_service.processors.diarization.ecapa_tdnn import EcapaTdnnExtractor
from asr_service.processors.diarization.pyannote_diarizer import PyAnnoteDiarizer


_cached_campplus_diarizer: CAMPPlusDiarizer | None = None
_cached_pyannote_diarizer: PyAnnoteDiarizer | None = None


def create_diarizer(language: str):
    """Select diarizer based on language (cached to avoid reloading models).

    Chinese → CAMPPlus (lightweight, optimized for Chinese)
    Other → pyannote-audio (multilingual, highest quality)
    """
    global _cached_campplus_diarizer, _cached_pyannote_diarizer
    chinese_codes = {"zh", "yue", "wuu", "min_nan", "gan", "hakka", "xiang"}

    if language in chinese_codes:
        if _cached_campplus_diarizer is None:
            _cached_campplus_diarizer = CAMPPlusDiarizer()
        return _cached_campplus_diarizer

    if _cached_pyannote_diarizer is None:
        _cached_pyannote_diarizer = PyAnnoteDiarizer()
    return _cached_pyannote_diarizer


_cached_embedding_extractor: EcapaTdnnExtractor | None = None


def create_embedding_extractor():
    """Get or create the cached ECAPA-TDNN embedding extractor."""
    global _cached_embedding_extractor
    if _cached_embedding_extractor is None:
        _cached_embedding_extractor = EcapaTdnnExtractor()
    return _cached_embedding_extractor
