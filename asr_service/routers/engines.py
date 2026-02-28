"""Engine listing and management endpoints."""

import asyncio
import logging
import os
import time
from enum import Enum
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/engines", tags=["engines"])


def _dir_size(path: str | Path) -> int:
    """Calculate total file size in a directory tree. Returns 0 if path doesn't exist."""
    total = 0
    try:
        for dirpath, _dirnames, filenames in os.walk(path):
            for f in filenames:
                fp = os.path.join(dirpath, f)
                try:
                    total += os.path.getsize(fp)
                except OSError:
                    pass
    except OSError:
        pass
    return total

_manager = None

# Background loading state tracking
_loading_status: dict[str, dict] = {}
_loading_tasks: dict[str, asyncio.Task] = {}

# Background download state tracking
_download_status: dict[str, dict] = {}
_download_tasks: dict[str, asyncio.Task] = {}


def set_manager(manager):
    global _manager
    _manager = manager


def get_manager():
    if _manager is None:
        raise RuntimeError("JobManager not initialized")
    return _manager


def reset_loading_state():
    """Reset module-level loading and download state. Used in test teardown."""
    _loading_status.clear()
    for task in _loading_tasks.values():
        if not task.done():
            task.cancel()
    _loading_tasks.clear()
    _download_status.clear()
    for task in _download_tasks.values():
        if not task.done():
            task.cancel()
    _download_tasks.clear()


class LoadPhase(str, Enum):
    IDLE = "idle"
    PREPARING = "preparing"
    LOADING = "loading"
    READY = "ready"
    ERROR = "error"


class EngineInfo(BaseModel):
    name: str
    supported_languages: list[str]
    supports_streaming: bool
    supports_timestamps: bool
    supports_diarization: bool
    model_sizes: list[str]
    is_loaded: bool
    current_model_size: str | None
    downloaded_models: list[str]


class LoadResponse(BaseModel):
    status: str  # "loading" | "already_loaded"
    engine_name: str
    model_size: str


class LoadingStatus(BaseModel):
    engine_name: str
    model_size: str | None
    phase: LoadPhase
    started_at: float | None
    elapsed_seconds: float
    error: str | None


class DownloadPhase(str, Enum):
    IDLE = "idle"
    DOWNLOADING = "downloading"
    COMPLETED = "completed"
    ERROR = "error"


class DownloadResponse(BaseModel):
    status: str  # "downloading" | "already_downloaded"
    engine_name: str
    model_size: str


class DownloadStatus(BaseModel):
    engine_name: str
    model_size: str | None
    phase: DownloadPhase
    started_at: float | None
    elapsed_seconds: float
    downloaded_bytes: int = 0
    total_bytes: int = 0
    error: str | None


class ConfigureEngineRequest(BaseModel):
    credentials: dict[str, str]


async def _build_engine_info(engine) -> EngineInfo:
    """Build EngineInfo from an engine instance."""
    caps = await engine.get_capabilities()
    downloaded = []
    if hasattr(engine, "is_model_downloaded"):
        for size in caps.model_sizes:
            try:
                if engine.is_model_downloaded(size):
                    downloaded.append(size)
            except Exception:
                pass
    return EngineInfo(
        name=caps.name,
        supported_languages=caps.supported_languages,
        supports_streaming=caps.supports_streaming,
        supports_timestamps=caps.supports_timestamps,
        supports_diarization=caps.supports_diarization,
        model_sizes=caps.model_sizes,
        is_loaded=engine.is_loaded(),
        current_model_size=getattr(engine, "_model_size", None),
        downloaded_models=downloaded,
    )


async def _do_load_model(engine_name: str, engine, model_size: str):
    """Background task to load model."""
    status = _loading_status[engine_name]
    try:
        status["phase"] = LoadPhase.LOADING
        await engine.load_model(model_size)
        status["phase"] = LoadPhase.READY
    except Exception as e:
        status["phase"] = LoadPhase.ERROR
        status["error"] = str(e)
        logger.error("Failed to load model %s/%s: %s", engine_name, model_size, e)
    finally:
        _loading_tasks.pop(engine_name, None)


