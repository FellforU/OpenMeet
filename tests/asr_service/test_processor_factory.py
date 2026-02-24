"""Tests for the language-adaptive processor pipeline factory."""

from asr_service.processors.factory import create_pipeline
from asr_service.processors.vad.fsmn_vad import FSMNVadProcessor
from asr_service.processors.vad.silero_vad import SileroVadProcessor
from asr_service.processors.punctuation.ct_transformer import CTTransformerPunctuator
from asr_service.processors.itn import ChineseITNProcessor
from asr_service.processors.diarization.campplus import CAMPPlusDiarizer
from asr_service.processors.diarization.pyannote_diarizer import PyAnnoteDiarizer


def test_chinese_pipeline():
    pipeline = create_pipeline("zh")
    assert isinstance(pipeline.vad, FSMNVadProcessor)
    assert isinstance(pipeline.punctuator, CTTransformerPunctuator)
    assert isinstance(pipeline.itn, ChineseITNProcessor)
    assert isinstance(pipeline.diarizer, CAMPPlusDiarizer)


def test_cantonese_pipeline():
    pipeline = create_pipeline("yue")
    assert isinstance(pipeline.vad, FSMNVadProcessor)
    assert isinstance(pipeline.punctuator, CTTransformerPunctuator)
    assert isinstance(pipeline.itn, ChineseITNProcessor)
    assert isinstance(pipeline.diarizer, CAMPPlusDiarizer)


def test_english_pipeline():
    pipeline = create_pipeline("en")
    assert isinstance(pipeline.vad, SileroVadProcessor)
    assert pipeline.punctuator is None
    assert pipeline.itn is None
    assert isinstance(pipeline.diarizer, PyAnnoteDiarizer)


def test_japanese_pipeline():
    pipeline = create_pipeline("ja")
    assert isinstance(pipeline.vad, SileroVadProcessor)
    assert pipeline.punctuator is None
    assert pipeline.itn is None
    assert isinstance(pipeline.diarizer, PyAnnoteDiarizer)
