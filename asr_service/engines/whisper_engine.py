import asyncio
from typing import Optional, Callable

from faster_whisper import WhisperModel

from asr_service.engines.base import AudioInput, EngineCapabilities
from asr_service.models.job import Segment


class WhisperEngine:
    """ASR engine wrapping faster-whisper."""

    SUPPORTED_SIZES = ["tiny", "base", "small", "medium", "large-v3"]

    def __init__(self):
        self._model: Optional[WhisperModel] = None
        self._model_size: Optional[str] = None

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

        def _load():
            return WhisperModel(
                model_size,
                device="auto",
                compute_type="auto",
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
            segments_gen, info = model_ref.transcribe(
                audio.file_path,
                language=language,
                beam_size=5,
                word_timestamps=True,
                vad_filter=True,
            )
            results = []
            for seg in segments_gen:
                results.append(
                    Segment(
                        start=round(seg.start, 3),
                        end=round(seg.end, 3),
                        text=seg.text.strip(),
                        confidence=round(seg.avg_logprob, 3) if seg.avg_logprob else None,
                    )
                )
            return results

        return await asyncio.to_thread(_transcribe)
