"""Summary quality evaluator.

Compares generated summaries against reference summaries or raw transcripts
to evaluate topic coverage, action item extraction, and data preservation.
"""

import re
import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class EvaluationResult:
    """Aggregated evaluation scores for a summary."""
    topic_coverage: float = 0.0       # 0-1, how many reference topics covered
    action_item_recall: float = 0.0   # 0-1, how many reference items extracted
    key_data_recall: float = 0.0      # 0-1, how many key numbers/data preserved
    structural_score: float = 0.0     # 0-1, structure completeness
    overall_score: float = 0.0        # weighted average
    details: dict = field(default_factory=dict)


@dataclass
class ReferenceSummary:
    """Reference summary for comparison (e.g., from Notion or manual notes)."""
    topics: list[str] = field(default_factory=list)
    action_items: list[str] = field(default_factory=list)
    key_data: list[str] = field(default_factory=list)
    conclusions: list[str] = field(default_factory=list)


class SummaryEvaluator:
    """Evaluates summary quality by comparing against reference data."""

    def __init__(self, weights: dict[str, float] | None = None):
        self._weights = weights or {
            "topic_coverage": 0.35,
            "action_item_recall": 0.30,
            "key_data_recall": 0.20,
            "structural_score": 0.15,
        }

    def evaluate(
        self,
        generated: dict,
        reference: ReferenceSummary,
    ) -> EvaluationResult:
        """Evaluate a generated summary against a reference.

        Args:
            generated: The generated summary dict with keys:
                topic, conclusions, action_items, discussion, key_data
            reference: Reference data to compare against.

        Returns:
            EvaluationResult with detailed scores.
        """
        result = EvaluationResult()

        # 1. Topic coverage: check how many reference topics appear in discussion
        result.topic_coverage, topic_details = self._evaluate_topic_coverage(
            generated, reference.topics
        )
        result.details["topic_coverage"] = topic_details

        # 2. Action item recall: check how many reference items are captured
        result.action_item_recall, action_details = self._evaluate_action_items(
            generated, reference.action_items
        )
        result.details["action_item_recall"] = action_details

        # 3. Key data recall: check if numbers/data are preserved
        result.key_data_recall, data_details = self._evaluate_key_data(
            generated, reference.key_data
        )
        result.details["key_data_recall"] = data_details

        # 4. Structural completeness
        result.structural_score = self._evaluate_structure(generated)

        # Overall weighted score
        result.overall_score = (
            self._weights["topic_coverage"] * result.topic_coverage
            + self._weights["action_item_recall"] * result.action_item_recall
            + self._weights["key_data_recall"] * result.key_data_recall
            + self._weights["structural_score"] * result.structural_score
        )

        return result

    def evaluate_from_transcript(
        self,
        generated: dict,
        transcript: str,
    ) -> EvaluationResult:
        """Evaluate summary quality using transcript as reference.

        Extracts reference data from transcript automatically.
        """
        reference = self._extract_reference_from_transcript(transcript)
        return self.evaluate(generated, reference)

    def _evaluate_topic_coverage(
        self, generated: dict, reference_topics: list[str]
    ) -> tuple[float, dict]:
        """Check how many reference topics are covered in the summary."""
        if not reference_topics:
            return 1.0, {"message": "no reference topics to compare"}

        # Build full text from generated summary for matching
        full_text = self._build_full_text(generated)

        matched = []
        missed = []
        for topic in reference_topics:
            # Check for keyword overlap using simple substring matching
            keywords = _extract_keywords(topic)
            match_count = sum(1 for kw in keywords if kw in full_text)
            if match_count >= max(1, len(keywords) * 0.4):
                matched.append(topic)
            else:
                missed.append(topic)

        score = len(matched) / len(reference_topics) if reference_topics else 0.0
        return score, {"matched": matched, "missed": missed}

    def _evaluate_action_items(
        self, generated: dict, reference_items: list[str]
    ) -> tuple[float, dict]:
        """Check how many reference action items are captured."""
        if not reference_items:
            return 1.0, {"message": "no reference action items to compare"}

        gen_items = generated.get("action_items", [])
        gen_text = " ".join(
            (item.get("task", "") + " " + item.get("action", ""))
            for item in gen_items
        )

        matched = []
        missed = []
        for item in reference_items:
            keywords = _extract_keywords(item)
            match_count = sum(1 for kw in keywords if kw in gen_text)
            if match_count >= max(1, len(keywords) * 0.3):
                matched.append(item)
            else:
                missed.append(item)

        score = len(matched) / len(reference_items) if reference_items else 0.0
        return score, {"matched": matched, "missed": missed}

    def _evaluate_key_data(
        self, generated: dict, reference_data: list[str]
    ) -> tuple[float, dict]:
        """Check if key numbers and data are preserved."""
        if not reference_data:
            return 1.0, {"message": "no reference data to compare"}

        full_text = self._build_full_text(generated)

        matched = []
        missed = []
        for data_item in reference_data:
            # Extract numbers from the data item
            numbers = re.findall(r"\d+", data_item)
            if numbers:
                found = any(num in full_text for num in numbers)
            else:
                found = data_item in full_text

            if found:
                matched.append(data_item)
            else:
                missed.append(data_item)

        score = len(matched) / len(reference_data) if reference_data else 0.0
        return score, {"matched": matched, "missed": missed}

    def _evaluate_structure(self, generated: dict) -> float:
        """Evaluate structural completeness of the summary."""
        score = 0.0
        total = 5

        if generated.get("topic"):
            score += 1
        if generated.get("conclusions") and len(generated["conclusions"]) > 0:
            score += 1
        if generated.get("action_items") and len(generated["action_items"]) > 0:
            score += 1
        if generated.get("discussion"):
            discussions = generated["discussion"]
            if isinstance(discussions, list) and len(discussions) > 0:
                score += 1
            elif isinstance(discussions, str) and len(discussions) > 50:
                score += 0.5
        if generated.get("key_data") and len(generated["key_data"]) > 0:
            score += 1

        return score / total

    def _build_full_text(self, generated: dict) -> str:
        """Build a single text string from all summary fields for matching."""
        parts = [
            generated.get("topic", ""),
            " ".join(generated.get("conclusions", [])),
        ]

        for item in generated.get("action_items", []):
            parts.append(item.get("task", ""))
            parts.append(item.get("action", ""))

        discussion = generated.get("discussion", [])
        if isinstance(discussion, list):
            for d in discussion:
                if isinstance(d, dict):
                    parts.append(d.get("topic", ""))
                    parts.append(d.get("summary", ""))
                else:
                    parts.append(str(d))
        elif isinstance(discussion, str):
            parts.append(discussion)

        for data in generated.get("key_data", []):
            parts.append(str(data))

        return " ".join(parts)

    def _extract_reference_from_transcript(self, transcript: str) -> ReferenceSummary:
        """Auto-extract reference data from raw transcript."""
        ref = ReferenceSummary()

        # Extract numbers and data patterns
        number_patterns = re.findall(
            r"[\d一二三四五六七八九十百千万]+[美金元块%年月日天个台]+",
            transcript,
        )
        ref.key_data = list(set(number_patterns))

        # Extract potential action items (imperative patterns)
        action_patterns = re.findall(
            r"(?:你|我们|他)(?:先|要|去|可以|需要|应该)[^，。！？\n]{4,30}",
            transcript,
        )
        ref.action_items = list(set(action_patterns))[:15]

        return ref


def _extract_keywords(text: str) -> list[str]:
    """Extract meaningful keywords from text for matching."""
    # Remove common stop words and short tokens
    stop_words = {"的", "了", "是", "在", "和", "与", "或", "这", "那", "个", "把", "被"}
    # Split on non-word characters
    tokens = re.findall(r"[\u4e00-\u9fff]{2,}|[a-zA-Z]{3,}|\d+", text)
    return [t for t in tokens if t not in stop_words]
