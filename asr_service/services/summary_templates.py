"""Meeting summary prompt templates for Ollama LLM.

Bilingual templates (Chinese + English) for structured meeting minutes.
Includes single-pass prompts and map-reduce prompts for long transcripts.
"""

# ---------------------------------------------------------------------------
# System Prompts
# ---------------------------------------------------------------------------

SYSTEM_PROMPT_ZH = """你是一个专业且细致的会议记录助手。你的核心原则：

1. **完整性**：覆盖会议中讨论的所有话题，不遗漏任何议题，包括非决策性讨论（如学习心得、经验分享、团队文化等软性话题）。
2. **数据保真**：原样保留会议中提到的所有关键数据——数字、金额、日期、百分比、人名、产品名、技术术语。绝不概括或省略具体数值。
3. **行动项提取**：不仅提取明确分配的任务，还要识别隐含的行动项（如"我们需要考虑一下X"、"下次再讨论Y"、"回头看看Z"）。
4. **严格JSON输出**：只输出合法JSON，不添加 markdown 代码围栏、注释或任何额外文字。"""

SYSTEM_PROMPT_EN = """You are a thorough, detail-oriented meeting minutes assistant. Your core principles:

1. **Completeness**: Cover ALL topics discussed in the meeting — do not skip any subject, including soft topics (learning insights, experience sharing, team culture, etc.).
2. **Data Fidelity**: Preserve ALL key data mentioned — numbers, costs, dates, percentages, names, product names, technical terms. Never summarize away specific values.
3. **Action Item Extraction**: Extract both explicit assignments AND implicit action items (e.g., "we should look into X", "let's revisit Y next time", "someone needs to check Z").
4. **Strict JSON Output**: Output only valid JSON — no markdown fences, no comments, no extra text."""

# ---------------------------------------------------------------------------
# Single-pass Summary Prompts
# ---------------------------------------------------------------------------

SUMMARY_PROMPT_ZH = """请根据以下会议转录生成完整、详尽的结构化会议纪要。

## 要求

1. **topic**：用一句话概括会议的核心主题（10-30字）。
2. **conclusions**：列出会议达成的所有结论和共识。每条结论保留具体数据（金额、日期、百分比等）。如果没有明确结论，列出关键观点。目标：3-10条。
3. **decisions**：提取会议中做出的所有决策（区别于结论，决策是明确拍板的事项），包含决策内容、决策人和理由。
4. **action_items**：提取所有行动项，包括：
   - 明确分配的任务（"小王去做X"）
   - 隐含的待办（"我们需要调研X"、"下次讨论Y"、"回头确认Z"）
   - 每项包含 assignee（责任人）、task（任务描述）、deadline（截止日期或null）、priority（high/medium/low）、status（not_started/in_progress/completed）
   - 目标：提取所有可识别的行动项，通常 3-15 条
5. **discussion**：按子话题拆分讨论内容，每个子话题包含 topic（子话题名）、summary（摘要）、participants（该话题参与者）、key_points（关键要点列表）。
   - 覆盖所有讨论过的话题，不仅是有结论的话题
   - 目标：3-15个子话题
6. **technical_details**：提取会议中涉及的技术细节（架构方案、技术选型、系统设计等），每项包含 category（分类）和 details（详细描述）。
7. **next_steps**：提取会议确定的下一步行动计划。
8. **key_data**：提取会议中提到的所有关键数据点。
9. **participants**：从转录中识别所有参会者姓名或代号。

## 会议转录
{transcript}

## 输出格式（严格JSON）
{{
  "topic": "会议主题概括",
  "conclusions": ["结论1，包含具体数据"],
  "decisions": [
    {{"decision": "决策内容", "made_by": "决策人", "reasoning": "理由"}}
  ],
  "action_items": [
    {{"assignee": "责任人", "task": "具体任务描述", "deadline": "2026-03-15", "priority": "medium", "status": "not_started"}}
  ],
  "discussion": [
    {{"topic": "子话题名称", "summary": "详细摘要", "participants": ["张三"], "key_points": ["要点1"]}}
  ],
  "technical_details": [
    {{"category": "技术分类", "details": "技术细节描述"}}
  ],
  "next_steps": ["下一步行动1"],
  "key_data": ["Q1成本降低15%", "上线日期3月15日"],
  "participants": ["张三", "李四"]
}}"""

