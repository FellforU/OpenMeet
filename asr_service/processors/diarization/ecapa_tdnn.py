"""ECAPA-TDNN speaker embedding extraction.

Extracts 192-dimensional speaker embeddings per segment.
Used by voiceprint library for speaker identification.
"""

import asyncio
import logging
from typing import Optional

import numpy as np

from asr_service.models.job import Segment
from asr_service.processors.model_utils import resolve_modelscope_model

logger = logging.getLogger(__name__)

ECAPA_MODEL_DIR = "speech_eres2net_sv_zh-cn_16k-common"
MIN_SEGMENT_DURATION = 0.3


class EcapaTdnnExtractor:
    """Speaker embedding extraction using ECAPA-TDNN / ERes2Net."""

    def __init__(self):
        self._model = None

    def _resolve_model_path(self) -> Optional[str]:
        return resolve_modelscope_model(ECAPA_MODEL_DIR)

    async def load(self) -> None:
        if self._model:
            return

        model_path = self._resolve_model_path()
        if not model_path:
            logger.info("ECAPA-TDNN model not found locally, skipping")
            return

        def _load():
            try:
                import torch
                from funasr import AutoModel

                # Post-processing runs after the ASR engine is unloaded,
                # so the GPU is free to use here
                device = "cuda" if torch.cuda.is_available() else "cpu"
                return AutoModel(model=model_path, device=device)
            except Exception as e:
                logger.warning("Failed to load ECAPA-TDNN from %s: %s", model_path, e)
                return None

        self._model = await asyncio.to_thread(_load)

    def is_available(self) -> bool:
        return self._model is not None

    async def extract_embeddings(
        self,
        audio_path: str,
        segments: list[Segment],
        audio: Optional[tuple[np.ndarray, int]] = None,
    ) -> list[Optional[list[float]]]:
        """Extract one embedding per segment. Returns list aligned with segments.

        None for segments that are too short or fail extraction.
        """
        if not self._model:
            await self.load()

        if not self._model:
            return [None] * len(segments)

        model_ref = self._model

        def _extract():
            import torch

            if audio is not None:
                audio_np, sr = audio
                waveform = torch.from_numpy(audio_np).unsqueeze(0)
            else:
                from asr_service.processors.diarization.campplus import _load_audio

                waveform, sr = _load_audio(audio_path)
                if waveform.shape[0] > 1:
                    waveform = waveform.mean(dim=0, keepdim=True)
            if sr != 16000:
                import torchaudio
                waveform = torchaudio.transforms.Resample(sr, 16000)(waveform)
                sr = 16000

            audio_np = waveform.squeeze(0).numpy()
            results: list[Optional[list[float]]] = []

            for seg in segments:
                start_sample = int(seg.start * sr)
                end_sample = int(seg.end * sr)
                chunk = audio_np[start_sample:end_sample]

                if len(chunk) < int(MIN_SEGMENT_DURATION * sr):
                    results.append(None)
                    continue

                try:
                    result = model_ref.generate(input=chunk)
                    emb = _parse_embedding(result)
                    if emb is not None:
                        # L2 normalize
                        norm = np.linalg.norm(emb)
                        if norm > 0:
                            emb = emb / norm
                        results.append(emb.tolist())
                    else:
                        results.append(None)
                except Exception:
                    results.append(None)

            return results

        return await asyncio.to_thread(_extract)


def _parse_embedding(result) -> Optional[np.ndarray]:
    """Parse FunASR model output to extract embedding vector."""
    if not result:
        return None

    if isinstance(result, list) and len(result) > 0:
        item = result[0]
        if isinstance(item, dict):
            emb = item.get("spk_embedding")
            if emb is not None:
                return np.asarray(emb, dtype=np.float32).flatten()
        if isinstance(item, np.ndarray):
            return item.astype(np.float32).flatten()

    if isinstance(result, np.ndarray):
        return result.astype(np.float32).flatten()

    return None
