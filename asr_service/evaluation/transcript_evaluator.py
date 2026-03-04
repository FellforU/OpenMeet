"""Transcript quality evaluator.

Evaluates transcription output quality including readability,
filler word density, number normalization accuracy, etc.
"""

import re
import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class TranscriptEvalResult:
    """Evaluation results for transcript quality."""
    filler_density: float = 0.0        # 0-1, ratio of filler chars to total
    repetition_density: float = 0.0    # 0-1, ratio of repeated content
    number_issues: int = 0             # count of suspicious number renderings
    readability_score: float = 0.0     # 0-1, overall readability
    hallucination_count: int = 0       # number of suspected hallucinations
    overall_score: float = 0.0
    details: dict = field(default_factory=dict)


# Common Chinese filler words for detection
_ZH_FILLERS = {
    "呃", "嗯", "啊", "额", "那个", "就是", "就是说",
    "然后", "对对对", "对对", "哦", "喂", "诶", "emmm",
}

# Common hallucination patterns from ASR models
_HALLUCINATION_PATTERNS = [
    r"请订阅",
    r"字幕由.*提供",
    r"感谢.*观看",
    r"语音备忘录已进行编辑",
    r"并确认标签是正确的",
    r"Thank you for watching",
    r"Subscribe",
    r"Subtitles by",
]


class TranscriptEvaluator:
    """Evaluates transcript quality metrics."""

    def evaluate(self, text: str, language: str = "zh") -> TranscriptEvalResult:
        """Evaluate transcript text quality.

        Args:
            text: The full transcript text.
            language: Language code.

        Returns:
            TranscriptEvalResult with detailed metrics.
        """
        result = TranscriptEvalResult()

        if not text.strip():
            return result

        # 1. Filler word density
        result.filler_density = self._calc_filler_density(text, language)

        # 2. Repetition density
        result.repetition_density = self._calc_repetition_density(text)

        # 3. Number normalization issues
        result.number_issues = self._count_number_issues(text, language)

        # 4. Hallucination detection
        result.hallucination_count = self._count_hallucinations(text)

        # 5. Readability score (composite)
        result.readability_score = max(0.0, 1.0
            - result.filler_density * 0.4
            - result.repetition_density * 0.3
            - min(result.number_issues * 0.02, 0.2)
            - min(result.hallucination_count * 0.1, 0.3)
        )

        result.overall_score = result.readability_score

        result.details = {
            "filler_density": f"{result.filler_density:.2%}",
            "repetition_density": f"{result.repetition_density:.2%}",
            "number_issues": result.number_issues,
            "hallucination_count": result.hallucination_count,
        }

        return result

    def compare(
        self, text_a: str, text_b: str, language: str = "zh"
    ) -> dict:
        """Compare two transcripts and return comparative metrics.

        Useful for A/B testing different ASR outputs.
        """
        eval_a = self.evaluate(text_a, language)
        eval_b = self.evaluate(text_b, language)

        return {
            "text_a": {
                "readability": eval_a.readability_score,
                "filler_density": eval_a.filler_density,
                "repetition_density": eval_a.repetition_density,
                "number_issues": eval_a.number_issues,
                "hallucination_count": eval_a.hallucination_count,
            },
            "text_b": {
                "readability": eval_b.readability_score,
                "filler_density": eval_b.filler_density,
                "repetition_density": eval_b.repetition_density,
                "number_issues": eval_b.number_issues,
                "hallucination_count": eval_b.hallucination_count,
            },
            "winner": "A" if eval_a.overall_score >= eval_b.overall_score else "B",
            "score_diff": abs(eval_a.overall_score - eval_b.overall_score),
        }

    def _calc_filler_density(self, text: str, language: str) -> float:
        """Calculate the density of filler words in the text."""
        if not text:
            return 0.0

        filler_chars = 0
        if language in ("zh", "yue", "wuu"):
            for filler in _ZH_FILLERS:
                count = text.count(filler)
                filler_chars += count * len(filler)
        else:
            words = text.lower().split()
            en_fillers = {"um", "uh", "like", "basically", "actually", "literally"}
            filler_chars = sum(len(w) for w in words if w in en_fillers)

        return min(filler_chars / max(len(text), 1), 1.0)

    def _calc_repetition_density(self, text: str) -> float:
        """Detect consecutive repetitions in text."""
        if not text:
            return 0.0

        # Match 2+ consecutive repeats of 1-6 char patterns
        pattern = r"([\u4e00-\u9fff]{1,6})\1{2,}"
        matches = re.findall(pattern, text)
        repeated_chars = sum(len(m) * (text.count(m * 3)) * 3 for m in matches)

        return min(repeated_chars / max(len(text), 1), 1.0)

    def _count_number_issues(self, text: str, language: str) -> int:
        """Count suspicious number rendering patterns."""
        issues = 0
        if language in ("zh", "yue", "wuu"):
            # Arabic digits surrounded by Chinese chars (e.g., "1个月", "3到5年")
            issues += len(re.findall(
                r"(?<=[\u4e00-\u9fff])\d(?=[\u4e00-\u9fff])", text
            ))
            # Isolated single digits in Chinese context
            issues += len(re.findall(
                r"(?<!\d)\d(?!\d)(?=[\u4e00-\u9fff]{2})", text
            ))
        return issues

    def _count_hallucinations(self, text: str) -> int:
        """Count suspected hallucination patterns."""
        count = 0
        for pattern in _HALLUCINATION_PATTERNS:
            count += len(re.findall(pattern, text, re.IGNORECASE))
        return count
