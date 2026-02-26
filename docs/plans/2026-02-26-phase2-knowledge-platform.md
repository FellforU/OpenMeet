# Phase 2: 知识平台 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 OpenMeet 中集成向量索引、知识检索和智能问答能力，将会议数据转化为可搜索的知识库。

**Architecture:** Python ASR 服务扩展三个模块：(1) Embedding + LanceDB 向量存储，(2) MCP Tools 实现结构化检索，(3) /chat RAG 问答端点。Python 通过只读模式访问 Rust 管理的 SQLite 数据库获取会议数据。前端新增悬浮问答按钮和聊天面板。

**Tech Stack:** sentence-transformers (BGE-small-zh-v1.5)、LanceDB、pymupdf、python-docx、SSE streaming、React + Zustand

**设计文档：** `docs/plans/2026-02-26-openmeet-v2-product-design.md` 第四章

---

## 前置知识

**关键文件清单：**

| 文件 | 作用 |
|------|------|
| `asr_service/main.py` | FastAPI 入口，注册所有路由 |
| `asr_service/config.py` | 服务配置（host、port、路径） |
| `asr_service/job_manager.py` | 任务管理器 |
| `asr_service/services/ollama_client.py` | Ollama LLM 客户端 |
| `asr_service/services/post_processing.py` | 转录后处理流水线 |
| `asr_service/routers/*.py` | 现有路由（health、jobs、engines、stream、search） |
| `src-tauri/src/database.rs` | Rust SQLite 模块（Phase 1 创建） |
| `src/services/asrClient.ts` | 前端 ASR API 客户端 |
| `src/services/llmClient.ts` | 前端 LLM 客户端 |
| `src/components/Workspace/index.tsx` | 工作区页签 |

**数据流架构：**
```
React Frontend
    │ POST /index/project/{id}  ← 触发索引
    │ POST /chat                ← 问答
    ▼
FastAPI (port 18090)
    ├── /asr/*              （现有 ASR 路由）
    ├── /index/*            （索引管理路由）
    ├── /mcp/tools          （MCP 工具列表）
    ├── /mcp/invoke         （MCP 工具调用）
    └── /chat               （RAG 问答端点，SSE 流式）
          │
          ├── SQLite (只读)  ← 读取会议数据
          ├── LanceDB        ← 向量检索
          ├── BGE Embedding  ← 文本向量化
          └── Ollama/Cloud   ← LLM 生成回答
```

**Python 访问 SQLite 策略：**
- Rust 端 SQLite 使用 WAL 模式，支持并发读取
- Python 使用 `sqlite3` 以 `?mode=ro` 只读模式打开同一数据库文件
- 数据库路径通过 `/config` 端点由前端在启动时传入

---

## Task 1: Python 依赖 + Embedding 模块

**Files:**
- Modify: `asr_service/requirements.txt`
- Create: `asr_service/knowledge/__init__.py`
- Create: `asr_service/knowledge/embedder.py`
- Create: `tests/asr_service/test_embedder.py`

### Step 1: 添加 Python 依赖

在 `asr_service/requirements.txt` 末尾添加：

```
# Knowledge platform (Phase 2)
sentence-transformers>=3.0,<4.0
lancedb>=0.17,<1.0
pymupdf>=1.24,<2.0
python-docx>=1.1,<2.0
sse-starlette>=2.0,<3.0
```

安装：
```bash
source .venv/bin/activate
pip install sentence-transformers lancedb pymupdf python-docx sse-starlette
```

### Step 2: 创建 knowledge 包

创建 `asr_service/knowledge/__init__.py`（空文件）。

### Step 3: 实现 Embedder

创建 `asr_service/knowledge/embedder.py`：

```python
"""Text embedding using BGE-small-zh-v1.5 model."""

import asyncio
from typing import Optional

import numpy as np


class Embedder:
    """Wrapper around sentence-transformers for text embedding."""

    MODEL_NAME = "BAAI/bge-small-zh-v1.5"
    DIMENSION = 512

    def __init__(self):
        self._model = None

    def is_loaded(self) -> bool:
        return self._model is not None

    async def load(self) -> None:
        """Load the embedding model. Downloads on first use."""
        if self._model is not None:
            return

        def _load():
            from sentence_transformers import SentenceTransformer
            return SentenceTransformer(self.MODEL_NAME)

        self._model = await asyncio.to_thread(_load)

    async def unload(self) -> None:
        self._model = None

    async def embed(self, texts: list[str]) -> np.ndarray:
        """Embed a list of texts. Returns (N, DIMENSION) array."""
        if self._model is None:
            await self.load()

        def _encode():
            return self._model.encode(texts, normalize_embeddings=True)

        return await asyncio.to_thread(_encode)

    async def embed_query(self, query: str) -> np.ndarray:
        """Embed a single query. Returns (DIMENSION,) array."""
        result = await self.embed([query])
        return result[0]
```

### Step 4: 编写 Embedder 测试

创建 `tests/asr_service/test_embedder.py`：

