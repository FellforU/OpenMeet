"""OpenAI Whisper API engine adapter.

Uses the OpenAI Whisper API for cloud-based transcription.
Requires OPENAI_API_KEY environment variable.
"""

import asyncio
import os
from typing import Optional, Callable

from asr_service.engines.base import AudioInput, EngineCapabilities
from asr_service.models.job import Segment


def _create_openai_client(api_key: str):
    """Create OpenAI client. Separated for testability."""
    from openai import OpenAI
    return OpenAI(api_key=api_key)


class OpenAIWhisperEngine:
    """ASR engine using OpenAI Whisper API."""

    def __init__(self):
        self._api_key: Optional[str] = None

    async def get_capabilities(self) -> EngineCapabilities:
        return EngineCapabilities(
            name="openai-whisper",
            supported_languages=[
                "en", "zh", "ja", "ko", "de", "fr", "es", "pt",
                "ru", "ar", "hi", "auto",
            ],
            supports_streaming=False,
            supports_timestamps=True,
            supports_diarization=False,
            model_sizes=["whisper-1"],
        )

    async def load_model(self, model_size: str = "whisper-1") -> None:
        key = os.environ.get("OPENAI_API_KEY")
        if not key:
            raise ValueError(
                "OPENAI_API_KEY environment variable not set. "
                "Set it in Settings > API Keys."
            )
        self._api_key = key

    async def unload_model(self) -> None:
        self._api_key = None

    def is_loaded(self) -> bool:
        return self._api_key is not None

    async def transcribe(
        self,
        audio: AudioInput,
        on_progress: Optional[Callable] = None,
    ) -> list[Segment]:
        if not self._api_key:
            raise RuntimeError("API key not configured. Call load_model() first.")

        api_key = self._api_key
        language = audio.language if audio.language and audio.language != "auto" else None
        file_path = audio.file_path

        def _call_api():
            client = _create_openai_client(api_key)
            with open(file_path, "rb") as f:
                kwargs = {
                    "model": "whisper-1",
                    "file": f,
                    "response_format": "verbose_json",
                    "timestamp_granularities": ["segment"],
                }
                if language:
                    kwargs["language"] = language
                return client.audio.transcriptions.create(**kwargs)

        response = await asyncio.to_thread(_call_api)

        segments = []
        for seg in response.segments:
            segments.append(
                Segment(
                    start=round(seg.start, 3),
                    end=round(seg.end, 3),
                    text=seg.text.strip() if isinstance(seg.text, str) else str(seg.text),
                    confidence=round(seg.avg_logprob, 3) if hasattr(seg, "avg_logprob") and seg.avg_logprob else None,
                )
            )
        return segments
