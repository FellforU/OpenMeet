"""FSMN-VAD processor for Chinese audio segmentation.

Uses FunASR's FSMN-VAD model, optimized for Chinese speech.
"""

import asyncio
from pathlib import Path
from typing import Optional

from asr_service import config


FSMN_VAD_MODEL_DIR = "speech_fsmn_vad_zh-cn-16k-common-pytorch"


class FSMNVadProcessor:
    """Voice Activity Detection using FSMN-VAD for Chinese."""

    def __init__(self):
        self._model = None

    def _resolve_model_path(self) -> Optional[str]:
        local = config.PROJECT_ROOT / "meeting" / "models" / FSMN_VAD_MODEL_DIR
        if local.exists():
            return str(local)
        models = config.MODELS_DIR / FSMN_VAD_MODEL_DIR
        if models.exists():
            return str(models)
        return None

    async def load(self) -> None:
        if self._model:
            return

        model_path = self._resolve_model_path()
        if not model_path:
            model_path = f"iic/{FSMN_VAD_MODEL_DIR}"

        def _load():
            try:
                from funasr import AutoModel
                return AutoModel(model=model_path)
            except Exception:
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
