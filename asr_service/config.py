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
