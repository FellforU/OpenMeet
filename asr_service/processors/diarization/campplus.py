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
# Maximum number of speakers to detect (prevents over-segmentation)
MAX_SPEAKERS = 20


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
    # Sliding window parameters for zero-duration segment fallback.
    # Window must be long enough for good embeddings but short enough
    # to contain only one speaker (typical turn gap ~300ms).
    WINDOW_SIZE = 1.5       # seconds per window
    WINDOW_STEP = 0.75      # seconds step (50% overlap)
    MIN_WINDOW_ENERGY = 0.01  # Skip silent windows

    async def process(
        self, audio_path: str, segments: list[Segment]
    ) -> list[Segment]:
        """Assign speaker labels by extracting per-segment embeddings and clustering.

        For zero-duration segments (Qwen3-ASR), builds a speaker timeline
        using sliding windows, then splits segments at speaker change points.
        """
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
                if waveform.shape[0] > 1:
                    waveform = waveform.mean(dim=0, keepdim=True)
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

                for i, seg in enumerate(segments[:5]):
                    logger.info(
                        "  seg[%d]: %.2f-%.2f (%.2fs) text='%s'",
                        i, seg.start, seg.end, seg.end - seg.start,
                        seg.text[:40],
                    )
                if len(segments) > 5:
                    logger.info("  ... and %d more segments", len(segments) - 5)

                zero_dur_count = sum(
                    1 for seg in segments if seg.end - seg.start < 0.01
                )
                use_sliding_window = zero_dur_count > len(segments) * 0.8

                if use_sliding_window:
                    logger.info(
                        "Diarization: %d/%d segments have zero duration, "
                        "using sliding window approach",
                        zero_dur_count, len(segments),
                    )
                    return self._sliding_window_diarize(
                        model_ref, audio_np, sr, total_dur, total_samples,
                    )

                # Normal path: segments have valid timestamps
                sub_segments: list[tuple[int, float, float]] = []
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

                embeddings = _extract_embeddings_batch(
                    model_ref, audio_np, sr, total_samples,
                    [(s, e) for _, s, e in sub_segments],
                )
                valid_count = sum(1 for e in embeddings if e is not None)
                logger.info(
                    "Diarization: %d/%d sub-segments got valid embeddings",
                    valid_count, len(sub_segments),
                )
                if valid_count < 2:
                    return {}

                sub_speaker_map = _cluster_embeddings(embeddings)

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

                return speaker_map
            except Exception as e:
                logger.warning("Diarization failed: %s", e, exc_info=True)
                return {}

        result = await asyncio.to_thread(_diarize)

        # Sliding window returns a timeline list[(start, end, speaker)]
        if isinstance(result, list) and result and isinstance(result[0], tuple):
            return self._apply_timeline_to_segments(segments, result)

        # Normal path returns a speaker_map dict
        speaker_map = result
        if not speaker_map:
            logger.warning("Diarization produced empty speaker map")
            return segments

        labeled = []
        for i, seg in enumerate(segments):
            speaker = speaker_map.get(i, seg.speaker)
            labeled.append(Segment(
                start=seg.start, end=seg.end, text=seg.text,
                speaker=speaker, confidence=seg.confidence,
            ))
        return labeled

    def _sliding_window_diarize(
        self, model_ref, audio_np, sr, total_dur, total_samples,
    ):
        """Build speaker timeline via sliding windows, return new segment list.

        1. Extract embeddings with sliding windows
        2. Cluster to get speaker labels per window
        3. Smooth timeline (median filter)
        4. Build speaker-attributed segments
        """
        win_size = self.WINDOW_SIZE
        win_step = self.WINDOW_STEP
        min_energy = self.MIN_WINDOW_ENERGY
        win_samples = int(win_size * sr)

        # Step 1: Extract embeddings for speech windows
        windows: list[tuple[float, float]] = []  # (start, end) of each window
        embeddings: list[Optional[np.ndarray]] = []
        skipped = 0
        valid_count = 0

        t = 0.0
        while t + win_size <= total_dur:
            s_samp = int(t * sr)
            e_samp = min(s_samp + win_samples, total_samples)
            win_audio = audio_np[s_samp:e_samp]

            rms = float(np.sqrt(np.mean(win_audio ** 2)))
            if rms < min_energy:
                skipped += 1
                t += win_step
                continue

            windows.append((t, t + win_size))
            try:
                result = model_ref.generate(input=win_audio)
                if valid_count == 0:
                    logger.info(
                        "Diarization: first generate() result type=%s, value=%s",
                        type(result).__name__, _summarize_result(result),
                    )
                emb = _extract_embedding(result)
                embeddings.append(emb)
                if emb is not None:
                    valid_count += 1
            except Exception as exc:
                logger.warning("Embedding extraction failed: %s", exc)
                embeddings.append(None)

            t += win_step

        logger.info(
            "Diarization: sliding window (%.1fs/%.1fs) → "
            "%d windows, %d valid, %d silent skipped",
            win_size, win_step, len(windows), valid_count, skipped,
        )

        if valid_count < 2:
            logger.warning("Not enough valid embeddings for clustering")
            return {}

        # Step 2: Cluster embeddings
        speaker_map = _cluster_embeddings(embeddings)
        n_speakers = len(set(speaker_map.values())) if speaker_map else 0
        logger.info("Diarization: clustering → %d speakers", n_speakers)

        if not speaker_map:
            return {}

        # Step 3: Build speaker timeline and smooth it
        # Create label array indexed by window position
        labels = []
        for wi in range(len(windows)):
            labels.append(speaker_map.get(wi, ""))

        # Temporal smoothing: median filter (window of 5)
        # Replace each label with the most common among its neighbors
        smoothed = list(labels)
        radius = 2
        for i in range(len(labels)):
            if not labels[i]:
                continue
            neighborhood = []
            for j in range(max(0, i - radius), min(len(labels), i + radius + 1)):
                if labels[j]:
                    neighborhood.append(labels[j])
            if neighborhood:
                from collections import Counter
                smoothed[i] = Counter(neighborhood).most_common(1)[0][0]

        # Log timeline sample
        for i in range(min(20, len(windows))):
            if smoothed[i]:
                ws, we = windows[i]
                logger.info(
                    "  timeline[%d]: %.1f-%.1fs → %s%s",
                    i, ws, we, smoothed[i],
                    " (smoothed)" if smoothed[i] != labels[i] else "",
                )

        # Step 4: Build speaker timeline as list of (start, end, speaker)
        timeline: list[tuple[float, float, str]] = []
        for wi, (ws, we) in enumerate(windows):
            spk = smoothed[wi]
            if not spk:
                continue
            if timeline and timeline[-1][2] == spk:
                # Extend current region
                timeline[-1] = (timeline[-1][0], we, spk)
            else:
                timeline.append((ws, we, spk))

        logger.info(
            "Diarization: speaker timeline has %d regions",
            len(timeline),
        )
        for i, (ts, te, spk) in enumerate(timeline[:10]):
            logger.info("  region[%d]: %.1f-%.1fs %s", i, ts, te, spk)
        if len(timeline) > 10:
            logger.info("  ... and %d more regions", len(timeline) - 10)

        return timeline

    def _apply_timeline_to_segments(
        self, segments: list[Segment], timeline: list[tuple[float, float, str]],
    ) -> list[Segment]:
        """Rebuild segments from speaker timeline using sentence-level assignment.

        For zero-duration segments (Qwen3-ASR), the original segment boundaries
        don't reflect actual speech timing. Instead of per-segment splitting:
        1. Concatenate all text and build a global char→time mapping
        2. Split full text into sentences by punctuation
        3. Assign each sentence a speaker from the timeline
        4. Group consecutive same-speaker sentences into new segments
        """
        if not timeline:
            return segments

        total_audio_end = timeline[-1][1]  # End of last timeline region

        # Build global char→time mapping from segment timestamps + text lengths
        # Each segment's text maps to a time range estimated from its timestamp
        char_time_anchors: list[tuple[int, float]] = []  # (char_offset, time)
        total_text = ""
        for i, seg in enumerate(segments):
            char_time_anchors.append((len(total_text), seg.start))
            total_text += seg.text

        total_chars = len(total_text)
        if total_chars == 0:
            return segments

        # Add end anchor
        char_time_anchors.append((total_chars, total_audio_end))

        def _char_to_time(char_pos: int) -> float:
            """Interpolate time for a character position."""
            if char_pos <= 0:
                return char_time_anchors[0][1]
            if char_pos >= total_chars:
                return total_audio_end

            # Find surrounding anchors
            for ai in range(len(char_time_anchors) - 1):
                c0, t0 = char_time_anchors[ai]
                c1, t1 = char_time_anchors[ai + 1]
                if c0 <= char_pos <= c1:
                    if c1 == c0:
                        return t0
                    frac = (char_pos - c0) / (c1 - c0)
                    return t0 + frac * (t1 - t0)
            return total_audio_end

        # Split full text into sentences at punctuation boundaries
        sentences = _split_into_sentences(total_text)
        logger.info(
            "Diarization: %d chars total text → %d sentences",
            total_chars, len(sentences),
        )

        # Assign speaker to each sentence based on its midpoint time
        sentence_assignments: list[tuple[str, str, float, float]] = []
        char_pos = 0
        for sent in sentences:
            sent_start_char = char_pos
            sent_end_char = char_pos + len(sent)
            mid_char = (sent_start_char + sent_end_char) // 2
            mid_time = _char_to_time(mid_char)
            start_time = _char_to_time(sent_start_char)
            end_time = _char_to_time(sent_end_char)

            # Find speaker at midpoint time
            spk = _find_nearest_speaker(mid_time, timeline)
            sentence_assignments.append((sent, spk, start_time, end_time))
            char_pos = sent_end_char

        # Group consecutive same-speaker sentences into segments
        result: list[Segment] = []
        if not sentence_assignments:
            return segments

        cur_text = sentence_assignments[0][0]
        cur_spk = sentence_assignments[0][1]
        cur_start = sentence_assignments[0][2]
        cur_end = sentence_assignments[0][3]

        for sent, spk, s_time, e_time in sentence_assignments[1:]:
            if spk == cur_spk:
                cur_text += sent
                cur_end = e_time
            else:
                if cur_text.strip():
                    result.append(Segment(
                        start=cur_start, end=cur_end,
                        text=cur_text.strip(),
                        speaker=cur_spk, confidence=1.0,
                    ))
                cur_text = sent
                cur_spk = spk
                cur_start = s_time
                cur_end = e_time

        # Flush last group
        if cur_text.strip():
            result.append(Segment(
                start=cur_start, end=cur_end,
                text=cur_text.strip(),
                speaker=cur_spk, confidence=1.0,
            ))

        logger.info(
            "Diarization: rebuilt %d segments → %d segments with speaker labels",
            len(segments), len(result),
        )
        for i, seg in enumerate(result[:10]):
            logger.info(
                "  result[%d]: %.1f-%.1fs %s text='%s'",
                i, seg.start, seg.end, seg.speaker, seg.text[:50],
            )
        if len(result) > 10:
            logger.info("  ... and %d more segments", len(result) - 10)

        return result