async def _do_download_model(engine_name: str, engine, model_size: str):
    """Background task to download model files."""
    status = _download_status[engine_name]
    try:
        status["phase"] = DownloadPhase.DOWNLOADING
        await engine.download_model(model_size)
        status["phase"] = DownloadPhase.COMPLETED
    except Exception as e:
        status["phase"] = DownloadPhase.ERROR
        status["error"] = str(e)
        logger.error("Failed to download model %s/%s: %s", engine_name, model_size, e)
    finally:
        _download_tasks.pop(engine_name, None)


@router.get("", response_model=list[EngineInfo])
async def list_engines():
    """List all available ASR engines and their capabilities."""
    manager = get_manager()
    results = []
    for name, engine in manager._engines.items():
        results.append(await _build_engine_info(engine))
    return results


@router.post("/{engine_name}/load", response_model=LoadResponse)
async def load_engine_model(
    engine_name: str, model_size: str = Query(...)
):
    """Start loading a model in the background. Returns immediately."""
    manager = get_manager()
    engine = manager._engines.get(engine_name)
    if not engine:
        raise HTTPException(404, f"Engine '{engine_name}' not found")

    # Validate model_size against capabilities
    caps = await engine.get_capabilities()
    if model_size not in caps.model_sizes:
        raise HTTPException(
            400,
            f"Invalid model_size '{model_size}' for engine '{engine_name}'. "
            f"Available: {caps.model_sizes}",
        )

    # Already loaded with same model_size
    if engine.is_loaded() and getattr(engine, "_model_size", None) == model_size:
        return LoadResponse(
            status="already_loaded",
            engine_name=engine_name,
            model_size=model_size,
        )

    # Already has a loading task in progress
    if engine_name in _loading_tasks and not _loading_tasks[engine_name].done():
        return LoadResponse(
            status="loading",
            engine_name=engine_name,
            model_size=model_size,
        )

    # Start background loading
    _loading_status[engine_name] = {
        "engine_name": engine_name,
        "model_size": model_size,
        "phase": LoadPhase.PREPARING,
        "started_at": time.time(),
        "error": None,
    }
    task = asyncio.create_task(_do_load_model(engine_name, engine, model_size))
    _loading_tasks[engine_name] = task

    return LoadResponse(
        status="loading",
        engine_name=engine_name,
        model_size=model_size,
    )


@router.get("/{engine_name}/load-status", response_model=LoadingStatus)
async def get_load_status(engine_name: str):
    """Get the current loading status for an engine."""
    manager = get_manager()
    engine = manager._engines.get(engine_name)
    if not engine:
        raise HTTPException(404, f"Engine '{engine_name}' not found")

    status = _loading_status.get(engine_name)
    if status:
        # Self-heal: if task finished but status is still in-progress
        if status["phase"] in (LoadPhase.PREPARING, LoadPhase.LOADING):
            task = _loading_tasks.get(engine_name)
            if task is None or task.done():
                if engine.is_loaded():
                    status["phase"] = LoadPhase.READY
                else:
                    status["phase"] = LoadPhase.ERROR
                    status["error"] = status.get("error") or "Loading interrupted"

        started_at = status.get("started_at")
        elapsed = time.time() - started_at if started_at else 0.0
        return LoadingStatus(
            engine_name=engine_name,
            model_size=status.get("model_size"),
            phase=status["phase"],
            started_at=started_at,
            elapsed_seconds=round(elapsed, 1),
            error=status.get("error"),
        )

    # No loading record — infer from engine state
    phase = LoadPhase.READY if engine.is_loaded() else LoadPhase.IDLE
    return LoadingStatus(
        engine_name=engine_name,
        model_size=getattr(engine, "_model_size", None),
        phase=phase,
        started_at=None,
        elapsed_seconds=0.0,
        error=None,
    )


