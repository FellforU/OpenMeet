"""ASR engine wrapping FunASR Paraformer."""

import asyncio
import os
from pathlib import Path
from typing import Optional, Callable

from opencc import OpenCC

from asr_service.engines.base import AudioInput, EngineCapabilities
from asr_service.models.job import Segment
from asr_service import config

# Traditional-to-Simplified Chinese converter (singleton)
_t2s = OpenCC("t2s")


# Lazy import to avoid hard dependency at module level
def _import_automodel():
    from funasr import AutoModel
    return AutoModel


# Module-level reference for mocking
AutoModel = None


def _ensure_automodel():
    global AutoModel
    if AutoModel is None:
        AutoModel = _import_automodel()
    return AutoModel


# Map model sizes to ModelScope model IDs or local paths
MODEL_MAP = {
    "paraformer-large": "iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    "paraformer-large-vad-punc": "iic/speech_paraformer-large-vad-punc_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    "paraformer-large-vad-punc-spk": "iic/speech_paraformer-large-vad-punc-spk_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    "paraformer-online": "iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-online",
}

# Sub-model dependencies: FunASR pipeline models need VAD / punctuation / speaker sub-models
SUB_MODEL_DEPS: dict[str, dict[str, str]] = {
    "paraformer-large": {},
    "paraformer-large-vad-punc": {
        "vad_model": "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch",
        "punc_model": "iic/punc_ct-transformer_zh-cn-common-vad_realtime-vocab272727",
    },
    "paraformer-large-vad-punc-spk": {
        "vad_model": "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch",
        "punc_model": "iic/punc_ct-transformer_zh-cn-common-vad_realtime-vocab272727",
        "spk_model": "iic/speech_campplus_sv_zh-cn_16k-common",
    },
    "paraformer-online": {},
}

# Local model directory mapping (from meeting/models/)
LOCAL_MODEL_DIRS = {
    "paraformer-large": "speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    "paraformer-large-vad-punc": "speech_paraformer-large-vad-punc_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    "paraformer-large-vad-punc-spk": "speech_paraformer-large-vad-punc-spk_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    "paraformer-online": "speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-online",
}


