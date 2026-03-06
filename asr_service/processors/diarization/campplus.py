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


def _load_audio(audio_path: str):
    """Load audio file, returning (waveform, sample_rate).

    waveform shape: (1, N) float32 tensor — mono.
    Avoids torchaudio.load() which requires torchcodec on newer versions.
    Falls back through: soundfile → wave (stdlib) → torchaudio.
    """
    import torch

    # Strategy 1: soundfile (cross-platform, supports WAV/FLAC/OGG)
    try:
        import soundfile as sf

        data, sr = sf.read(audio_path, dtype="float32")
        # soundfile returns (N,) for mono, (N, C) for multi-channel
        if data.ndim == 2:
            data = data.mean(axis=1)
        return torch.from_numpy(data).unsqueeze(0), sr
    except Exception:
        pass

    # Strategy 2: wave (stdlib, WAV-only but zero dependencies)
    try:
        import wave

        with wave.open(audio_path, "rb") as wf:
            sr = wf.getframerate()
            n_frames = wf.getnframes()
            n_channels = wf.getnchannels()
            sampwidth = wf.getsampwidth()
            raw = wf.readframes(n_frames)

        # Convert raw PCM bytes to float32
        if sampwidth == 2:
            arr = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        elif sampwidth == 4:
            arr = np.frombuffer(raw, dtype=np.int32).astype(np.float32) / 2147483648.0
        else:
            arr = np.frombuffer(raw, dtype=np.uint8).astype(np.float32) / 128.0 - 1.0

        if n_channels > 1:
            arr = arr.reshape(-1, n_channels).mean(axis=1)
        return torch.from_numpy(arr).unsqueeze(0), sr
    except Exception:
        pass

    # Strategy 3: torchaudio (last resort — may need torchcodec)
    import torchaudio
    return torchaudio.load(audio_path)


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

    # Segments longer than this (seconds) will be split via energy-based VAD
    # before embedding extraction, so each sub-segment maps to one speaker.
    MAX_SEGMENT_FOR_EMBEDDING = 5.0

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
        max_seg_dur = self.MAX_SEGMENT_FOR_EMBEDDING

        def _diarize():
            try:
                waveform, sr = _load_audio(audio_path)
                logger.info(
                    "Diarization: loaded audio %s, shape=%s, sr=%d",
                    audio_path, waveform.shape, sr,
                )
                # Convert to mono
                if waveform.shape[0] > 1:
                    waveform = waveform.mean(dim=0, keepdim=True)
                # Resample to 16kHz
                if sr != 16000:
                    import torchaudio as _ta
                    waveform = _ta.transforms.Resample(sr, 16000)(waveform)
                    sr = 16000

                audio_np = waveform.squeeze(0).numpy()
                total_samples = len(audio_np)
                total_dur = total_samples / sr
                logger.info(
                    "Diarization: %d samples, %.1fs, %d input segments",
                    total_samples, total_dur, len(segments),
                )

                # Log input segment timestamps for debugging
                for i, seg in enumerate(segments[:5]):
                    logger.info(
                        "  seg[%d]: %.2f-%.2f (%.2fs) text='%s'",
                        i, seg.start, seg.end, seg.end - seg.start,
                        seg.text[:40],
                    )
                if len(segments) > 5:
                    logger.info("  ... and %d more segments", len(segments) - 5)

                # Build sub-segments: if a segment is too long (e.g. 30s chunk
                # from engines without timestamps), split it via energy-based
                # VAD so each sub-segment maps to one speaker.
                sub_segments: list[tuple[int, float, float]] = []  # (orig_idx, start, end)
                for i, seg in enumerate(segments):
                    duration = seg.end - seg.start
                    if duration > max_seg_dur:
                        vad_segs = _energy_vad_split(
                            audio_np, sr, seg.start, seg.end, total_samples,
                        )
                        for vs, ve in vad_segs:
                            sub_segments.append((i, vs, ve))
                    else:
                        sub_segments.append((i, seg.start, seg.end))

                logger.info(
                    "Diarization: %d sub-segments after VAD split",
                    len(sub_segments),
                )
                for j, (oi, ss, se) in enumerate(sub_segments[:8]):
                    logger.info(
                        "  sub[%d]: orig=%d, %.2f-%.2f (%.2fs)",
                        j, oi, ss, se, se - ss,
                    )
                if len(sub_segments) > 8:
                    logger.info("  ... and %d more sub-segments", len(sub_segments) - 8)

                # Extract embedding per sub-segment
                sub_embeddings: list[Optional[np.ndarray]] = []
                valid_count = 0
                for _, ss, se in sub_segments:
                    start_sample = int(ss * sr)
                    end_sample = min(int(se * sr), total_samples)
                    chunk = audio_np[start_sample:end_sample]

                    if len(chunk) < int(MIN_SEGMENT_DURATION * sr):
                        sub_embeddings.append(None)
                        continue

                    try:
                        result = model_ref.generate(input=chunk)
                        if valid_count == 0:
                            # Log first result structure for debugging
                            logger.info(
                                "Diarization: first generate() result type=%s, value=%s",
                                type(result).__name__,
                                _summarize_result(result),
                            )
                        emb = _extract_embedding(result)
                        sub_embeddings.append(emb)
                        if emb is not None:
                            valid_count += 1
                        elif valid_count == 0:
                            logger.warning(
                                "Diarization: _extract_embedding returned None for first sub-segment"
                            )
                    except Exception as exc:
                        logger.warning("Embedding extraction failed for sub-segment: %s", exc)
                        sub_embeddings.append(None)

                logger.info(
                    "Diarization: %d/%d sub-segments got valid embeddings",
                    valid_count, len(sub_segments),
                )

                if valid_count < 2:
                    logger.warning(
                        "Not enough valid embeddings for clustering (%d), "
                        "need at least 2", valid_count,
                    )
                    return {}

                # Cluster sub-segment embeddings
                sub_speaker_map = _cluster_embeddings(sub_embeddings)
                logger.info(
                    "Diarization: clustering produced %d speaker labels",
                    len(set(sub_speaker_map.values())) if sub_speaker_map else 0,
                )

                # Map back: for each original segment, pick the most frequent
                # speaker label among its sub-segments (majority vote).
                from collections import Counter
                seg_labels: dict[int, list[str]] = {}
                for sub_idx, (orig_idx, _, _) in enumerate(sub_segments):
                    label = sub_speaker_map.get(sub_idx)
                    if label:
                        seg_labels.setdefault(orig_idx, []).append(label)

                speaker_map: dict[int, str] = {}
                for orig_idx, labels in seg_labels.items():
                    counter = Counter(labels)
                    speaker_map[orig_idx] = counter.most_common(1)[0][0]

                logger.info(
                    "Diarization: final speaker_map has %d entries for %d segments",
                    len(speaker_map), len(segments),
                )
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


