"""ASR engine for user-provided models (ModelScope repos).

Uses ``transformers.pipeline("automatic-speech-recognition")`` to load and
run any compatible model the user registers via the frontend.
下载统一走 ModelScope（魔搭）国内源，model_id 填魔搭仓库 ID。
"""

import asyncio
import logging
from dataclasses import dataclass
from typing import Optional, Callable

from asr_service.engines.base import AudioInput, EngineCapabilities
from asr_service.models.job import Segment

logger = logging.getLogger(__name__)


@dataclass
class CustomModelConfig:
    id: str                        # unique key (used as model_size)
    name: str                      # display name
    platform: str = "modelscope"   # 保留字段（历史配置兼容），一律按魔搭处理
    model_id: str = ""             # ModelScope repo ID (e.g. "Qwen/Qwen3-ASR-0.6B")
    mirror_url: str | None = None  # 保留字段（不再使用）
    vram_gb: float = 2.0           # estimated VRAM in GB


class CustomEngine:
    """ASR engine that loads user-registered models via transformers pipeline."""

    def __init__(self):
        self._model = None
        self._model_size: str | None = None
        self._configs: dict[str, CustomModelConfig] = {}

    # ------------------------------------------------------------------
    # Configuration management
    # ------------------------------------------------------------------

    def register_models(self, configs: list[CustomModelConfig]):
        """Replace the registered model configs (called by frontend on startup)."""
        self._configs = {c.id: c for c in configs}
        logger.info("Custom engine: registered %d model(s)", len(configs))

    def get_registered_models(self) -> list[CustomModelConfig]:
        return list(self._configs.values())

    @property
    def SUPPORTED_SIZES(self) -> list[str]:
        return list(self._configs.keys())

    # ------------------------------------------------------------------
    # ASREngine protocol
    # ------------------------------------------------------------------

    async def get_capabilities(self) -> EngineCapabilities:
        return EngineCapabilities(
            name="custom",
            supported_languages=["auto"],
            supports_streaming=False,
            supports_timestamps=True,
            supports_diarization=False,
            model_sizes=self.SUPPORTED_SIZES,
        )

    async def load_model(self, model_size: str) -> None:
        cfg = self._configs.get(model_size)
        if not cfg:
            raise ValueError(f"Unknown custom model: {model_size}")

        if self._model and self._model_size == model_size:
            return

        await self.unload_model()

        local_path = self.get_model_path(model_size)
        if not local_path:
            raise RuntimeError(
                f"Model '{cfg.model_id}' not downloaded. Download it first."
            )

        def _load():
            import torch
            import transformers

            has_cuda = torch.cuda.is_available()
            dtype = torch.float16 if has_cuda else torch.float32

            pipe = transformers.pipeline(
                "automatic-speech-recognition",
                model=local_path,
                device_map="auto" if has_cuda else None,
                torch_dtype=dtype,
            )
            return pipe

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

    async def transcribe(
        self,
        audio: AudioInput,
        on_progress: Optional[Callable] = None,
    ) -> list[Segment]:
        if not self._model:
            raise RuntimeError("Model not loaded. Call load_model() first.")

        pipe = self._model

        def _run():
            result = pipe(audio.file_path, return_timestamps=True)
            segments: list[Segment] = []

            chunks = result.get("chunks", [])
            if chunks:
                for chunk in chunks:
                    ts = chunk.get("timestamp", (0.0, 0.0))
                    start = ts[0] if ts[0] is not None else 0.0
                    end = ts[1] if ts[1] is not None else start
                    text = chunk.get("text", "").strip()
                    if text:
                        segments.append(Segment(
                            start=round(start, 3),
                            end=round(end, 3),
                            text=text,
                        ))
            else:
                # Fallback: single segment from full text
                text = result.get("text", "").strip()
                if text:
                    segments.append(Segment(start=0.0, end=0.0, text=text))

            return segments

        return await asyncio.to_thread(_run)

    # ------------------------------------------------------------------
    # Download / path helpers
    # ------------------------------------------------------------------

    def is_model_downloaded(self, model_size: str) -> bool:
        cfg = self._configs.get(model_size)
        if not cfg:
            return False
        from asr_service.services import model_source

        return model_source.is_downloaded(cfg.model_id)

    def get_model_path(self, model_size: str) -> str | None:
        cfg = self._configs.get(model_size)
        if not cfg:
            return None
        from asr_service.services import model_source

        return model_source.local_path(cfg.model_id)

    def get_download_dir(self, model_size: str) -> str | None:
        """Return the expected download directory (even while downloading)."""
        cfg = self._configs.get(model_size)
        if not cfg:
            return None
        from asr_service.services import model_source

        return str(model_source.ms_model_dir(cfg.model_id))

    def estimated_size_bytes(self, model_size: str) -> int:
        """Rough estimate: vram_gb * 2 * 1 GB."""
        cfg = self._configs.get(model_size)
        if not cfg:
            return 0
        return int(cfg.vram_gb * 2 * 1_073_741_824)

    async def download_model(self, model_size: str) -> str:
        """Download model files without loading into memory (via ModelScope)."""
        cfg = self._configs.get(model_size)
        if not cfg:
            raise ValueError(f"Unknown custom model: {model_size}")
        from asr_service.services import model_source

        return await model_source.download(cfg.model_id)
