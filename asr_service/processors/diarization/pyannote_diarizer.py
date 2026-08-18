"""pyannote-audio based speaker diarization.

Industry-standard speaker diarization with ~16ms resolution.
Supports all languages, overlapping speech detection, and automatic
speaker count estimation.

Requires: pyannote-audio>=3.1 (4.x supported), HuggingFace token (for model download).
Falls back gracefully if unavailable — caller should try CAMPPlus instead.
"""

import asyncio
import bisect
import logging
import re
from pathlib import Path
from typing import Optional

import numpy as np

from asr_service.models.job import Segment
from asr_service.processors.forced_alignment import ForcedAligner

logger = logging.getLogger(__name__)

MIN_EMBEDDING_DURATION = 0.3


def _read_mono_audio(audio_path: str) -> tuple[np.ndarray, int]:
    """Read an audio file as mono float32, returning (samples, sample_rate).

    Uses soundfile to avoid the torchcodec dependency of torchaudio.load().
    """
    import soundfile as sf

    data, sr = sf.read(audio_path, dtype="float32")
    if data.ndim > 1:
        data = data.mean(axis=1)
    return np.ascontiguousarray(data, dtype=np.float32), sr


class PyAnnoteDiarizer:
    """Speaker diarization using pyannote-audio pipeline.

    Handles both normal segments (with timestamps) and zero-duration
    segments (Qwen3-ASR) via forced alignment + sentence-level splitting.
    """

    def __init__(self):
        self._pipeline = None
        self._aligner = ForcedAligner()
        self._load_attempted = False
        # Per-speaker centroids from the last diarization run, so the
        # embedding step can reuse them instead of re-running the model
        self._speaker_centroids: dict[str, np.ndarray] = {}
        self._centroids_audio_path: Optional[str] = None
        # Inference result cached by precompute(), consumed by process():
        # (audio_path, num_speakers, timeline, centroid_map)
        self._precomputed: Optional[tuple] = None

    async def load(self) -> None:
        """Load pyannote pipeline. Only attempts once."""
        if self._pipeline or self._load_attempted:
            return
        self._load_attempted = True

        def _load():
            try:
                from pyannote.audio import Pipeline
                from asr_service.services import model_source

                # 魔搭下载目录（自包含仓库，config.yaml 引用相对路径）
                ms_dir = model_source.local_path(
                    "pyannote/speaker-diarization-community-1"
                )
                if not ms_dir:
                    logger.warning(
                        "pyannote load failed: model not downloaded — "
                        "download it in Settings (via ModelScope)"
                    )
                    return None

                pipeline = None
                for target in (ms_dir, str(Path(ms_dir) / "config.yaml")):
                    try:
                        pipeline = Pipeline.from_pretrained(target)
                        break
                    except Exception as e:
                        logger.debug("load %s failed: %s", target, e)

                if pipeline is None:
                    logger.warning("pyannote load failed from %s", ms_dir)
                    return None

                import torch
                device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
                pipeline = pipeline.to(device)
                logger.info("pyannote community-1 ready (%s)", ms_dir)
                return pipeline
            except Exception as e:
                logger.warning("pyannote load failed: %s", e)
                return None

        self._pipeline = await asyncio.to_thread(_load)

    def is_available(self) -> bool:
        return self._pipeline is not None

    async def extract_embeddings(
        self,
        audio_path: str,
        segments: list[Segment],
        audio: Optional[tuple[np.ndarray, int]] = None,
    ) -> list[Optional[list[float]]]:
        """Extract per-segment speaker embeddings.

        Fast path: reuses the per-speaker centroids that pyannote 4.x already
        computed during diarization — zero extra inference.
        Fallback: runs pyannote's internal embedding model per segment
        (wespeaker-voxceleb-resnet34-LM, no extra model download).

        Returns a list aligned with segments (None for segments too short).
        """
        if not segments:
            return []

        # Fast path: map each segment to its speaker's centroid from the
        # diarization run on the same audio file
        if self._speaker_centroids and self._centroids_audio_path == audio_path:
            results: list[Optional[list[float]]] = []
            hits = 0
            for seg in segments:
                emb = (
                    self._speaker_centroids.get(seg.speaker)
                    if seg.speaker else None
                )
                if emb is not None:
                    results.append(emb.tolist())
                    hits += 1
                else:
                    results.append(None)
            if hits:
                logger.info(
                    "Embeddings reused from diarization centroids: %d/%d segments",
                    hits, len(segments),
                )
                return results

        if not self._pipeline:
            await self.load()
        if not self._pipeline:
            return [None] * len(segments)

        # Access pyannote's internal embedding model (BaseInference, batched
        # __call__ — the old Inference.crop() API does not exist in 3.x/4.x)
        emb_model = getattr(self._pipeline, '_embedding', None)
        if emb_model is None:
            logger.warning("pyannote pipeline has no _embedding model")
            return [None] * len(segments)

        if audio is None:
            try:
                audio = await asyncio.to_thread(_read_mono_audio, audio_path)
            except Exception as e:
                logger.warning("Audio loading for embedding failed: %s", e)
                return [None] * len(segments)
        audio_np, sample_rate = audio

        def _extract():
            import torch

            data, sr = audio_np, sample_rate
            target_sr = getattr(emb_model, "sample_rate", 16000)
            if sr != target_sr:
                import torchaudio
                waveform_t = torch.from_numpy(data).unsqueeze(0)
                waveform_t = torchaudio.functional.resample(waveform_t, sr, target_sr)
                data, sr = waveform_t.squeeze(0).numpy(), target_sr

            results: list[Optional[list[float]]] = [None] * len(segments)
            valid = 0
            min_samples = int(MIN_EMBEDDING_DURATION * sr)
            for i, seg in enumerate(segments):
                start = int(seg.start * sr)
                end = min(int(seg.end * sr), len(data))
                if end - start < min_samples:
                    continue
                try:
                    chunk = torch.from_numpy(data[start:end]).reshape(1, 1, -1)
                    # (1, dim) numpy array; NaN rows mean extraction failed
                    emb = np.asarray(emb_model(chunk), dtype=np.float32).flatten()
                    if not np.isfinite(emb).all():
                        continue
                    norm = np.linalg.norm(emb)
                    if norm > 0:
                        emb = emb / norm
                    results[i] = emb.tolist()
                    valid += 1
                except Exception as e:
                    logger.debug(
                        "Embedding extraction failed for segment %.1f-%.1f: %s",
                        seg.start, seg.end, e,
                    )
            logger.info(
                "pyannote embedding extraction: %d/%d segments", valid, len(segments),
            )
            return results

        return await asyncio.to_thread(_extract)

    async def precompute(
        self,
        audio_path: str,
        audio: Optional[tuple[np.ndarray, int]] = None,
        num_speakers: Optional[int] = None,
    ) -> None:
        """Run the heavy pyannote inference ahead of time and cache the result.

        Meant to run concurrently with the text-only pipeline steps (LLM
        correction etc.) — diarization inference only needs audio, not text.
        Never raises; on failure process() simply redoes the work.
        """
        self._precomputed = None
        if num_speakers == 1:
            return
        try:
            if not self._pipeline:
                await self.load()
            if not self._pipeline:
                return
            if audio is None:
                audio = await asyncio.to_thread(_read_mono_audio, audio_path)
            timeline, centroid_map = await self._run_inference(audio, num_speakers)
            if timeline:
                self._precomputed = (audio_path, num_speakers, timeline, centroid_map)
        except Exception as e:
            logger.warning("Diarization precompute failed: %s", e)

    async def _run_inference(
        self,
        audio: tuple[np.ndarray, int],
        num_speakers: Optional[int],
    ) -> tuple[list[tuple[float, float, str]], dict[str, np.ndarray]]:
        """Run the pyannote pipeline, returning (timeline, per-speaker centroids)."""
        pipeline_ref = self._pipeline
        audio_np, sample_rate = audio

        def _diarize():
            try:
                # Preload audio as waveform dict to bypass torchcodec/AudioDecoder
                # pyannote accepts {"waveform": Tensor(channel, time), "sample_rate": int}
                import torch
                waveform = torch.from_numpy(audio_np).unsqueeze(0)  # (1, samples)
                audio_input = {"waveform": waveform, "sample_rate": sample_rate}

                kwargs = {}
                if num_speakers and num_speakers >= 2:
                    kwargs["min_speakers"] = num_speakers
                    kwargs["max_speakers"] = num_speakers

                diarization = pipeline_ref(audio_input, **kwargs)

                # Handle different return types from pyannote versions.
                # 4.x returns DiarizeOutput with per-speaker centroids
                # already computed — grab them so the embedding step is free.
                centroids = None
                if hasattr(diarization, "itertracks"):
                    annotation = diarization
                elif hasattr(diarization, "speaker_diarization"):
                    annotation = diarization.speaker_diarization
                    centroids = getattr(diarization, "speaker_embeddings", None)
                elif hasattr(diarization, "annotation"):
                    annotation = diarization.annotation
                elif isinstance(diarization, tuple):
                    annotation = diarization[0]
                else:
                    logger.warning(
                        "Unexpected pyannote output type: %s, attrs: %s",
                        type(diarization).__name__,
                        [a for a in dir(diarization) if not a.startswith("_")],
                    )
                    return [], {}

                # Per-speaker centroid map (rows aligned with annotation.labels())
                centroid_map: dict[str, np.ndarray] = {}
                if centroids is not None:
                    for label, row in zip(annotation.labels(), centroids):
                        row = np.asarray(row, dtype=np.float32).flatten()
                        norm = np.linalg.norm(row)
                        if row.size and np.isfinite(row).all() and norm > 0:
                            centroid_map[label] = row / norm

                # Build speaker timeline: [(start, end, speaker), ...]
                timeline: list[tuple[float, float, str]] = []
                speaker_set: set[str] = set()
                for turn, _, speaker in annotation.itertracks(yield_label=True):
                    timeline.append((turn.start, turn.end, speaker))
                    speaker_set.add(speaker)

                logger.info(
                    "pyannote diarization: %d turns, %d speakers",
                    len(timeline), len(speaker_set),
                )
                for i, (ts, te, spk) in enumerate(timeline[:10]):
                    logger.info("  turn[%d]: %.2f-%.2fs %s", i, ts, te, spk)
                if len(timeline) > 10:
                    logger.info("  ... and %d more turns", len(timeline) - 10)

                return timeline, centroid_map
            except Exception as e:
                logger.warning("pyannote diarization failed: %s", e, exc_info=True)
                return [], {}

        return await asyncio.to_thread(_diarize)

    async def process(
        self,
        audio_path: str,
        segments: list[Segment],
        num_speakers: Optional[int] = None,
        audio: Optional[tuple[np.ndarray, int]] = None,
    ) -> list[Segment]:
        """Run speaker diarization and assign labels to segments.

        For zero-duration segments (Qwen3-ASR), rebuilds the transcript
        with sentence-level speaker assignment using forced alignment.
        For normal segments, assigns speaker based on time overlap.

        Args:
            audio_path: Path to audio file.
            segments: ASR output segments.
            num_speakers: Optional hint for number of speakers.
            audio: Optional preloaded (mono float32 samples, sample_rate)
                to avoid re-reading the file.
        """
        if not segments:
            return segments

        # num_speakers=1 means single speaker — skip diarization entirely
        if num_speakers == 1:
            logger.info("num_speakers=1, skipping diarization — assigning all to 'Speaker 1'")
            return [
                Segment(
                    start=seg.start, end=seg.end, text=seg.text,
                    speaker="Speaker 1", confidence=seg.confidence,
                )
                for seg in segments
            ]

        if not self._pipeline:
            await self.load()
        if not self._pipeline:
            # Fall back to CAMPPlus when pyannote unavailable
            logger.info("pyannote unavailable, falling back to CAMPPlus")
            from asr_service.processors.diarization.factory import create_campplus_fallback
            fallback = create_campplus_fallback()
            return await fallback.process(audio_path, segments, num_speakers=num_speakers)

        # Reuse the inference result if precompute() already ran it
        # (e.g. concurrently with the LLM correction step)
        pre = self._precomputed
        if pre and pre[0] == audio_path and pre[1] == num_speakers:
            self._precomputed = None
            timeline, centroid_map = pre[2], pre[3]
            logger.info("pyannote: using precomputed diarization result")
        else:
            # Load audio once (mono float32) — reused by diarization, forced
            # alignment and the embedding step
            if audio is None:
                try:
                    audio = await asyncio.to_thread(_read_mono_audio, audio_path)
                except Exception as e:
                    logger.warning("Audio loading for diarization failed: %s", e)
                    return segments
            timeline, centroid_map = await self._run_inference(audio, num_speakers)

        if not timeline:
            return segments

        # Rename speakers to sequential "Speaker 1", "Speaker 2", etc.
        timeline, label_map = _rename_speakers(timeline)

        # Keep centroids keyed by renamed labels for the embedding step
        self._speaker_centroids = {
            label_map[k]: v for k, v in centroid_map.items() if k in label_map
        }
        self._centroids_audio_path = audio_path if self._speaker_centroids else None

        # Compare ASR segment granularity vs pyannote turn granularity.
        # If pyannote turns are finer than ASR segments, use sentence-level
        # splitting to take advantage of pyannote's precise speaker boundaries.
        avg_seg_dur = (
            sum(seg.end - seg.start for seg in segments) / len(segments)
            if segments else 0
        )
        avg_turn_dur = (
            sum(te - ts for ts, te, _ in timeline) / len(timeline)
            if timeline else 0
        )
        zero_dur_count = sum(
            1 for seg in segments if seg.end - seg.start < 0.01
        )
        use_sentence_split = (
            zero_dur_count > len(segments) * 0.8
            or avg_seg_dur > avg_turn_dur * 2
        )

        logger.info(
            "pyannote: %d segs (avg %.1fs), %d turns (avg %.1fs), zero-dur=%d, sentence_split=%s",
            len(segments), avg_seg_dur, len(timeline), avg_turn_dur,
            zero_dur_count, use_sentence_split,
        )

        if use_sentence_split:
            return await self._apply_timeline_to_segments(
                audio_path, segments, timeline, audio=audio,
            )

        # Normal path: assign speaker based on segment midpoint
        return _assign_speakers_by_overlap(segments, timeline)

    async def _apply_timeline_to_segments(
        self,
        audio_path: str,
        segments: list[Segment],
        timeline: list[tuple[float, float, str]],
        audio: Optional[tuple[np.ndarray, int]] = None,
    ) -> list[Segment]:
        """Rebuild segments from pyannote timeline for zero-duration ASR output.

        1. Concatenate all text and split into sentences
        2. Use MMS_FA forced alignment for precise sentence timestamps
        3. Fall back to char-position interpolation if alignment unavailable
        4. Assign each sentence a speaker from pyannote timeline
        5. Group consecutive same-speaker sentences into new segments
        """
        total_audio_end = timeline[-1][1]

        # Concatenate all segment text
        total_text = "".join(seg.text for seg in segments)
        total_chars = len(total_text)
        if total_chars == 0:
            return segments

        # Split into sentences at punctuation boundaries
        sentences = _split_into_sentences(total_text)
        logger.info(
            "pyannote: %d chars → %d sentences for speaker assignment",
            total_chars, len(sentences),
        )

        # --- Rough per-sentence estimates from char-position interpolation ---
        # Used as the last-resort fallback, and by the Qwen aligner to
        # window long audio (it can only align ~5 min per call)
        char_time_anchors: list[tuple[int, float]] = []
        offset = 0
        for seg in segments:
            char_time_anchors.append((offset, seg.start))
            offset += len(seg.text)
        char_time_anchors.append((total_chars, total_audio_end))

        def _interp(char_pos: int) -> float:
            if char_pos <= 0:
                return char_time_anchors[0][1]
            if char_pos >= total_chars:
                return total_audio_end
            for ai in range(len(char_time_anchors) - 1):
                c0, t0 = char_time_anchors[ai]
                c1, t1 = char_time_anchors[ai + 1]
                if c0 <= char_pos <= c1:
                    if c1 == c0:
                        return t0
                    return t0 + (char_pos - c0) / (c1 - c0) * (t1 - t0)
            return total_audio_end

        rough_times: list[tuple[float, float]] = []
        char_pos = 0
        for sent in sentences:
            rough_times.append((_interp(char_pos), _interp(char_pos + len(sent))))
            char_pos += len(sent)

        # --- Get sentence timestamps via forced alignment ---
        sentence_times: list[Optional[tuple[float, float]]] = [None] * len(sentences)

        # Reuse preloaded audio; resample to 16kHz only if needed
        audio_np, sr = None, 16000
        try:
            if audio is not None:
                audio_np, sr = audio
            else:
                audio_np, sr = await asyncio.to_thread(_read_mono_audio, audio_path)
            if sr != 16000:
                import torch as th
                import torchaudio
                waveform_t = th.from_numpy(audio_np).unsqueeze(0)
                waveform_t = torchaudio.functional.resample(waveform_t, sr, 16000)
                audio_np = waveform_t.squeeze(0).numpy()
                sr = 16000
        except Exception as e:
            logger.warning("Audio loading for alignment failed: %s", e)
            audio_np = None

        if audio_np is not None:
            try:
                sentence_times = await self._aligner.align_sentences(
                    audio_np, sr, sentences, rough_times=rough_times,
                )
                aligned = sum(1 for t in sentence_times if t is not None)
                logger.info(
                    "Forced alignment: %d/%d sentences aligned",
                    aligned, len(sentences),
                )
            except Exception as e:
                logger.warning("Forced alignment failed: %s", e)

        # Fill unaligned sentences from the interpolation estimates
        for i in range(len(sentences)):
            if sentence_times[i] is None:
                sentence_times[i] = rough_times[i]

        # --- Assign speakers and build output ---
        turn_index = _TimelineIndex(timeline)
        sentence_assignments: list[tuple[str, str, float, float]] = []
        for i, sent in enumerate(sentences):
            s_start, s_end = sentence_times[i]  # type: ignore[misc]
            mid_time = (s_start + s_end) / 2.0
            spk = turn_index.speaker_at(mid_time)
            sentence_assignments.append((sent, spk or "Speaker 1", s_start, s_end))

        # Group consecutive same-speaker sentences
        result: list[Segment] = []
        if not sentence_assignments:
            return segments

        cur_text, cur_spk, cur_start, cur_end = sentence_assignments[0]

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

        if cur_text.strip():
            result.append(Segment(
                start=cur_start, end=cur_end,
                text=cur_text.strip(),
                speaker=cur_spk, confidence=1.0,
            ))

        logger.info(
            "pyannote: rebuilt %d segments → %d segments with speaker labels",
            len(segments), len(result),
        )
        for i, seg in enumerate(result[:10]):
            logger.info(
                "  result[%d]: %.2f-%.2fs %s text='%s'",
                i, seg.start, seg.end, seg.speaker, seg.text[:50],
            )
        if len(result) > 10:
            logger.info("  ... and %d more segments", len(result) - 10)

        return result


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def _rename_speakers(
    timeline: list[tuple[float, float, str]],
) -> tuple[list[tuple[float, float, str]], dict[str, str]]:
    """Rename pyannote speaker labels (SPEAKER_00, SPEAKER_01, ...)
    to sequential 'Speaker 1', 'Speaker 2', etc.

    Returns (renamed_timeline, original_label → new_label map)."""
    label_map: dict[str, str] = {}
    counter = 0
    result = []
    for ts, te, spk in timeline:
        if spk not in label_map:
            counter += 1
            label_map[spk] = f"Speaker {counter}"
        result.append((ts, te, label_map[spk]))
    return result, label_map