def _energy_vad_split(
    audio_np: np.ndarray,
    sr: int,
    seg_start: float,
    seg_end: float,
    total_samples: int,
    frame_ms: int = 30,
    min_speech_ms: int = 300,
) -> list[tuple[float, float]]:
    """Split a long audio region into speech segments using energy-based VAD.

    Returns list of (start_sec, end_sec) tuples for detected speech regions.
    This is a lightweight alternative to model-based VAD, suitable for
    pre-splitting before speaker embedding extraction.
    """
    start_sample = int(seg_start * sr)
    end_sample = min(int(seg_end * sr), total_samples)
    chunk = audio_np[start_sample:end_sample]

    if len(chunk) == 0:
        return []

    frame_size = int(sr * frame_ms / 1000)
    num_frames = len(chunk) // frame_size
    if num_frames == 0:
        return [(seg_start, seg_end)]

    # Compute per-frame energy (RMS)
    energies = np.array([
        np.sqrt(np.mean(chunk[i * frame_size:(i + 1) * frame_size] ** 2))
        for i in range(num_frames)
    ])

    # Adaptive threshold: median energy (silence floor) + fraction of dynamic range
    if len(energies) == 0:
        return [(seg_start, seg_end)]
    sorted_e = np.sort(energies)
    noise_floor = sorted_e[int(len(sorted_e) * 0.3)]
    peak = sorted_e[int(len(sorted_e) * 0.95)]
    threshold = noise_floor + 0.25 * (peak - noise_floor)

    # Find contiguous speech regions above threshold
    is_speech = energies > threshold
    min_speech_frames = max(1, int(min_speech_ms / frame_ms))

    regions: list[tuple[float, float]] = []
    in_speech = False
    speech_start = 0

    for i, s in enumerate(is_speech):
        if s and not in_speech:
            speech_start = i
            in_speech = True
        elif not s and in_speech:
            if i - speech_start >= min_speech_frames:
                rs = seg_start + speech_start * frame_ms / 1000.0
                re = seg_start + i * frame_ms / 1000.0
                regions.append((rs, min(re, seg_end)))
            in_speech = False

    # Handle speech region extending to end
    if in_speech and num_frames - speech_start >= min_speech_frames:
        rs = seg_start + speech_start * frame_ms / 1000.0
        regions.append((rs, seg_end))

    return regions if regions else [(seg_start, seg_end)]


def _summarize_result(result) -> str:
    """Summarize FunASR result structure for debugging."""
    if result is None:
        return "None"
    if isinstance(result, np.ndarray):
        return f"ndarray(shape={result.shape}, dtype={result.dtype})"
    if isinstance(result, list):
        parts = []
        for i, item in enumerate(result[:3]):
            if isinstance(item, dict):
                keys = list(item.keys())
                val_types = {k: type(v).__name__ for k, v in list(item.items())[:5]}
                parts.append(f"dict(keys={keys}, types={val_types})")
            elif isinstance(item, np.ndarray):
                parts.append(f"ndarray(shape={item.shape})")
            else:
                parts.append(f"{type(item).__name__}({str(item)[:80]})")
        return f"list[{len(result)}]: [{', '.join(parts)}]"
    return f"{type(result).__name__}({str(result)[:100]})"


def _extract_embedding(result) -> Optional[np.ndarray]:
    """Extract speaker embedding vector from FunASR CAMPPlus output."""
    if not result:
        return None

    # FunASR returns list of dicts; embedding key varies by version
    if isinstance(result, list) and len(result) > 0:
        item = result[0]
        if isinstance(item, dict):
            # Try known embedding keys
            for key in ("spk_embedding", "embedding", "emb", "sv_embedding"):
                emb = item.get(key)
                if emb is not None:
                    return np.asarray(emb, dtype=np.float32).flatten()
            # Fallback: look for any ndarray value in the dict
            for key, val in item.items():
                if isinstance(val, np.ndarray) and val.ndim >= 1 and val.size > 10:
                    return val.astype(np.float32).flatten()
                if isinstance(val, list) and len(val) > 10:
                    try:
                        arr = np.asarray(val, dtype=np.float32)
                        if arr.ndim >= 1:
                            return arr.flatten()
                    except (ValueError, TypeError):
                        continue
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
