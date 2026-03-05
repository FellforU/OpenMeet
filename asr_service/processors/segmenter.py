"""Semantic paragraph segmenter for transcription output.

Groups transcript segments into logical paragraphs based on time gaps,
semantic topic markers, or a hybrid of both. Inserts paragraph boundary
markers (\n\n) into segment text at paragraph boundaries.

Strategies:
- time: split when silence gap exceeds threshold
- semantic: split on topic-change keywords
- hybrid: combine time, semantic, and duration limits
"""

from dataclasses import dataclass
from typing import List

from asr_service.models.job import Segment


@dataclass
class SegmenterConfig:
    """Paragraph segmentation configuration."""
    enabled: bool = True
    strategy: str = "hybrid"  # time, semantic, hybrid
    min_segment_duration: float = 5.0
    max_segment_duration: float = 60.0
    gap_threshold: float = 1.5
    language: str = "zh"


class SemanticSegmenter:
    """Paragraph segmenter with time, semantic, and hybrid strategies.

    Unlike the glm-4.7 version, this actually modifies segment text by
    appending paragraph boundary markers at split points.
    """

    ZH_TOPIC_MARKERS: List[str] = [
        "然后", "另外", "还有", "接下来", "至于", "说到",
        "关于", "那个话题", "回到", "再说", "另外说",
        "那么", "现在", "还有就是", "另外再说",
    ]

    EN_TOPIC_MARKERS: List[str] = [
        "by the way", "also", "another thing", "next",
        "about", "regarding", "moving on", "back to",
        "speaking of", "in addition", "furthermore",
    ]

    def __init__(self, config: SegmenterConfig | None = None):
        self.config = config or SegmenterConfig()

    def process(self, segments: List[Segment]) -> List[Segment]:
        """Apply paragraph segmentation to segments.

        Inserts '\\n\\n' at the end of the last segment in each paragraph
        (except the final one) to mark paragraph boundaries.

        Returns a new list of Segment objects (immutable operation).
        """
        if not self.config.enabled or not segments:
            return segments

        paragraphs = self._split_paragraphs(segments)
        return self._mark_boundaries(paragraphs)

    def _split_paragraphs(self, segments: List[Segment]) -> List[List[Segment]]:
        """Split segments into paragraph groups based on strategy."""
        if self.config.strategy == "time":
            return self._time_based(segments)
        elif self.config.strategy == "semantic":
            return self._semantic_based(segments)
        return self._hybrid_based(segments)

    def _time_based(self, segments: List[Segment]) -> List[List[Segment]]:
        """Split on silence gaps exceeding threshold."""
        if not segments:
            return []

        paragraphs: List[List[Segment]] = []
        current: List[Segment] = [segments[0]]

        for i in range(1, len(segments)):
            gap = segments[i].start - segments[i - 1].end
            if gap > self.config.gap_threshold:
                paragraphs.append(current)
                current = [segments[i]]
            else:
                current.append(segments[i])

        if current:
            paragraphs.append(current)
        return paragraphs

    def _semantic_based(self, segments: List[Segment]) -> List[List[Segment]]:
        """Split on topic-change keyword markers."""
        if not segments:
            return []

        paragraphs: List[List[Segment]] = []
        current: List[Segment] = [segments[0]]
        markers = self._get_topic_markers()

        for i in range(1, len(segments)):
            text = segments[i].text.strip().lower()
            has_marker = any(marker in text for marker in markers)

            if has_marker and len(current) >= 2:
                paragraphs.append(current)
                current = [segments[i]]
            else:
                current.append(segments[i])

        if current:
            paragraphs.append(current)
        return paragraphs

    def _hybrid_based(self, segments: List[Segment]) -> List[List[Segment]]:
        """Combine time gaps, semantic markers, and duration limits."""
        if not segments:
            return []

        paragraphs: List[List[Segment]] = []
        current: List[Segment] = [segments[0]]
        current_duration = segments[0].end - segments[0].start
        markers = self._get_topic_markers()

        for i in range(1, len(segments)):
            gap = segments[i].start - segments[i - 1].end
            text = segments[i].text.strip().lower()
            has_marker = any(marker in text for marker in markers)

            should_split = (
                gap > self.config.gap_threshold
                or has_marker
                or current_duration >= self.config.max_segment_duration
            )

            if should_split and current_duration >= self.config.min_segment_duration:
                paragraphs.append(current)
                current = [segments[i]]
                current_duration = segments[i].end - segments[i].start
            else:
                current.append(segments[i])
                current_duration += segments[i].end - segments[i].start

        if current:
            paragraphs.append(current)
        return paragraphs

    def _get_topic_markers(self) -> List[str]:
        """Return topic markers for the configured language."""
        chinese_codes = {"zh", "yue", "wuu", "min_nan", "gan", "hakka", "xiang"}
        if self.config.language in chinese_codes:
            return self.ZH_TOPIC_MARKERS
        return self.EN_TOPIC_MARKERS

    @staticmethod
    def _mark_boundaries(paragraphs: List[List[Segment]]) -> List[Segment]:
        """Mark paragraph boundaries by appending \\n\\n to the last segment of each paragraph."""
        result: List[Segment] = []
        for para_idx, paragraph in enumerate(paragraphs):
            for seg_idx, seg in enumerate(paragraph):
                is_last_in_para = seg_idx == len(paragraph) - 1
                is_last_para = para_idx == len(paragraphs) - 1

                if is_last_in_para and not is_last_para:
                    result.append(Segment(
                        start=seg.start,
                        end=seg.end,
                        text=seg.text + "\n\n",
                        speaker=seg.speaker,
                        confidence=seg.confidence,
                    ))
                else:
                    result.append(seg)
        return result


class ParagraphFormatter:
    """Utility for formatting segmented paragraphs into text."""

    @staticmethod
    def format_paragraphs(paragraphs: List[List[Segment]]) -> str:
        """Format paragraph groups into text with blank line separators."""
        lines = []
        for para_idx, paragraph in enumerate(paragraphs):
            for seg in paragraph:
                lines.append(seg.text)
            if para_idx < len(paragraphs) - 1:
                lines.append("")
        return "\n".join(lines)

    @staticmethod
    def get_paragraph_boundaries(
        paragraphs: List[List[Segment]],
    ) -> List[tuple[float, float]]:
        """Get (start_time, end_time) for each paragraph."""
        boundaries = []
        for paragraph in paragraphs:
            if not paragraph:
                continue
            boundaries.append((paragraph[0].start, paragraph[-1].end))
        return boundaries