```python
"""Tests for the Embedder module."""

import pytest
import numpy as np
from unittest.mock import AsyncMock, MagicMock, patch

from asr_service.knowledge.embedder import Embedder


@pytest.fixture
def embedder():
    return Embedder()


def test_initial_state(embedder):
    assert not embedder.is_loaded()


@pytest.mark.asyncio
async def test_load_and_unload(embedder):
    with patch("asr_service.knowledge.embedder.asyncio.to_thread") as mock_thread:
        mock_model = MagicMock()
        mock_thread.return_value = mock_model

        await embedder.load()
        assert embedder.is_loaded()

        await embedder.unload()
        assert not embedder.is_loaded()


@pytest.mark.asyncio
async def test_embed_returns_correct_shape(embedder):
    mock_model = MagicMock()
    mock_model.encode.return_value = np.random.rand(3, 512).astype(np.float32)
    embedder._model = mock_model

    result = await embedder.embed(["hello", "world", "test"])
    assert result.shape == (3, 512)
    mock_model.encode.assert_called_once()


@pytest.mark.asyncio
async def test_embed_query_returns_1d(embedder):
    mock_model = MagicMock()
    mock_model.encode.return_value = np.random.rand(1, 512).astype(np.float32)
    embedder._model = mock_model

    result = await embedder.embed_query("test query")
    assert result.shape == (512,)


@pytest.mark.asyncio
async def test_embed_auto_loads(embedder):
    with patch("asr_service.knowledge.embedder.asyncio.to_thread") as mock_thread:
        mock_model = MagicMock()
        mock_model.encode.return_value = np.random.rand(1, 512).astype(np.float32)
        mock_thread.side_effect = [mock_model, mock_model.encode.return_value]

        result = await embedder.embed(["test"])
        assert embedder.is_loaded()
```

### Step 5: 运行测试

```bash
python -m pytest tests/asr_service/test_embedder.py -v
```

### Step 6: Commit

```bash
git add asr_service/requirements.txt asr_service/knowledge/ tests/asr_service/test_embedder.py
git commit -m "feat(knowledge): add BGE embedding module with sentence-transformers"
```

---

## Task 2: 文本分块 + LanceDB 向量存储

**Files:**
- Create: `asr_service/knowledge/chunker.py`
- Create: `asr_service/knowledge/vector_store.py`
- Create: `tests/asr_service/test_chunker.py`
- Create: `tests/asr_service/test_vector_store.py`

### Step 1: 实现文本分块器

创建 `asr_service/knowledge/chunker.py`：

```python
"""Text chunking utilities for knowledge indexing."""

from dataclasses import dataclass


@dataclass
class Chunk:
    """A text chunk with metadata."""
    text: str
    source_type: str      # "segment" | "summary" | "note" | "attachment"
    project_id: str
    metadata: dict         # speaker, timestamp, filename, etc.


def chunk_text(
    text: str,
    chunk_size: int = 500,
    overlap: int = 50,
) -> list[str]:
    """Split text into overlapping chunks by character count.

    Tries to split at sentence boundaries (。！？.!?) when possible.
    """
    if len(text) <= chunk_size:
        return [text] if text.strip() else []

    chunks = []
    start = 0
    sentence_endings = set("。！？.!?\n")

    while start < len(text):
        end = min(start + chunk_size, len(text))

        # Try to find a sentence boundary near the end
        if end < len(text):
            best_break = -1
            search_start = max(start + chunk_size - overlap, start)
            for i in range(end, search_start, -1):
                if text[i - 1] in sentence_endings:
                    best_break = i
                    break
            if best_break > start:
                end = best_break

        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)

        # Move forward with overlap
        start = end - overlap if end < len(text) else end

    return chunks


def chunk_segments(
    segments: list[dict],
    project_id: str,
    chunk_size: int = 500,
) -> list[Chunk]:
    """Chunk transcription segments, grouping consecutive segments."""
    if not segments:
        return []

    # Group segments into chunks by concatenating text
    chunks = []
    buffer_text = ""
    buffer_start = segments[0].get("start_time", 0)
    buffer_speaker = segments[0].get("speaker")

    for seg in segments:
        seg_text = seg.get("text", "").strip()
        if not seg_text:
            continue

        if len(buffer_text) + len(seg_text) > chunk_size and buffer_text:
            chunks.append(Chunk(
                text=buffer_text.strip(),
                source_type="segment",
                project_id=project_id,
                metadata={
                    "start_time": buffer_start,
                    "end_time": seg.get("end_time", 0),
                    "speaker": buffer_speaker,
                },
            ))
            buffer_text = seg_text + " "
            buffer_start = seg.get("start_time", 0)
            buffer_speaker = seg.get("speaker")
        else:
            buffer_text += seg_text + " "

    if buffer_text.strip():
        chunks.append(Chunk(
            text=buffer_text.strip(),
            source_type="segment",
            project_id=project_id,
            metadata={
                "start_time": buffer_start,
                "speaker": buffer_speaker,
            },
        ))

    return chunks
```

### Step 2: 实现 LanceDB 向量存储

创建 `asr_service/knowledge/vector_store.py`：

