"""Engine listing and management endpoints."""

from fastapi import APIRouter
from pydantic import BaseModel

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


@router.get("", response_model=list[EngineInfo])
async def list_engines():
    """List all available ASR engines and their capabilities."""
    manager = get_manager()
    results = []
    for name, engine in manager._engines.items():
        caps = await engine.get_capabilities()
        results.append(
            EngineInfo(
                name=caps.name,
                supported_languages=caps.supported_languages,
                supports_streaming=caps.supports_streaming,
                supports_timestamps=caps.supports_timestamps,
                supports_diarization=caps.supports_diarization,
                model_sizes=caps.model_sizes,
                is_loaded=engine.is_loaded(),
                current_model_size=getattr(engine, "_model_size", None),
            )
        )
    return results
