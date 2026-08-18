"""Diarization model download and management endpoints.

下载统一走 ModelScope（魔搭）国内源的 community-1 仓库——自包含、免 Token、
免网页协议。
"""

import asyncio
import logging
import time
from enum import Enum

from fastapi import APIRouter
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/diarization", tags=["diarization"])

# Background download state
_download_status: dict = {}
_download_task: asyncio.Task | None = None

# Primary pipeline (self-contained repo, 魔搭上无 gate)
PYANNOTE_PIPELINE = "pyannote/speaker-diarization-community-1"

# Approximate total size in bytes (community-1 实测约 32MB)
PYANNOTE_ESTIMATED_SIZE = 35 * 1024 * 1024


class DownloadPhase(str, Enum):
    IDLE = "idle"
    DOWNLOADING = "downloading"
    COMPLETED = "completed"
    ERROR = "error"


class PyannoteStatus(BaseModel):
    downloaded: bool
    phase: DownloadPhase
    elapsed_seconds: float = 0
    downloaded_bytes: int = 0
    total_bytes: int = 0
    error: str | None = None
    path: str | None = None


def _is_pyannote_downloaded() -> bool:
    """Check if the pyannote pipeline is fully downloaded (ModelScope dir)."""
    from asr_service.services import model_source

    return model_source.is_downloaded(PYANNOTE_PIPELINE)


def _get_downloaded_bytes() -> int:
    """Calculate total bytes of downloaded pyannote model files."""
    from asr_service.services import model_source

    ms_dir = model_source.ms_model_dir(PYANNOTE_PIPELINE)
    if not ms_dir.exists():
        return 0
    return sum(f.stat().st_size for f in ms_dir.rglob("*") if f.is_file())


async def _do_download():
    """Background task to download pyannote models."""
    global _download_status

    _download_status = {
        "phase": DownloadPhase.DOWNLOADING,
        "started_at": time.time(),
        "error": None,
    }

    def _download():
        # 统一走 ModelScope 国内源：自包含仓库，免 Token 免网页协议
        from asr_service.services import model_source

        model_source.download_sync(PYANNOTE_PIPELINE)
        return True

    try:
        await asyncio.to_thread(_download)
        # 下载函数正常返回不代表文件齐全（网络中断可能只留下碎片），
        # 必须验证完整性后才能报告完成
        if not _is_pyannote_downloaded():
            raise RuntimeError(
                "Download incomplete: model files missing after download"
            )
        _download_status["phase"] = DownloadPhase.COMPLETED
    except Exception as e:
        _download_status["phase"] = DownloadPhase.ERROR
        _download_status["error"] = str(e)
        logger.error("pyannote download failed: %s", e)


@router.get("/pyannote/status", response_model=PyannoteStatus)
async def get_pyannote_status():
    """Check if pyannote models are downloaded and get download progress."""
    downloaded = _is_pyannote_downloaded()
    model_path = None
    if downloaded:
        from asr_service.services import model_source

        model_path = str(model_source.ms_model_dir(PYANNOTE_PIPELINE))

    if _download_status and _download_status.get("phase") == DownloadPhase.DOWNLOADING:
        started_at = _download_status.get("started_at", 0)
        elapsed = time.time() - started_at if started_at else 0
        return PyannoteStatus(
            downloaded=downloaded,
            phase=DownloadPhase.DOWNLOADING,
            elapsed_seconds=round(elapsed, 1),
            downloaded_bytes=_get_downloaded_bytes(),
            total_bytes=PYANNOTE_ESTIMATED_SIZE,
            path=model_path,
        )

    if _download_status and _download_status.get("phase") == DownloadPhase.ERROR:
        return PyannoteStatus(
            downloaded=downloaded,
            phase=DownloadPhase.ERROR,
            error=_download_status.get("error"),
            path=model_path,
        )

    if _download_status and _download_status.get("phase") == DownloadPhase.COMPLETED:
        return PyannoteStatus(
            downloaded=True,
            phase=DownloadPhase.COMPLETED,
            path=model_path,
        )

    return PyannoteStatus(
        downloaded=downloaded,
        phase=DownloadPhase.IDLE,
        path=model_path,
    )


@router.post("/pyannote/download")
async def download_pyannote():
    """Start downloading pyannote models in the background."""
    global _download_task

    if _is_pyannote_downloaded():
        return {"status": "already_downloaded"}

    if _download_task and not _download_task.done():
        return {"status": "downloading"}

    _download_task = asyncio.create_task(_do_download())
    return {"status": "downloading"}


@router.post("/pyannote/cancel-download")
async def cancel_pyannote_download():
    """Cancel an in-progress pyannote download."""
    global _download_task, _download_status

    if _download_task and not _download_task.done():
        _download_task.cancel()

    _download_status = {
        "phase": DownloadPhase.IDLE,
        "error": None,
    }

    return {"status": "cancelled"}
