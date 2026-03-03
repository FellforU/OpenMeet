"""Custom model configuration and validation endpoints."""

import logging

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from asr_service.engines.custom_engine import CustomEngine, CustomModelConfig

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/custom", tags=["custom"])

_engine: CustomEngine | None = None


def set_engine(engine: CustomEngine):
    global _engine
    _engine = engine


def get_engine() -> CustomEngine:
    if _engine is None:
        raise RuntimeError("Custom engine not initialized")
    return _engine


# ------------------------------------------------------------------
# Request / Response models
# ------------------------------------------------------------------

class CustomModelItem(BaseModel):
    id: str
    name: str
    platform: str  # "huggingface" | "modelscope"
    model_id: str
    mirror_url: str | None = None
    vram_gb: float = 2.0


class RegisterModelsRequest(BaseModel):
    models: list[CustomModelItem]


class RegisterModelsResponse(BaseModel):
    status: str
    count: int


class ValidateRequest(BaseModel):
    platform: str  # "huggingface" | "modelscope"
    model_id: str
    mirror_url: str | None = None


class ValidateResponse(BaseModel):
    valid: bool
    error: str | None = None
    model_name: str | None = None
    tags: list[str] | None = None


# ------------------------------------------------------------------
# Endpoints
# ------------------------------------------------------------------

@router.post("/models", response_model=RegisterModelsResponse)
async def register_models(body: RegisterModelsRequest):
    """Register/update the list of custom model configs (pushed by frontend on startup)."""
    engine = get_engine()
    configs = [
        CustomModelConfig(
            id=m.id,
            name=m.name,
            platform=m.platform,
            model_id=m.model_id,
            mirror_url=m.mirror_url,
            vram_gb=m.vram_gb,
        )
        for m in body.models
    ]
    engine.register_models(configs)
    return RegisterModelsResponse(status="ok", count=len(configs))


@router.get("/models", response_model=list[CustomModelItem])
async def list_models():
    """Return currently registered custom models."""
    engine = get_engine()
    return [
        CustomModelItem(
            id=c.id,
            name=c.name,
            platform=c.platform,
            model_id=c.model_id,
            mirror_url=c.mirror_url,
            vram_gb=c.vram_gb,
        )
        for c in engine.get_registered_models()
    ]


@router.post("/validate", response_model=ValidateResponse)
async def validate_model(body: ValidateRequest):
    """Validate whether a model ID is an ASR model on the given platform."""
    if body.platform == "huggingface":
        return await _validate_huggingface(body.model_id, body.mirror_url)
    if body.platform == "modelscope":
        return await _validate_modelscope(body.model_id)
    raise HTTPException(400, f"Unsupported platform: {body.platform}")


async def _validate_huggingface(model_id: str, mirror_url: str | None) -> ValidateResponse:
    """Check HuggingFace API for model existence and pipeline_tag."""
    from asr_service.config import get_hf_mirror

    endpoint = mirror_url or get_hf_mirror() or "https://huggingface.co"
    url = f"{endpoint}/api/models/{model_id}"

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url)
    except httpx.RequestError as e:
        return ValidateResponse(valid=False, error=f"Network error: {e}")

    if resp.status_code == 404:
        return ValidateResponse(valid=False, error="Model not found on HuggingFace")
    if resp.status_code != 200:
        return ValidateResponse(valid=False, error=f"HuggingFace API error: HTTP {resp.status_code}")

    data = resp.json()
    pipeline_tag = data.get("pipeline_tag", "")
    model_name = data.get("modelId", model_id)
    tags = data.get("tags", [])

    if pipeline_tag != "automatic-speech-recognition":
        return ValidateResponse(
            valid=False,
            error=f"Not an ASR model (pipeline_tag: {pipeline_tag or 'unknown'})",
            model_name=model_name,
            tags=tags,
        )

    return ValidateResponse(valid=True, model_name=model_name, tags=tags)


async def _validate_modelscope(model_id: str) -> ValidateResponse:
    """Check ModelScope API for model existence and task type."""
    url = f"https://modelscope.cn/api/v1/models/{model_id}"

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url)
    except httpx.RequestError as e:
        return ValidateResponse(valid=False, error=f"Network error: {e}")

    if resp.status_code == 404:
        return ValidateResponse(valid=False, error="Model not found on ModelScope")
    if resp.status_code != 200:
        return ValidateResponse(valid=False, error=f"ModelScope API error: HTTP {resp.status_code}")

    data = resp.json()
    model_data = data.get("Data", {})
    task = model_data.get("Task", "")
    model_name = model_data.get("Name", model_id)
    tags = model_data.get("Tags", [])

    if task != "auto-speech-recognition":
        return ValidateResponse(
            valid=False,
            error=f"Not an ASR model (task: {task or 'unknown'})",
            model_name=model_name,
            tags=tags,
        )

    return ValidateResponse(valid=True, model_name=model_name, tags=tags)
