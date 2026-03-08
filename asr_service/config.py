import logging
import os
import shutil
from pathlib import Path

logger = logging.getLogger(__name__)

# Base directories
PROJECT_ROOT = Path(__file__).parent.parent
MODELS_DIR = PROJECT_ROOT / "models"
DATA_DIR = PROJECT_ROOT / "data"

# Server config
HOST = "127.0.0.1"
PORT = 18090

# Supported engines
AVAILABLE_ENGINES = ["whisper", "qwen3", "paraformer", "openai-whisper", "alibaba-asr", "custom"]
DEFAULT_ENGINE = "whisper"

# Knowledge platform config
LANCE_DB_DIR = "lance"
EMBEDDING_MODEL = "BAAI/bge-small-zh-v1.5"
CHUNK_SIZE = 500
CHUNK_OVERLAP = 50

# Runtime config (set by frontend on startup)
_runtime_config = {
    "app_data_dir": None,
    "sqlite_db_path": None,
    "lance_db_path": None,
    "cache_dir": None,           # Root cache directory for all types
    "hf_mirror": None,
}

# Subdirectory names under the root cache directory
CACHE_SUBDIR_MODELS = "models"
CACHE_SUBDIR_AUDIO = "audio"
CACHE_SUBDIR_ATTACHMENTS = "attachments"


def set_app_data_dir(path: str):
    _runtime_config["app_data_dir"] = path
    _runtime_config["sqlite_db_path"] = f"{path}/openmeet.db"
    _runtime_config["lance_db_path"] = f"{path}/lance"


def get_sqlite_path() -> str | None:
    return _runtime_config["sqlite_db_path"]


def get_lance_path() -> str | None:
    return _runtime_config["lance_db_path"]


def _migrate_legacy_cache(root: Path):
    """Move model directories from root level into models/ subdirectory.

    Before the cacheDir refactor (commit 13c1e51), modelCacheDir pointed
    directly at the HuggingFace / ModelScope cache root.  After the refactor,
    cacheDir is a general-purpose root and models live under {cacheDir}/models/.
    This function detects and migrates legacy model dirs so that previously
    downloaded models are found by the engines.
    """
    if not root.exists():
        return

    models_dir = root / CACHE_SUBDIR_MODELS
    models_dir.mkdir(parents=True, exist_ok=True)

    known_subdirs = {CACHE_SUBDIR_MODELS, CACHE_SUBDIR_AUDIO, CACHE_SUBDIR_ATTACHMENTS}
    migrated = 0

    for item in root.iterdir():
        if item.name in known_subdirs:
            continue
        should_move = False

        # HuggingFace cache dirs: models--org--name
        if item.is_dir() and item.name.startswith("models--"):
            should_move = True
        # ModelScope org dir used by Paraformer
        elif item.is_dir() and item.name == "iic":
            should_move = True

        if should_move:
            target = models_dir / item.name
            if not target.exists():
                try:
                    shutil.move(str(item), str(target))
                    migrated += 1
                except OSError as e:
                    logger.warning("Failed to migrate legacy model dir %s: %s", item, e)

    if migrated > 0:
        logger.info("Migrated %d legacy model directories into %s", migrated, models_dir)


def set_cache_dir(path: str | None):
    """Set root cache directory. Model env vars point to the models/ subdirectory."""
    _runtime_config["cache_dir"] = path
    if path:
        root = Path(path)
        models_dir = root / CACHE_SUBDIR_MODELS
        models_dir.mkdir(parents=True, exist_ok=True)

        # Migrate legacy model dirs from root into the models/ subdirectory
        _migrate_legacy_cache(root)

        models_str = str(models_dir)
        os.environ["HF_HUB_CACHE"] = models_str
        os.environ["MODELSCOPE_CACHE"] = models_str
    else:
        os.environ.pop("HF_HUB_CACHE", None)
        os.environ.pop("MODELSCOPE_CACHE", None)

    # huggingface_hub caches HF_HUB_CACHE at import time; patch the live constant
    # so models download to the configured directory instead of ~/.cache/huggingface/hub
    try:
        import huggingface_hub.constants as hf_constants
        if path:
            hf_constants.HF_HUB_CACHE = str(Path(path) / CACHE_SUBDIR_MODELS)
        else:
            # Reset to default
            hf_constants.HF_HUB_CACHE = str(
                Path.home() / ".cache" / "huggingface" / "hub"
            )
    except ImportError:
        pass


def get_cache_dir() -> str | None:
    """Return the root cache directory."""
    return _runtime_config["cache_dir"]


def get_model_cache_dir() -> str | None:
    """Return the models subdirectory under the cache root. Used by ASR engines."""
    root = _runtime_config["cache_dir"]
    if root:
        return str(Path(root) / CACHE_SUBDIR_MODELS)
    return None


def get_cache_subdir(subdir: str) -> str | None:
    """Return a typed subdirectory under the cache root (e.g. 'audio', 'attachments')."""
    root = _runtime_config["cache_dir"]
    if root:
        return str(Path(root) / subdir)
    return None


def set_hf_mirror(url: str | None):
    """Set HuggingFace mirror endpoint. Also updates HF_ENDPOINT env var
    and patches huggingface_hub's cached ENDPOINT constant."""
    _runtime_config["hf_mirror"] = url
    if url:
        os.environ["HF_ENDPOINT"] = url
    else:
        os.environ.pop("HF_ENDPOINT", None)
    # huggingface_hub caches ENDPOINT at import time; patch the live constant
    try:
        import huggingface_hub.constants as hf_constants
        hf_constants.ENDPOINT = url or "https://huggingface.co"
    except ImportError:
        pass


def get_hf_mirror() -> str | None:
    return _runtime_config.get("hf_mirror")
