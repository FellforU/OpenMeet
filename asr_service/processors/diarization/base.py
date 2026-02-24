"""Base interface for speaker diarization processors."""

from typing import Protocol
from asr_service.models.job import Segment


class Diarizer(Protocol):
    """Protocol for speaker diarization."""

    async def process(
        self, audio_path: str, segments: list[Segment]
    ) -> list[Segment]:
        """Assign speaker labels to transcription segments.

        Returns segments with speaker field populated.
        """
        ...

    def is_available(self) -> bool:
        """Check if this diarizer is ready to use."""
        ...
