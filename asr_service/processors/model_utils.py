"""Shared model path resolution for post-processing sub-models.

Checks local directories and ModelScope cache. Never returns a remote ID
to prevent unintended automatic downloads.
"""

import os
import logging
from pathlib import Path

from asr_service import config

logger = logging.getLogger(__name__)


def resolve_modelscope_model(model_dir: str) -> str | None:
    """Resolve a sub-model to a local path. Returns None if not found locally.

    Search order:
    1. meeting/models/{model_dir}
    2. models/{model_dir}
    3. ModelScope cache: {MODELSCOPE_CACHE}/iic/{model_dir}
    4. Default ModelScope cache: ~/.cache/modelscope/hub/iic/{model_dir}
    """
    # 1. meeting/models/
    local = config.PROJECT_ROOT / "meeting" / "models" / model_dir
    if local.exists():
        return str(local)

    # 2. models/
    models = config.MODELS_DIR / model_dir
    if models.exists():
        return str(models)

    # 3. Runtime model cache dir (set by frontend)
    cache_dir = config.get_model_cache_dir()
    if cache_dir:
        cached = Path(cache_dir) / "iic" / model_dir
        if cached.exists():
            return str(cached)

    # 4. MODELSCOPE_CACHE env var
    ms_cache = os.environ.get("MODELSCOPE_CACHE")
    if ms_cache:
        cached = Path(ms_cache) / "iic" / model_dir
        if cached.exists():
            return str(cached)

    # 5. Default ModelScope cache (~/.cache/modelscope/hub/)
    default_cache = Path.home() / ".cache" / "modelscope" / "hub" / "iic" / model_dir
    if default_cache.exists():
        return str(default_cache)

    logger.debug("Sub-model '%s' not found locally, skipping", model_dir)
    return None
