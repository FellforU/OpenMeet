"""Local embedding model download and management endpoints.

Handles Qwen3-Embedding model series download, status checking,
and cache management via HuggingFace Hub.
"""

import asyncio
import logging
import os
import time
from enum import Enum
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from asr_service import config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/embedding", tags=["embedding"])

# Available local embedding models
EMBEDDING_MODELS: dict[str, dict] = {
    "bge-small-zh": {
        "repo_id": "BAAI/bge-small-zh-v1.5",
        "name": "BGE-small-zh",
        "params": "33M",
        "dimension": 512,
        "size_bytes": 90 * 1024 * 1024,
        "vram_gb": 0.3,
        "description_zh": "轻量中文嵌入，推理速度快",
        "description_en": "Lightweight Chinese embedding, fast inference",
        "languages": ["zh", "en"],
    },
    "bge-m3": {
        "repo_id": "BAAI/bge-m3",
        "name": "BGE-M3",
        "params": "568M",
        "dimension": 1024,
        "size_bytes": 2200 * 1024 * 1024,
        "vram_gb": 2,
        "description_zh": "多语言多粒度，生产级首选",
        "description_en": "Multi-lingual, multi-granularity, production-grade",
        "languages": ["zh", "en", "ja", "ko"],
    },
    "qwen3-embedding-0.6b": {
        "repo_id": "Qwen/Qwen3-Embedding-0.6B",
        "name": "Qwen3-Embedding-0.6B",
        "params": "0.6B",
        "dimension": 1024,
        "size_bytes": 1200 * 1024 * 1024,
        "vram_gb": 1.5,
        "description_zh": "性价比最佳，C-MTEB 超越 BGE-M3 近 10%",
        "description_en": "Best cost-performance, surpasses BGE-M3 on C-MTEB by ~10%",
        "languages": ["zh", "en", "multi"],
    },
    "qwen3-embedding-4b": {
        "repo_id": "Qwen/Qwen3-Embedding-4B",
        "name": "Qwen3-Embedding-4B",
        "params": "4B",
        "dimension": 2560,
        "size_bytes": 8000 * 1024 * 1024,
        "vram_gb": 10,
        "description_zh": "效果与资源均衡，12GB 显卡可全精度运行",
        "description_en": "Balanced performance and resources, runs on 12GB GPU",
        "languages": ["zh", "en", "multi"],
    },
    "qwen3-embedding-8b": {
        "repo_id": "Qwen/Qwen3-Embedding-8B",
        "name": "Qwen3-Embedding-8B",
        "params": "8B",
        "dimension": 4096,
        "size_bytes": 15100 * 1024 * 1024,
        "vram_gb": 18,
        "description_zh": "MTEB 多语言排行榜第一，最高精度",
        "description_en": "MTEB multilingual #1, highest accuracy",
        "languages": ["zh", "en", "multi"],
    },
}


class DownloadPhase(str, Enum):
    IDLE = "idle"
    DOWNLOADING = "downloading"
    COMPLETED = "completed"
    ERROR = "error"


class EmbeddingModelInfo(BaseModel):
    key: str
    repo_id: str
    name: str
    params: str
    dimension: int
    size_bytes: int
    vram_gb: float
    description_zh: str
    description_en: str
    languages: list[str]
    downloaded: bool
    path: str | None = None


class EmbeddingDownloadStatus(BaseModel):
    key: str
    phase: DownloadPhase
    elapsed_seconds: float = 0
    downloaded_bytes: int = 0
    total_bytes: int = 0
    error: str | None = None


# Background download state per model key
_download_states: dict[str, dict] = {}
_download_tasks: dict[str, asyncio.Task] = {}


def _validate_key(key: str) -> dict:
    """Validate model key and return spec, or raise 404."""
    if key not in EMBEDDING_MODELS:
        raise HTTPException(status_code=404, detail=f"Unknown model: {key}")
    return EMBEDDING_MODELS[key]


def _get_model_cache_dir() -> Path:
    cache_dir = config.get_model_cache_dir()
    if cache_dir:
        return Path(cache_dir)
    return Path.home() / ".cache" / "huggingface" / "hub"


def _is_model_downloaded(repo_id: str) -> bool:
    cache_dir = _get_model_cache_dir()
    dir_name = "models--" + repo_id.replace("/", "--")
    model_dir = cache_dir / dir_name
    if not model_dir.exists():
        return False
    snapshots = model_dir / "snapshots"
    return snapshots.exists() and any(snapshots.iterdir())


def _get_model_path(repo_id: str) -> str | None:
    cache_dir = _get_model_cache_dir()
    dir_name = "models--" + repo_id.replace("/", "--")
    model_dir = cache_dir / dir_name
    if model_dir.exists():
        return str(model_dir)
    return None


