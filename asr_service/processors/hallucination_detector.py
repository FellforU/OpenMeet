"""Hallucination detector for ASR output.

ASR models (especially Whisper) sometimes produce hallucinated text that
wasn't actually spoken. This module detects and filters common hallucination
patterns including repeated phrases, template insertions, unexpected language
switches, low-confidence suspicious segments, and timestamp anomalies.
"""

import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

from asr_service.models.job import Segment

logger = logging.getLogger(__name__)


class Sensitivity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


# Thresholds keyed by sensitivity level
_THRESHOLDS: dict[Sensitivity, dict[str, float]] = {
    Sensitivity.LOW: {
        "repetition_ratio": 0.8,
        "min_confidence": 0.1,
        "max_overlap_ratio": 0.9,
        "max_segment_duration": 120.0,
        "min_repetition_count": 4,
    },
    Sensitivity.MEDIUM: {
        "repetition_ratio": 0.6,
        "min_confidence": 0.2,
        "max_overlap_ratio": 0.7,
        "max_segment_duration": 90.0,
        "min_repetition_count": 3,
    },
    Sensitivity.HIGH: {
        "repetition_ratio": 0.4,
        "min_confidence": 0.3,
        "max_overlap_ratio": 0.5,
        "max_segment_duration": 60.0,
        "min_repetition_count": 2,
    },
}

# Common hallucinated template phrases from Whisper and other ASR models
_DEFAULT_BLOCKED_PHRASES_ZH = [
    "这条语音备忘录已进行编辑",
    "请订阅我的频道",
    "字幕由Amara.org社区提供",
    "字幕由amara.org社区提供",
    "感谢观看",
    "谢谢观看",
    "请不要忘记点赞和订阅",
    "欢迎收看本期节目",
    "如果喜欢请点赞订阅",
    "字幕制作",
    "本视频由",
    "感谢收看",
    "请点击订阅",
    "由Amara.org社区提供",
    "请帮忙点赞",
    "音乐",
]

_DEFAULT_BLOCKED_PHRASES_EN = [
    "thank you for watching",
    "please subscribe",
    "like and subscribe",
    "thanks for watching",
    "subtitles by the amara.org community",
    "subtitles by amara.org",
    "this has been a voice memo",
    "please like and subscribe",
    "don't forget to subscribe",
    "click the bell icon",
    "leave a comment below",
    "link in the description",
    "sponsored by",
    "music",
    "applause",
]

# Regex to detect CJK characters
_CJK_PATTERN = re.compile(
    r"[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff"
    r"\U00020000-\U0002a6df\U0002a700-\U0002ebef]"
)

# Regex to detect Latin alphabet words (English, etc.)
_LATIN_WORD_PATTERN = re.compile(r"[a-zA-Z]{2,}")


