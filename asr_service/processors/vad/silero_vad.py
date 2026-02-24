"""Silero-VAD processor for general/multilingual audio segmentation.

Lightweight VAD model, works across all languages.
"""

import asyncio
from typing import Optional


class SileroVadProcessor:
    """Voice Activity Detection using Silero-VAD for general use."""

    def __init__(self):
        self._model = None
        self._utils = None

    async def load(self) -> None:
        if self._model:
            return

        def _load():
            try:
                import torch
                model, utils = torch.hub.load(
                    repo_or_dir="snakers4/silero-vad",
                    model="silero_vad",
                    force_reload=False,
                    onnx=True,
                )
                return model, utils
            except Exception:
                return None, None

        self._model, self._utils = await asyncio.to_thread(_load)

    def is_available(self) -> bool:
        return self._model is not None

    async def detect(self, audio_path: str) -> list[tuple[float, float]]:
        """Detect speech segments in audio.

        Returns list of (start_ms, end_ms) tuples.
        """
        if not self._model:
            await self.load()

        if not self._model or not self._utils:
            return []

        model_ref = self._model
        get_speech_timestamps = self._utils[0]
        read_audio = self._utils[1]

        def _detect():
            wav = read_audio(audio_path, sampling_rate=16000)
            timestamps = get_speech_timestamps(
                wav,
                model_ref,
                sampling_rate=16000,
                threshold=0.5,
            )
            return [
                (float(ts["start"]) / 16.0, float(ts["end"]) / 16.0)
                for ts in timestamps
            ]

        return await asyncio.to_thread(_detect)