```python
"""LanceDB vector storage for knowledge base."""

import asyncio
from pathlib import Path
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
        if self.TABLE_NAME in db.table_names():
            return db.open_table(self.TABLE_NAME)

        schema = pa.schema([
            pa.field("id", pa.string()),
            pa.field("text", pa.string()),
            pa.field("source_type", pa.string()),
            pa.field("project_id", pa.string()),
            pa.field("metadata_json", pa.string()),
            pa.field("vector", pa.list_(pa.float32(), 512)),
        ])
        return db.create_table(self.TABLE_NAME, schema=schema)

    async def add_chunks(
        self,
        chunks: list[dict],
        vectors: np.ndarray,
    ) -> None:
        """Add chunks with their embeddings to the vector store.

        chunks: list of {"id", "text", "source_type", "project_id", "metadata_json"}
        vectors: (N, 512) numpy array
        """
        import json

        def _add():
            table = self._get_or_create_table()
            data = []
            for i, chunk in enumerate(chunks):
                data.append({
                    "id": chunk["id"],
                    "text": chunk["text"],
                    "source_type": chunk["source_type"],
                    "project_id": chunk["project_id"],
                    "metadata_json": chunk.get("metadata_json", "{}"),
                    "vector": vectors[i].tolist(),
                })
            if data:
                table.add(data)

        await asyncio.to_thread(_add)

    async def search(
        self,
        query_vector: np.ndarray,
        top_k: int = 5,
        project_ids: Optional[list[str]] = None,
    ) -> list[dict]:
        """Search for similar chunks.

        Returns list of {"id", "text", "source_type", "project_id", "metadata_json", "score"}.
        """
        def _search():
            table = self._get_or_create_table()
            query = table.search(query_vector.tolist()).limit(top_k)

            if project_ids:
                filter_expr = " OR ".join(
                    f"project_id = '{pid}'" for pid in project_ids
                )
                query = query.where(f"({filter_expr})")

            results = query.to_pandas()
            items = []
            for _, row in results.iterrows():
                items.append({
                    "id": row["id"],
                    "text": row["text"],
                    "source_type": row["source_type"],
                    "project_id": row["project_id"],
                    "metadata_json": row["metadata_json"],
                    "score": float(row.get("_distance", 0)),
                })
            return items

        return await asyncio.to_thread(_search)

    async def delete_by_project(self, project_id: str) -> None:
        """Delete all chunks for a project (before re-indexing)."""
        def _delete():
            db = self._ensure_db()
            if self.TABLE_NAME not in db.table_names():
                return
            table = db.open_table(self.TABLE_NAME)
            table.delete(f"project_id = '{project_id}'")

        await asyncio.to_thread(_delete)

    async def get_all_project_ids(self) -> list[str]:
        """Get distinct project IDs in the index."""
        def _get():
            db = self._ensure_db()
            if self.TABLE_NAME not in db.table_names():
                return []
            table = db.open_table(self.TABLE_NAME)
            df = table.to_pandas()
            return df["project_id"].unique().tolist()

        return await asyncio.to_thread(_get)
```

### Step 3: 编写分块器测试

创建 `tests/asr_service/test_chunker.py`：

```python
"""Tests for the text chunker."""

import pytest
from asr_service.knowledge.chunker import chunk_text, chunk_segments, Chunk


def test_short_text_no_split():
    result = chunk_text("Hello world", chunk_size=500)
    assert result == ["Hello world"]


def test_empty_text():
    assert chunk_text("") == []
    assert chunk_text("   ") == []


def test_long_text_splits():
    text = "A" * 1000
    result = chunk_text(text, chunk_size=500, overlap=50)
    assert len(result) >= 2
    for chunk in result:
        assert len(chunk) <= 500


def test_sentence_boundary_split():
    text = "第一句话。" * 50 + "第二句话。" * 50
    result = chunk_text(text, chunk_size=300, overlap=50)
    # Should prefer splitting at sentence boundaries
    for chunk in result:
        assert chunk.endswith("。") or chunk == result[-1]


def test_chunk_segments_empty():
    assert chunk_segments([], "proj1") == []


def test_chunk_segments_basic():
    segments = [
        {"text": "Hello", "start_time": 0, "end_time": 1, "speaker": "A"},
        {"text": "World", "start_time": 1, "end_time": 2, "speaker": "A"},
    ]
    result = chunk_segments(segments, "proj1", chunk_size=500)
    assert len(result) == 1
    assert result[0].text == "Hello World"
    assert result[0].source_type == "segment"
    assert result[0].project_id == "proj1"


def test_chunk_segments_overflow():
    segments = [
        {"text": "A" * 300, "start_time": 0, "end_time": 1},
        {"text": "B" * 300, "start_time": 1, "end_time": 2},
    ]
    result = chunk_segments(segments, "proj1", chunk_size=500)
    assert len(result) == 2
```

### Step 4: 编写向量存储测试

创建 `tests/asr_service/test_vector_store.py`：

```python
"""Tests for the LanceDB vector store."""

import pytest
import numpy as np
import tempfile
import os

from asr_service.knowledge.vector_store import VectorStore


@pytest.fixture
def store(tmp_path):
    return VectorStore(str(tmp_path / "test_lance"))


@pytest.mark.asyncio
async def test_add_and_search(store):
    chunks = [
        {"id": "c1", "text": "Hello world", "source_type": "segment", "project_id": "p1", "metadata_json": "{}"},
        {"id": "c2", "text": "Goodbye world", "source_type": "note", "project_id": "p1", "metadata_json": "{}"},
    ]
    vectors = np.random.rand(2, 512).astype(np.float32)

    await store.add_chunks(chunks, vectors)

    # Search with the first vector should return it as most similar
    results = await store.search(vectors[0], top_k=2)
    assert len(results) == 2
    assert results[0]["id"] == "c1"


@pytest.mark.asyncio
async def test_delete_by_project(store):
    chunks = [
        {"id": "c1", "text": "A", "source_type": "segment", "project_id": "p1", "metadata_json": "{}"},
        {"id": "c2", "text": "B", "source_type": "segment", "project_id": "p2", "metadata_json": "{}"},
    ]
    vectors = np.random.rand(2, 512).astype(np.float32)
    await store.add_chunks(chunks, vectors)

    await store.delete_by_project("p1")

    results = await store.search(vectors[0], top_k=10)
    project_ids = [r["project_id"] for r in results]
    assert "p1" not in project_ids


@pytest.mark.asyncio
async def test_filter_by_project_ids(store):
    chunks = [
        {"id": "c1", "text": "A", "source_type": "segment", "project_id": "p1", "metadata_json": "{}"},
        {"id": "c2", "text": "B", "source_type": "segment", "project_id": "p2", "metadata_json": "{}"},
    ]
    vectors = np.random.rand(2, 512).astype(np.float32)
    await store.add_chunks(chunks, vectors)

    results = await store.search(vectors[0], top_k=10, project_ids=["p1"])
    assert all(r["project_id"] == "p1" for r in results)


@pytest.mark.asyncio
async def test_get_all_project_ids(store):
    chunks = [
        {"id": "c1", "text": "A", "source_type": "segment", "project_id": "p1", "metadata_json": "{}"},
        {"id": "c2", "text": "B", "source_type": "segment", "project_id": "p2", "metadata_json": "{}"},
    ]
    vectors = np.random.rand(2, 512).astype(np.float32)
    await store.add_chunks(chunks, vectors)

    ids = await store.get_all_project_ids()
    assert set(ids) == {"p1", "p2"}
```

