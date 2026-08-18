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


# Map short model sizes to ModelScope model IDs (Qwen 官方同步仓库)
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
        local_path = self.get_model_path(model_size)
        if not local_path:
            raise RuntimeError(
                f"Model '{model_size}' not downloaded. "
                "Download it in Settings first."
            )

        def _load():
            import torch

            has_cuda = torch.cuda.is_available()
            kwargs: dict = {
                "dtype": torch.bfloat16 if has_cuda else torch.float32,
            }
            # For models that fit on a single GPU (<= 8GB in bfloat16),
            # avoid device_map="auto" — accelerate reserves 90% VRAM for
            # model placement leaving only 10% for inference buffers,
            # which causes OOM on 8GB GPUs.  Load directly to CUDA instead.
            if has_cuda:
                kwargs["device_map"] = "cuda:0"
            return QwenASR.from_pretrained(local_path, **kwargs)

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

    def is_model_downloaded(self, model_size: str) -> bool:
        """已下载判定：以魔搭下载目录的完整性标记为准。"""
        if model_size not in self.SUPPORTED_SIZES:
            return False
        from asr_service.services import model_source

        return model_source.is_downloaded(MODEL_MAP[model_size])

    def get_model_path(self, model_size: str) -> Optional[str]:
        """Return the local path for a downloaded model (ModelScope dir)."""
        if model_size not in self.SUPPORTED_SIZES:
            return None
        from asr_service.services import model_source

        return model_source.local_path(MODEL_MAP[model_size])

    def _fetch_actual_model_size(self, model_size: str) -> int:
        """Fetch actual model size from the ModelScope API."""
        from asr_service.services import model_source

        total = model_source.fetch_repo_size_sync(MODEL_MAP[model_size])
        if total > 0:
            self._actual_sizes[model_size] = total
            return total
        return self.ESTIMATED_SIZES.get(model_size, 0)

    def estimated_size_bytes(self, model_size: str) -> int:
        """Return estimated download size in bytes."""
        # Use cached actual size if available
        if model_size in self._actual_sizes:
            return self._actual_sizes[model_size]
        return self.ESTIMATED_SIZES.get(model_size, 0)

    def get_download_dir(self, model_size: str) -> str | None:
        """Return the expected download directory (even while downloading)."""
        if model_size not in self.SUPPORTED_SIZES:
            return None
        from asr_service.services import model_source
        return str(model_source.ms_model_dir(MODEL_MAP[model_size]))

    async def download_model(self, model_size: str) -> str:
        """Download model files without keeping in memory (via ModelScope)."""
        if model_size not in self.SUPPORTED_SIZES:
            raise ValueError(f"Unsupported model size: {model_size}")

        from asr_service.services import model_source

        import logging
        logger = logging.getLogger(__name__)

        model_id = MODEL_MAP[model_size]
        actual_size = await asyncio.to_thread(self._fetch_actual_model_size, model_size)
        logger.info(
            "开始下载模型 %s（约 %.2f GB，来源 ModelScope）",
            model_id, actual_size / 1_000_000_000,
        )
        return await model_source.download(model_id)

    # Maximum chunk duration in seconds for GPU-safe inference.
    # 16-minute audio with 1.7B model needs ~9.75 GiB for attention —
    # splitting into 30-second chunks keeps peak VRAM under 4 GiB.
    MAX_CHUNK_SECONDS = 30

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
            import wave as wave_mod

            # Read audio metadata to decide chunking
            try:
                with wave_mod.open(audio.file_path, "rb") as wf:
                    sr = wf.getframerate()
                    n_channels = wf.getnchannels()
                    n_frames = wf.getnframes()
                    sampwidth = wf.getsampwidth()
            except Exception:
                # Not a WAV or can't read — fall back to single-shot
                return self._transcribe_single(
                    model_ref, audio.file_path, language, apply_t2s,
                )

            total_duration = n_frames / sr
            max_chunk_sec = self.MAX_CHUNK_SECONDS

            # Short audio — process in one shot
            if total_duration <= max_chunk_sec:
                return self._transcribe_single(
                    model_ref, audio.file_path, language, apply_t2s,
                )

            # Long audio — split into chunks to avoid OOM
            import logging
            import struct
            import tempfile
            import torch

            logger = logging.getLogger(__name__)
            chunk_frames = max_chunk_sec * sr
            num_chunks = (n_frames + chunk_frames - 1) // chunk_frames
            logger.info(
                "Audio %.1fs exceeds %ds limit, splitting into %d chunks",
                total_duration, max_chunk_sec, num_chunks,
            )

            # Read all raw PCM data
            with wave_mod.open(audio.file_path, "rb") as wf:
                raw_data = wf.readframes(n_frames)

            bytes_per_frame = n_channels * sampwidth
            all_segments = []

            for i in range(num_chunks):
                start_frame = i * chunk_frames
                end_frame = min((i + 1) * chunk_frames, n_frames)
                start_byte = start_frame * bytes_per_frame
                end_byte = end_frame * bytes_per_frame
                chunk_data = raw_data[start_byte:end_byte]
                chunk_start_sec = start_frame / sr

                # Write chunk to temp WAV
                # Close the handle immediately — on Windows the file
                # stays locked while NamedTemporaryFile is open.
                tmp = tempfile.NamedTemporaryFile(
                    suffix=".wav", delete=False, prefix="qwen3_chunk_",
                )
                tmp_path = tmp.name
                tmp.close()
                with wave_mod.open(tmp_path, "wb") as wf:
                    wf.setnchannels(n_channels)
                    wf.setsampwidth(sampwidth)
                    wf.setframerate(sr)
                    wf.writeframes(chunk_data)

                chunk_end_sec = end_frame / sr

                try:
                    chunk_segs = self._transcribe_single(
                        model_ref, tmp_path, language, apply_t2s,
                    )
                    # Assign timestamps based on chunk position.
                    # Qwen3-ASR returns start=0/end=0 (no timestamps),
                    # so we use the chunk time range instead.
                    for seg in chunk_segs:
                        seg_start = seg.start if seg.start > 0 or seg.end > 0 else 0.0
                        seg_end = seg.end if seg.end > 0 else (chunk_end_sec - chunk_start_sec)
                        all_segments.append(
                            Segment(
                                start=round(chunk_start_sec + seg_start, 3),
                                end=round(chunk_start_sec + seg_end, 3),
                                text=seg.text,
                            )
                        )
                finally:
                    Path(tmp_path).unlink(missing_ok=True)

                # Free GPU cache between chunks
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()

                if on_progress:
                    on_progress((i + 1) / num_chunks)

            return all_segments

        return await asyncio.to_thread(_transcribe)

    @staticmethod
    def _transcribe_single(
        model, audio_path: str, language, apply_t2s: bool,
    ) -> list[Segment]:
        """Transcribe a single audio file (must be short enough for GPU memory)."""
        results = model.transcribe(audio=audio_path, language=language)

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
