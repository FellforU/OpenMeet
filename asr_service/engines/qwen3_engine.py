"""ASR engine wrapping Qwen3-ASR (qwen-asr package)."""

import asyncio
import os
from pathlib import Path
from typing import Optional, Callable

from opencc import OpenCC

from asr_service.engines.base import AudioInput, EngineCapabilities
from asr_service.models.job import Segment

# Traditional-to-Simplified Chinese converter (singleton)
_t2s = OpenCC("t2s")


def _get_hf_cache() -> Path:
    """Return the HuggingFace cache directory, respecting runtime config and env vars."""
    from asr_service.config import get_model_cache_dir
    runtime_dir = get_model_cache_dir()
    if runtime_dir:
        return Path(runtime_dir).resolve()
    env_cache = os.environ.get("HF_HUB_CACHE")
    if env_cache:
        return Path(env_cache).resolve()
    env_home = os.environ.get("HF_HOME")
    if env_home:
        return Path(env_home).resolve() / "hub"
    return Path.home() / ".cache" / "huggingface" / "hub"

# Map short model sizes to HuggingFace model IDs
MODEL_MAP = {
    "qwen3-asr-0.6B": "Qwen/Qwen3-ASR-0.6B",
    "qwen3-asr-1.7B": "Qwen/Qwen3-ASR-1.7B",
}


# Lazy import to avoid hard dependency at module level
def _import_qwen3asr():
    from qwen_asr import Qwen3ASRModel
    return Qwen3ASRModel


# Module-level reference for mocking
Qwen3ASRModel = None


def _ensure_qwen3asr():
    global Qwen3ASRModel
    if Qwen3ASRModel is None:
        Qwen3ASRModel = _import_qwen3asr()
    return Qwen3ASRModel


class Qwen3Engine:
    """ASR engine wrapping Qwen3-ASR via qwen-asr package."""

    SUPPORTED_SIZES = list(MODEL_MAP.keys())
    ESTIMATED_SIZES: dict[str, int] = {
        "qwen3-asr-0.6B": 1_200_000_000,
        "qwen3-asr-1.7B": 3_500_000_000,
    }

    def __init__(self):
        self._model = None
        self._model_size: Optional[str] = None

    async def get_capabilities(self) -> EngineCapabilities:
        return EngineCapabilities(
            name="qwen3",
            supported_languages=[
                "zh", "en", "ja", "ko", "yue", "wuu",
                "min_nan", "gan", "hakka", "xiang",
                "auto",
            ],
            supports_streaming=True,
            supports_timestamps=False,
            supports_diarization=False,
            model_sizes=self.SUPPORTED_SIZES,
        )

    async def load_model(self, model_size: str = "qwen3-asr-0.6B") -> None:
        if model_size not in self.SUPPORTED_SIZES:
            raise ValueError(f"Unsupported model size: {model_size}")
        if self._model and self._model_size == model_size:
            return

        await self.unload_model()

        QwenASR = _ensure_qwen3asr()
        model_id = MODEL_MAP[model_size]
        cache_dir = str(_get_hf_cache())
        # Use local files only when the model is already downloaded
        use_local = self.is_model_downloaded(model_size)

        def _load():
            import torch
            dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
            kwargs = {
                "dtype": dtype,
                "device_map": "auto",
                "cache_dir": cache_dir,
            }
            if use_local:
                kwargs["local_files_only"] = True
            return QwenASR.from_pretrained(model_id, **kwargs)

        self._model = await asyncio.to_thread(_load)
        self._model_size = model_size

    async def unload_model(self) -> None:
        if self._model:
            del self._model
            self._model = None
            self._model_size = None

    def is_loaded(self) -> bool:
        return self._model is not None

    def _get_hf_cache_dir(self, model_size: str) -> Path:
        """Return the HuggingFace cache directory for a model."""
        model_id = MODEL_MAP.get(model_size, "")
        return _get_hf_cache() / f"models--{model_id.replace('/', '--')}"

    def is_model_downloaded(self, model_size: str) -> bool:
        """Check if model exists in HuggingFace cache with actual model files."""
        cache_dir = self._get_hf_cache_dir(model_size)
        snapshots_dir = cache_dir / "snapshots"
        if not snapshots_dir.exists():
            return False
        try:
            for snapshot in snapshots_dir.iterdir():
                if not snapshot.is_dir():
                    continue
                # Verify snapshot has actual model files (config.json, *.safetensors, etc.)
                has_config = (snapshot / "config.json").exists()
                has_weights = any(snapshot.glob("*.safetensors")) or any(snapshot.glob("*.bin"))
                if has_config or has_weights:
                    return True
            return False
        except OSError:
            return False

    def get_model_path(self, model_size: str) -> Optional[str]:
        """Return the local cache path for a downloaded model."""
        if model_size not in self.SUPPORTED_SIZES:
            return None
        cache_dir = self._get_hf_cache_dir(model_size)
        snapshots_dir = cache_dir / "snapshots"
        if snapshots_dir.exists():
            try:
                subdirs = sorted(snapshots_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
                if subdirs:
                    return str(subdirs[0])
            except OSError:
                pass
        if cache_dir.exists():
            return str(cache_dir)
        return None

    def estimated_size_bytes(self, model_size: str) -> int:
        """Return estimated download size in bytes."""
        return self.ESTIMATED_SIZES.get(model_size, 0)

    def get_download_dir(self, model_size: str) -> str | None:
        """Return the expected cache directory for a model (even while downloading)."""
        if model_size not in self.SUPPORTED_SIZES:
            return None
        cache_dir = self._get_hf_cache_dir(model_size)
        return str(cache_dir)

    async def download_model(self, model_size: str) -> str:
        """Download model files without keeping in memory."""
        if model_size not in self.SUPPORTED_SIZES:
            raise ValueError(f"Unsupported model size: {model_size}")

        model_id = MODEL_MAP[model_size]
        cache_dir = str(_get_hf_cache())

        def _download():
            from huggingface_hub import snapshot_download
            return snapshot_download(model_id, cache_dir=cache_dir)

        path = await asyncio.to_thread(_download)
        return str(path)

    async def transcribe(
        self,
        audio: AudioInput,
        on_progress: Optional[Callable] = None,
    ) -> list[Segment]:
        if not self._model:
            raise RuntimeError("Model not loaded. Call load_model() first.")

        model_ref = self._model
        language = audio.language if audio.language and audio.language != "auto" else None
        apply_t2s = language in ("zh", None)

        def _transcribe():
            results = model_ref.transcribe(
                audio=audio.file_path,
                language=language,
            )

            segments = []
            if isinstance(results, list):
                for item in results:
                    if isinstance(item, dict):
                        text = item.get("text", "")
                    else:
                        text = getattr(item, "text", None) or ""
                    text = text.strip() if text else ""
                    if text:
                        if apply_t2s:
                            text = _t2s.convert(text)
                        segments.append(
                            Segment(start=0.0, end=0.0, text=text)
                        )
            return segments

        return await asyncio.to_thread(_transcribe)
