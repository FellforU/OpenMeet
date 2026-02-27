from typing import Protocol, Optional, Callable
from dataclasses import dataclass

from asr_service.models.job import Segment


@dataclass
class AudioInput:
    file_path: str
    language: Optional[str] = None
    model_size: str = "base"


@dataclass
class EngineCapabilities:
    name: str
    supported_languages: list[str]
    supports_streaming: bool
    supports_timestamps: bool
    supports_diarization: bool
    model_sizes: list[str]


class ASREngine(Protocol):
    """Protocol for all ASR engines."""

    async def transcribe(
        self, audio: AudioInput, on_progress: Optional[Callable] = None
    ) -> list[Segment]: ...

    async def get_capabilities(self) -> EngineCapabilities: ...

    async def load_model(self, model_size: str) -> None: ...

    async def unload_model(self) -> None: ...

    def is_loaded(self) -> bool: ...

    def is_model_downloaded(self, model_size: str) -> bool: ...

    async def download_model(self, model_size: str) -> str: ...
