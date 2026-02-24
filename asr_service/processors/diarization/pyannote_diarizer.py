"""pyannote-audio based speaker diarization for multilingual audio.

High quality, supports all languages. Requires HuggingFace token.
"""

import asyncio
import os
from typing import Optional

from asr_service.models.job import Segment


class PyAnnoteDiarizer:
    """Speaker diarization using pyannote-audio pipeline."""

    def __init__(self):
        self._pipeline = None

    async def load(self) -> None:
        if self._pipeline:
            return

        hf_token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")

        def _load():
            try:
                from pyannote.audio import Pipeline
                pipeline = Pipeline.from_pretrained(
                    "pyannote/speaker-diarization-3.1",
                    use_auth_token=hf_token,
                )
                return pipeline
            except Exception:
                return None

        self._pipeline = await asyncio.to_thread(_load)

    def is_available(self) -> bool:
        return self._pipeline is not None

    async def process(
        self, audio_path: str, segments: list[Segment]
    ) -> list[Segment]:
        """Assign speaker labels using pyannote diarization pipeline."""
        if not self._pipeline:
            await self.load()

        if not self._pipeline:
            return segments

        pipeline_ref = self._pipeline

        def _diarize():
            diarization = pipeline_ref(audio_path)
            # Build timeline of speaker turns
            turns = []
            for turn, _, speaker in diarization.itertracks(yield_label=True):
                turns.append({
                    "start": turn.start,
                    "end": turn.end,
                    "speaker": speaker,
                })
            return turns

        turns = await asyncio.to_thread(_diarize)

        # Assign speaker labels based on time overlap
        labeled = []
        for seg in segments:
            seg_mid = (seg.start + seg.end) / 2
            speaker = _find_speaker_at_time(turns, seg_mid)
            labeled.append(
                Segment(
                    start=seg.start,
                    end=seg.end,
                    text=seg.text,
                    speaker=speaker,
                    confidence=seg.confidence,
                )
            )
        return labeled


def _find_speaker_at_time(turns: list[dict], time: float) -> Optional[str]:
    """Find the speaker active at a given time."""
    for turn in turns:
        if turn["start"] <= time <= turn["end"]:
            return turn["speaker"]
    return None
