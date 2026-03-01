"""CT-Transformer punctuation restoration for Chinese text.

Uses FunASR's CT-Transformer model for restoring punctuation marks.
"""

import asyncio
import logging
from typing import Optional

from asr_service.models.job import Segment
from asr_service.processors.model_utils import resolve_modelscope_model

logger = logging.getLogger(__name__)

CT_PUNC_MODEL_DIR = "punc_ct-transformer_zh-cn-common-vad_realtime-vocab272727"


class CTTransformerPunctuator:
    """Punctuation restoration using CT-Transformer for Chinese."""

    def __init__(self):
        self._model = None

    def _resolve_model_path(self) -> Optional[str]:
        return resolve_modelscope_model(CT_PUNC_MODEL_DIR)

    async def load(self) -> None:
        if self._model:
            return

        model_path = self._resolve_model_path()
        if not model_path:
            logger.info("Punctuation model not found locally, skipping")
            return

        def _load():
            try:
                from funasr import AutoModel
                return AutoModel(model=model_path)
            except Exception as e:
                logger.warning("Failed to load punctuation model from %s: %s", model_path, e)
                return None

        self._model = await asyncio.to_thread(_load)

    def is_available(self) -> bool:
        return self._model is not None

    async def restore(self, segments: list[Segment]) -> list[Segment]:
        """Add punctuation to segment texts."""
        if not self._model:
            await self.load()

        if not self._model:
            return segments

        model_ref = self._model
        texts = [s.text for s in segments]

        def _punctuate():
            results = []
            for text in texts:
                try:
                    result = model_ref.generate(input=text)
                    if isinstance(result, list) and result:
                        results.append(result[0].get("text", text))
                    else:
                        results.append(text)
                except Exception:
                    results.append(text)
            return results

        punctuated = await asyncio.to_thread(_punctuate)

        return [
            Segment(
                start=seg.start,
                end=seg.end,
                text=text,
                speaker=seg.speaker,
                confidence=seg.confidence,
            )
            for seg, text in zip(segments, punctuated)
        ]
