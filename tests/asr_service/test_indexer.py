"""Tests for the knowledge indexer."""

import pytest
import numpy as np
from unittest.mock import AsyncMock, MagicMock

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
    r.get_summary.return_value = {
        "topic": "Test",
        "raw_markdown": "Summary text",
        "conclusions": [],
        "action_items": [],
        "discussion": [],
    }
    r.get_note.return_value = "Some note"
    r.get_attachments.return_value = []
    r.get_all_projects.return_value = [
        ProjectInfo(id="p1", title="Test", is_folder=False, created_at="2026-01-01")
    ]
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
