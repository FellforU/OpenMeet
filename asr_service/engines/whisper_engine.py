import asyncio
from pathlib import Path
from typing import Optional, Callable

import faster_whisper
from faster_whisper import WhisperModel
from opencc import OpenCC

from asr_service.engines.base import AudioInput, EngineCapabilities
from asr_service.models.job import Segment

# Traditional-to-Simplified Chinese converter (singleton)
_t2s = OpenCC("t2s")


# Whisper model size to HF repo mapping (for cache path calculation)
_WHISPER_HF_REPOS = {
    "tiny": "Systran/faster-whisper-tiny",
    "base": "Systran/faster-whisper-base",
    "small": "Systran/faster-whisper-small",
    "medium": "Systran/faster-whisper-medium",
    "large-v3": "Systran/faster-whisper-large-v3",
}


class WhisperEngine:
    """ASR engine wrapping faster-whisper."""

    SUPPORTED_SIZES = ["tiny", "base", "small", "medium", "large-v3"]
    ESTIMATED_SIZES: dict[str, int] = {
        "tiny": 150_000_000,
        "base": 290_000_000,
        "small": 950_000_000,
        "medium": 3_000_000_000,
        "large-v3": 6_000_000_000,
    }

    def __init__(self):
        self._model: Optional[WhisperModel] = None
        self._model_size: Optional[str] = None

    def _get_cache_dir(self) -> str | None:
        """Return runtime model cache directory, or None for default."""
        from asr_service.config import get_model_cache_dir
        return get_model_cache_dir()

    async def get_capabilities(self) -> EngineCapabilities:
        return EngineCapabilities(
            name="whisper",
            supported_languages=["en", "zh", "ja", "ko", "de", "fr", "es", "auto"],
            supports_streaming=False,
            supports_timestamps=True,
            supports_diarization=False,
            model_sizes=self.SUPPORTED_SIZES,
        )

    async def load_model(self, model_size: str = "base") -> None:
        if model_size not in self.SUPPORTED_SIZES:
            raise ValueError(f"Unsupported model size: {model_size}")
        if self._model and self._model_size == model_size:
            return

        await self.unload_model()

        cache_dir = self._get_cache_dir()

        def _load():
            kwargs: dict = {
                "device": "auto",
                "compute_type": "auto",
            }
            if cache_dir:
                kwargs["download_root"] = cache_dir
            return WhisperModel(model_size, **kwargs)

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
        """Check if model files exist in HuggingFace cache."""
        try:
            cache_dir = self._get_cache_dir()
            faster_whisper.download_model(
                model_size, local_files_only=True, output_dir=cache_dir
            )
            return True
        except Exception:
            return False

    def get_model_path(self, model_size: str) -> str | None:
        """Return the local cache path for a downloaded model."""
        if model_size not in self.SUPPORTED_SIZES:
            return None
        try:
            cache_dir = self._get_cache_dir()
            path = faster_whisper.download_model(
                model_size, local_files_only=True, output_dir=cache_dir
            )
            return str(path)
        except Exception:
            return None

    def estimated_size_bytes(self, model_size: str) -> int:
        """Return estimated download size in bytes."""
        return self.ESTIMATED_SIZES.get(model_size, 0)

    def get_download_dir(self, model_size: str) -> str | None:
        """Return the expected cache directory for a model (even while downloading)."""
        repo = _WHISPER_HF_REPOS.get(model_size)
        if not repo:
            return None
        cache_dir = self._get_cache_dir()
        if cache_dir:
            base = Path(cache_dir)
        else:
            base = Path.home() / ".cache" / "huggingface" / "hub"
        return str(base / f"models--{repo.replace('/', '--')}")

    async def download_model(self, model_size: str) -> str:
        """Download model files without loading into memory."""
        if model_size not in self.SUPPORTED_SIZES:
            raise ValueError(f"Unsupported model size: {model_size}")

        cache_dir = self._get_cache_dir()

        def _download():
            return faster_whisper.download_model(model_size, output_dir=cache_dir)

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
        language = audio.language if audio.language != "auto" else None

        def _transcribe():
            kwargs: dict = {
                "language": language,
                "beam_size": 5,
                "word_timestamps": True,
                "vad_filter": True,
            }
            if language == "zh":
                kwargs["initial_prompt"] = "以下是简体中文的转录内容。"

            segments_gen, info = model_ref.transcribe(audio.file_path, **kwargs)

            # Only apply T2S for Chinese — use detected language when auto
            detected_lang = language or info.language
            apply_t2s = detected_lang == "zh"

            results = []
            for seg in segments_gen:
                text = seg.text.strip()
                if apply_t2s and text:
                    text = _t2s.convert(text)
                results.append(
                    Segment(
                        start=round(seg.start, 3),
                        end=round(seg.end, 3),
                        text=text,
                        confidence=round(seg.avg_logprob, 3) if seg.avg_logprob else None,
                    )
                )
            return results

        return await asyncio.to_thread(_transcribe)