class _TimelineIndex:
    """Binary-search index over a start-sorted speaker timeline.

    Replaces the O(turns) linear scan per lookup — matters when a long
    meeting produces thousands of sentences × thousands of turns.
    """

    def __init__(self, timeline: list[tuple[float, float, str]]):
        self._timeline = sorted(timeline, key=lambda t: t[0])
        self._starts = [t[0] for t in self._timeline]
        self._max_dur = max((te - ts for ts, te, _ in self._timeline), default=0.0)

    def speaker_at(self, time: float) -> Optional[str]:
        """Speaker whose turn contains the time point, else nearest turn."""
        timeline = self._timeline
        if not timeline:
            return None

        idx = bisect.bisect_right(self._starts, time) - 1

        # Containing turn: only turns starting within max_dur before `time`
        # can contain it (turns may overlap, so scan left)
        j = idx
        while j >= 0 and time - timeline[j][0] <= self._max_dur:
            ts, te, spk = timeline[j]
            if ts <= time <= te:
                return spk
            j -= 1

        # Nearest turn: candidates are the neighbors of the insertion point
        best_spk = None
        min_dist = float("inf")
        for k in (idx, idx + 1):
            if 0 <= k < len(timeline):
                ts, te, spk = timeline[k]
                d = min(abs(time - ts), abs(time - te))
                if d < min_dist:
                    min_dist = d
                    best_spk = spk
        return best_spk


