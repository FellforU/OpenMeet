"""Factory for selecting the appropriate diarizer.

Priority: pyannote-audio (best quality) → CAMPPlus (fallback for Chinese).
"""

import logging

from asr_service.processors.diarization.campplus import CAMPPlusDiarizer
from asr_service.processors.diarization.ecapa_tdnn import EcapaTdnnExtractor
from asr_service.processors.diarization.pyannote_diarizer import PyAnnoteDiarizer

logger = logging.getLogger(__name__)

_cached_pyannote_diarizer: PyAnnoteDiarizer | None = None
_cached_campplus_diarizer: CAMPPlusDiarizer | None = None


def create_diarizer(language: str):
    """Select diarizer (cached to avoid reloading models).

    Always tries pyannote first (best quality, all languages).
    Falls back to CAMPPlus for Chinese if pyannote is unavailable
    (e.g., no HuggingFace token, model not downloaded).
    """
    global _cached_pyannote_diarizer, _cached_campplus_diarizer

    # Always try pyannote first — it's the best quality option
    if _cached_pyannote_diarizer is None:
        _cached_pyannote_diarizer = PyAnnoteDiarizer()
    return _cached_pyannote_diarizer


def create_campplus_fallback():
    """Get or create CAMPPlus diarizer as fallback.

    Called by PyAnnoteDiarizer when pyannote model is unavailable.
    """
    global _cached_campplus_diarizer
    if _cached_campplus_diarizer is None:
        _cached_campplus_diarizer = CAMPPlusDiarizer()
    return _cached_campplus_diarizer


_cached_embedding_extractor: EcapaTdnnExtractor | None = None


def create_embedding_extractor():
    """Get or create the cached ECAPA-TDNN embedding extractor."""
    global _cached_embedding_extractor
    if _cached_embedding_extractor is None:
        _cached_embedding_extractor = EcapaTdnnExtractor()
    return _cached_embedding_extractor
