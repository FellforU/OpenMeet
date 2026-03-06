"""LLM-based ASR error correction processor.

Uses system-configured LLM to fix common ASR recognition errors:
- Homophone/near-sound substitutions
- Technical terms / product names / person names
- Spoken number expressions
"""

import logging
import math
import re
from typing import Optional

from asr_service.models.job import Segment
from asr_service.services.llm_client import LLMClient

logger = logging.getLogger(__name__)

# Max characters per LLM correction chunk.
# Most cloud LLMs support 32K-128K context. Use a large default to avoid
# unnecessary splitting. Only split for very long meetings (500+ segments).
_CHUNK_SIZE = 30000

_CORRECTION_PROMPT = """你是一个专业的语音转录校对助手。以下是 ASR（语音识别）系统输出的会议转录文本，每行前有编号 [N]。

请修正其中明显的 ASR 识别错误，包括：
1. 同音/近音字替换错误（如"国购服务器"→"Google服务器"、"夫妻"→"服务器"、"一饭"→"Jira"）
2. 技术术语/产品名/人名的误识别（如"欧本Kotlin"→"OpenClaw"、"本club"→"OpenClaw"）
3. 口语数字表述错误（如"二分四季"→"2核4G"、"幺50"→"#150"）

## 严格要求
- 只修正明显的 ASR 错误，不要改动语义、语序或口语表达风格
- 不要添加或删除内容，不要润色文字
- 对于不确定的词，保持原样不修改
- 保持原始编号格式 [N]，每行一条
- 只输出修正后的文本，不要其他解释

## 待校对文本
{text}"""

# Pattern to parse "[N] text" lines from LLM response
_LINE_PATTERN = re.compile(r"^\[(\d+)\]\s*(.+)", re.MULTILINE)
# Pattern to strip <think>...</think> reasoning blocks from model output
_THINK_PATTERN = re.compile(r"<think>.*?</think>", re.DOTALL)


class LLMCorrector:
    """Post-processing step that uses LLM to correct ASR errors."""

    def __init__(self, llm_client: LLMClient):
        self._llm = llm_client

    async def correct(self, segments: list[Segment]) -> list[Segment]:
        """Correct ASR errors in segments using LLM.

        Returns new segment list with corrected text.
        Falls back to original segments on any error.
        """
        if not segments:
            return segments

        if not self._llm.is_configured():
            logger.info("LLM not configured, skipping ASR error correction")
            return segments

        try:
            return await self._correct_impl(segments)
        except Exception as e:
            logger.warning("LLM correction failed: %s", e)
            return segments

    async def _correct_impl(self, segments: list[Segment]) -> list[Segment]:
        """Core correction logic: chunk → LLM → parse → merge."""
        # Build numbered transcript
        lines = [f"[{i}] {seg.text}" for i, seg in enumerate(segments)]
        full_text = "\n".join(lines)

        # Split into chunks at line boundaries
        chunks = _split_chunks(full_text)
        logger.info(
            "LLM correction: %d segments, %d chunks",
            len(segments), len(chunks),
        )

        # Process each chunk sequentially
        corrected_map: dict[int, str] = {}
        for ci, chunk in enumerate(chunks):
            prompt = _CORRECTION_PROMPT.format(text=chunk)
            try:
                # Use large max_tokens since output mirrors input size
                # Estimate max_tokens: output mirrors input + overhead.
                # Chinese: ~1.5 tokens per char; add 20% headroom.
                chunk_tokens = max(8000, math.ceil(len(chunk) * 1.5 * 1.2))
                response = await self._llm.generate(
                    prompt, max_tokens=chunk_tokens,
                )
                # Strip <think>...</think> blocks (DeepSeek R1, etc.)
                response = _THINK_PATTERN.sub("", response).strip()
                # Log response snippet for debugging
                resp_lines = response.split("\n") if response else []
                logger.info(
                    "LLM correction chunk %d/%d: response %d chars, "
                    "%d lines, first 3: %s",
                    ci + 1, len(chunks), len(response), len(resp_lines),
                    resp_lines[:3],
                )
                # Parse [N] corrected_text lines
                matches_found = 0
                for match in _LINE_PATTERN.finditer(response):
                    idx = int(match.group(1))
                    corrected = match.group(2).strip()
                    if corrected and 0 <= idx < len(segments):
                        corrected_map[idx] = corrected
                        matches_found += 1
                logger.info(
                    "LLM correction chunk %d/%d: parsed %d matches",
                    ci + 1, len(chunks), matches_found,
                )
            except Exception as e:
                logger.warning(
                    "LLM correction chunk %d/%d failed: %s",
                    ci + 1, len(chunks), e,
                )
                # Skip failed chunk, keep original text

        if not corrected_map:
            logger.info("LLM correction: no corrections produced")
            return segments

        # Build corrected segments
        result = []
        changed = 0
        for i, seg in enumerate(segments):
            new_text = corrected_map.get(i)
            if new_text and new_text != seg.text:
                changed += 1
                result.append(Segment(
                    start=seg.start,
                    end=seg.end,
                    text=new_text,
                    speaker=seg.speaker,
                    confidence=seg.confidence,
                ))
            else:
                result.append(seg)

        logger.info(
            "LLM correction: %d/%d segments corrected",
            changed, len(segments),
        )
        return result


def _split_chunks(text: str) -> list[str]:
    """Split numbered transcript into chunks at line boundaries."""
    if len(text) <= _CHUNK_SIZE:
        return [text]

    chunks: list[str] = []
    current = ""

    for line in text.split("\n"):
        if current and len(current) + len(line) + 1 > _CHUNK_SIZE:
            chunks.append(current)
            current = line
        else:
            current = f"{current}\n{line}" if current else line

    if current:
        chunks.append(current)
    return chunks
