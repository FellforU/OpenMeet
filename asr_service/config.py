import os
from pathlib import Path

# Base directories
PROJECT_ROOT = Path(__file__).parent.parent
MODELS_DIR = PROJECT_ROOT / "models"
DATA_DIR = PROJECT_ROOT / "data"

# Server config
HOST = "127.0.0.1"
PORT = 18090

# Supported engines
AVAILABLE_ENGINES = ["whisper", "qwen3", "paraformer", "openai-whisper", "alibaba-asr"]
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
    "model_cache_dir": None,
    "hf_mirror": None,
}


def set_app_data_dir(path: str):
    _runtime_config["app_data_dir"] = path
    _runtime_config["sqlite_db_path"] = f"{path}/openmeet.db"
    _runtime_config["lance_db_path"] = f"{path}/lance"


def get_sqlite_path() -> str | None:
    return _runtime_config["sqlite_db_path"]


def get_lance_path() -> str | None:
    return _runtime_config["lance_db_path"]


def set_model_cache_dir(path: str | None):
    """Set runtime model cache directory. Also updates env vars for libraries."""
    _runtime_config["model_cache_dir"] = path
    if path:
        os.environ["HF_HUB_CACHE"] = path
        os.environ["MODELSCOPE_CACHE"] = path
    else:
        os.environ.pop("HF_HUB_CACHE", None)
        os.environ.pop("MODELSCOPE_CACHE", None)


def get_model_cache_dir() -> str | None:
    return _runtime_config["model_cache_dir"]


def set_hf_mirror(url: str | None):
    """Set HuggingFace mirror endpoint. Also updates HF_ENDPOINT env var."""
    _runtime_config["hf_mirror"] = url
    if url:
        os.environ["HF_ENDPOINT"] = url
    else:
        os.environ.pop("HF_ENDPOINT", None)


def get_hf_mirror() -> str | None:
    return _runtime_config.get("hf_mirror")
