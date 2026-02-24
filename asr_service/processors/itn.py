"""Inverse Text Normalization (ITN) for Chinese text.

Converts spoken forms to written forms:
  - "一二三" → "123"
  - "二零二四年" → "2024年"
  - "百分之八十" → "80%"
  - "一三八一二三四五六七八" → "13812345678"
"""

import asyncio
import re
from typing import Optional

from asr_service.models.job import Segment


class ChineseITNProcessor:
    """Chinese Inverse Text Normalization using WeTextProcessing."""

    def __init__(self):
        self._normalizer = None

    async def load(self) -> None:
        if self._normalizer:
            return

        def _load():
            try:
                from tn.chinese.normalizer import Normalizer
                return Normalizer()
            except ImportError:
                return None
            except Exception:
                return None

        self._normalizer = await asyncio.to_thread(_load)

    def is_available(self) -> bool:
        return self._normalizer is not None

    async def normalize(
        self, segments: list[Segment], language: str = "zh"
    ) -> list[Segment]:
        """Apply ITN to segment texts."""
        if language not in ("zh", "yue", "wuu"):
            return segments

        if not self._normalizer:
            await self.load()

        if not self._normalizer:
            # Fallback: basic regex-based ITN
            return [
                Segment(
                    start=s.start,
                    end=s.end,
                    text=_basic_chinese_itn(s.text),
                    speaker=s.speaker,
                    confidence=s.confidence,
                )
                for s in segments
            ]

        normalizer_ref = self._normalizer

        def _normalize():
            results = []
            for seg in segments:
                try:
                    text = normalizer_ref.normalize(seg.text)
                    results.append(text)
                except Exception:
                    results.append(seg.text)
            return results

        normalized = await asyncio.to_thread(_normalize)

        return [
            Segment(
                start=seg.start,
                end=seg.end,
                text=text,
                speaker=seg.speaker,
                confidence=seg.confidence,
            )
            for seg, text in zip(segments, normalized)
        ]


# Basic Chinese digit mapping for fallback ITN
_ZH_DIGITS = {
    "零": "0", "一": "1", "二": "2", "三": "3", "四": "4",
    "五": "5", "六": "6", "七": "7", "八": "8", "九": "9",
    "〇": "0",
}


def _basic_chinese_itn(text: str) -> str:
    """Basic fallback ITN for Chinese text when WeTextProcessing unavailable.

    Handles simple digit sequences and common patterns.
    """
    # Replace consecutive Chinese digits with Arabic digits
    # e.g., "一二三" → "123"
    result = text
    for zh, ar in _ZH_DIGITS.items():
        result = result.replace(zh, ar)

    # Common patterns
    result = re.sub(r"百分之(\d+)", r"\1%", result)

    return result