### Step 5: 运行测试

```bash
python -m pytest tests/asr_service/test_chunker.py tests/asr_service/test_vector_store.py -v
```

### Step 6: Commit

```bash
git commit -m "feat(knowledge): add text chunker and LanceDB vector store"
```

---

## Task 3: 文档解析（PDF/DOCX）

**Files:**
- Create: `asr_service/knowledge/doc_parser.py`
- Create: `tests/asr_service/test_doc_parser.py`

### Step 1: 实现文档解析器

创建 `asr_service/knowledge/doc_parser.py`：

```python
"""Document text extraction for attachments."""

import asyncio
from pathlib import Path


async def extract_text(file_path: str) -> str:
    """Extract text from a document file.

    Supports: PDF, DOCX, TXT, MD, CSV.
    Returns empty string for unsupported formats.
    """
    path = Path(file_path)
    if not path.exists():
        return ""

    ext = path.suffix.lower()

    if ext == ".pdf":
        return await _extract_pdf(file_path)
    elif ext == ".docx":
        return await _extract_docx(file_path)
    elif ext in (".txt", ".md", ".csv"):
        return await _extract_text_file(file_path)
    else:
        return ""


async def _extract_pdf(file_path: str) -> str:
    def _read():
        import pymupdf
        doc = pymupdf.open(file_path)
        texts = []
        for page in doc:
            texts.append(page.get_text())
        doc.close()
        return "\n".join(texts)

    return await asyncio.to_thread(_read)


async def _extract_docx(file_path: str) -> str:
    def _read():
        from docx import Document
        doc = Document(file_path)
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip())

    return await asyncio.to_thread(_read)


async def _extract_text_file(file_path: str) -> str:
    def _read():
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()

    return await asyncio.to_thread(_read)
```

### Step 2: 编写测试

创建 `tests/asr_service/test_doc_parser.py`：

```python
"""Tests for the document parser."""

import pytest
import tempfile
import os

from asr_service.knowledge.doc_parser import extract_text


@pytest.mark.asyncio
async def test_extract_text_file(tmp_path):
    f = tmp_path / "test.txt"
    f.write_text("Hello world\nLine 2", encoding="utf-8")
    result = await extract_text(str(f))
    assert "Hello world" in result
    assert "Line 2" in result


@pytest.mark.asyncio
async def test_extract_markdown(tmp_path):
    f = tmp_path / "test.md"
    f.write_text("# Title\n\nContent here", encoding="utf-8")
    result = await extract_text(str(f))
    assert "Title" in result


@pytest.mark.asyncio
async def test_extract_nonexistent():
    result = await extract_text("/nonexistent/file.txt")
    assert result == ""


@pytest.mark.asyncio
async def test_extract_unsupported(tmp_path):
    f = tmp_path / "test.xyz"
    f.write_bytes(b"binary data")
    result = await extract_text(str(f))
    assert result == ""
```

### Step 3: 运行测试 + Commit

```bash
python -m pytest tests/asr_service/test_doc_parser.py -v
git commit -m "feat(knowledge): add PDF/DOCX/TXT document text extraction"
```

---

## Task 4: 索引服务 + SQLite 读取器

**Files:**
- Create: `asr_service/knowledge/sqlite_reader.py`
- Create: `asr_service/knowledge/indexer.py`
- Modify: `asr_service/config.py` —— 添加知识库配置
- Create: `tests/asr_service/test_indexer.py`

### Step 1: 扩展 config.py

在 `asr_service/config.py` 末尾添加：

```python
# Knowledge platform config
LANCE_DB_DIR = "lance"       # relative to app_data_dir
EMBEDDING_MODEL = "BAAI/bge-small-zh-v1.5"
CHUNK_SIZE = 500
CHUNK_OVERLAP = 50
```

并新增可变配置：

```python
# Runtime config (set by frontend on startup)
_runtime_config = {
    "app_data_dir": None,     # Set via /config endpoint
    "sqlite_db_path": None,   # Derived: {app_data_dir}/openmeet.db
    "lance_db_path": None,    # Derived: {app_data_dir}/lance/
}

def set_app_data_dir(path: str):
    _runtime_config["app_data_dir"] = path
    _runtime_config["sqlite_db_path"] = f"{path}/openmeet.db"
    _runtime_config["lance_db_path"] = f"{path}/lance"

def get_sqlite_path() -> str | None:
    return _runtime_config["sqlite_db_path"]

def get_lance_path() -> str | None:
    return _runtime_config["lance_db_path"]
```

### Step 2: SQLite 只读读取器

创建 `asr_service/knowledge/sqlite_reader.py`：

