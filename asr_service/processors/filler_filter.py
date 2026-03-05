"""Filler word filter for Chinese and English ASR post-processing.

Removes filler words and hesitation markers from transcription segments:
  - Chinese: 啊、呃、嗯、额、那个、就是说、就是、然后 etc.
  - English: um, uh, like, you know, basically, actually etc.

Supports configurable filter levels (light/medium/heavy), repetition merging,
sentence-position-aware filtering, and custom filler word lists.
"""

import re
from enum import Enum
from dataclasses import dataclass, field
from typing import Optional

from asr_service.models.job import Segment


class FilterLevel(str, Enum):
    """Filter aggressiveness level."""
    LIGHT = "light"
    MEDIUM = "medium"
    HEAVY = "heavy"


# --- Default filler word lists by level ---

# Light: only pure hesitation markers
_CHINESE_FILLERS_LIGHT: set[str] = {
    "啊", "呃", "嗯", "额", "哦", "嘶", "emmm", "emm", "em",
}

# Medium: light + common discourse fillers
_CHINESE_FILLERS_MEDIUM: set[str] = _CHINESE_FILLERS_LIGHT | {
    "那个", "就是", "然后", "嘿", "哈", "喂", "诶", "呢",
    "吧", "嘛", "呐", "唉",
}

# Heavy: medium + verbose discourse markers
_CHINESE_FILLERS_HEAVY: set[str] = _CHINESE_FILLERS_MEDIUM | {
    "就是说", "对对对", "对对", "怎么说呢", "你知道吧",
    "反正就是", "说白了", "其实", "基本上", "所以说",
    "我觉得吧", "这个这个",
}

_ENGLISH_FILLERS_LIGHT: set[str] = {
    "um", "uh", "uh huh", "hmm", "hm", "mm", "mmm", "er", "ah",
}

_ENGLISH_FILLERS_MEDIUM: set[str] = _ENGLISH_FILLERS_LIGHT | {
    "like", "you know", "i mean", "well", "so", "right",
    "okay", "ok",
}

_ENGLISH_FILLERS_HEAVY: set[str] = _ENGLISH_FILLERS_MEDIUM | {
    "basically", "actually", "literally", "sort of", "kind of",
    "you know what i mean", "at the end of the day", "honestly",
    "to be honest", "in a sense", "if you will", "as it were",
}

# Map level → (chinese set, english set)
_FILLER_SETS: dict[FilterLevel, tuple[set[str], set[str]]] = {
    FilterLevel.LIGHT: (_CHINESE_FILLERS_LIGHT, _ENGLISH_FILLERS_LIGHT),
    FilterLevel.MEDIUM: (_CHINESE_FILLERS_MEDIUM, _ENGLISH_FILLERS_MEDIUM),
    FilterLevel.HEAVY: (_CHINESE_FILLERS_HEAVY, _ENGLISH_FILLERS_HEAVY),
}


@dataclass
class FillerFilterConfig:
    """Configuration for filler word filtering."""
    level: FilterLevel = FilterLevel.MEDIUM
    remove_start_fillers: bool = True
    remove_mid_fillers: bool = True
    merge_repetitions: bool = True
    min_repetition_count: int = 2
    custom_fillers_zh: set[str] = field(default_factory=set)
    custom_fillers_en: set[str] = field(default_factory=set)
    excluded_fillers: set[str] = field(default_factory=set)


class FillerFilterProcessor:
    """Filler word filter with configurable levels and language support.

    Supports three filter levels:
      - light: only pure hesitation markers (啊/呃/嗯, um/uh/hmm)
      - medium: adds common discourse fillers (那个/就是, like/you know)
      - heavy: adds verbose markers (就是说/对对对, basically/literally)

    Features:
      - Position-aware: start-of-segment fillers removed more aggressively
      - Repetition merging: "一个一个一个" → "一个"
      - Fully customizable filler word lists
    """

    def __init__(self, config: Optional[FillerFilterConfig] = None):
        self._config = config or FillerFilterConfig()
        self._zh_fillers: set[str] = set()
        self._en_fillers: set[str] = set()
        self._rebuild_filler_sets()

    @property
    def config(self) -> FillerFilterConfig:
        return self._config

    @config.setter
    def config(self, value: FillerFilterConfig) -> None:
        self._config = value
        self._rebuild_filler_sets()

    def _rebuild_filler_sets(self) -> None:
        """Rebuild effective filler sets from level + custom words - exclusions."""
        base_zh, base_en = _FILLER_SETS[self._config.level]
        self._zh_fillers = (
            (base_zh | self._config.custom_fillers_zh)
            - self._config.excluded_fillers
        )
        self._en_fillers = (
            (base_en | self._config.custom_fillers_en)
            - self._config.excluded_fillers
        )

    async def filter(
        self,
        segments: list[Segment],
        language: str = "zh",
    ) -> list[Segment]:
        """Apply filler filtering to a list of segments.

        Args:
            segments: List of transcription segments.
            language: Language code (zh, en, etc.).

        Returns:
            New list of segments with fillers removed. Empty segments
            after filtering are dropped.
        """
        is_chinese = language in ("zh", "yue", "wuu", "min_nan", "gan", "hakka", "xiang")
        fillers = self._zh_fillers if is_chinese else self._en_fillers

        if not fillers:
            return segments

        results: list[Segment] = []
        for seg in segments:
            text = seg.text

            # Step 1: merge consecutive repetitions
            if self._config.merge_repetitions:
                text = _merge_repetitions(text, is_chinese, self._config.min_repetition_count)

            # Step 2: remove fillers
            text = _remove_fillers(
                text,
                fillers,
                is_chinese=is_chinese,
                remove_start=self._config.remove_start_fillers,
                remove_mid=self._config.remove_mid_fillers,
            )

            # Step 3: clean up whitespace
            text = _clean_whitespace(text, is_chinese)

            # Drop segments that become empty after filtering
            if not text.strip():
                continue

            results.append(
                Segment(
                    start=seg.start,
                    end=seg.end,
                    text=text,
                    speaker=seg.speaker,
                    confidence=seg.confidence,
                )
            )

        return results


