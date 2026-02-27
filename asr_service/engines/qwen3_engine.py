"""ASR engine wrapping Qwen3-ASR (FunASR AutoModel)."""

import asyncio
from pathlib import Path
from typing import Optional, Callable

from asr_service.engines.base import AudioInput, EngineCapabilities
from asr_service.models.job import Segment

MODELSCOPE_CACHE = Path.home() / ".cache" / "modelscope" / "hub"


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


class Qwen3Engine:
    """ASR engine wrapping Qwen3-ASR via FunASR AutoModel."""

    SUPPORTED_SIZES = [
        "qwen3-asr-0.6B",
        "qwen3-asr-1.7B",
    ]

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
            supports_timestamps=True,
            supports_diarization=False,
            model_sizes=self.SUPPORTED_SIZES,
        )

    async def load_model(self, model_size: str = "qwen3-asr-0.6B") -> None:
        if model_size not in self.SUPPORTED_SIZES:
            raise ValueError(f"Unsupported model size: {model_size}")
        if self._model and self._model_size == model_size:
            return

        await self.unload_model()

        AM = _ensure_automodel()

        def _load():
            return AM(
                model=f"iic/{model_size}",
                device="auto",
            )

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
        """Check if model exists in ModelScope cache."""
        cache_dir = MODELSCOPE_CACHE / "iic" / model_size
        return cache_dir.exists()

    async def download_model(self, model_size: str) -> str:
        """Download model files without keeping in memory."""
        if model_size not in self.SUPPORTED_SIZES:
            raise ValueError(f"Unsupported model size: {model_size}")

        AM = _ensure_automodel()

        def _download():
            model = AM(model=f"iic/{model_size}", device="cpu")
            del model
            return str(MODELSCOPE_CACHE / "iic" / model_size)

        return await asyncio.to_thread(_download)

    async def transcribe(
        self,
        audio: AudioInput,
        on_progress: Optional[Callable] = None,
    ) -> list[Segment]:
        if not self._model:
            raise RuntimeError("Model not loaded. Call load_model() first.")

        model_ref = self._model
        language = audio.language if audio.language and audio.language != "auto" else None

        def _transcribe():
            kwargs = {"input": audio.file_path}
            if language:
                kwargs["language"] = language

            results = model_ref.generate(**kwargs)

            segments = []
            if isinstance(results, list):
                for item in results:
                    text = item.get("text", "")
                    timestamps = item.get("timestamp", [])
                    if timestamps and len(timestamps) > 0:
                        ts = timestamps[0]
                        start = float(ts[0]) if len(ts) > 0 else 0.0
                        end = float(ts[1]) if len(ts) > 1 else start
                    else:
                        start = 0.0
                        end = 0.0

                    segments.append(
                        Segment(
                            start=round(start, 3),
                            end=round(end, 3),
                            text=text.strip(),
                        )
                    )
            return segments

        return await asyncio.to_thread(_transcribe)