```python
"""Read-only SQLite access to OpenMeet database."""

import json
import sqlite3
from dataclasses import dataclass


@dataclass
class ProjectInfo:
    id: str
    title: str
    is_folder: bool
    created_at: str


class SQLiteReader:
    """Read-only access to the Rust-managed SQLite database."""

    def __init__(self, db_path: str):
        self._db_path = db_path

    def _connect(self) -> sqlite3.Connection:
        # Open in read-only mode via URI
        uri = f"file:{self._db_path}?mode=ro"
        return sqlite3.connect(uri, uri=True)

    def get_project(self, project_id: str) -> ProjectInfo | None:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT id, title, is_folder, created_at FROM projects WHERE id = ?",
                (project_id,),
            ).fetchone()
            if not row:
                return None
            return ProjectInfo(id=row[0], title=row[1], is_folder=bool(row[2]), created_at=row[3])
        finally:
            conn.close()

    def get_all_projects(self) -> list[ProjectInfo]:
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT id, title, is_folder, created_at FROM projects WHERE is_folder = 0"
            ).fetchall()
            return [ProjectInfo(id=r[0], title=r[1], is_folder=bool(r[2]), created_at=r[3]) for r in rows]
        finally:
            conn.close()

    def get_segments(self, project_id: str) -> list[dict]:
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT id, start_time, end_time, text, speaker, confidence FROM segments WHERE project_id = ? ORDER BY idx",
                (project_id,),
            ).fetchall()
            return [
                {"id": r[0], "start_time": r[1], "end_time": r[2], "text": r[3], "speaker": r[4], "confidence": r[5]}
                for r in rows
            ]
        finally:
            conn.close()

    def get_summary(self, project_id: str) -> dict | None:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT topic, conclusions, action_items, discussion, raw_markdown FROM summaries WHERE project_id = ?",
                (project_id,),
            ).fetchone()
            if not row:
                return None
            return {
                "topic": row[0],
                "conclusions": json.loads(row[1]) if row[1] else [],
                "action_items": json.loads(row[2]) if row[2] else [],
                "discussion": json.loads(row[3]) if row[3] else [],
                "raw_markdown": row[4] or "",
            }
        finally:
            conn.close()

    def get_note(self, project_id: str) -> str | None:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT content FROM notes WHERE project_id = ?",
                (project_id,),
            ).fetchone()
            return row[0] if row else None
        finally:
            conn.close()

    def get_attachments(self, project_id: str) -> list[dict]:
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT id, filename, file_path, mime_type FROM attachments WHERE project_id = ?",
                (project_id,),
            ).fetchall()
            return [{"id": r[0], "filename": r[1], "file_path": r[2], "mime_type": r[3]} for r in rows]
        finally:
            conn.close()

    def get_all_action_items(self, project_ids: list[str] | None = None) -> list[dict]:
        """Get all action items across projects."""
        conn = self._connect()
        try:
            if project_ids:
                placeholders = ",".join("?" for _ in project_ids)
                rows = conn.execute(
                    f"SELECT project_id, action_items FROM summaries WHERE project_id IN ({placeholders})",
                    project_ids,
                ).fetchall()
            else:
                rows = conn.execute("SELECT project_id, action_items FROM summaries").fetchall()

            items = []
            for r in rows:
                project_id = r[0]
                action_items = json.loads(r[1]) if r[1] else []
                for item in action_items:
                    items.append({**item, "project_id": project_id})
            return items
        finally:
            conn.close()

    def get_meeting_stats(self, project_ids: list[str] | None = None) -> dict:
        """Get meeting statistics."""
        conn = self._connect()
        try:
            if project_ids:
                placeholders = ",".join("?" for _ in project_ids)
                where = f"WHERE id IN ({placeholders}) AND is_folder = 0"
                params = project_ids
            else:
                where = "WHERE is_folder = 0"
                params = []

            count = conn.execute(f"SELECT COUNT(*) FROM projects {where}", params).fetchone()[0]
            total_duration = conn.execute(
                f"SELECT COALESCE(SUM(duration_ms), 0) FROM projects {where}", params
            ).fetchone()[0]

            # Speaker distribution from segments
            if project_ids:
                seg_where = f"WHERE project_id IN ({placeholders})"
            else:
                seg_where = ""
            speakers = conn.execute(
                f"SELECT speaker, COUNT(*) FROM segments {seg_where} GROUP BY speaker",
                params,
            ).fetchall()

            return {
                "meeting_count": count,
                "total_duration_ms": total_duration,
                "speakers": {s[0] or "Unknown": s[1] for s in speakers},
            }
        finally:
            conn.close()
```

### Step 3: 实现索引服务

创建 `asr_service/knowledge/indexer.py`：

```python
"""Knowledge indexing service - orchestrates embedding and storage."""

import json
import uuid
from typing import Optional

from .chunker import Chunk, chunk_text, chunk_segments
from .doc_parser import extract_text
from .embedder import Embedder
from .vector_store import VectorStore
from .sqlite_reader import SQLiteReader


class Indexer:
    """Orchestrates indexing of project data into the vector store."""

    def __init__(self, embedder: Embedder, vector_store: VectorStore, sqlite_reader: SQLiteReader):
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
                chunks.append(Chunk(
                    text=text,
                    source_type="summary",
                    project_id=project_id,
                    metadata={"topic": summary.get("topic", "")},
                ))

        # 3. Index note
        note = self._reader.get_note(project_id)
        if note:
            for text in chunk_text(note):
                chunks.append(Chunk(
                    text=text,
                    source_type="note",
                    project_id=project_id,
                    metadata={},
                ))

        # 4. Index attachments
        attachments = self._reader.get_attachments(project_id)
        for att in attachments:
            doc_text = await extract_text(att["file_path"])
            if doc_text:
                for text in chunk_text(doc_text):
                    chunks.append(Chunk(
                        text=text,
                        source_type="attachment",
                        project_id=project_id,
                        metadata={"filename": att["filename"]},
                    ))

        if not chunks:
            return 0

        # Embed all chunks
        texts = [c.text for c in chunks]
        vectors = await self._embedder.embed(texts)

        # Prepare for storage
        chunk_dicts = []
        for c in chunks:
            chunk_dicts.append({
                "id": str(uuid.uuid4()),
                "text": c.text,
                "source_type": c.source_type,
                "project_id": c.project_id,
                "metadata_json": json.dumps(c.metadata, ensure_ascii=False),
            })

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
```

### Step 4: 编写索引服务测试

