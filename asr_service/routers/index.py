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
        raise HTTPException(
            status_code=503,
            detail="Knowledge indexer not initialized. Call POST /config first.",
        )
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