def _find_nearest_speaker(
    timestamp: float, timeline: list[tuple[float, float, str]],
) -> str:
    """Find the speaker of the nearest timeline region to a timestamp."""
    best_spk = ""
    min_dist = float("inf")
    for ts, te, spk in timeline:
        if ts <= timestamp <= te:
            return spk
        d = min(abs(timestamp - ts), abs(timestamp - te))
        if d < min_dist:
            min_dist = d
            best_spk = spk
    return best_spk


def _split_into_sentences(text: str) -> list[str]:
    """Split text into sentences at Chinese/English punctuation boundaries.

    Each returned string includes its trailing punctuation.
    E.g. "你好。再见！" → ["你好。", "再见！"]
    """
    import re as _re

    # Split after sentence-ending punctuation, keeping the delimiter
    # Also split on comma/semicolon for finer granularity (speaker turns
    # often happen at clause boundaries, not just sentence boundaries)
    parts = _re.split(r"(?<=[。！？.!?，,；;])", text)

    # Filter empty strings and merge very short fragments (< 2 chars)
    # into the previous sentence to avoid noise
    sentences: list[str] = []
    for part in parts:
        if not part:
            continue
        if sentences and len(part.strip()) < 2:
            sentences[-1] += part
        else:
            sentences.append(part)

    return sentences if sentences else [text]