@router.post("/{engine_name}/unload", response_model=EngineInfo)
async def unload_engine_model(engine_name: str):
    """Unload the current model to free resources."""
    manager = get_manager()
    engine = manager._engines.get(engine_name)
    if not engine:
        raise HTTPException(404, f"Engine '{engine_name}' not found")
    # Cancel any in-progress loading task
    task = _loading_tasks.pop(engine_name, None)
    if task and not task.done():
        task.cancel()
    _loading_status.pop(engine_name, None)
    await engine.unload_model()
    return await _build_engine_info(engine)


@router.post("/{engine_name}/cancel-load", response_model=LoadingStatus)
async def cancel_load(engine_name: str):
    """Cancel an in-progress model load without unloading any existing model."""
    manager = get_manager()
    engine = manager._engines.get(engine_name)
    if not engine:
        raise HTTPException(404, f"Engine '{engine_name}' not found")

    # Cancel the asyncio task if running
    task = _loading_tasks.pop(engine_name, None)
    if task and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    status = _loading_status.get(engine_name)
    if status and status["phase"] in (LoadPhase.PREPARING, LoadPhase.LOADING):
        status["phase"] = LoadPhase.IDLE
        status["error"] = None

    started_at = status.get("started_at") if status else None
    elapsed = time.time() - started_at if started_at else 0.0

    return LoadingStatus(
        engine_name=engine_name,
        model_size=status.get("model_size") if status else None,
        phase=LoadPhase.IDLE,
        started_at=started_at,
        elapsed_seconds=round(elapsed, 1),
        error=None,
    )


@router.post("/{engine_name}/download", response_model=DownloadResponse)
async def download_engine_model(
    engine_name: str, model_size: str = Query(...)
):
    """Start downloading model files in the background. Returns immediately."""
    manager = get_manager()
    engine = manager._engines.get(engine_name)
    if not engine:
        raise HTTPException(404, f"Engine '{engine_name}' not found")

    if not hasattr(engine, "download_model"):
        raise HTTPException(400, f"Engine '{engine_name}' does not support download")

    # Validate model_size
    caps = await engine.get_capabilities()
    if model_size not in caps.model_sizes:
        raise HTTPException(
            400,
            f"Invalid model_size '{model_size}' for engine '{engine_name}'. "
            f"Available: {caps.model_sizes}",
        )

    # Already downloaded
    if hasattr(engine, "is_model_downloaded") and engine.is_model_downloaded(model_size):
        return DownloadResponse(
            status="already_downloaded",
            engine_name=engine_name,
            model_size=model_size,
        )

    # Already has a download task in progress
    if engine_name in _download_tasks and not _download_tasks[engine_name].done():
        return DownloadResponse(
            status="downloading",
            engine_name=engine_name,
            model_size=model_size,
        )

    # Start background download
    _download_status[engine_name] = {
        "engine_name": engine_name,
        "model_size": model_size,
        "phase": DownloadPhase.DOWNLOADING,
        "started_at": time.time(),
        "error": None,
    }
    task = asyncio.create_task(_do_download_model(engine_name, engine, model_size))
    _download_tasks[engine_name] = task

    return DownloadResponse(
        status="downloading",
        engine_name=engine_name,
        model_size=model_size,
    )


@router.post("/{engine_name}/cancel-download", response_model=DownloadStatus)
async def cancel_download(engine_name: str):
    """Cancel an in-progress model download."""
    manager = get_manager()
    engine = manager._engines.get(engine_name)
    if not engine:
        raise HTTPException(404, f"Engine '{engine_name}' not found")

    # Cancel the asyncio task if running
    task = _download_tasks.pop(engine_name, None)
    if task and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    status = _download_status.get(engine_name)
    if status and status["phase"] == DownloadPhase.DOWNLOADING:
        status["phase"] = DownloadPhase.IDLE
        status["error"] = None

    started_at = status.get("started_at") if status else None
    elapsed = time.time() - started_at if started_at else 0.0

    return DownloadStatus(
        engine_name=engine_name,
        model_size=status.get("model_size") if status else None,
        phase=DownloadPhase.IDLE,
        started_at=started_at,
        elapsed_seconds=round(elapsed, 1),
        downloaded_bytes=0,
        total_bytes=0,
        error=None,
    )


