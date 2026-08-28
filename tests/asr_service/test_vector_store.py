"""Tests for the LanceDB vector store."""

import pytest
import numpy as np

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
