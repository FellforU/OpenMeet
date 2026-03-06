"""Configuration endpoint for setting app data directory and embedding backend."""

from fastapi import APIRouter
from pydantic import BaseModel

from ..config import set_app_data_dir, set_cache_dir, set_hf_mirror, get_lance_path, get_sqlite_path

router = APIRouter(tags=["config"])

_knowledge_initializer = None
_embedder_ref = None
_reranker_ref = None
_llm_client_ref = None


def set_knowledge_initializer(fn):
    global _knowledge_initializer
    _knowledge_initializer = fn


def set_embedder(embedder):
    global _embedder_ref
    _embedder_ref = embedder


def set_reranker(reranker):
    global _reranker_ref
    _reranker_ref = reranker


def set_llm_client(client):
    global _llm_client_ref
    _llm_client_ref = client


class EmbeddingConfig(BaseModel):
    provider: str = "local"
    model: str = ""
    api_key: str | None = None
    api_url: str | None = None


class HfMirrorRequest(BaseModel):
    url: str = ""


class LLMConfig(BaseModel):
    provider: str = ""
    model: str = ""
    api_key: str | None = None
    api_url: str | None = None
    host: str | None = None  # Ollama host


class ConfigRequest(BaseModel):
    app_data_dir: str
    embedding_config: EmbeddingConfig | None = None
    rerank_config: EmbeddingConfig | None = None
    llm_config: LLMConfig | None = None
    cache_dir: str | None = None
    hf_mirror: str | None = None


class ConfigResponse(BaseModel):
    status: str
    sqlite_path: str | None
    lance_path: str | None


@router.post("/config", response_model=ConfigResponse)
async def set_config(req: ConfigRequest):
    set_app_data_dir(req.app_data_dir)

    # Apply cache directory (empty string resets to default)
    set_cache_dir(req.cache_dir or None)

    # Apply HuggingFace mirror
    if req.hf_mirror is not None:
        set_hf_mirror(req.hf_mirror or None)

    # Apply embedding configuration if provided
    if req.embedding_config and _embedder_ref:
        ec = req.embedding_config
        _embedder_ref.configure(
            provider=ec.provider,
            model_name=ec.model,
            api_key=ec.api_key,
            api_url=ec.api_url,
        )

    # Apply rerank configuration if provided
    if req.rerank_config and _reranker_ref:
        rc = req.rerank_config
        _reranker_ref.configure(
            provider=rc.provider,
            model_name=rc.model,
            api_key=rc.api_key,
            api_url=rc.api_url,
        )

    # Apply LLM configuration if provided
    if req.llm_config and _llm_client_ref:
        lc = req.llm_config
        _llm_client_ref.configure(
            provider=lc.provider,
            model=lc.model,
            api_key=lc.api_key,
            api_url=lc.api_url,
            host=lc.host,
        )

    # Initialize knowledge modules if not already
    if _knowledge_initializer:
        await _knowledge_initializer()

    return ConfigResponse(
        status="ok",
        sqlite_path=get_sqlite_path(),
        lance_path=get_lance_path(),
    )


@router.post("/config/hf-mirror")
async def set_hf_mirror_endpoint(req: HfMirrorRequest):
    """Set HuggingFace mirror URL at runtime."""
    set_hf_mirror(req.url or None)
    return {"status": "ok", "hf_mirror": req.url or None}
