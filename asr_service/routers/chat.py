"""Chat endpoint with SSE streaming for RAG-based Q&A."""

import json
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

router = APIRouter(tags=["chat"])

# Set by main.py during initialization
_rag_pipeline = None


def set_rag_pipeline(pipeline):
    global _rag_pipeline
    _rag_pipeline = pipeline


def _get_pipeline():
    if _rag_pipeline is None:
        raise HTTPException(
            status_code=503,
            detail="RAG pipeline not initialized. Call POST /config first.",
        )
    return _rag_pipeline


class ChatRequest(BaseModel):
    question: str
    context: str = "all"  # "current" | "all"
    project_id: str | None = None
    model: str = "qwen2.5:7b"


class ContextRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    context: Literal["current", "all"] = "all"
    project_id: str | None = None


class ChatSourceItem(BaseModel):
    project_id: str
    project_title: str = ""
    source_type: str
    text: str
    metadata: dict = {}


class ContextResponse(BaseModel):
    question_type: str
    context_text: str
    sources: list[ChatSourceItem]


@router.post("/chat")
async def chat(req: ChatRequest):
    pipeline = _get_pipeline()

    async def event_generator():
        async for event in pipeline.answer(
            question=req.question,
            project_id=req.project_id,
            context_scope=req.context,
            model=req.model,
        ):
            event_type = event.get("type", "unknown")
            yield {
                "event": event_type,
                "data": json.dumps(event, ensure_ascii=False),
            }

    return EventSourceResponse(event_generator())


@router.post("/chat/context", response_model=ContextResponse)
async def chat_context(req: ContextRequest):
    """Retrieve context for a question without calling LLM."""
    pipeline = _get_pipeline()
    result = await pipeline.retrieve(
        question=req.question,
        project_id=req.project_id,
        context_scope=req.context,
    )
    return ContextResponse(**result)