SUMMARY_PROMPT_EN = """Generate a thorough, comprehensive set of structured meeting notes from the following transcription.

## Requirements

1. **topic**: One-sentence summary of the meeting's core theme (10-30 words).
2. **conclusions**: List ALL conclusions and agreements reached. Preserve specific data. Target: 3-10 items.
3. **decisions**: Extract all decisions made (distinct from conclusions — decisions are explicitly agreed-upon choices), with decision content, who made it, and reasoning.
4. **action_items**: Extract ALL action items, including explicit and implicit ones.
   - Each item has: assignee, task, deadline (or null), priority (high/medium/low), status (not_started/in_progress/completed)
   - Target: 3-15 items
5. **discussion**: Break down by sub-topic. Each has topic, summary, participants (who discussed it), key_points (bullet points).
   - Cover ALL topics discussed. Target: 3-15 sub-topics
6. **technical_details**: Extract technical details (architecture, tech choices, system design). Each has category and details.
7. **next_steps**: Extract confirmed next action plans.
8. **key_data**: Extract ALL key data points mentioned.
9. **participants**: Identify all participant names or identifiers.

## Meeting Transcription
{transcript}

## Output Format (strict JSON)
{{
  "topic": "Meeting topic summary",
  "conclusions": ["Conclusion 1 with specific data"],
  "decisions": [
    {{"decision": "Decision content", "made_by": "Person", "reasoning": "Reason"}}
  ],
  "action_items": [
    {{"assignee": "Person", "task": "Task description", "deadline": "2026-03-15", "priority": "medium", "status": "not_started"}}
  ],
  "discussion": [
    {{"topic": "Sub-topic name", "summary": "Detailed summary", "participants": ["Alice"], "key_points": ["Point 1"]}}
  ],
  "technical_details": [
    {{"category": "Category", "details": "Technical details"}}
  ],
  "next_steps": ["Next action 1"],
  "key_data": ["Q1 costs down 15%", "Launch date March 15"],
  "participants": ["Alice", "Bob"]
}}"""

# ---------------------------------------------------------------------------
# Map-Reduce: Chunk Summary Prompts (map phase)
# ---------------------------------------------------------------------------

CHUNK_SUMMARY_PROMPT_ZH = """请总结以下会议转录片段。这是完整会议的一部分，后续会合并所有片段的摘要。

## 要求
- 提取该片段中的所有话题、结论、决策、行动项和关键数据
- 行动项标注优先级(high/medium/low)和状态(not_started/in_progress/completed)
- 讨论话题标注参与者和关键要点
- 提取技术细节和下一步行动
- 保留所有具体数据（数字、日期、金额、百分比、人名）
- 记录所有出现的参会者

## 会议转录片段
{transcript}

## 输出格式（严格JSON）
{{
  "topics": ["该片段讨论的话题1", "话题2"],
  "conclusions": ["该片段中达成的结论"],
  "decisions": [
    {{"decision": "决策内容", "made_by": "决策人", "reasoning": "理由"}}
  ],
  "action_items": [
    {{"assignee": "责任人", "task": "任务描述", "deadline": null, "priority": "medium", "status": "not_started"}}
  ],
  "discussion_points": [
    {{"topic": "子话题", "summary": "摘要", "participants": ["参与者"], "key_points": ["要点1"]}}
  ],
  "technical_details": [
    {{"category": "分类", "details": "技术细节"}}
  ],
  "next_steps": ["下一步行动"],
  "key_data": ["提到的具体数据"],
  "participants": ["出现的参会者"]
}}"""

CHUNK_SUMMARY_PROMPT_EN = """Summarize the following meeting transcript chunk. This is part of a larger meeting; all chunk summaries will be merged later.

## Requirements
- Extract all topics, conclusions, decisions, action items, and key data from this chunk
- Action items should include priority (high/medium/low) and status (not_started/in_progress/completed)
- Discussion points should include participants and key points
- Extract technical details and next steps
- Preserve all specific data (numbers, dates, amounts, percentages, names)
- Record all participants mentioned

## Transcript Chunk
{transcript}

## Output Format (strict JSON)
{{
  "topics": ["Topic 1 discussed in this chunk", "Topic 2"],
  "conclusions": ["Conclusions reached in this chunk"],
  "decisions": [
    {{"decision": "Decision content", "made_by": "Person", "reasoning": "Reason"}}
  ],
  "action_items": [
    {{"assignee": "Person", "task": "Task description", "deadline": null, "priority": "medium", "status": "not_started"}}
  ],
  "discussion_points": [
    {{"topic": "Sub-topic", "summary": "Summary", "participants": ["Person"], "key_points": ["Point 1"]}}
  ],
  "technical_details": [
    {{"category": "Category", "details": "Technical details"}}
  ],
  "next_steps": ["Next action"],
  "key_data": ["Specific data mentioned"],
  "participants": ["Participants mentioned"]
}}"""

# ---------------------------------------------------------------------------
# Map-Reduce: Merge Summary Prompts (reduce phase)
# ---------------------------------------------------------------------------