def _merge_repetitions(text: str, is_chinese: bool, min_count: int = 2) -> str:
    """Deduplicate consecutive repeated words or phrases.

    For Chinese: detect repeated character sequences (1-6 chars).
      e.g. "一个一个一个" → "一个", "对对对" → "对"
    For English: detect repeated words.
      e.g. "the the the" → "the"
    """
    if is_chinese:
        # Match repeated Chinese character sequences, at least min_count times.
        # Process single-char stuttering FIRST (我我我→我), then multi-char
        # phrases (一个一个一个→一个) from long to short.  This avoids the
        # length-2 pattern consuming single-char stutters as 2-char repeats
        # (e.g. "我我我我" being seen as "我我"×2 instead of "我"×4).

        # Step 1: Single-char stuttering — require 3+ repetitions to preserve
        # natural doubled chars like 天天、人人、慢慢
        threshold_1 = max(min_count, 3)
        pattern_1 = rf"([\u4e00-\u9fff])\1{{{threshold_1 - 1},}}"
        text = re.sub(pattern_1, r"\1", text)

        # Step 2: Multi-char phrase repetitions (length 2-6), long to short
        for length in range(6, 1, -1):
            pattern = rf"([\u4e00-\u9fff]{{{length}}})\1{{{min_count - 1},}}"
            text = re.sub(pattern, r"\1", text)
    else:
        # Match repeated English words (case-insensitive)
        pattern = rf"\b(\w+)(?:\s+\1){{{min_count - 1},}}\b"
        text = re.sub(pattern, r"\1", text, flags=re.IGNORECASE)

    return text


def _remove_fillers(
    text: str,
    fillers: set[str],
    is_chinese: bool,
    remove_start: bool,
    remove_mid: bool,
) -> str:
    """Remove filler words from text with position awareness.

    Args:
        text: Input text.
        fillers: Set of filler words to match (lowercase for English).
        is_chinese: Whether the text is Chinese.
        remove_start: Remove fillers at segment start.
        remove_mid: Remove fillers in the middle of the segment.
    """
    if not remove_start and not remove_mid:
        return text

    if is_chinese:
        return _remove_fillers_chinese(text, fillers, remove_start, remove_mid)
    return _remove_fillers_english(text, fillers, remove_start, remove_mid)


def _remove_fillers_chinese(
    text: str,
    fillers: set[str],
    remove_start: bool,
    remove_mid: bool,
) -> str:
    """Remove Chinese filler words with position awareness.

    Chinese text has no word boundaries, so we match filler strings directly.
    Sort fillers by length descending to match longer phrases first.
    """
    sorted_fillers = sorted(fillers, key=len, reverse=True)

    if remove_start:
        # Repeatedly strip fillers from the beginning
        changed = True
        while changed:
            changed = False
            stripped = text.lstrip()
            for filler in sorted_fillers:
                if stripped.startswith(filler):
                    text = stripped[len(filler):]
                    changed = True
                    break
            # Also strip common Chinese punctuation after filler removal at start
            text = text.lstrip("，、。 ")

    if remove_mid:
        for filler in sorted_fillers:
            text = text.replace(filler, "")

    return text


def _remove_fillers_english(
    text: str,
    fillers: set[str],
    remove_start: bool,
    remove_mid: bool,
) -> str:
    """Remove English filler words with position awareness.

    Uses word boundary matching for single words and phrase matching
    for multi-word fillers.
    """
    # Sort fillers by word count descending, then length, to match longer phrases first
    sorted_fillers = sorted(fillers, key=lambda f: (-f.count(" "), -len(f)))

    if remove_start:
        changed = True
        while changed:
            changed = False
            stripped = text.lstrip()
            lower = stripped.lower()
            for filler in sorted_fillers:
                if lower.startswith(filler):
                    rest = stripped[len(filler):]
                    # Ensure we matched at a word boundary
                    if not rest or not rest[0].isalpha():
                        text = rest
                        changed = True
                        break
            # Strip leading punctuation and whitespace after filler removal
            text = text.lstrip(" ,;")

    if remove_mid:
        for filler in sorted_fillers:
            if " " in filler:
                # Multi-word filler: case-insensitive phrase replacement
                pattern = re.compile(re.escape(filler), re.IGNORECASE)
                text = pattern.sub("", text)
            else:
                # Single-word filler: use word boundary matching
                pattern = re.compile(rf"\b{re.escape(filler)}\b", re.IGNORECASE)
                text = pattern.sub("", text)

    return text


def _clean_whitespace(text: str, is_chinese: bool) -> str:
    """Normalize whitespace and punctuation artifacts after filler removal."""
    # Collapse multiple spaces
    text = re.sub(r" {2,}", " ", text)

    # Remove space before Chinese punctuation
    text = re.sub(r" ([，。、！？；：])", r"\1", text)

    # Remove doubled punctuation
    text = re.sub(r"([，。、！？；：,.])\1+", r"\1", text)

    # Remove leading punctuation
    text = re.sub(r"^[，。、,.\s]+", "", text)

    return text.strip()