class ParaformerEngine:
    """ASR engine wrapping FunASR Paraformer (non-autoregressive, fast Chinese ASR)."""

    SUPPORTED_SIZES = list(MODEL_MAP.keys())
    # Estimated sizes include main model + sub-models (VAD ~40MB, punc ~275MB, spk ~30MB)
    ESTIMATED_SIZES: dict[str, int] = {
        "paraformer-large": 1_100_000_000,
        "paraformer-large-vad-punc": 1_600_000_000,
        "paraformer-large-vad-punc-spk": 1_850_000_000,
        "paraformer-online": 1_100_000_000,
    }

    def __init__(self):
        self._model = None
        self._model_size: Optional[str] = None
        # Cache for actual model sizes fetched from ModelScope
        self._actual_sizes: dict[str, int] = {}

    def _get_modelscope_cache(self) -> Path:
        """Return the ModelScope cache directory, respecting runtime config and env vars."""
        from asr_service.config import get_model_cache_dir
        runtime_dir = get_model_cache_dir()
        if runtime_dir:
            return Path(runtime_dir).resolve()
        env_cache = os.environ.get("MODELSCOPE_CACHE")
        if env_cache:
            return Path(env_cache).resolve()
        return Path.home() / ".cache" / "modelscope" / "hub"

    async def get_capabilities(self) -> EngineCapabilities:
        return EngineCapabilities(
            name="paraformer",
            supported_languages=["zh", "en", "ja", "ko", "auto"],
            supports_streaming=True,
            supports_timestamps=True,
            supports_diarization=False,
            model_sizes=self.SUPPORTED_SIZES,
        )

    def _resolve_model_path(self, model_size: str) -> str:
        """Resolve to local model path if available, otherwise use remote ID."""
        local_dir = LOCAL_MODEL_DIRS.get(model_size)
        if local_dir:
            # Check meeting/models/ directory first
            local_path = config.PROJECT_ROOT / "meeting" / "models" / local_dir
            if local_path.exists():
                return str(local_path)
            # Then check models/ directory
            local_path = config.MODELS_DIR / local_dir
            if local_path.exists():
                return str(local_path)
        return MODEL_MAP[model_size]

    def _resolve_sub_model_path(self, model_id: str) -> str:
        """Resolve sub-model to local cache path if available, otherwise return remote ID."""
        if "/" not in model_id:
            return model_id
        org, name = model_id.split("/", 1)
        # Check local meeting/models/ directory
        local_path = config.PROJECT_ROOT / "meeting" / "models" / name
        if local_path.exists():
            return str(local_path)
        local_path = config.MODELS_DIR / name
        if local_path.exists():
            return str(local_path)
        # Check ModelScope cache
        cache_dir = self._get_modelscope_cache() / org / name
        if cache_dir.exists():
            return str(cache_dir)
        return model_id

    async def load_model(self, model_size: str = "paraformer-large") -> None:
        if model_size not in self.SUPPORTED_SIZES:
            raise ValueError(f"Unsupported model size: {model_size}")
        if self._model and self._model_size == model_size:
            return

        await self.unload_model()

        AM = _ensure_automodel()
        model_path = self._resolve_model_path(model_size)
        sub_deps = SUB_MODEL_DEPS.get(model_size, {})
        cache_dir = str(self._get_modelscope_cache())

        def _load():
            import torch

            kwargs: dict = {
                "model": model_path,
                "disable_update": True,
                "device": "cuda" if torch.cuda.is_available() else "cpu",
            }
            # Resolve sub-model paths (VAD, punctuation, speaker)
            for key, model_id in sub_deps.items():
                kwargs[key] = self._resolve_sub_model_path(model_id)
            # Set cache dir so any missing sub-models download to the right place
            kwargs["model_hub"] = "ms"
            kwargs["cache_dir"] = cache_dir
            return AM(**kwargs)

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

    def _has_model_files(self, path: Path) -> bool:
        """Check if a directory contains actual model files (not just empty dirs)."""
        if not path.exists():
            return False
        # ModelScope models have configuration.json; local models have config.yaml or .pb files
        marker_files = ["configuration.json", "config.yaml", "config.json"]
        for marker in marker_files:
            if (path / marker).exists():
                return True
        # Fallback: check if directory has any non-trivial files (>1KB)
        try:
            for f in path.rglob("*"):
                if f.is_file() and f.stat().st_size > 1024:
                    return True
        except OSError:
            pass
        return False

    def is_model_downloaded(self, model_size: str) -> bool:
        """Check if model files exist locally or in ModelScope cache."""
        if model_size not in self.SUPPORTED_SIZES:
            return False
        # Check local model directories first
        local_dir = LOCAL_MODEL_DIRS.get(model_size)
        if local_dir:
            local_path = config.PROJECT_ROOT / "meeting" / "models" / local_dir
            if self._has_model_files(local_path):
                return True
            local_path = config.MODELS_DIR / local_dir
            if self._has_model_files(local_path):
                return True
        # Check ModelScope cache (runtime-aware)
        modelscope_cache = self._get_modelscope_cache()
        model_id = MODEL_MAP.get(model_size, "")
        if "/" in model_id:
            org, name = model_id.split("/", 1)
            cache_dir = modelscope_cache / org / name
            return self._has_model_files(cache_dir)
        return False

    def get_model_path(self, model_size: str) -> str | None:
        """Return the local path for a downloaded model."""
        if model_size not in self.SUPPORTED_SIZES:
            return None
        # Check local model directories first
        local_dir = LOCAL_MODEL_DIRS.get(model_size)
        if local_dir:
            local_path = config.PROJECT_ROOT / "meeting" / "models" / local_dir
            if local_path.exists():
                return str(local_path)
            local_path = config.MODELS_DIR / local_dir
            if local_path.exists():
                return str(local_path)
        # Check ModelScope cache (runtime-aware)
        modelscope_cache = self._get_modelscope_cache()
        model_id = MODEL_MAP.get(model_size, "")
        if "/" in model_id:
            org, name = model_id.split("/", 1)
            cache_dir = modelscope_cache / org / name
            if cache_dir.exists():
                return str(cache_dir)
        return None

    def _fetch_actual_model_size(self, model_size: str) -> int:
        """Fetch actual model size from ModelScope API."""
        from modelscope import HubApi

        model_id = MODEL_MAP[model_size]
        try:
            api = HubApi()
            model_info = api.get_model(model_id)
            total = 0
            # Model info may contain file sizes in different formats
            # Try to get size from model info
            if hasattr(model_info, 'size') and model_info.size:
                total = model_info.size
            elif isinstance(model_info, dict) and 'size' in model_info:
                total = model_info['size']
            # If size not available, try to get from files
            else:
                # Fallback: try to get model files info
                try:
                    files_info = api.list_model_files(model_id)
                    for file_info in files_info.get('Data', {}).get('Files', []):
                        if 'Size' in file_info:
                            total += file_info['Size']
                except Exception:
                    pass

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
        model_id = MODEL_MAP.get(model_size, "")
        if "/" not in model_id:
            return None
        cache_base = self._get_modelscope_cache()
        org, name = model_id.split("/", 1)
        return str(cache_base / org / name)

    async def download_model(self, model_size: str) -> str:
        """Download model files (including sub-models) without keeping in memory."""
        if model_size not in self.SUPPORTED_SIZES:
            raise ValueError(f"Unsupported model size: {model_size}")

        # Skip if already available locally
        if self.is_model_downloaded(model_size):
            return self._resolve_model_path(model_size)

        model_id = MODEL_MAP[model_size]
        sub_deps = SUB_MODEL_DEPS.get(model_size, {})
        cache_dir = str(self._get_modelscope_cache())

        import logging
        logger = logging.getLogger(__name__)

        logger.info("=== 开始下载 Paraformer 模型 ===")
        logger.info("模型ID: %s", model_id)
        logger.info("缓存目录: %s", cache_dir)
        if sub_deps:
            logger.info("子模型: %s", list(sub_deps.keys()))

        # Fetch actual model size
        actual_size = await asyncio.to_thread(self._fetch_actual_model_size, model_size)
        logger.info("模型实际大小: %s", f"{actual_size / 1_000_000_000:.2f} GB")

        def _download():
            from modelscope import snapshot_download

            # Check for ModelScope endpoint env var (similar to HF_ENDPOINT)
            # ModelScope may not support this directly, but we'll prepare for it
            modelscope_endpoint = os.environ.get("MODELSCOPE_ENDPOINT")
            if modelscope_endpoint:
                logger.info("使用 ModelScope 端点: %s", modelscope_endpoint)

            # ModelScope SDK doesn't support progress_callback like huggingface_hub
            # It has built-in progress bar shown in console

            try:
                # Download main model
                logger.info("正在下载主模型: %s", model_id)
                path = snapshot_download(
                    model_id,
                    cache_dir=cache_dir
                )
                logger.info("主模型下载完成: %s", path)

                # Download required sub-models (VAD, punctuation, speaker)
                for key, sub_id in sub_deps.items():
                    logger.info("正在下载子模型 (%s): %s", key, sub_id)
                    snapshot_download(sub_id, cache_dir=cache_dir)
                    logger.info("子模型下载完成: %s", sub_id)

                return path
            except Exception as e:
                logger.error("模型下载失败: %s", e)
                raise RuntimeError(
                    f"下载模型失败: {e}\n"
                    f"模型ID: {model_id}\n"
                    f"请检查网络连接，或手动从 ModelScope 下载模型:\n"
                    f"https://www.modelscope.cn/models/{model_id}"
                ) from e

        return await asyncio.to_thread(_download)

    async def transcribe(
        self,
        audio: AudioInput,
        on_progress: Optional[Callable] = None,
    ) -> list[Segment]:
        if not self._model:
            raise RuntimeError("Model not loaded. Call load_model() first.")

        model_ref = self._model
        apply_t2s = not audio.language or audio.language in ("zh", "auto")

        def _transcribe():
            results = model_ref.generate(input=audio.file_path)

            segments = []
            if not isinstance(results, list) or not results:
                return segments

            for item in results:
                # Paraformer returns sentence_info for segmented results
                sentence_info = item.get("sentence_info", [])
                if sentence_info:
                    for sent in sentence_info:
                        text = sent.get("text", "").strip()
                        if apply_t2s and text:
                            text = _t2s.convert(text)
                        start_ms = sent.get("start", 0)
                        end_ms = sent.get("end", 0)
                        segments.append(
                            Segment(
                                start=round(start_ms / 1000.0, 3),
                                end=round(end_ms / 1000.0, 3),
                                text=text,
                            )
                        )
                else:
                    # Fallback: single text result
                    text = item.get("text", "").strip()
                    if apply_t2s and text:
                        text = _t2s.convert(text)
                    if text:
                        segments.append(
                            Segment(start=0.0, end=0.0, text=text)
                        )

            return segments

        return await asyncio.to_thread(_transcribe)