@dataclass
class HallucinationDetector:
    """Detects and filters hallucinated ASR segments.

    Args:
        sensitivity: Detection sensitivity level (low/medium/high).
        blocked_phrases: Additional custom phrases to block.
    """

    sensitivity: Sensitivity = Sensitivity.MEDIUM
    blocked_phrases: list[str] = field(default_factory=list)

    @property
    def _thresholds(self) -> dict[str, float]:
        return _THRESHOLDS[self.sensitivity]

    def _get_blocked_phrases(self, language: Optional[str]) -> list[str]:
        """Build the full blocked phrase list based on language."""
        phrases: list[str] = list(self.blocked_phrases)

        if language in ("zh", "yue", "wuu", None):
            phrases.extend(_DEFAULT_BLOCKED_PHRASES_ZH)
        if language in ("en", None):
            phrases.extend(_DEFAULT_BLOCKED_PHRASES_EN)

        return [p.lower().strip() for p in phrases]

    def detect(
        self,
        segments: list[Segment],
        language: Optional[str] = None,
    ) -> list[Segment]:
        """Detect and remove hallucinated segments.

        Returns a new list with hallucinated segments removed.
        Logs a warning for each detected hallucination.

        Args:
            segments: List of ASR segments to check.
            language: Expected language code (e.g. "zh", "en").

        Returns:
            Filtered list of segments with hallucinations removed.
        """
        if not segments:
            return []

        flagged_indices: set[int] = set()

        # Run all detection passes
        flagged_indices.update(self._detect_template_phrases(segments, language))
        flagged_indices.update(self._detect_repetitions(segments))
        flagged_indices.update(self._detect_language_switches(segments, language))
        flagged_indices.update(self._detect_low_confidence(segments))
        flagged_indices.update(self._detect_timestamp_anomalies(segments))

        if flagged_indices:
            logger.warning(
                "Hallucination detector flagged %d/%d segments (sensitivity=%s)",
                len(flagged_indices),
                len(segments),
                self.sensitivity.value,
            )

        return [
            seg for i, seg in enumerate(segments) if i not in flagged_indices
        ]

    def _detect_template_phrases(
        self,
        segments: list[Segment],
        language: Optional[str],
    ) -> set[int]:
        """Detect segments matching known hallucination template phrases."""
        flagged: set[int] = set()
        blocked = self._get_blocked_phrases(language)

        for i, seg in enumerate(segments):
            text_lower = seg.text.strip().lower()
            if not text_lower:
                continue

            for phrase in blocked:
                if phrase in text_lower:
                    logger.warning(
                        "Hallucination [template]: segment %d matches blocked "
                        "phrase '%s' — text: '%s' [%.2f-%.2f]",
                        i, phrase, seg.text, seg.start, seg.end,
                    )
                    flagged.add(i)
                    break

        return flagged

    def _detect_repetitions(self, segments: list[Segment]) -> set[int]:
        """Detect consecutive repeated phrases.

        Flags runs of segments where the same (or very similar) text
        appears consecutively more times than the threshold allows.
        """
        flagged: set[int] = set()
        min_count = int(self._thresholds["min_repetition_count"])

        if len(segments) < min_count:
            return flagged

        i = 0
        while i < len(segments):
            run_text = _normalize_for_comparison(segments[i].text)
            if not run_text:
                i += 1
                continue

            # Count consecutive segments with similar text
            run_indices = [i]
            j = i + 1
            while j < len(segments):
                candidate = _normalize_for_comparison(segments[j].text)
                if _text_similarity(run_text, candidate) >= self._thresholds["repetition_ratio"]:
                    run_indices.append(j)
                    j += 1
                else:
                    break

            if len(run_indices) >= min_count:
                # Keep the first occurrence, flag the rest
                for idx in run_indices[1:]:
                    logger.warning(
                        "Hallucination [repetition]: segment %d repeats '%s' "
                        "(%d consecutive) [%.2f-%.2f]",
                        idx,
                        segments[idx].text[:60],
                        len(run_indices),
                        segments[idx].start,
                        segments[idx].end,
                    )
                    flagged.add(idx)

            i = j

        return flagged

    def _detect_language_switches(
        self,
        segments: list[Segment],
        language: Optional[str],
    ) -> set[int]:
        """Detect unexpected language switches.

        A segment is flagged if the expected language is set and the
        segment's dominant language clearly differs. Single foreign words
        mixed into the expected language are tolerated.
        """
        flagged: set[int] = set()

        if language is None:
            return flagged

        expect_cjk = language in ("zh", "yue", "wuu", "ja", "ko")

        for i, seg in enumerate(segments):
            text = seg.text.strip()
            if len(text) < 4:
                continue

            cjk_count = len(_CJK_PATTERN.findall(text))
            latin_words = _LATIN_WORD_PATTERN.findall(text)
            latin_char_count = sum(len(w) for w in latin_words)
            total_meaningful = cjk_count + latin_char_count

            if total_meaningful == 0:
                continue

            cjk_ratio = cjk_count / total_meaningful if total_meaningful else 0

            if expect_cjk and cjk_ratio < 0.2 and latin_char_count > 10:
                # Expected CJK but got mostly Latin text
                logger.warning(
                    "Hallucination [language switch]: segment %d has unexpected "
                    "language (expected %s, CJK ratio=%.2f) — text: '%s' [%.2f-%.2f]",
                    i, language, cjk_ratio, text[:60], seg.start, seg.end,
                )
                flagged.add(i)
            elif not expect_cjk and cjk_ratio > 0.8 and cjk_count > 5:
                # Expected Latin but got mostly CJK text
                logger.warning(
                    "Hallucination [language switch]: segment %d has unexpected "
                    "language (expected %s, CJK ratio=%.2f) — text: '%s' [%.2f-%.2f]",
                    i, language, cjk_ratio, text[:60], seg.start, seg.end,
                )
                flagged.add(i)

        return flagged

    def _detect_low_confidence(self, segments: list[Segment]) -> set[int]:
        """Detect low-confidence segments with suspicious patterns.

        Only flags segments that have both low confidence AND exhibit
        another suspicious signal (very short text, only punctuation, etc.).
        """
        flagged: set[int] = set()
        min_conf = self._thresholds["min_confidence"]

        for i, seg in enumerate(segments):
            if seg.confidence is None or seg.confidence >= min_conf:
                continue

            text = seg.text.strip()

            # Suspicious if low confidence AND very short / empty / only punctuation
            is_suspicious = (
                len(text) == 0
                or len(text) <= 2
                or re.fullmatch(r"[\s\W]+", text) is not None
            )

            if is_suspicious:
                logger.warning(
                    "Hallucination [low confidence]: segment %d has confidence "
                    "%.3f < %.3f with suspicious text '%s' [%.2f-%.2f]",
                    i, seg.confidence, min_conf, text[:60], seg.start, seg.end,
                )
                flagged.add(i)

        return flagged

    def _detect_timestamp_anomalies(self, segments: list[Segment]) -> set[int]:
        """Detect segments with impossible timestamps.

        Checks for:
        - Segments with negative or zero duration
        - Segments exceeding maximum allowed duration
        - Segments overlapping significantly with the previous segment
        """
        flagged: set[int] = set()
        max_duration = self._thresholds["max_segment_duration"]
        max_overlap = self._thresholds["max_overlap_ratio"]

        for i, seg in enumerate(segments):
            duration = seg.end - seg.start

            # Negative or zero duration
            if duration <= 0:
                logger.warning(
                    "Hallucination [timestamp]: segment %d has non-positive "
                    "duration %.2f — text: '%s' [%.2f-%.2f]",
                    i, duration, seg.text[:60], seg.start, seg.end,
                )
                flagged.add(i)
                continue

            # Excessively long duration
            if duration > max_duration:
                logger.warning(
                    "Hallucination [timestamp]: segment %d has excessive "
                    "duration %.2fs (max %.2fs) — text: '%s' [%.2f-%.2f]",
                    i, duration, max_duration, seg.text[:60], seg.start, seg.end,
                )
                flagged.add(i)
                continue

            # Overlap with previous segment
            if i > 0 and i - 1 not in flagged:
                prev = segments[i - 1]
                prev_duration = prev.end - prev.start
                if prev_duration > 0:
                    overlap = max(0.0, prev.end - seg.start)
                    overlap_ratio = overlap / min(prev_duration, duration)
                    if overlap_ratio > max_overlap:
                        logger.warning(
                            "Hallucination [timestamp]: segment %d overlaps "
                            "%.1f%% with previous segment — text: '%s' [%.2f-%.2f]",
                            i, overlap_ratio * 100, seg.text[:60],
                            seg.start, seg.end,
                        )
                        flagged.add(i)

        return flagged


def _normalize_for_comparison(text: str) -> str:
    """Normalize text for repetition comparison.

    Strips whitespace and punctuation, lowercases.
    """
    text = text.strip().lower()
    text = re.sub(r"[\s\.,!?;:，。！？；：、\-—\"\'\(\)\[\]【】「」]+", "", text)
    return text


def _text_similarity(a: str, b: str) -> float:
    """Compute a simple character-level similarity ratio between two strings.

    Returns a float in [0.0, 1.0]. Uses the ratio of matching characters
    to the length of the longer string. This is intentionally simple and
    fast — not a full edit-distance computation.
    """
    if not a or not b:
        return 1.0 if a == b else 0.0

    if a == b:
        return 1.0

    # Use set-based character overlap as a fast approximation
    shorter, longer = (a, b) if len(a) <= len(b) else (b, a)

    if len(longer) == 0:
        return 1.0

    # Count character matches (order-insensitive but frequency-aware)
    longer_chars: dict[str, int] = {}
    for c in longer:
        longer_chars[c] = longer_chars.get(c, 0) + 1

    matches = 0
    for c in shorter:
        if longer_chars.get(c, 0) > 0:
            matches += 1
            longer_chars[c] -= 1

    return matches / len(longer)
