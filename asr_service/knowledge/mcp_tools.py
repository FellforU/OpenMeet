"""MCP Tools for knowledge base operations."""

import json
from typing import Optional

from .embedder import Embedder
from .vector_store import VectorStore
from .sqlite_reader import SQLiteReader


TOOL_DEFINITIONS = [
    {
        "name": "search_knowledge_base",
        "description": "Search the knowledge base using semantic similarity. Returns relevant text chunks from transcripts, summaries, notes, and attachments.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "project_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional list of project IDs to search within",
                },
                "top_k": {
                    "type": "integer",
                    "default": 5,
                    "description": "Number of results to return",
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_meeting_stats",
        "description": "Get meeting statistics including count, total duration, and speaker distribution.",
        "parameters": {
            "type": "object",
            "properties": {
                "project_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional list of project IDs to filter",
                },
            },
        },
    },
    {
        "name": "get_action_items",
        "description": "Get all action items from meeting summaries.",
        "parameters": {
            "type": "object",
            "properties": {
                "project_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional list of project IDs to filter",
                },
                "include_done": {
                    "type": "boolean",
                    "default": False,
                    "description": "Whether to include completed items",
                },
            },
        },
    },
    {
        "name": "get_speaker_analysis",
        "description": "Get speaker analysis with speaking duration and segment counts.",
        "parameters": {
            "type": "object",
            "properties": {
                "project_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional list of project IDs to filter",
                },
            },
        },
    },
]


class MCPTools:
    """MCP tool implementations for knowledge base operations."""

    def __init__(
        self,
        embedder: Embedder,
        vector_store: VectorStore,
        sqlite_reader: SQLiteReader,
    ):
        self._embedder = embedder
        self._store = vector_store
        self._reader = sqlite_reader

    async def invoke(self, name: str, arguments: dict) -> dict:
        """Invoke a tool by name with arguments."""
        handlers = {
            "search_knowledge_base": self._search_knowledge_base,
            "get_meeting_stats": self._get_meeting_stats,
            "get_action_items": self._get_action_items,
            "get_speaker_analysis": self._get_speaker_analysis,
        }
        handler = handlers.get(name)
        if not handler:
            return {"error": f"Unknown tool: {name}"}
        return await handler(arguments)

    async def _search_knowledge_base(self, args: dict) -> dict:
        query = args.get("query", "")
        project_ids = args.get("project_ids")
        top_k = args.get("top_k", 5)

        if not query:
            return {"error": "query is required"}

        query_vector = await self._embedder.embed_query(query)
        results = await self._store.search(query_vector, top_k=top_k, project_ids=project_ids)

        # Enrich with project titles
        enriched = []
        for r in results:
            project = self._reader.get_project(r["project_id"])
            metadata = json.loads(r["metadata_json"]) if r["metadata_json"] else {}
            enriched.append(
                {
                    "text": r["text"],
                    "source_type": r["source_type"],
                    "project_id": r["project_id"],
                    "project_title": project.title if project else "Unknown",
                    "score": r["score"],
                    "metadata": metadata,
                }
            )

        return {"results": enriched}

    async def _get_meeting_stats(self, args: dict) -> dict:
        project_ids = args.get("project_ids")
        stats = self._reader.get_meeting_stats(project_ids)
        return stats

    async def _get_action_items(self, args: dict) -> dict:
        project_ids = args.get("project_ids")
        include_done = args.get("include_done", False)

        items = self._reader.get_all_action_items(project_ids)

        if not include_done:
            items = [i for i in items if not i.get("done")]

        return {"action_items": items}

    async def _get_speaker_analysis(self, args: dict) -> dict:
        project_ids = args.get("project_ids")
        speakers = self._reader.get_speaker_segments(project_ids)
        return {"speakers": speakers}
