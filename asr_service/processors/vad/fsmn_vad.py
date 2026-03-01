"""FSMN-VAD processor for Chinese audio segmentation.

Uses FunASR's FSMN-VAD model, optimized for Chinese speech.
"""

import asyncio
import logging
from typing import Optional

from asr_service.processors.model_utils import resolve_modelscope_model

logger = logging.getLogger(__name__)

FSMN_VAD_MODEL_DIR = "speech_fsmn_vad_zh-cn-16k-common-pytorch"


class FSMNVadProcessor:
    """Voice Activity Detection using FSMN-VAD for Chinese."""

    def __init__(self):
        self._model = None

    def _resolve_model_path(self) -> Optional[str]:
        return resolve_modelscope_model(FSMN_VAD_MODEL_DIR)

    async def load(self) -> None:
        if self._model:
            return

        model_path = self._resolve_model_path()
        if not model_path:
            logger.info("VAD model not found locally, skipping")
            return

        def _load():
            try:
                from funasr import AutoModel
                return AutoModel(model=model_path)
            except Exception as e:
                logger.warning("Failed to load VAD model from %s: %s", model_path, e)
                return None

        self._model = await asyncio.to_thread(_load)

    def is_available(self) -> bool:
        return self._model is not None

    async def detect(self, audio_path: str) -> list[tuple[float, float]]:
        """Detect speech segments in audio.

        Returns list of (start_ms, end_ms) tuples.
        """
        if not self._model:
            await self.load()

        if not self._model:
            return []

        model_ref = self._model

        def _detect():
            result = model_ref.generate(input=audio_path)
            segments = []
            if isinstance(result, list):
                for item in result:
                    value = item.get("value", [])
                    for pair in value:
                        if isinstance(pair, (list, tuple)) and len(pair) == 2:
                            segments.append((float(pair[0]), float(pair[1])))
            return segments

        return await asyncio.to_thread(_detect)
