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
        "qwen3-asr-0.6B": 1_240_000_000,  # ~1.24 GB (实际下载大小)
        "qwen3-asr-1.7B": 3_500_000_000,   # ~3.5 GB (估算值)
    }

    def __init__(self):
        self._model = None
        self._model_size: Optional[str] = None
        # Cache for actual model sizes fetched from HuggingFace
        self._actual_sizes: dict[str, int] = {}

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
        # When model is already downloaded, pass local snapshot path directly
        # so both AutoModel and AutoProcessor load offline without network requests
        local_path = self.get_model_path(model_size) if self.is_model_downloaded(model_size) else None

        def _load():
            import logging
            import torch

            logger = logging.getLogger(__name__)
            has_cuda = torch.cuda.is_available()
            dtype = torch.bfloat16 if has_cuda else torch.float32

            kwargs: dict = {"dtype": dtype}

            # For models that fit on a single GPU (<= 8GB in bfloat16),
            # avoid device_map="auto" — accelerate reserves 90% VRAM for
            # model placement leaving only 10% for inference buffers,
            # which causes OOM on 8GB GPUs.  Load directly to CUDA instead.
            if has_cuda:
                kwargs["device_map"] = "cuda:0"

            # Strategy 1: load from local snapshot path (offline, no network)
            if local_path:
                try:
                    return QwenASR.from_pretrained(local_path, **kwargs)
                except OSError as e:
                    logger.warning(
                        "Failed to load from local path %s: %s, falling back to model_id",
                        local_path, e, exc_info=True,
                    )

            # Strategy 2: load via model_id with cache_dir (HuggingFace resolves path)
            kwargs["cache_dir"] = cache_dir
            return QwenASR.from_pretrained(model_id, **kwargs)

        self._model = await asyncio.to_thread(_load)
        self._model_size = model_size

    async def unload_model(self) -> None:
        if self._model:
            del self._model
            self._model = None
            self._model_size = None
            try:
                import gc
                gc.collect()
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass

    def is_loaded(self) -> bool:
        return self._model is not None

    def _get_hf_cache_dir(self, model_size: str) -> Path:
        """Return the HuggingFace cache directory for a model."""
        model_id = MODEL_MAP.get(model_size, "")
        return _get_hf_cache() / f"models--{model_id.replace('/', '--')}"

    def is_model_downloaded(self, model_size: str) -> bool:
        """Check if model exists in HuggingFace cache with actual model files."""
        import logging
        _log = logging.getLogger(__name__)
        cache_dir = self._get_hf_cache_dir(model_size)
        snapshots_dir = cache_dir / "snapshots"
        _log.info("Qwen3 model check: %s → cache_dir=%s, exists=%s, snapshots_exists=%s",
                  model_size, cache_dir, cache_dir.exists(), snapshots_dir.exists())
        if cache_dir.exists():
            try:
                children = list(cache_dir.iterdir())
                _log.info("  cache_dir children: %s", [c.name for c in children])
            except OSError:
                pass
        if not snapshots_dir.exists():
            return False
        try:
            for snapshot in snapshots_dir.iterdir():
                if not snapshot.is_dir():
                    continue
                # Verify snapshot has actual model files (config.json, *.safetensors, etc.)
                has_config = (snapshot / "config.json").exists()
                has_weights = any(snapshot.glob("*.safetensors")) or any(snapshot.glob("*.bin"))
                _log.info("  snapshot %s: config=%s, weights=%s", snapshot.name, has_config, has_weights)
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

    def _fetch_actual_model_size(self, model_size: str) -> int:
        """Fetch actual model size from HuggingFace API."""
        import os
        from huggingface_hub import HfApi

        model_id = MODEL_MAP[model_size]
        try:
            hf_endpoint = os.environ.get("HF_ENDPOINT", "https://huggingface.co")
            # Remove trailing slash if present
            if hf_endpoint.endswith("/"):
                hf_endpoint = hf_endpoint[:-1]

            api = HfApi(endpoint=hf_endpoint)
            info = api.model_info(model_id, token=False)
            total = 0
            for sibling in info.siblings:
                if sibling.size:
                    total += sibling.size
            self._actual_sizes[model_size] = total
            return total
        except Exception:
            # Fall back to estimated size if fetch fails
            return self.ESTIMATED_SIZES.get(model_size, 0)

    def estimated_size_bytes(self, model_size: str) -> int:
        """Return estimated download size in bytes."""
        # Use cached actual size if available
        if model_size in self._actual_sizes:
            return self._actual_sizes[model_size]
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

        import logging
        import os

        logger = logging.getLogger(__name__)

        # Enable huggingface_hub progress bars
        os.environ["HF_HUB_ENABLE_PROGRESS_BARS"] = "1"

        # Show which endpoint is being used
        hf_endpoint = os.environ.get("HF_ENDPOINT", "https://huggingface.co")
        # Ensure endpoint ends with /
        if not hf_endpoint.endswith("/"):
            hf_endpoint += "/"

        # Fetch actual model size from HuggingFace API
        actual_size = await asyncio.to_thread(self._fetch_actual_model_size, model_size)
        logger.info("模型实际大小: %s", f"{actual_size / 1_000_000_000:.2f} GB")

        logger.info("=== 开始下载模型 ===")
        logger.info("模型ID: %s", model_id)
        logger.info("下载地址: %s", hf_endpoint)
        logger.info("缓存目录: %s", cache_dir)
        logger.info("提示: 如果下载缓慢，请在设置中启用 HuggingFace 镜像 (hf-mirror.com)")

        def _download():
            from huggingface_hub import snapshot_download

            return snapshot_download(
                model_id,
                cache_dir=cache_dir,
                endpoint=hf_endpoint,
            )

        path = await asyncio.to_thread(_download)
        logger.info("模型下载完成: %s", path)
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