def _find_speaker_at_time(
    timeline: list[tuple[float, float, str]], time: float,
) -> Optional[str]:
    """Find the speaker active at a given time (single-lookup convenience)."""
    return _TimelineIndex(timeline).speaker_at(time)


def _assign_speakers_by_overlap(
    segments: list[Segment],
    timeline: list[tuple[float, float, str]],
) -> list[Segment]:
    """Assign speakers to segments with valid timestamps using overlap."""
    turn_index = _TimelineIndex(timeline)
    result = []
    for seg in segments:
        seg_mid = (seg.start + seg.end) / 2
        speaker = turn_index.speaker_at(seg_mid)
        result.append(Segment(
            start=seg.start, end=seg.end, text=seg.text,
            speaker=speaker or seg.speaker, confidence=seg.confidence,
        ))
    return result


def _split_into_sentences(text: str) -> list[str]:
    """Split text into sentences at Chinese/English punctuation boundaries.

    Each returned string includes its trailing punctuation.
    Splits at clause level (commas too) for finer speaker granularity.
    """
    parts = re.split(r"(?<=[。！？.!?，,；;])", text)

    sentences: list[str] = []
    for part in parts:
        if not part:
            continue
        if sentences and len(part.strip()) < 2:
            sentences[-1] += part
        else:
            sentences.append(part)

    return sentences if sentences else [text]
