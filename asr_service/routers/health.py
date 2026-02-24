from fastapi import APIRouter

from asr_service.config import AVAILABLE_ENGINES

router = APIRouter()


@router.get("/health")
async def health_check():
    return {
        "status": "ok",
        "engines": AVAILABLE_ENGINES,
    }