@router.get("/{engine_name}/download-status", response_model=DownloadStatus)
async def get_download_status(engine_name: str):
    """Get the current download status for an engine."""
    manager = get_manager()
    engine = manager._engines.get(engine_name)
    if not engine:
        raise HTTPException(404, f"Engine '{engine_name}' not found")

    status = _download_status.get(engine_name)
    if status:
        # Self-heal: if task finished but status is still "downloading"
        if status["phase"] == DownloadPhase.DOWNLOADING:
            task = _download_tasks.get(engine_name)
            if task is None or task.done():
                model_size = status.get("model_size", "")
                if hasattr(engine, "is_model_downloaded") and engine.is_model_downloaded(model_size):
                    status["phase"] = DownloadPhase.COMPLETED
                else:
                    status["phase"] = DownloadPhase.ERROR
                    status["error"] = status.get("error") or "Download interrupted"

        # Calculate byte progress if downloading
        downloaded_bytes = 0
        total_bytes = 0
        model_size = status.get("model_size", "")
        if status["phase"] == DownloadPhase.DOWNLOADING and model_size:
            if hasattr(engine, "estimated_size_bytes"):
                total_bytes = engine.estimated_size_bytes(model_size)
            if hasattr(engine, "get_download_dir"):
                dl_dir = engine.get_download_dir(model_size)
                if dl_dir:
                    downloaded_bytes = _dir_size(dl_dir)

        started_at = status.get("started_at")
        elapsed = time.time() - started_at if started_at else 0.0
        return DownloadStatus(
            engine_name=engine_name,
            model_size=status.get("model_size"),
            phase=status["phase"],
            started_at=started_at,
            elapsed_seconds=round(elapsed, 1),
            downloaded_bytes=downloaded_bytes,
            total_bytes=total_bytes,
            error=status.get("error"),
        )

    return DownloadStatus(
        engine_name=engine_name,
        model_size=None,
        phase=DownloadPhase.IDLE,
        started_at=None,
        elapsed_seconds=0.0,
        downloaded_bytes=0,
        total_bytes=0,
        error=None,
    )


class ModelPathResponse(BaseModel):
    engine_name: str
    model_size: str
    path: str | None


@router.get("/{engine_name}/model-path", response_model=ModelPathResponse)
async def get_model_path(engine_name: str, model_size: str = Query(...)):
    """Get the local filesystem path for a downloaded model."""
    manager = get_manager()
    engine = manager._engines.get(engine_name)
    if not engine:
        raise HTTPException(404, f"Engine '{engine_name}' not found")

    # Validate model_size against engine capabilities
    caps = await engine.get_capabilities()
    if model_size not in caps.model_sizes:
        raise HTTPException(
            400,
            f"Invalid model_size '{model_size}' for engine '{engine_name}'. "
            f"Available: {caps.model_sizes}",
        )

    path = None
    if hasattr(engine, "get_model_path"):
        try:
            path = engine.get_model_path(model_size)
        except Exception as e:
            logger.warning("get_model_path failed for %s/%s: %s", engine_name, model_size, e)

    return ModelPathResponse(
        engine_name=engine_name,
        model_size=model_size,
        path=path,
    )


@router.post("/{engine_name}/configure")
async def configure_engine(engine_name: str, body: ConfigureEngineRequest):
    """Set runtime credentials for cloud engines (bypasses env vars)."""
    manager = get_manager()
    engine = manager._engines.get(engine_name)
    if not engine:
        raise HTTPException(404, f"Engine '{engine_name}' not found")
    if not hasattr(engine, "configure"):
        raise HTTPException(400, f"Engine '{engine_name}' does not support runtime configuration")
    engine.configure(body.credentials)
    logger.info("Configured engine '%s' with runtime credentials", engine_name)
    return {"status": "ok"}
