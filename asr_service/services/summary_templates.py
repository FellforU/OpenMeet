"""Meeting summary prompt templates for Ollama LLM.

Bilingual templates (Chinese + English) for structured meeting minutes.
"""

SYSTEM_PROMPT_ZH = """你是一个专业的会议记录助手。你的任务是根据会议转录文本生成结构化的会议纪要。
请严格按照JSON格式输出，不要添加任何额外的说明或标记。"""

SYSTEM_PROMPT_EN = """You are a professional meeting minutes assistant. Your task is to generate structured meeting notes from transcription text.
Output strictly in JSON format without any additional explanation or markup."""

SUMMARY_PROMPT_ZH = """请根据以下会议转录生成结构化的会议纪要。

会议转录:
{transcript}

请输出以下JSON格式：
{{
  "topic": "会议主题（一句话概括）",
  "conclusions": ["结论1", "结论2", "结论3"],
  "action_items": [
    {{"action": "行动项描述", "owner": "责任人（如有）", "deadline": "截止日期（如有）"}}
  ],
  "discussion": "详细讨论摘要（200-500字）"
}}"""

SUMMARY_PROMPT_EN = """Generate structured meeting notes from the following transcription.

Meeting Transcription:
{transcript}

Output in the following JSON format:
{{
  "topic": "Meeting topic (one sentence summary)",
  "conclusions": ["Conclusion 1", "Conclusion 2", "Conclusion 3"],
  "action_items": [
    {{"action": "Action item description", "owner": "Assigned to (if any)", "deadline": "Due date (if any)"}}
  ],
  "discussion": "Detailed discussion summary (200-500 words)"
}}"""


def get_summary_prompt(transcript: str, language: str = "zh") -> tuple[str, str]:
    """Get the system prompt and user prompt for summary generation.

    Returns (system_prompt, user_prompt).
    """
    chinese_codes = {"zh", "yue", "wuu", "min_nan", "gan", "hakka", "xiang"}

    if language in chinese_codes:
        return SYSTEM_PROMPT_ZH, SUMMARY_PROMPT_ZH.format(transcript=transcript)

    return SYSTEM_PROMPT_EN, SUMMARY_PROMPT_EN.format(transcript=transcript)


def format_transcript(segments: list) -> str:
    """Format segments into a readable transcript string."""
    lines = []
    for seg in segments:
        speaker = getattr(seg, "speaker", None) or ""
        prefix = f"[{speaker}] " if speaker else ""
        start = getattr(seg, "start", 0)
        minutes = int(start // 60)
        seconds = int(start % 60)
        timestamp = f"[{minutes:02d}:{seconds:02d}]"
        lines.append(f"{timestamp} {prefix}{seg.text}")
    return "\n".join(lines)