创建 `tests/asr_service/test_indexer.py`：

```python
"""Tests for the knowledge indexer."""

import pytest
import numpy as np
from unittest.mock import AsyncMock, MagicMock, patch

from asr_service.knowledge.indexer import Indexer
from asr_service.knowledge.embedder import Embedder
from asr_service.knowledge.vector_store import VectorStore
from asr_service.knowledge.sqlite_reader import SQLiteReader, ProjectInfo


@pytest.fixture
def mock_embedder():
    e = MagicMock(spec=Embedder)
    e.embed = AsyncMock(return_value=np.random.rand(5, 512).astype(np.float32))
    return e


@pytest.fixture
def mock_store():
    s = MagicMock(spec=VectorStore)
    s.add_chunks = AsyncMock()
    s.delete_by_project = AsyncMock()
    return s


@pytest.fixture
def mock_reader():
    r = MagicMock(spec=SQLiteReader)
    r.get_segments.return_value = [
        {"id": "s1", "start_time": 0, "end_time": 1, "text": "Hello world", "speaker": "A", "confidence": 0.9}
    ]
    r.get_summary.return_value = {"topic": "Test", "raw_markdown": "Summary text", "conclusions": [], "action_items": [], "discussion": []}
    r.get_note.return_value = "Some note"
    r.get_attachments.return_value = []
    r.get_all_projects.return_value = [ProjectInfo(id="p1", title="Test", is_folder=False, created_at="2026-01-01")]
    return r


@pytest.fixture
def indexer(mock_embedder, mock_store, mock_reader):
    return Indexer(mock_embedder, mock_store, mock_reader)


@pytest.mark.asyncio
async def test_index_project_basic(indexer, mock_store, mock_embedder):
    count = await indexer.index_project("p1")
    assert count > 0
    mock_store.delete_by_project.assert_called_once_with("p1")
    mock_store.add_chunks.assert_called_once()
    mock_embedder.embed.assert_called_once()


@pytest.mark.asyncio
async def test_index_project_empty(indexer, mock_reader, mock_store):
    mock_reader.get_segments.return_value = []
    mock_reader.get_summary.return_value = None
    mock_reader.get_note.return_value = None
    mock_reader.get_attachments.return_value = []

    count = await indexer.index_project("p1")
    assert count == 0
    mock_store.add_chunks.assert_not_called()


@pytest.mark.asyncio
async def test_index_all_projects(indexer):
    results = await indexer.index_all_projects()
    assert "p1" in results
    assert results["p1"] > 0
```

### Step 5: 运行测试 + Commit

```bash
python -m pytest tests/asr_service/test_indexer.py -v
git commit -m "feat(knowledge): add SQLite reader and indexing service"
```

---

## Task 5: 索引 + 配置 API 路由

**Files:**
- Create: `asr_service/routers/config.py`
- Create: `asr_service/routers/index.py`
- Modify: `asr_service/main.py` —— 注册新路由、初始化知识库模块
- Create: `tests/asr_service/test_config_router.py`
- Create: `tests/asr_service/test_index_router.py`

### Step 1: 配置路由

创建 `asr_service/routers/config.py`：

```python
"""Configuration endpoint for setting app data directory."""

from fastapi import APIRouter
from pydantic import BaseModel

from ..config import set_app_data_dir, get_lance_path, get_sqlite_path

router = APIRouter(tags=["config"])

_knowledge_initializer = None

def set_knowledge_initializer(fn):
    global _knowledge_initializer
    _knowledge_initializer = fn


class ConfigRequest(BaseModel):
    app_data_dir: str


class ConfigResponse(BaseModel):
    status: str
    sqlite_path: str | None
    lance_path: str | None


@router.post("/config", response_model=ConfigResponse)
async def set_config(req: ConfigRequest):
    set_app_data_dir(req.app_data_dir)

    # Initialize knowledge modules if not already
    if _knowledge_initializer:
        await _knowledge_initializer()

    return ConfigResponse(
        status="ok",
        sqlite_path=get_sqlite_path(),
        lance_path=get_lance_path(),
    )
```

### Step 2: 索引路由

创建 `asr_service/routers/index.py`：

```python
"""Knowledge indexing endpoints."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/index", tags=["knowledge"])

# Set by main.py during initialization
_indexer = None

def set_indexer(indexer):
    global _indexer
    _indexer = indexer


def _get_indexer():
    if _indexer is None:
        raise HTTPException(status_code=503, detail="Knowledge indexer not initialized. Call POST /config first.")
    return _indexer


class IndexResponse(BaseModel):
    project_id: str
    chunks_indexed: int


class IndexAllResponse(BaseModel):
    projects: dict[str, int]
    total_chunks: int


@router.post("/project/{project_id}", response_model=IndexResponse)
async def index_project(project_id: str):
    indexer = _get_indexer()
    count = await indexer.index_project(project_id)
    return IndexResponse(project_id=project_id, chunks_indexed=count)


@router.post("/all", response_model=IndexAllResponse)
async def index_all():
    indexer = _get_indexer()
    results = await indexer.index_all_projects()
    return IndexAllResponse(projects=results, total_chunks=sum(results.values()))
```

### Step 3: 更新 main.py 注册路由和知识库初始化

在 `asr_service/main.py` 中：

1. 导入新路由：
```python
from .routers import config as config_router
from .routers import index as index_router
```

2. 注册路由：
```python
app.include_router(config_router.router)
app.include_router(index_router.router)
```

