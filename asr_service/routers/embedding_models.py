"""Local embedding model download and management endpoints.

Handles Qwen3-Embedding model series download, status checking,
and cache management via HuggingFace Hub.
"""

import asyncio
import logging
import time
from enum import Enum

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

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
        "description_zh": "推荐默认。性价比最佳，C-MTEB 超越 BGE-M3 近 10%",
        "description_en": "Recommended default. Best cost-performance, surpasses BGE-M3 on C-MTEB by ~10%",
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


def _is_model_downloaded(repo_id: str) -> bool:
    """已下载判定：以魔搭下载目录的完整性标记为准。"""
    from asr_service.services import model_source

    return model_source.is_downloaded(repo_id)


def _get_model_path(repo_id: str) -> str | None:
    from asr_service.services import model_source

    return model_source.local_path(repo_id)


def _get_model_downloaded_bytes(repo_id: str) -> int:
    from asr_service.services import model_source

    ms_dir = model_source.ms_model_dir(repo_id)
    if not ms_dir.exists():
        return 0
    return sum(f.stat().st_size for f in ms_dir.rglob("*") if f.is_file())


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
        # 统一走 ModelScope 国内源（repo_id 与 HF 同名同组织）
        from asr_service.services import model_source

        model_source.download_sync(repo_id)

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
