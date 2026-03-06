"""Inverse Text Normalization (ITN) for Chinese text.

Converts spoken forms to written forms:
  - Keeps Chinese digits natural in conversational context (一两百、三到五年)
  - Converts misplaced Arabic digits from ASR to Chinese (1个月 → 一个月)
  - Preserves Arabic digits in proper contexts: years, IDs, phone numbers, IPs
  - When WeTextProcessing is available, uses its full normalizer
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
            # Fallback: smart number normalization that keeps Chinese natural
            return [
                Segment(
                    start=s.start,
                    end=s.end,
                    text=_smart_number_normalize(s.text),
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


# Chinese-to-Arabic mapping (used by WeTextProcessing path, kept for reference)
_ZH_DIGITS = {
    "零": "0", "一": "1", "二": "2", "三": "3", "四": "4",
    "五": "5", "六": "6", "七": "7", "八": "8", "九": "9",
    "〇": "0",
}

# Arabic-to-Chinese mapping for fallback normalization
_ARABIC_TO_ZH = {
    "0": "零", "1": "一", "2": "二", "3": "三", "4": "四",
    "5": "五", "6": "六", "7": "七", "8": "八", "9": "九",
}

# Patterns where Arabic digits should be PRESERVED (not converted to Chinese)
# - Years: 2024年, 2025年
# - Specific IDs / hashtags: #150, No.123
# - Phone numbers: 138-1234-5678, 13812345678 (11 digits)
# - IP addresses: 192.168.1.1
# - Version numbers: v2.0, 3.14
# - Percentages already in Arabic: 80%
# - Dates in Arabic: 3月15日 is OK but we handle this separately
# - Long digit sequences (>= 4 digits) likely intentional
_PRESERVE_ARABIC_PATTERNS = [
    # Years (4-digit number followed by 年)
    re.compile(r"\d{4}年"),
    # IP addresses
    re.compile(r"\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}"),
    # Version numbers (v1.2, 2.0.1, etc.)
    re.compile(r"[vV]?\d+\.\d+(?:\.\d+)*"),
    # Phone numbers (11+ consecutive digits, or with dashes)
    re.compile(r"\d[\d\-]{9,}\d"),
    # Hashtag/ID references (#123, No.456) — require the prefix
    re.compile(r"[#＃]\d+"),
    re.compile(r"No\.\d+", re.IGNORECASE),
    # Percentages in Arabic form
    re.compile(r"\d+%"),
    # Long digit sequences (4+ digits) — likely intentional
    re.compile(r"\d{4,}"),
]


def _should_preserve_arabic(text: str, match_start: int, match_end: int) -> bool:
    """Check if an Arabic digit sequence at the given position should be preserved.

    Returns True if the digit is part of a pattern that should stay in Arabic.
    """
    # Extract a window around the match for context checking
    window_start = max(0, match_start - 5)
    window_end = min(len(text), match_end + 5)
    window = text[window_start:window_end]

    for pattern in _PRESERVE_ARABIC_PATTERNS:
        m = pattern.search(window)
        if m:
            # Check if this pattern overlaps with our digit position
            abs_start = window_start + m.start()
            abs_end = window_start + m.end()
            if abs_start <= match_start and abs_end >= match_end:
                return True

    return False


def _smart_number_normalize(text: str) -> str:
    """Smart fallback ITN that keeps Chinese text natural for spoken transcripts.

    Strategy: Keep Chinese digits as-is, convert isolated Arabic digits
    (1-3 digit sequences) to Chinese where they appear in conversational
    Chinese context. Preserve Arabic digits in technical contexts.

    Examples:
        "一两百美金" → "一两百美金" (unchanged, natural Chinese)
        "三到五年" → "三到五年" (unchanged)
        "1个月" → "一个月" (ASR artifact, normalize to Chinese)
        "3到5年" → "三到五年" (normalize conversational numbers)
        "2024年" → "2024年" (preserve year)
        "192.168.1.1" → "192.168.1.1" (preserve IP)
        "幺50" → "幺50" (code/number speech, keep as-is)
        "百分之八十" → "百分之八十" (keep Chinese, no conversion needed)
    """
    result = text

    # Step 1: Convert isolated short Arabic digit sequences (1-3 digits)
    # followed by Chinese characters to Chinese digits.
    # This fixes ASR engines that incorrectly output "1个月" instead of "一个月".
    # We process from right to left to keep indices stable.
    # Pattern: 1-3 Arabic digits followed by a Chinese character (not another digit)
    arabic_in_chinese = list(re.finditer(r"(\d{1,3})", result))

    for m in reversed(arabic_in_chinese):
        digit_str = m.group(1)
        start = m.start()
        end = m.end()

        # Skip if this should be preserved as Arabic
        if _should_preserve_arabic(result, start, end):
            continue

        # Check context: is this digit surrounded by Chinese text?
        char_before = result[start - 1] if start > 0 else ""
        char_after = result[end] if end < len(result) else ""

        # Only convert if adjacent to Chinese characters (CJK Unified Ideographs range)
        has_chinese_context = (
            _is_chinese_char(char_before) or _is_chinese_char(char_after)
        )

        if not has_chinese_context:
            continue

        # Convert each Arabic digit to Chinese
        chinese_digits = "".join(_ARABIC_TO_ZH.get(d, d) for d in digit_str)
        result = result[:start] + chinese_digits + result[end:]

    return result


def _is_chinese_char(ch: str) -> bool:
    """Check if a character is a CJK Chinese character."""
    if not ch:
        return False
    cp = ord(ch)
    # CJK Unified Ideographs
    if 0x4E00 <= cp <= 0x9FFF:
        return True
    # CJK Unified Ideographs Extension A
    if 0x3400 <= cp <= 0x4DBF:
        return True
    # CJK Compatibility Ideographs
    if 0xF900 <= cp <= 0xFAFF:
        return True
    return False


def _arabic_to_chinese_fallback(text: str) -> str:
    """Convert all Arabic digits to Chinese digits (brute-force fallback).

    This is the old _basic_chinese_itn logic reversed: instead of converting
    Chinese→Arabic, it converts Arabic→Chinese. Kept as a utility but not
    used in the main pipeline — prefer _smart_number_normalize() instead.

    Example: "123" → "一二三"
    """
    result = text
    for ar, zh in _ARABIC_TO_ZH.items():
        result = result.replace(ar, zh)
    return result
