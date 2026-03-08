"""Diarization model download and management endpoints.

Handles pyannote speaker-diarization-3.1 model download, status checking,
and cache management. The model includes sub-models:
- pyannote/segmentation-3.0 (~17MB)
- pyannote/wespeaker-voxceleb-resnet34-LM (~65MB)
"""

import asyncio
import logging
import os
import time
from enum import Enum
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from asr_service import config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/diarization", tags=["diarization"])

# Background download state
_download_status: dict = {}
_download_task: asyncio.Task | None = None

# HuggingFace repo IDs that make up the pyannote pipeline
PYANNOTE_REPOS = [
    "pyannote/speaker-diarization-3.1",
    "pyannote/segmentation-3.0",
    "hbredin/wespeaker-voxceleb-resnet34-LM",
]

# Approximate total size in bytes (segmentation ~17MB + wespeaker ~65MB + config)
PYANNOTE_ESTIMATED_SIZE = 85 * 1024 * 1024


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


def _get_pyannote_cache_dir() -> Path | None:
    """Get the HuggingFace cache directory where pyannote models are stored."""
    cache_dir = config.get_model_cache_dir()
    if cache_dir:
        return Path(cache_dir)
    # Fallback to default HF cache
    return Path.home() / ".cache" / "huggingface" / "hub"


def _is_pyannote_downloaded() -> bool:
    """Check if pyannote speaker-diarization-3.1 is cached locally."""
    cache_dir = _get_pyannote_cache_dir()
    if not cache_dir or not cache_dir.exists():
        return False

    # Check for the main pipeline config and sub-models
    required_dirs = [
        "models--pyannote--speaker-diarization-3.1",
        "models--pyannote--segmentation-3.0",
    ]
    for dir_name in required_dirs:
        model_dir = cache_dir / dir_name
        if not model_dir.exists():
            return False
        # Check that snapshots exist (model was actually downloaded)
        snapshots_dir = model_dir / "snapshots"
        if not snapshots_dir.exists() or not any(snapshots_dir.iterdir()):
            return False

    return True


def _get_downloaded_bytes() -> int:
    """Calculate total bytes of downloaded pyannote model files."""
    cache_dir = _get_pyannote_cache_dir()
    if not cache_dir:
        return 0

    total = 0
    for dir_name in [
        "models--pyannote--speaker-diarization-3.1",
        "models--pyannote--segmentation-3.0",
        "models--hbredin--wespeaker-voxceleb-resnet34-LM",
    ]:
        model_dir = cache_dir / dir_name
        if model_dir.exists():
            for f in model_dir.rglob("*"):
                if f.is_file():
                    total += f.stat().st_size
    return total


async def _do_download():
    """Background task to download pyannote models."""
    global _download_status

    _download_status = {
        "phase": DownloadPhase.DOWNLOADING,
        "started_at": time.time(),
        "error": None,
    }

    def _download():
        hf_token = os.environ.get("HF_TOKEN") or os.environ.get(
            "HUGGING_FACE_HUB_TOKEN"
        )

        try:
            from pyannote.audio import Pipeline

            # This downloads all sub-models automatically
            pipeline = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-3.1",
                token=hf_token,
            )
            logger.info("pyannote speaker-diarization-3.1 downloaded successfully")
            return True
        except ImportError:
            # pyannote not installed — try direct huggingface_hub download
            try:
                from huggingface_hub import snapshot_download

                for repo_id in PYANNOTE_REPOS:
                    logger.info("Downloading %s...", repo_id)
                    snapshot_download(
                        repo_id,
                        token=hf_token,
                    )
                logger.info("All pyannote models downloaded")
                return True
            except Exception as e:
                raise RuntimeError(f"Download failed: {e}") from e

    try:
        await asyncio.to_thread(_download)
        _download_status["phase"] = DownloadPhase.COMPLETED
    except Exception as e:
        _download_status["phase"] = DownloadPhase.ERROR
        _download_status["error"] = str(e)
        logger.error("pyannote download failed: %s", e)


@router.get("/pyannote/status", response_model=PyannoteStatus)
async def get_pyannote_status():
    """Check if pyannote models are downloaded and get download progress."""
    downloaded = _is_pyannote_downloaded()

    if _download_status and _download_status.get("phase") == DownloadPhase.DOWNLOADING:
        started_at = _download_status.get("started_at", 0)
        elapsed = time.time() - started_at if started_at else 0
        return PyannoteStatus(
            downloaded=downloaded,
            phase=DownloadPhase.DOWNLOADING,
            elapsed_seconds=round(elapsed, 1),
            downloaded_bytes=_get_downloaded_bytes(),
            total_bytes=PYANNOTE_ESTIMATED_SIZE,
        )

    if _download_status and _download_status.get("phase") == DownloadPhase.ERROR:
        return PyannoteStatus(
            downloaded=downloaded,
            phase=DownloadPhase.ERROR,
            error=_download_status.get("error"),
        )

    if _download_status and _download_status.get("phase") == DownloadPhase.COMPLETED:
        return PyannoteStatus(
            downloaded=True,
            phase=DownloadPhase.COMPLETED,
        )

    return PyannoteStatus(
        downloaded=downloaded,
        phase=DownloadPhase.IDLE,
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
