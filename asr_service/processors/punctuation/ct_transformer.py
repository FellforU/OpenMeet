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
                import torch
                from funasr import AutoModel
                device = "cuda" if torch.cuda.is_available() else "cpu"
                return AutoModel(model=model_path, device=device)
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
            results = list(texts)
            todo = [i for i, t in enumerate(texts) if t and t.strip()]
            if not todo:
                return results

            # Batch all texts in one generate() call — a per-text loop pays
            # the funasr pipeline overhead once per segment
            try:
                batch = model_ref.generate(input=[texts[i] for i in todo])
                if isinstance(batch, list) and len(batch) == len(todo):
                    for i, item in zip(todo, batch):
                        if isinstance(item, dict):
                            results[i] = item.get("text", texts[i])
                    return results
            except Exception as e:
                logger.warning(
                    "Batch punctuation failed, falling back to per-text: %s", e,
                )

            for i in todo:
                try:
                    result = model_ref.generate(input=texts[i])
                    if isinstance(result, list) and result:
                        results[i] = result[0].get("text", texts[i])
                except Exception:
                    pass
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
