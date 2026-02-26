"""LanceDB vector storage for knowledge base."""

import asyncio
from typing import Optional

import numpy as np
import pyarrow as pa


class VectorStore:
    """LanceDB-backed vector store for knowledge retrieval."""

    TABLE_NAME = "knowledge"

    def __init__(self, db_path: str):
        self._db_path = db_path
        self._db = None

    def _ensure_db(self):
        if self._db is None:
            import lancedb

            self._db = lancedb.connect(self._db_path)
        return self._db

    def _get_or_create_table(self):
        db = self._ensure_db()
        try:
            return db.open_table(self.TABLE_NAME)
        except Exception:
            schema = pa.schema(
                [
                    pa.field("id", pa.string()),
                    pa.field("text", pa.string()),
                    pa.field("source_type", pa.string()),
                    pa.field("project_id", pa.string()),
                    pa.field("metadata_json", pa.string()),
                    pa.field("vector", pa.list_(pa.float32(), 512)),
                ]
            )
            return db.create_table(self.TABLE_NAME, schema=schema)

    def _table_exists(self) -> bool:
        db = self._ensure_db()
        try:
            db.open_table(self.TABLE_NAME)
            return True
        except Exception:
            return False

    async def add_chunks(
        self,
        chunks: list[dict],
        vectors: np.ndarray,
    ) -> None:
        """Add chunks with their embeddings to the vector store."""

        def _add():
            table = self._get_or_create_table()
            data = []
            for i, chunk in enumerate(chunks):
                data.append(
                    {
                        "id": chunk["id"],
                        "text": chunk["text"],
                        "source_type": chunk["source_type"],
                        "project_id": chunk["project_id"],
                        "metadata_json": chunk.get("metadata_json", "{}"),
                        "vector": vectors[i].tolist(),
                    }
                )
            if data:
                table.add(data)

        await asyncio.to_thread(_add)

    async def search(
        self,
        query_vector: np.ndarray,
        top_k: int = 5,
        project_ids: Optional[list[str]] = None,
    ) -> list[dict]:
        """Search for similar chunks."""

        def _search():
            if not self._table_exists():
                return []
            table = self._ensure_db().open_table(self.TABLE_NAME)
            query = table.search(query_vector.tolist()).limit(top_k)

            if project_ids:
                filter_expr = " OR ".join(
                    f"project_id = '{pid}'" for pid in project_ids
                )
                query = query.where(f"({filter_expr})")

            results = query.to_arrow()
            items = []
            result_dict = results.to_pydict()
            n_rows = len(result_dict.get("id", []))
            for i in range(n_rows):
                items.append(
                    {
                        "id": result_dict["id"][i],
                        "text": result_dict["text"][i],
                        "source_type": result_dict["source_type"][i],
                        "project_id": result_dict["project_id"][i],
                        "metadata_json": result_dict["metadata_json"][i],
                        "score": float(result_dict.get("_distance", [0] * n_rows)[i]),
                    }
                )
            return items

        return await asyncio.to_thread(_search)

    async def delete_by_project(self, project_id: str) -> None:
        """Delete all chunks for a project (before re-indexing)."""

        def _delete():
            if not self._table_exists():
                return
            table = self._ensure_db().open_table(self.TABLE_NAME)
            table.delete(f"project_id = '{project_id}'")

        await asyncio.to_thread(_delete)

    async def get_all_project_ids(self) -> list[str]:
        """Get distinct project IDs in the index."""

        def _get():
            if not self._table_exists():
                return []
            table = self._ensure_db().open_table(self.TABLE_NAME)
            arrow_table = table.to_arrow()
            col = arrow_table.column("project_id")
            return list(set(col.to_pylist()))

        return await asyncio.to_thread(_get)
