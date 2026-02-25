"""Engine listing and management endpoints."""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/engines", tags=["engines"])

_manager = None


def set_manager(manager):
    global _manager
    _manager = manager


def get_manager():
    if _manager is None:
        raise RuntimeError("JobManager not initialized")
    return _manager


class EngineInfo(BaseModel):
    name: str
    supported_languages: list[str]
    supports_streaming: bool
    supports_timestamps: bool
    supports_diarization: bool
    model_sizes: list[str]
    is_loaded: bool
    current_model_size: str | None


class ConfigureEngineRequest(BaseModel):
    credentials: dict[str, str]


async def _build_engine_info(engine) -> EngineInfo:
    """Build EngineInfo from an engine instance."""
    caps = await engine.get_capabilities()
    return EngineInfo(
        name=caps.name,
        supported_languages=caps.supported_languages,
        supports_streaming=caps.supports_streaming,
        supports_timestamps=caps.supports_timestamps,
        supports_diarization=caps.supports_diarization,
        model_sizes=caps.model_sizes,
        is_loaded=engine.is_loaded(),
        current_model_size=getattr(engine, "_model_size", None),
    )


@router.get("", response_model=list[EngineInfo])
async def list_engines():
    """List all available ASR engines and their capabilities."""
    manager = get_manager()
    results = []
    for name, engine in manager._engines.items():
        results.append(await _build_engine_info(engine))
    return results


@router.post("/{engine_name}/load", response_model=EngineInfo)
async def load_engine_model(
    engine_name: str, model_size: str = Query(...)
):
    """Load a specific model for an engine. Downloads if needed."""
    manager = get_manager()
    engine = manager._engines.get(engine_name)
    if not engine:
        raise HTTPException(404, f"Engine '{engine_name}' not found")
    try:
        await engine.load_model(model_size)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return await _build_engine_info(engine)


@router.post("/{engine_name}/unload", response_model=EngineInfo)
async def unload_engine_model(engine_name: str):
    """Unload the current model to free resources."""
    manager = get_manager()
    engine = manager._engines.get(engine_name)
    if not engine:
        raise HTTPException(404, f"Engine '{engine_name}' not found")
    await engine.unload_model()
    return await _build_engine_info(engine)


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
