"""ASR engine for user-provided HuggingFace / ModelScope models.

Uses ``transformers.pipeline("automatic-speech-recognition")`` to load and
run any compatible model the user registers via the frontend.
"""

import asyncio
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Callable

from asr_service.engines.base import AudioInput, EngineCapabilities
from asr_service.models.job import Segment

logger = logging.getLogger(__name__)


@dataclass
class CustomModelConfig:
    id: str                        # unique key (used as model_size)
    name: str                      # display name
    platform: str                  # "huggingface" | "modelscope"
    model_id: str                  # repo ID (e.g. "openai/whisper-large-v3-turbo")
    mirror_url: str | None = None  # per-model mirror (overrides global)
    vram_gb: float = 2.0           # estimated VRAM in GB


def _get_hf_cache() -> Path:
    """Return the HuggingFace cache directory, respecting runtime config."""
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


def _get_ms_cache() -> Path:
    """Return the ModelScope cache directory."""
    from asr_service.config import get_model_cache_dir
    runtime_dir = get_model_cache_dir()
    if runtime_dir:
        return Path(runtime_dir).resolve()
    env_cache = os.environ.get("MODELSCOPE_CACHE")
    if env_cache:
        return Path(env_cache).resolve()
    return Path.home() / ".cache" / "modelscope"


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

    def _get_hf_cache_dir(self, model_size: str) -> Path | None:
        """Return the HF cache directory for a given model config."""
        cfg = self._configs.get(model_size)
        if not cfg or cfg.platform != "huggingface":
            return None
        return _get_hf_cache() / f"models--{cfg.model_id.replace('/', '--')}"

    def _get_ms_cache_dir(self, model_size: str) -> Path | None:
        """Return the ModelScope cache directory for a given model config."""
        cfg = self._configs.get(model_size)
        if not cfg or cfg.platform != "modelscope":
            return None
        return _get_ms_cache() / cfg.model_id.replace("/", os.sep)

    def is_model_downloaded(self, model_size: str) -> bool:
        """Check if model files exist in the cache."""
        cfg = self._configs.get(model_size)
        if not cfg:
            return False

        if cfg.platform == "huggingface":
            cache_dir = self._get_hf_cache_dir(model_size)
            if not cache_dir:
                return False
            snapshots_dir = cache_dir / "snapshots"
            if not snapshots_dir.exists():
                return False
            try:
                for snapshot in snapshots_dir.iterdir():
                    if not snapshot.is_dir():
                        continue
                    has_config = (snapshot / "config.json").exists()
                    has_weights = (
                        any(snapshot.glob("*.safetensors"))
                        or any(snapshot.glob("*.bin"))
                    )
                    if has_config or has_weights:
                        return True
            except OSError:
                pass
            return False

        if cfg.platform == "modelscope":
            cache_dir = self._get_ms_cache_dir(model_size)
            if not cache_dir or not cache_dir.exists():
                return False
            has_config = (cache_dir / "config.json").exists() or (cache_dir / "configuration.json").exists()
            has_weights = (
                any(cache_dir.glob("*.safetensors"))
                or any(cache_dir.glob("*.bin"))
            )
            return has_config or has_weights

        return False

    def get_model_path(self, model_size: str) -> str | None:
        """Return the local path for a downloaded model."""
        cfg = self._configs.get(model_size)
        if not cfg:
            return None

        if cfg.platform == "huggingface":
            cache_dir = self._get_hf_cache_dir(model_size)
            if not cache_dir:
                return None
            snapshots_dir = cache_dir / "snapshots"
            if snapshots_dir.exists():
                try:
                    subdirs = sorted(
                        snapshots_dir.iterdir(),
                        key=lambda p: p.stat().st_mtime,
                        reverse=True,
                    )
                    if subdirs:
                        return str(subdirs[0])
                except OSError:
                    pass
            return None

        if cfg.platform == "modelscope":
            cache_dir = self._get_ms_cache_dir(model_size)
            if cache_dir and cache_dir.exists():
                return str(cache_dir)
            return None

        return None

    def get_download_dir(self, model_size: str) -> str | None:
        """Return the expected download directory (even while downloading)."""
        cfg = self._configs.get(model_size)
        if not cfg:
            return None

        if cfg.platform == "huggingface":
            d = self._get_hf_cache_dir(model_size)
            return str(d) if d else None

        if cfg.platform == "modelscope":
            d = self._get_ms_cache_dir(model_size)
            return str(d) if d else None

        return None

    def estimated_size_bytes(self, model_size: str) -> int:
        """Rough estimate: vram_gb * 2 * 1 GB."""
        cfg = self._configs.get(model_size)
        if not cfg:
            return 0
        return int(cfg.vram_gb * 2 * 1_073_741_824)

    async def download_model(self, model_size: str) -> str:
        """Download model files without loading into memory."""
        cfg = self._configs.get(model_size)
        if not cfg:
            raise ValueError(f"Unknown custom model: {model_size}")

        if cfg.platform == "huggingface":
            cache_dir = str(_get_hf_cache())
            mirror_url = cfg.mirror_url or None

            def _download_hf():
                from huggingface_hub import snapshot_download
                kwargs: dict = {
                    "repo_id": cfg.model_id,
                    "cache_dir": cache_dir,
                }
                if mirror_url:
                    kwargs["endpoint"] = mirror_url
                return snapshot_download(**kwargs)

            path = await asyncio.to_thread(_download_hf)
            return str(path)

        if cfg.platform == "modelscope":
            cache_dir = str(_get_ms_cache())

            def _download_ms():
                from modelscope.hub.snapshot_download import snapshot_download
                return snapshot_download(cfg.model_id, cache_dir=cache_dir)

            path = await asyncio.to_thread(_download_ms)
            return str(path)

        raise ValueError(f"Unsupported platform: {cfg.platform}")
