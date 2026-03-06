"""pyannote-audio based speaker diarization.

Industry-standard speaker diarization with ~16ms resolution.
Supports all languages, overlapping speech detection, and automatic
speaker count estimation.

Requires: pyannote-audio>=3.0, HuggingFace token (for model download).
Falls back gracefully if unavailable — caller should try CAMPPlus instead.
"""

import asyncio
import logging
import os
import re
from typing import Optional

import numpy as np

from asr_service.models.job import Segment
from asr_service.processors.forced_alignment import ForcedAligner

logger = logging.getLogger(__name__)


class PyAnnoteDiarizer:
    """Speaker diarization using pyannote-audio pipeline.

    Handles both normal segments (with timestamps) and zero-duration
    segments (Qwen3-ASR) via forced alignment + sentence-level splitting.
    """

    def __init__(self):
        self._pipeline = None
        self._aligner = ForcedAligner()
        self._load_attempted = False

    async def load(self) -> None:
        """Load pyannote pipeline. Only attempts once."""
        if self._pipeline or self._load_attempted:
            return
        self._load_attempted = True

        hf_token = os.environ.get("HF_TOKEN") or os.environ.get(
            "HUGGING_FACE_HUB_TOKEN"
        )

        def _load():
            try:
                from pyannote.audio import Pipeline

                pipeline = Pipeline.from_pretrained(
                    "pyannote/speaker-diarization-3.1",
                    token=hf_token,
                )
                import torch
                device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
                pipeline = pipeline.to(device)
                logger.info("pyannote speaker-diarization-3.1 loaded")
                return pipeline
            except Exception as e:
                logger.warning("pyannote load failed: %s", e)
                return None

        self._pipeline = await asyncio.to_thread(_load)

    def is_available(self) -> bool:
        return self._pipeline is not None

    async def process(
        self,
        audio_path: str,
        segments: list[Segment],
        num_speakers: Optional[int] = None,
    ) -> list[Segment]:
        """Run speaker diarization and assign labels to segments.

        For zero-duration segments (Qwen3-ASR), rebuilds the transcript
        with sentence-level speaker assignment using forced alignment.
        For normal segments, assigns speaker based on time overlap.

        Args:
            audio_path: Path to audio file.
            segments: ASR output segments.
            num_speakers: Optional hint for number of speakers.
        """
        if not segments:
            return segments

        if not self._pipeline:
            await self.load()
        if not self._pipeline:
            # Fall back to CAMPPlus when pyannote unavailable
            logger.info("pyannote unavailable, falling back to CAMPPlus")
            from asr_service.processors.diarization.factory import create_campplus_fallback
            fallback = create_campplus_fallback()
            return await fallback.process(audio_path, segments, num_speakers=num_speakers)

        pipeline_ref = self._pipeline

        # Preload audio as waveform dict to bypass torchcodec/AudioDecoder
        # pyannote accepts {"waveform": Tensor(channel, time), "sample_rate": int}
        # Use soundfile instead of torchaudio to avoid torchcodec dependency
        import soundfile as sf
        import torch
        audio_data, sample_rate = sf.read(audio_path, dtype="float32")
        # soundfile returns (samples,) for mono or (samples, channels) for multi-channel
        waveform = torch.from_numpy(audio_data)
        if waveform.ndim == 1:
            waveform = waveform.unsqueeze(0)  # (1, samples)
        else:
            waveform = waveform.T  # (channels, samples)
        audio_input = {"waveform": waveform, "sample_rate": sample_rate}

        # Run pyannote diarization
        def _diarize():
            try:
                kwargs = {}
                if num_speakers and num_speakers >= 2:
                    kwargs["min_speakers"] = num_speakers
                    kwargs["max_speakers"] = num_speakers

                diarization = pipeline_ref(audio_input, **kwargs)

                # Handle different return types from pyannote versions
                # Newer versions may return DiarizeOutput; extract annotation
                if hasattr(diarization, "itertracks"):
                    annotation = diarization
                elif hasattr(diarization, "speaker_diarization"):
                    annotation = diarization.speaker_diarization
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
                    return []

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

                return timeline
            except Exception as e:
                logger.warning("pyannote diarization failed: %s", e, exc_info=True)
                return []

        timeline = await asyncio.to_thread(_diarize)

        if not timeline:
            return segments

        # Rename speakers to sequential "Speaker 1", "Speaker 2", etc.
        timeline = _rename_speakers(timeline)

        # Decide whether to use sentence-level splitting:
        # 1. Zero-duration segments (e.g., Qwen3 raw output)
        # 2. Coarse segments (e.g., 30s chunks) where avg duration is too long
        #    for accurate per-segment speaker assignment
        zero_dur_count = sum(
            1 for seg in segments if seg.end - seg.start < 0.01
        )
        total_dur = sum(seg.end - seg.start for seg in segments)
        avg_dur = total_dur / len(segments) if segments else 0
        use_sentence_split = (
            zero_dur_count > len(segments) * 0.8
            or avg_dur > 15.0
        )

        if use_sentence_split:
            logger.info(
                "pyannote: %d/%d zero-dur, avg_dur=%.1fs, using sentence-level splitting",
                zero_dur_count, len(segments), avg_dur,
            )
            return await self._apply_timeline_to_segments(
                audio_path, segments, timeline,
            )

        # Normal path: assign speaker based on segment midpoint
        return _assign_speakers_by_overlap(segments, timeline)

    async def _apply_timeline_to_segments(
        self,
        audio_path: str,
        segments: list[Segment],
        timeline: list[tuple[float, float, str]],
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

        # --- Get sentence timestamps via forced alignment ---
        sentence_times: list[Optional[tuple[float, float]]] = [None] * len(sentences)

        # Load audio for forced alignment (using soundfile to avoid torchcodec)
        audio_np, sr = None, 16000
        try:
            import soundfile as sf_align
            audio_data, file_sr = sf_align.read(audio_path, dtype="float32")
            # Convert to mono if multi-channel
            if audio_data.ndim > 1:
                audio_data = audio_data.mean(axis=1)
            # Resample to 16kHz if needed
            if file_sr != 16000:
                import torchaudio
                import torch as th
                waveform_t = th.from_numpy(audio_data).unsqueeze(0)
                waveform_t = torchaudio.functional.resample(waveform_t, file_sr, 16000)
                audio_data = waveform_t.squeeze(0).numpy()
            audio_np = audio_data
            sr = 16000
        except Exception as e:
            logger.warning("Audio loading for alignment failed: %s", e)

        if audio_np is not None:
            try:
                sentence_times = await self._aligner.align_sentences(
                    audio_np, sr, sentences,
                )
                aligned = sum(1 for t in sentence_times if t is not None)
                logger.info(
                    "Forced alignment: %d/%d sentences aligned",
                    aligned, len(sentences),
                )
            except Exception as e:
                logger.warning("Forced alignment failed: %s", e)

        # Interpolation fallback for unaligned sentences
        has_unaligned = any(t is None for t in sentence_times)
        if has_unaligned:
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

            char_pos = 0
            for i, sent in enumerate(sentences):
                if sentence_times[i] is None:
                    s_start = _interp(char_pos)
                    s_end = _interp(char_pos + len(sent))
                    sentence_times[i] = (s_start, s_end)
                char_pos += len(sent)

        # --- Assign speakers and build output ---
        sentence_assignments: list[tuple[str, str, float, float]] = []
        for i, sent in enumerate(sentences):
            s_start, s_end = sentence_times[i]  # type: ignore[misc]
            mid_time = (s_start + s_end) / 2.0
            spk = _find_speaker_at_time(timeline, mid_time)
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
) -> list[tuple[float, float, str]]:
    """Rename pyannote speaker labels (SPEAKER_00, SPEAKER_01, ...)
    to sequential 'Speaker 1', 'Speaker 2', etc."""
    label_map: dict[str, str] = {}
    counter = 0
    result = []
    for ts, te, spk in timeline:
        if spk not in label_map:
            counter += 1
            label_map[spk] = f"Speaker {counter}"
        result.append((ts, te, label_map[spk]))
    return result


def _find_speaker_at_time(
    timeline: list[tuple[float, float, str]], time: float,
) -> Optional[str]:
    """Find the speaker active at a given time.

    Returns the speaker whose turn contains the time point.
    Falls back to the nearest turn if no exact match.
    """
    # Exact match
    for ts, te, spk in timeline:
        if ts <= time <= te:
            return spk

    # Nearest turn
    best_spk = None
    min_dist = float("inf")
    for ts, te, spk in timeline:
        d = min(abs(time - ts), abs(time - te))
        if d < min_dist:
            min_dist = d
            best_spk = spk
    return best_spk


def _assign_speakers_by_overlap(
    segments: list[Segment],
    timeline: list[tuple[float, float, str]],
) -> list[Segment]:
    """Assign speakers to segments with valid timestamps using overlap."""
    result = []
    for seg in segments:
        seg_mid = (seg.start + seg.end) / 2
        speaker = _find_speaker_at_time(timeline, seg_mid)
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
