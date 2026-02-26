"""Configuration endpoint for setting app data directory."""

from fastapi import APIRouter
from pydantic import BaseModel

from ..config import set_app_data_dir, get_lance_path, get_sqlite_path

router = APIRouter(tags=["config"])

_knowledge_initializer = None


def set_knowledge_initializer(fn):
    global _knowledge_initializer
    _knowledge_initializer = fn


class ConfigRequest(BaseModel):
    app_data_dir: str


class ConfigResponse(BaseModel):
    status: str
    sqlite_path: str | None
    lance_path: str | None


@router.post("/config", response_model=ConfigResponse)
async def set_config(req: ConfigRequest):
    set_app_data_dir(req.app_data_dir)

    # Initialize knowledge modules if not already
    if _knowledge_initializer:
        await _knowledge_initializer()

    return ConfigResponse(
        status="ok",
        sqlite_path=get_sqlite_path(),
        lance_path=get_lance_path(),
    )