3. 添加知识库延迟初始化逻辑：
```python
from .knowledge.embedder import Embedder
from .knowledge.vector_store import VectorStore
from .knowledge.sqlite_reader import SQLiteReader
from .knowledge.indexer import Indexer
from .config import get_lance_path, get_sqlite_path

_embedder = Embedder()
_knowledge_initialized = False

async def init_knowledge():
    global _knowledge_initialized
    if _knowledge_initialized:
        return
    lance_path = get_lance_path()
    sqlite_path = get_sqlite_path()
    if not lance_path or not sqlite_path:
        return
    store = VectorStore(lance_path)
    reader = SQLiteReader(sqlite_path)
    indexer = Indexer(_embedder, store, reader)
    index_router.set_indexer(indexer)
    _knowledge_initialized = True

config_router.set_knowledge_initializer(init_knowledge)
```

### Step 4: 编写路由测试

创建 `tests/asr_service/test_config_router.py` 和 `tests/asr_service/test_index_router.py`：

测试 /config 端点设置 app_data_dir，测试 /index/project/{id} 和 /index/all 端点（mock indexer）。

### Step 5: 运行测试 + Commit

```bash
python -m pytest tests/asr_service/test_config_router.py tests/asr_service/test_index_router.py -v
git commit -m "feat(knowledge): add config and indexing API endpoints"
```

---

## Task 6: MCP Tools 实现

**Files:**
- Create: `asr_service/knowledge/mcp_tools.py`
- Create: `asr_service/routers/mcp.py`
- Create: `tests/asr_service/test_mcp_tools.py`

### Step 1: 实现 MCP Tools

创建 `asr_service/knowledge/mcp_tools.py`：

实现 4 个工具函数：
1. `search_knowledge_base(query, project_ids, top_k)` —— 向量检索
2. `get_meeting_stats(project_ids)` —— 会议统计
3. `get_action_items(project_ids, include_done)` —— 行动项汇总
4. `get_speaker_analysis(project_ids)` —— 发言人分析

每个工具接收 embedder、vector_store、sqlite_reader 实例作为参数。

### Step 2: MCP 路由

创建 `asr_service/routers/mcp.py`：

```
GET  /mcp/tools          → 返回所有工具的 JSON Schema 定义
POST /mcp/invoke          → 调用指定工具（name + arguments）
```

### Step 3: 测试 + Commit

```bash
git commit -m "feat(knowledge): add MCP tools for search, stats, actions, speakers"
```

---

## Task 7: /chat RAG 问答端点

**Files:**
- Create: `asr_service/routers/chat.py`
- Create: `asr_service/knowledge/rag.py`
- Create: `tests/asr_service/test_chat.py`

### Step 1: RAG Pipeline

创建 `asr_service/knowledge/rag.py`：

```python
# RAG 流程：
# 1. 用户问题 → 判断类型（统计类 vs 语义检索类）
# 2. 调用对应 MCP Tool 获取上下文
# 3. 构造 prompt = 系统提示 + 检索结果 + 用户问题
# 4. 调用 LLM（Ollama 或云端），支持流式输出
# 5. 返回回答 + 引用来源
```

### Step 2: Chat 路由（SSE 流式）

创建 `asr_service/routers/chat.py`：

```python
# POST /chat
# Request: { question: str, context: "current_project" | "all", project_id?: str }
# Response: SSE stream
#   event: token   data: {"text": "..."}
#   event: sources data: {"sources": [...]}
#   event: done    data: {}
```

使用 `sse-starlette` 的 `EventSourceResponse` 实现流式输出。

### Step 3: 测试 + Commit

```bash
git commit -m "feat(knowledge): add RAG pipeline and /chat SSE endpoint"
```

---

## Task 8: 前端 Chat Store + API Client

**Files:**
- Create: `src/services/chatClient.ts`
- Create: `src/stores/chatStore.ts`

### Step 1: Chat API 客户端

创建 `src/services/chatClient.ts`：

```typescript
// SSE 流式对话客户端
// sendMessage(question, context, projectId) → AsyncGenerator<ChatEvent>
// ChatEvent: { type: "token", text } | { type: "sources", sources } | { type: "done" }
```

使用 `fetch` + `ReadableStream` 实现 SSE 解析。

### Step 2: Chat Store

创建 `src/stores/chatStore.ts`：

```typescript
// Zustand store
// messages: ChatMessage[]
// isLoading: boolean
// context: "current" | "all"
// sendMessage(question) → 流式追加到 messages
// clearMessages()
// setContext(ctx)
```

### Step 3: tsc 验证 + Commit

```bash
npx tsc --noEmit
git commit -m "feat(chat): add chat API client and Zustand store"
```

---

## Task 9: 前端悬浮问答 UI

**Files:**
- Create: `src/components/Chat/ChatButton.tsx`
- Create: `src/components/Chat/ChatPanel.tsx`
- Create: `src/components/Chat/ChatMessage.tsx`
- Modify: `src/App.tsx` —— 添加 ChatButton
- Modify: `src/i18n/locales/zh/workspace.json` —— 添加聊天翻译
- Modify: `src/i18n/locales/en/workspace.json` —— 添加聊天翻译

### Step 1: ChatButton（悬浮按钮）

- 固定在右下角，圆形按钮，AI 图标（Sparkles from lucide）
- 点击展开/收起 ChatPanel
- 未读消息计数徽章

### Step 2: ChatPanel（聊天面板）

- 400x500px 浮动面板，支持拖拽移动
- 顶部：标题 + 上下文切换（当前会议 / 全部知识库）+ 关闭按钮
- 中间：消息列表（滚动）
- 底部：输入框 + 发送按钮

### Step 3: ChatMessage（消息组件）

- 用户消息 / AI 消息 不同样式
- AI 消息支持 Markdown 渲染
- 来源引用链接可点击（跳转到对应会议/转录位置）
- 加载状态动画

### Step 4: i18n 翻译 + Commit

```bash
git commit -m "feat(chat): add floating chat button and panel UI"
```

---

## Task 10: 前端触发索引 + 配置推送