def _get_model_downloaded_bytes(repo_id: str) -> int:
    cache_dir = _get_model_cache_dir()
    dir_name = "models--" + repo_id.replace("/", "--")
    model_dir = cache_dir / dir_name
    if not model_dir.exists():
        return 0
    total = 0
    for f in model_dir.rglob("*"):
        if f.is_file():
            total += f.stat().st_size
    return total


@router.get("/models", response_model=list[EmbeddingModelInfo])
async def list_embedding_models():
    """List all available local embedding models with download status."""
    result = []
    for key, spec in EMBEDDING_MODELS.items():
        downloaded = _is_model_downloaded(spec["repo_id"])
        result.append(EmbeddingModelInfo(
            key=key,
            repo_id=spec["repo_id"],
            name=spec["name"],
            params=spec["params"],
            dimension=spec["dimension"],
            size_bytes=spec["size_bytes"],
            vram_gb=spec["vram_gb"],
            description_zh=spec["description_zh"],
            description_en=spec["description_en"],
            languages=spec["languages"],
            downloaded=downloaded,
            path=_get_model_path(spec["repo_id"]) if downloaded else None,
        ))
    return result


async def _do_download(key: str, repo_id: str):
    """Background task to download an embedding model."""
    _download_states[key] = {
        "phase": DownloadPhase.DOWNLOADING,
        "started_at": time.time(),
        "error": None,
    }

    def _download():
        from huggingface_hub import snapshot_download

        hf_token = os.environ.get("HF_TOKEN") or os.environ.get(
            "HUGGING_FACE_HUB_TOKEN"
        )
        hf_endpoint = os.environ.get("HF_ENDPOINT")
        cache_dir = str(_get_model_cache_dir())

        kwargs: dict = {"repo_id": repo_id, "token": hf_token or None}
        kwargs["cache_dir"] = cache_dir
        if hf_endpoint:
            kwargs["endpoint"] = hf_endpoint

        logger.info(
            "Downloading embedding model %s to %s (mirror=%s)...",
            repo_id, cache_dir, hf_endpoint or "default",
        )
        snapshot_download(**kwargs)
        logger.info("Embedding model %s downloaded successfully", repo_id)

    try:
        await asyncio.to_thread(_download)
        _download_states[key]["phase"] = DownloadPhase.COMPLETED
    except asyncio.CancelledError:
        _download_states[key]["phase"] = DownloadPhase.IDLE
        logger.info("Embedding model %s download cancelled", repo_id)
    except Exception as e:
        _download_states[key]["phase"] = DownloadPhase.ERROR
        _download_states[key]["error"] = str(e)
        logger.error("Embedding model %s download failed: %s", repo_id, e)
    finally:
        # Clean up completed task reference
        _download_tasks.pop(key, None)


@router.post("/models/{key}/download")
async def download_model(key: str):
    """Start downloading an embedding model in the background."""
    spec = _validate_key(key)

    if _is_model_downloaded(spec["repo_id"]):
        return {"status": "already_downloaded"}

    if key in _download_tasks and not _download_tasks[key].done():
        return {"status": "downloading"}

    _download_tasks[key] = asyncio.create_task(_do_download(key, spec["repo_id"]))
    return {"status": "downloading"}


@router.get("/models/{key}/download-status", response_model=EmbeddingDownloadStatus)
async def get_download_status(key: str):
    """Get download progress for an embedding model."""
    spec = _validate_key(key)
    state = _download_states.get(key)

    if state and state.get("phase") == DownloadPhase.DOWNLOADING:
        started_at = state.get("started_at", 0)
        elapsed = time.time() - started_at if started_at else 0
        return EmbeddingDownloadStatus(
            key=key,
            phase=DownloadPhase.DOWNLOADING,
            elapsed_seconds=round(elapsed, 1),
            downloaded_bytes=_get_model_downloaded_bytes(spec["repo_id"]),
            total_bytes=spec["size_bytes"],
        )

    if state and state.get("phase") == DownloadPhase.ERROR:
        return EmbeddingDownloadStatus(
            key=key,
            phase=DownloadPhase.ERROR,
            error=state.get("error"),
        )

    if state and state.get("phase") == DownloadPhase.COMPLETED:
        return EmbeddingDownloadStatus(
            key=key,
            phase=DownloadPhase.COMPLETED,
        )

    # Already downloaded from a previous session
    if _is_model_downloaded(spec["repo_id"]):
        return EmbeddingDownloadStatus(
            key=key,
            phase=DownloadPhase.COMPLETED,
        )

    return EmbeddingDownloadStatus(key=key, phase=DownloadPhase.IDLE)


@router.post("/models/{key}/cancel-download")
async def cancel_download(key: str):
    """Cancel an in-progress embedding model download."""
    _validate_key(key)

    if key in _download_tasks and not _download_tasks[key].done():
        _download_tasks[key].cancel()

    _download_states[key] = {
        "phase": DownloadPhase.IDLE,
        "error": None,
    }
    return {"status": "cancelled"}
