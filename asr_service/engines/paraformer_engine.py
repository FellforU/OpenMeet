"""ASR engine wrapping FunASR Paraformer."""

import asyncio
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
    "paraformer-large": "iic/speech_paraformer-large_asr_nat-zh-cn-16k-common",
    "paraformer-large-vad-punc": "iic/speech_paraformer-large-vad-punc_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    "paraformer-large-vad-punc-spk": "iic/speech_paraformer-large-vad-punc-spk_asr_nat-zh-cn",
    "paraformer-online": "iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-online",
}

# Local model directory mapping (from meeting/models/)
LOCAL_MODEL_DIRS = {
    "paraformer-large": "speech_paraformer-large_asr_nat-zh-cn-16k-common",
    "paraformer-large-vad-punc": "speech_paraformer-large-vad-punc_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    "paraformer-large-vad-punc-spk": "speech_paraformer-large-vad-punc-spk_asr_nat-zh-cn",
    "paraformer-online": "speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-online",
}


class ParaformerEngine:
    """ASR engine wrapping FunASR Paraformer (non-autoregressive, fast Chinese ASR)."""

    SUPPORTED_SIZES = list(MODEL_MAP.keys())

    def __init__(self):
        self._model = None
        self._model_size: Optional[str] = None

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

    async def load_model(self, model_size: str = "paraformer-large") -> None:
        if model_size not in self.SUPPORTED_SIZES:
            raise ValueError(f"Unsupported model size: {model_size}")
        if self._model and self._model_size == model_size:
            return

        await self.unload_model()

        AM = _ensure_automodel()
        model_path = self._resolve_model_path(model_size)

        def _load():
            return AM(model=model_path)

        self._model = await asyncio.to_thread(_load)
        self._model_size = model_size

    async def unload_model(self) -> None:
        if self._model:
            del self._model
            self._model = None
            self._model_size = None

    def is_loaded(self) -> bool:
        return self._model is not None

    def is_model_downloaded(self, model_size: str) -> bool:
        """Check if model files exist locally or in ModelScope cache."""
        if model_size not in self.SUPPORTED_SIZES:
            return False
        # Check local model directories first
        local_dir = LOCAL_MODEL_DIRS.get(model_size)
        if local_dir:
            local_path = config.PROJECT_ROOT / "meeting" / "models" / local_dir
            if local_path.exists():
                return True
            local_path = config.MODELS_DIR / local_dir
            if local_path.exists():
                return True
        # Check ModelScope cache
        modelscope_cache = Path.home() / ".cache" / "modelscope" / "hub"
        model_id = MODEL_MAP.get(model_size, "")
        if model_id.startswith("iic/"):
            cache_dir = modelscope_cache / "iic" / model_id.split("/", 1)[1]
            return cache_dir.exists()
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
        # Check ModelScope cache
        modelscope_cache = Path.home() / ".cache" / "modelscope" / "hub"
        model_id = MODEL_MAP.get(model_size, "")
        if model_id.startswith("iic/"):
            cache_dir = modelscope_cache / "iic" / model_id.split("/", 1)[1]
            if cache_dir.exists():
                return str(cache_dir)
        return None

    async def download_model(self, model_size: str) -> str:
        """Download model files without keeping in memory."""
        if model_size not in self.SUPPORTED_SIZES:
            raise ValueError(f"Unsupported model size: {model_size}")

        # Skip if already available locally
        if self.is_model_downloaded(model_size):
            return self._resolve_model_path(model_size)

        model_id = MODEL_MAP[model_size]

        def _download():
            from modelscope.hub.snapshot_download import snapshot_download
            return snapshot_download(model_id)

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