def _extract_embeddings_batch(
    model_ref,
    audio_np: np.ndarray,
    sr: int,
    total_samples: int,
    time_ranges: list[tuple[float, float]],
) -> list[Optional[np.ndarray]]:
    """Extract speaker embeddings for a batch of audio time ranges."""
    embeddings: list[Optional[np.ndarray]] = []
    valid_count = 0

    for ss, se in time_ranges:
        start_sample = int(ss * sr)
        end_sample = min(int(se * sr), total_samples)
        chunk = audio_np[start_sample:end_sample]

        if len(chunk) < int(MIN_SEGMENT_DURATION * sr):
            embeddings.append(None)
            continue

        try:
            result = model_ref.generate(input=chunk)
            if valid_count == 0:
                logger.info(
                    "Diarization: first generate() result type=%s, value=%s",
                    type(result).__name__, _summarize_result(result),
                )
            emb = _extract_embedding(result)
            embeddings.append(emb)
            if emb is not None:
                valid_count += 1
        except Exception as exc:
            logger.warning("Embedding extraction failed: %s", exc)
            embeddings.append(None)

    return embeddings


def _energy_vad_split(
    audio_np: np.ndarray,
    sr: int,
    seg_start: float,
    seg_end: float,
    total_samples: int,
    frame_ms: int = 30,
    min_speech_ms: int = 500,
    min_silence_ms: int = 600,
) -> list[tuple[float, float]]:
    """Split a long audio region into speech segments using energy-based VAD.

    Returns list of (start_sec, end_sec) tuples for detected speech regions.
    Only splits on silence gaps >= min_silence_ms to produce speaker-level
    segments rather than sentence-level fragments.
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
    min_silence_frames = max(1, int(min_silence_ms / frame_ms))

    regions: list[tuple[float, float]] = []
    in_speech = False
    speech_start = 0
    silence_count = 0  # Consecutive silence frames

    for i, s in enumerate(is_speech):
        if s:
            if not in_speech:
                speech_start = i
                in_speech = True
            silence_count = 0
        else:
            if in_speech:
                silence_count += 1
                # Only end speech region if silence is long enough
                if silence_count >= min_silence_frames:
                    # Speech ended at the frame before silence started
                    speech_end = i - silence_count + 1
                    if speech_end - speech_start >= min_speech_frames:
                        rs = seg_start + speech_start * frame_ms / 1000.0
                        re = seg_start + speech_end * frame_ms / 1000.0
                        regions.append((rs, min(re, seg_end)))
                    in_speech = False
                    silence_count = 0

    # Handle speech region extending to end
    if in_speech:
        speech_end = num_frames
        if speech_end - speech_start >= min_speech_frames:
            rs = seg_start + speech_start * frame_ms / 1000.0
            regions.append((rs, seg_end))

    return regions if regions else [(seg_start, seg_end)]


def _merge_vad_segments(
    vad_segs: list[tuple[float, float]],
    min_duration: float = 1.5,
    max_duration: float = 5.0,
    max_gap: float = 0.5,
) -> list[tuple[float, float]]:
    """Merge short adjacent VAD segments into longer windows.

    Short audio segments produce noisy speaker embeddings. This merges
    adjacent segments (within max_gap seconds) until each window is at
    least min_duration seconds, capped at max_duration.
    """
    if not vad_segs:
        return vad_segs

    merged: list[tuple[float, float]] = []
    cur_start, cur_end = vad_segs[0]

    for vs, ve in vad_segs[1:]:
        gap = vs - cur_end
        merged_dur = ve - cur_start

        # Merge if: gap is small AND merged window won't exceed max
        if gap <= max_gap and merged_dur <= max_duration:
            cur_end = ve
        else:
            merged.append((cur_start, cur_end))
            cur_start, cur_end = vs, ve

    merged.append((cur_start, cur_end))

    # Second pass: merge any remaining short windows with neighbors
    if len(merged) > 1:
        final: list[tuple[float, float]] = [merged[0]]
        for ms, me in merged[1:]:
            prev_s, prev_e = final[-1]
            prev_dur = prev_e - prev_s
            cur_dur = me - ms
            gap = ms - prev_e

            # If previous window is too short, extend it
            if prev_dur < min_duration and gap <= max_gap * 3 and (me - prev_s) <= max_duration:
                final[-1] = (prev_s, me)
            # If current window is too short, merge into previous
            elif cur_dur < min_duration and gap <= max_gap * 3 and (me - prev_s) <= max_duration:
                final[-1] = (prev_s, me)
            else:
                final.append((ms, me))
        merged = final

    return merged


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
    """Cluster speaker embeddings using agglomerative clustering.

    Uses sklearn AgglomerativeClustering with cosine distance.
    Falls back to greedy clustering if sklearn is unavailable.
    Caps the number of clusters at MAX_SPEAKERS to prevent over-segmentation.
    """
    from sklearn.cluster import AgglomerativeClustering
    from sklearn.metrics.pairwise import cosine_distances

    # Collect valid (index, embedding) pairs
    valid = [(i, emb) for i, emb in enumerate(embeddings) if emb is not None]
    if len(valid) < 2:
        if len(valid) == 1:
            return {valid[0][0]: "Speaker 1"}
        return {}

    # Normalize embeddings
    emb_matrix = np.array([emb for _, emb in valid], dtype=np.float32)
    norms = np.linalg.norm(emb_matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    emb_matrix = emb_matrix / norms

    # Compute cosine distance matrix
    dist_matrix = cosine_distances(emb_matrix)

    # Phase 1: cluster with distance threshold (cosine distance = 1 - similarity)
    distance_threshold = 1.0 - SIMILARITY_THRESHOLD
    clustering = AgglomerativeClustering(
        n_clusters=None,
        distance_threshold=distance_threshold,
        metric="precomputed",
        linkage="average",
    )
    labels = clustering.fit_predict(dist_matrix)
    n_clusters = len(set(labels))

    logger.info(
        "Diarization clustering: %d embeddings → %d clusters (threshold=%.2f)",
        len(valid), n_clusters, distance_threshold,
    )

    # Phase 2: if too many clusters, re-cluster with capped n_clusters
    if n_clusters > MAX_SPEAKERS:
        logger.info(
            "Diarization: %d clusters exceeds max %d, re-clustering",
            n_clusters, MAX_SPEAKERS,
        )
        clustering = AgglomerativeClustering(
            n_clusters=MAX_SPEAKERS,
            metric="precomputed",
            linkage="average",
        )
        labels = clustering.fit_predict(dist_matrix)
        n_clusters = MAX_SPEAKERS

    # Build speaker map with sequential numbering
    # AgglomerativeClustering labels may not be sequential (e.g. 0, 2, 5)
    unique_labels = sorted(set(labels))
    label_remap = {old: new + 1 for new, old in enumerate(unique_labels)}

    speaker_map: dict[int, str] = {}
    for vi, label in enumerate(labels):
        seg_idx = valid[vi][0]
        speaker_map[seg_idx] = f"Speaker {label_remap[label]}"

    return speaker_map
