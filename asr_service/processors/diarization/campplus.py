"""CAMPPlus-based speaker diarization for Chinese audio.

Uses FunASR's CAMPPlus model for speaker embedding extraction,
then clusters embeddings with cosine similarity to assign speaker labels.
"""

import asyncio
import logging
from typing import Optional

import numpy as np

from asr_service.models.job import Segment
from asr_service.processors.model_utils import resolve_modelscope_model

logger = logging.getLogger(__name__)

# Model path from meeting/models/
CAMPPLUS_MODEL_DIR = "speech_campplus_sv_zh-cn_16k-common"

# Minimum segment duration (seconds) for embedding extraction
MIN_SEGMENT_DURATION = 0.3
# Cosine similarity threshold for same-speaker grouping
SIMILARITY_THRESHOLD = 0.65


class CAMPPlusDiarizer:
    """Speaker diarization using FunASR CAMPPlus model."""

    def __init__(self):
        self._model = None

    def _resolve_model_path(self) -> Optional[str]:
        """Find local CAMPPlus model."""
        return resolve_modelscope_model(CAMPPLUS_MODEL_DIR)

    async def load(self) -> None:
        if self._model:
            return

        model_path = self._resolve_model_path()
        if not model_path:
            logger.info("Speaker diarization model not found locally, skipping")
            return

        def _load():
            try:
                import torch
                from funasr import AutoModel
                # Force CPU to avoid competing with ASR engine for GPU memory
                return AutoModel(model=model_path, model_revision="v2.0.4", device="cpu")
            except Exception as e:
                logger.warning("Failed to load diarization model from %s: %s", model_path, e)
                return None

        self._model = await asyncio.to_thread(_load)

    def is_available(self) -> bool:
        return self._model is not None

    async def process(
        self, audio_path: str, segments: list[Segment]
    ) -> list[Segment]:
        """Assign speaker labels by extracting per-segment embeddings and clustering."""
        if not segments:
            return segments

        if not self._model:
            await self.load()

        if not self._model:
            return segments

        model_ref = self._model

        def _diarize():
            try:
                import torchaudio

                waveform, sr = torchaudio.load(audio_path)
                # Convert to mono
                if waveform.shape[0] > 1:
                    waveform = waveform.mean(dim=0, keepdim=True)
                # Resample to 16kHz
                if sr != 16000:
                    waveform = torchaudio.transforms.Resample(sr, 16000)(waveform)
                    sr = 16000

                audio_np = waveform.squeeze(0).numpy()

                # Extract embedding per segment
                embeddings: list[Optional[np.ndarray]] = []
                for seg in segments:
                    start_sample = int(seg.start * sr)
                    end_sample = int(seg.end * sr)
                    chunk = audio_np[start_sample:end_sample]

                    if len(chunk) < int(MIN_SEGMENT_DURATION * sr):
                        embeddings.append(None)
                        continue

                    try:
                        result = model_ref.generate(input=chunk)
                        emb = _extract_embedding(result)
                        embeddings.append(emb)
                    except Exception:
                        embeddings.append(None)

                # Cluster embeddings
                speaker_map = _cluster_embeddings(embeddings)
                return speaker_map
            except Exception as e:
                logger.warning("Diarization failed: %s", e, exc_info=True)
                return {}

        speaker_map = await asyncio.to_thread(_diarize)

        if not speaker_map:
            logger.warning("Diarization produced empty speaker map, returning segments unchanged")
            return segments

        # Apply speaker labels
        labeled = []
        for i, seg in enumerate(segments):
            speaker = speaker_map.get(i, seg.speaker)
            labeled.append(
                Segment(
                    start=seg.start,
                    end=seg.end,
                    text=seg.text,
                    speaker=speaker,
                    confidence=seg.confidence,
                )
            )
        return labeled


def _extract_embedding(result) -> Optional[np.ndarray]:
    """Extract speaker embedding vector from FunASR CAMPPlus output."""
    if not result:
        return None

    # FunASR returns list of dicts; embedding is in 'spk_embedding' key
    if isinstance(result, list) and len(result) > 0:
        item = result[0]
        if isinstance(item, dict):
            emb = item.get("spk_embedding")
            if emb is not None:
                return np.asarray(emb, dtype=np.float32).flatten()
        # Some versions return the embedding directly as ndarray
        if isinstance(item, np.ndarray):
            return item.flatten()

    # If result itself is an ndarray
    if isinstance(result, np.ndarray):
        return result.flatten()

    return None


def _cluster_embeddings(
    embeddings: list[Optional[np.ndarray]],
) -> dict[int, str]:
    """Greedy clustering of speaker embeddings using cosine similarity."""
    # Collect valid (index, embedding) pairs
    valid = [(i, emb) for i, emb in enumerate(embeddings) if emb is not None]
    if len(valid) < 2:
        # Not enough embeddings to cluster
        if len(valid) == 1:
            return {valid[0][0]: "Speaker 1"}
        return {}

    # Normalize embeddings
    for idx in range(len(valid)):
        norm = np.linalg.norm(valid[idx][1])
        if norm > 0:
            valid[idx] = (valid[idx][0], valid[idx][1] / norm)

    # Greedy clustering: assign each embedding to the first cluster
    # whose centroid has cosine similarity above threshold
    clusters: list[list[int]] = []        # cluster -> list of valid[] indices
    centroids: list[np.ndarray] = []

    for vi, (seg_idx, emb) in enumerate(valid):
        best_cluster = -1
        best_sim = -1.0

        for ci, centroid in enumerate(centroids):
            sim = float(np.dot(emb, centroid))
            if sim > best_sim:
                best_sim = sim
                best_cluster = ci

        if best_sim >= SIMILARITY_THRESHOLD and best_cluster >= 0:
            clusters[best_cluster].append(vi)
            # Update centroid as running average
            members = clusters[best_cluster]
            new_centroid = np.mean(
                [valid[m][1] for m in members], axis=0
            )
            norm = np.linalg.norm(new_centroid)
            if norm > 0:
                new_centroid /= norm
            centroids[best_cluster] = new_centroid
        else:
            # New cluster
            clusters.append([vi])
            centroids.append(emb.copy())

    # Build speaker map
    speaker_map: dict[int, str] = {}
    for ci, members in enumerate(clusters):
        label = f"Speaker {ci + 1}"
        for vi in members:
            seg_idx = valid[vi][0]
            speaker_map[seg_idx] = label

    return speaker_map
