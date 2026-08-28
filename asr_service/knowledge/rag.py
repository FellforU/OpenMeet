"""RAG pipeline for knowledge-based question answering."""

import json
from typing import AsyncIterator, Optional

from .mcp_tools import MCPTools
from ..services.ollama_client import OllamaClient


SYSTEM_PROMPT = """你是 OpenMeet 的 AI 助手，负责基于会议数据回答用户问题。

请遵循以下规则：
1. 只基于提供的上下文信息回答，不要编造内容
2. 如果上下文中没有相关信息，明确告知用户
3. 引用来源时标注会议名称和时间
4. 回答简洁清晰，使用中文
5. 对于统计类问题，给出准确的数字"""

STATS_KEYWORDS = ["几次", "多少", "统计", "数量", "总共", "时长", "频率", "how many", "count", "total"]
ACTION_KEYWORDS = ["待办", "行动项", "任务", "todo", "action item", "to do"]
SPEAKER_KEYWORDS = ["发言人", "谁说", "说话", "speaker", "who said"]


def classify_question(question: str) -> str:
    """Classify question type to determine which tools to use."""
    q_lower = question.lower()
    if any(kw in q_lower for kw in STATS_KEYWORDS):
        return "stats"
    if any(kw in q_lower for kw in ACTION_KEYWORDS):
        return "action_items"
    if any(kw in q_lower for kw in SPEAKER_KEYWORDS):
        return "speaker"
    return "search"


class RAGPipeline:
    """RAG pipeline that uses MCP tools for context retrieval."""

    def __init__(self, mcp_tools: MCPTools, ollama: Optional[OllamaClient] = None):
        self._tools = mcp_tools
        self._ollama = ollama

    @staticmethod
    def _serialize_sources(sources: list[dict]) -> list[dict]:
        """Serialize source references for API responses."""
        return [
            {
                "project_id": s["project_id"],
                "project_title": s.get("project_title", ""),
                "source_type": s["source_type"],
                "text": s["text"][:100],
                "metadata": s.get("metadata", {}),
            }
            for s in sources
        ]

    async def _retrieve_context(
        self,
        question: str,
        project_id: Optional[str] = None,
        context_scope: str = "all",
    ) -> tuple[str, str, list[dict]]:
        """Retrieve context for a question. Returns (question_type, context_text, sources)."""
        q_type = classify_question(question)
        project_ids = [project_id] if project_id and context_scope == "current" else None

        context_text = ""
        sources: list[dict] = []

        if q_type == "stats":
            result = await self._tools.invoke("get_meeting_stats", {"project_ids": project_ids})
            context_text = f"会议统计数据：\n{json.dumps(result, ensure_ascii=False, indent=2)}"

        elif q_type == "action_items":
            result = await self._tools.invoke("get_action_items", {"project_ids": project_ids})
            context_text = f"行动项列表：\n{json.dumps(result, ensure_ascii=False, indent=2)}"

        elif q_type == "speaker":
            result = await self._tools.invoke("get_speaker_analysis", {"project_ids": project_ids})
            context_text = f"发言人分析：\n{json.dumps(result, ensure_ascii=False, indent=2)}"
            search_result = await self._tools.invoke(
                "search_knowledge_base",
                {"query": question, "project_ids": project_ids, "top_k": 3},
            )
            if search_result.get("results"):
                context_text += "\n\n相关转录：\n"
                for r in search_result["results"]:
                    context_text += f"- [{r['project_title']}] {r['text']}\n"
                    sources.append(r)

        else:  # search
            result = await self._tools.invoke(
                "search_knowledge_base",
                {"query": question, "project_ids": project_ids, "top_k": 5},
            )
            if result.get("results"):
                context_text = "相关内容：\n"
                for r in result["results"]:
                    context_text += f"\n[{r['project_title']} - {r['source_type']}]\n{r['text']}\n"
                    sources.append(r)
            else:
                context_text = "未找到相关内容。"

        return q_type, context_text, sources

    async def retrieve(
        self,
        question: str,
        project_id: Optional[str] = None,
        context_scope: str = "all",
    ) -> dict:
        """Retrieve context without calling LLM. For use by /chat/context endpoint."""
        q_type, context_text, sources = await self._retrieve_context(
            question, project_id, context_scope
        )
        return {
            "question_type": q_type,
            "context_text": context_text,
            "sources": self._serialize_sources(sources),
        }

    async def answer(
        self,
        question: str,
        project_id: Optional[str] = None,
        context_scope: str = "all",
        model: str = "qwen2.5:7b",
    ) -> AsyncIterator[dict]:
        """Answer a question using RAG. Yields streaming events.

        Events:
          {"type": "context", "data": {...}}    - retrieved context
          {"type": "token", "text": "..."}      - LLM token
          {"type": "sources", "sources": [...]} - source references
          {"type": "done"}                      - stream complete
        """
        q_type, context_text, sources = await self._retrieve_context(
            question, project_id, context_scope
        )

        # Yield context event
        yield {"type": "context", "data": {"question_type": q_type, "context_preview": context_text[:200]}}

        # Build prompt
        prompt = f"""上下文信息：
{context_text}

用户问题：{question}

请基于上下文信息回答问题。"""

        # Stream LLM response
        if self._ollama:
            try:
                async for token in self._ollama.generate_stream(
                    prompt=prompt,
                    model=model,
                    system=SYSTEM_PROMPT,
                ):
                    yield {"type": "token", "text": token}
            except Exception as e:
                yield {"type": "token", "text": f"\n\n[LLM 调用失败: {e}]"}
        else:
            yield {"type": "token", "text": "[LLM 未配置，请使用前端 Chat]"}

        # Yield sources
        if sources:
            yield {
                "type": "sources",
                "sources": self._serialize_sources(sources),
            }

        yield {"type": "done"}
