"""Knowledge indexing service - orchestrates embedding and storage."""

import json
import uuid

from .chunker import Chunk, chunk_text, chunk_segments
from .doc_parser import extract_text
from .embedder import Embedder
from .vector_store import VectorStore
from .sqlite_reader import SQLiteReader


class Indexer:
    """Orchestrates indexing of project data into the vector store."""

    def __init__(
        self, embedder: Embedder, vector_store: VectorStore, sqlite_reader: SQLiteReader
    ):
        self._embedder = embedder
        self._store = vector_store
        self._reader = sqlite_reader

    async def index_project(self, project_id: str) -> int:
        """Index all content for a project. Returns number of chunks indexed."""
        # Delete existing index for this project
        await self._store.delete_by_project(project_id)

        chunks: list[Chunk] = []

        # 1. Index segments
        segments = self._reader.get_segments(project_id)
        if segments:
            chunks.extend(chunk_segments(segments, project_id))

        # 2. Index summary
        summary = self._reader.get_summary(project_id)
        if summary and summary.get("raw_markdown"):
            for text in chunk_text(summary["raw_markdown"]):
                chunks.append(
                    Chunk(
                        text=text,
                        source_type="summary",
                        project_id=project_id,
                        metadata={"topic": summary.get("topic", "")},
                    )
                )

        # 3. Index note
        note = self._reader.get_note(project_id)
        if note:
            for text in chunk_text(note):
                chunks.append(
                    Chunk(
                        text=text,
                        source_type="note",
                        project_id=project_id,
                        metadata={},
                    )
                )

        # 4. Index attachments
        attachments = self._reader.get_attachments(project_id)
        for att in attachments:
            doc_text = await extract_text(att["file_path"])
            if doc_text:
                for text in chunk_text(doc_text):
                    chunks.append(
                        Chunk(
                            text=text,
                            source_type="attachment",
                            project_id=project_id,
                            metadata={"filename": att["filename"]},
                        )
                    )

        if not chunks:
            return 0

        # Embed all chunks
        texts = [c.text for c in chunks]
        vectors = await self._embedder.embed(texts)

        # Prepare for storage
        chunk_dicts = []
        for c in chunks:
            chunk_dicts.append(
                {
                    "id": str(uuid.uuid4()),
                    "text": c.text,
                    "source_type": c.source_type,
                    "project_id": c.project_id,
                    "metadata_json": json.dumps(c.metadata, ensure_ascii=False),
                }
            )

        await self._store.add_chunks(chunk_dicts, vectors)
        return len(chunks)

    async def index_all_projects(self) -> dict[str, int]:
        """Index all non-folder projects. Returns {project_id: chunk_count}."""
        projects = self._reader.get_all_projects()
        results = {}
        for proj in projects:
            count = await self.index_project(proj.id)
            results[proj.id] = count
        return results
