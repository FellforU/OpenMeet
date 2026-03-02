from fastapi import APIRouter

from asr_service.config import AVAILABLE_ENGINES

router = APIRouter()


def _gpu_info() -> dict:
    """Return GPU/CUDA diagnostic information."""
    try:
        import torch
        info: dict = {
            "pytorch_version": torch.__version__,
            "cuda_available": torch.cuda.is_available(),
            "cuda_version": torch.version.cuda,
        }
        if torch.cuda.is_available():
            info["gpu_count"] = torch.cuda.device_count()
            info["gpus"] = []
            for i in range(torch.cuda.device_count()):
                props = torch.cuda.get_device_properties(i)
                info["gpus"].append({
                    "index": i,
                    "name": torch.cuda.get_device_name(i),
                    "vram_total_gb": round(props.total_mem / 1024**3, 1),
                    "vram_allocated_gb": round(torch.cuda.memory_allocated(i) / 1024**3, 2),
                })
        return info
    except Exception as e:
        return {"error": str(e)}


@router.get("/health")
async def health_check():
    return {
        "status": "ok",
        "engines": AVAILABLE_ENGINES,
        "gpu": _gpu_info(),
    }
