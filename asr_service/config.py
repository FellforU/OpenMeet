import logging
import os
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
# Qwen3-Embedding-0.6B：2026 年中文本地 embedding 性价比首选
EMBEDDING_MODEL = "Qwen/Qwen3-Embedding-0.6B"
CHUNK_SIZE = 500
CHUNK_OVERLAP = 50

# Runtime config (set by frontend on startup)
_runtime_config = {
    "app_data_dir": None,
    "sqlite_db_path": None,
    "lance_db_path": None,
    "cache_dir": None,           # Root cache directory for all types
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


def set_cache_dir(path: str | None):
    """Set root cache directory. Models live under {cacheDir}/models/.

    模型下载统一走 ModelScope（见 services/model_source.py）：
    - model_source 管理的模型放在 models/ms/{org}__{name}/
    - Paraformer 等 funasr 系模型经 MODELSCOPE_CACHE 环境变量落在 models/ 下
    """
    _runtime_config["cache_dir"] = path
    if path:
        models_dir = Path(path) / CACHE_SUBDIR_MODELS
        models_dir.mkdir(parents=True, exist_ok=True)
        os.environ["MODELSCOPE_CACHE"] = str(models_dir)
    else:
        os.environ.pop("MODELSCOPE_CACHE", None)


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