**Files:**
- Create: `src/services/knowledgeClient.ts`
- Modify: `src/App.tsx` —— 启动时推送 app_data_dir
- Modify: `src/stores/transcriptionStore.ts` —— 转录完成后触发索引
- Modify: `src/components/Workspace/NotesPanel.tsx` —— 笔记保存后触发索引
- Modify: `src/components/Workspace/AttachmentsPanel.tsx` —— 附件上传后触发索引

### Step 1: Knowledge API 客户端

创建 `src/services/knowledgeClient.ts`：

```typescript
// configureKnowledge(appDataDir) → POST /config
// indexProject(projectId) → POST /index/project/{id}
// indexAll() → POST /index/all
```

### Step 2: App.tsx 启动推送 app_data_dir

在 ASR 服务就绪后，调用 `configureKnowledge(appDataDir)` 将数据库路径推送给 Python 服务。
使用 `await invoke("get_app_data_dir")` 获取路径（需在 Rust 端添加简单 IPC 命令）。

### Step 3: 触发索引

- `transcriptionStore`: `persistSegments` 后调用 `indexProject(projectId)`
- `NotesPanel`: 笔记保存后调用 `indexProject(projectId)`（debounce）
- `AttachmentsPanel`: 附件上传后调用 `indexProject(projectId)`

### Step 4: Rust 端添加 get_app_data_dir 命令

在 `src-tauri/src/database.rs` 添加：

```rust
#[tauri::command]
pub fn get_app_data_dir(app: AppHandle) -> Result<String, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}
```

在 `lib.rs` 的 `invoke_handler` 中注册。

### Step 5: cargo check + tsc + Commit

```bash
cd src-tauri && cargo check
npx tsc --noEmit
git commit -m "feat(knowledge): trigger indexing from frontend on data changes"
```

---

## Task 11: 集成测试与性能优化

**Files:**
- 各模块测试文件

### Step 1: Python 全量测试

```bash
python -m pytest tests/ -v --cov=asr_service
```

### Step 2: 前端编译验证

```bash
npx tsc --noEmit
cd src-tauri && cargo check
```

### Step 3: 手动测试清单

- [ ] 启动应用，POST /config 成功设置数据库路径
- [ ] 录制转录后，/index/project/{id} 自动触发
- [ ] POST /chat 能基于转录内容回答问题
- [ ] 统计问题（"本月开了几次会"）返回准确数字
- [ ] 回答包含来源引用，可点击跳转
- [ ] 悬浮按钮点击展开/收起聊天面板
- [ ] 「当前会议」模式只检索当前项目
- [ ] 「全部知识库」模式检索所有项目
- [ ] BGE 模型首次使用时自动下载
- [ ] 附件（PDF/DOCX）内容被正确索引

### Step 4: Final Commit

```bash
git commit -m "feat: complete Phase 2 knowledge platform with RAG chat"
```

---

## 文件变更总览

| 操作 | 文件 | 说明 |
|------|------|------|
| **创建** | `asr_service/knowledge/__init__.py` | 知识库包 |
| **创建** | `asr_service/knowledge/embedder.py` | BGE Embedding |
| **创建** | `asr_service/knowledge/chunker.py` | 文本分块 |
| **创建** | `asr_service/knowledge/vector_store.py` | LanceDB 向量存储 |
| **创建** | `asr_service/knowledge/doc_parser.py` | PDF/DOCX 解析 |
| **创建** | `asr_service/knowledge/sqlite_reader.py` | SQLite 只读读取器 |
| **创建** | `asr_service/knowledge/indexer.py` | 索引编排服务 |
| **创建** | `asr_service/knowledge/mcp_tools.py` | MCP Tools |
| **创建** | `asr_service/knowledge/rag.py` | RAG Pipeline |
| **创建** | `asr_service/routers/config.py` | 配置路由 |
| **创建** | `asr_service/routers/index.py` | 索引路由 |
| **创建** | `asr_service/routers/mcp.py` | MCP 路由 |
| **创建** | `asr_service/routers/chat.py` | Chat SSE 路由 |
| **创建** | `src/services/chatClient.ts` | 聊天 API 客户端 |
| **创建** | `src/services/knowledgeClient.ts` | 索引 API 客户端 |
| **创建** | `src/stores/chatStore.ts` | 聊天状态管理 |
| **创建** | `src/components/Chat/ChatButton.tsx` | 悬浮按钮 |
| **创建** | `src/components/Chat/ChatPanel.tsx` | 聊天面板 |
| **创建** | `src/components/Chat/ChatMessage.tsx` | 消息组件 |
| **修改** | `asr_service/requirements.txt` | 新增依赖 |
| **修改** | `asr_service/config.py` | 知识库配置 |
| **修改** | `asr_service/main.py` | 注册新路由 |
| **修改** | `src-tauri/src/database.rs` | get_app_data_dir |
| **修改** | `src-tauri/src/lib.rs` | 注册新命令 |
| **修改** | `src/App.tsx` | 推送 config + ChatButton |
| **修改** | `src/stores/transcriptionStore.ts` | 触发索引 |
| **修改** | `src/components/Workspace/NotesPanel.tsx` | 触发索引 |
| **修改** | `src/components/Workspace/AttachmentsPanel.tsx` | 触发索引 |
| **修改** | `src/i18n/locales/{zh,en}/workspace.json` | 聊天翻译 |

---

## 依赖变更

**Python (requirements.txt):**
```
sentence-transformers>=3.0,<4.0
lancedb>=0.17,<1.0
pymupdf>=1.24,<2.0
python-docx>=1.1,<2.0
sse-starlette>=2.0,<3.0
```

**前端 (package.json):**
无新增依赖（使用现有 shadcn/ui + lucide-react）。
