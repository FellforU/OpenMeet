"""Chat endpoint with SSE streaming for RAG-based Q&A."""

import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
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