MERGE_SUMMARY_PROMPT_ZH = """以下是一场会议各个片段的摘要，请将它们合并为一份完整的、去重的结构化会议纪要。

## 要求
1. 合并所有片段中的话题，去除重复，合并同一话题的讨论内容。
2. 汇总所有结论和决策，去重并保留具体数据。
3. 汇总所有行动项，去重并合并相同任务，保留优先级和状态。
4. 合并讨论要点，标注参与者和关键要点。
5. 合并技术细节和下一步行动。
6. 汇总所有关键数据和参会者，去重。
7. 生成一个统一的会议主题概括。

## 各片段摘要
{chunk_summaries}

## 输出格式（严格JSON）
{{
  "topic": "会议主题概括",
  "conclusions": ["结论1，包含具体数据"],
  "decisions": [
    {{"decision": "决策内容", "made_by": "决策人", "reasoning": "理由"}}
  ],
  "action_items": [
    {{"assignee": "责任人", "task": "任务描述", "deadline": null, "priority": "medium", "status": "not_started"}}
  ],
  "discussion": [
    {{"topic": "子话题名称", "summary": "合并后的详细摘要", "participants": ["参与者"], "key_points": ["要点1"]}}
  ],
  "technical_details": [
    {{"category": "分类", "details": "技术细节"}}
  ],
  "next_steps": ["下一步行动"],
  "key_data": ["所有关键数据点"],
  "participants": ["所有参会者"]
}}"""

MERGE_SUMMARY_PROMPT_EN = """Below are summaries of individual chunks from a single meeting. Merge them into one complete, deduplicated, structured set of meeting notes.

## Requirements
1. Merge all topics across chunks — deduplicate and combine discussions on the same topic.
2. Consolidate all conclusions and decisions — deduplicate and preserve specific data.
3. Consolidate all action items — deduplicate, merge identical tasks, preserve priority and status.
4. Merge discussion points with participants and key points.
5. Merge technical details and next steps.
6. Consolidate all key data and participants — deduplicate.
7. Generate a unified meeting topic summary.

## Chunk Summaries
{chunk_summaries}

## Output Format (strict JSON)
{{
  "topic": "Meeting topic summary",
  "conclusions": ["Conclusion 1 with specific data"],
  "decisions": [
    {{"decision": "Decision content", "made_by": "Person", "reasoning": "Reason"}}
  ],
  "action_items": [
    {{"assignee": "Person", "task": "Task description", "deadline": null, "priority": "medium", "status": "not_started"}}
  ],
  "discussion": [
    {{"topic": "Sub-topic name", "summary": "Merged detailed summary", "participants": ["Person"], "key_points": ["Point 1"]}}
  ],
  "technical_details": [
    {{"category": "Category", "details": "Technical details"}}
  ],
  "next_steps": ["Next action"],
  "key_data": ["All key data points"],
  "participants": ["All participants"]
}}"""


# ---------------------------------------------------------------------------
# Helper Functions
# ---------------------------------------------------------------------------

def get_summary_prompt(transcript: str, language: str = "zh") -> tuple[str, str]:
    """Get the system prompt and user prompt for summary generation.

    Returns (system_prompt, user_prompt).
    """
    chinese_codes = {"zh", "yue", "wuu", "min_nan", "gan", "hakka", "xiang"}

    if language in chinese_codes:
        return SYSTEM_PROMPT_ZH, SUMMARY_PROMPT_ZH.format(transcript=transcript)

    return SYSTEM_PROMPT_EN, SUMMARY_PROMPT_EN.format(transcript=transcript)


def get_chunk_summary_prompt(
    transcript: str, language: str = "zh"
) -> tuple[str, str]:
    """Get the system prompt and user prompt for summarizing a single chunk.

    Used in the map phase of map-reduce summarization for long transcripts.
    Returns (system_prompt, user_prompt).
    """
    chinese_codes = {"zh", "yue", "wuu", "min_nan", "gan", "hakka", "xiang"}

    if language in chinese_codes:
        return SYSTEM_PROMPT_ZH, CHUNK_SUMMARY_PROMPT_ZH.format(
            transcript=transcript
        )

    return SYSTEM_PROMPT_EN, CHUNK_SUMMARY_PROMPT_EN.format(
        transcript=transcript
    )


def get_merge_summary_prompt(
    chunk_summaries: str, language: str = "zh"
) -> tuple[str, str]:
    """Get the system prompt and user prompt for merging chunk summaries.

    Used in the reduce phase of map-reduce summarization.
    The chunk_summaries parameter should be a JSON array string of all
    chunk summary results.
    Returns (system_prompt, user_prompt).
    """
    chinese_codes = {"zh", "yue", "wuu", "min_nan", "gan", "hakka", "xiang"}

    if language in chinese_codes:
        return SYSTEM_PROMPT_ZH, MERGE_SUMMARY_PROMPT_ZH.format(
            chunk_summaries=chunk_summaries
        )

    return SYSTEM_PROMPT_EN, MERGE_SUMMARY_PROMPT_EN.format(
        chunk_summaries=chunk_summaries
    )


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
