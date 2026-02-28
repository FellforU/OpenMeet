"""Configuration endpoint for setting app data directory and embedding backend."""

from fastapi import APIRouter
from pydantic import BaseModel

from ..config import set_app_data_dir, set_model_cache_dir, get_lance_path, get_sqlite_path

router = APIRouter(tags=["config"])

_knowledge_initializer = None
_embedder_ref = None


def set_knowledge_initializer(fn):
    global _knowledge_initializer
    _knowledge_initializer = fn


def set_embedder(embedder):
    global _embedder_ref
    _embedder_ref = embedder


class EmbeddingConfig(BaseModel):
    provider: str = "local"
    model: str = ""
    api_key: str | None = None
    api_url: str | None = None


class ConfigRequest(BaseModel):
    app_data_dir: str
    embedding_config: EmbeddingConfig | None = None
    model_cache_dir: str | None = None


class ConfigResponse(BaseModel):
    status: str
    sqlite_path: str | None
    lance_path: str | None


@router.post("/config", response_model=ConfigResponse)
async def set_config(req: ConfigRequest):
    set_app_data_dir(req.app_data_dir)

    # Apply model cache directory (empty string resets to default)
    set_model_cache_dir(req.model_cache_dir or None)

    # Apply embedding configuration if provided
    if req.embedding_config and _embedder_ref:
        ec = req.embedding_config
        _embedder_ref.configure(
            provider=ec.provider,
            model_name=ec.model,
            api_key=ec.api_key,
            api_url=ec.api_url,
        )

    # Initialize knowledge modules if not already
    if _knowledge_initializer:
        await _knowledge_initializer()

    return ConfigResponse(
        status="ok",
        sqlite_path=get_sqlite_path(),
        lance_path=get_lance_path(),
    )
