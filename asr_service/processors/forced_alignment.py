"""Forced alignment using torchaudio MMS_FA (wav2vec2) for sentence-level timestamps.

Aligns transcribed text to audio to get precise time ranges for each sentence.
Used by diarization to accurately map speaker timeline to text positions,
replacing the imprecise character-position interpolation.

Requires: torchaudio>=2.1 (for MMS_FA pipeline), pypinyin (for Chinese romanization).
Falls back gracefully if dependencies are unavailable.
"""

import asyncio
import logging
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

try:
    from pypinyin import pinyin as _pinyin, Style as _PinyinStyle
except ImportError:
    _pinyin = None
    _PinyinStyle = None

# Emission is computed in chunks: transformer attention is O(T²) in audio
# length, so a single forward over a full meeting is unusably slow
_EMISSION_CHUNK_SECONDS = 30.0


class ForcedAligner:
    """Align text sentences to audio using MMS_FA wav2vec2 CTC forced alignment."""

    def __init__(self):
        self._model = None
        self._tokenizer = None
        self._aligner = None
        self._sample_rate = 16000
        self._device = "cpu"
        self._available: Optional[bool] = None

    def _ensure_loaded(self) -> bool:
        """Lazy-load MMS_FA model. Returns True if available."""
        if self._available is not None:
            return self._available

        try:
            import torch
            import torchaudio

            bundle = torchaudio.pipelines.MMS_FA
            self._model = bundle.get_model().eval()
            # Post-processing runs after the ASR engine is unloaded, so the
            # GPU is free; fall back to CPU if the move fails
            try:
                if torch.cuda.is_available():
                    self._model = self._model.cuda()
                    self._device = "cuda"
                else:
                    self._model = self._model.cpu()
                    self._device = "cpu"
            except Exception:
                self._model = self._model.cpu()
                self._device = "cpu"
            self._tokenizer = bundle.get_tokenizer()
            self._aligner = bundle.get_aligner()
            self._sample_rate = bundle.sample_rate
            self._available = True
            logger.info(
                "MMS_FA forced alignment model loaded (sr=%d, device=%s)",
                self._sample_rate, self._device,
            )
        except Exception as e:
            logger.warning("MMS_FA not available, will use interpolation fallback: %s", e)
            self._available = False

        return self._available

    async def align_sentences(
        self,
        audio_np: np.ndarray,
        sr: int,
        sentences: list[str],
    ) -> list[Optional[tuple[float, float]]]:
        """Align sentences to audio, returning time ranges.

        Args:
            audio_np: Mono audio as 1D float32 numpy array.
            sr: Audio sample rate.
            sentences: List of text sentences to align (in order).

        Returns:
            List of (start_sec, end_sec) for each sentence.
            None for sentences that failed to align.
        """
        if not sentences:
            return []

        def _run():
            return self._align_impl(audio_np, sr, sentences)

        return await asyncio.to_thread(_run)

    def _align_impl(
        self,
        audio_np: np.ndarray,
        sr: int,
        sentences: list[str],
    ) -> list[Optional[tuple[float, float]]]:
        """Core alignment implementation (runs in thread)."""
        if not self._ensure_loaded():
            return [None] * len(sentences)

        import torch
        import torchaudio

        # Prepare audio waveform
        waveform = torch.from_numpy(audio_np).unsqueeze(0).float()
        if sr != self._sample_rate:
            waveform = torchaudio.functional.resample(
                waveform, sr, self._sample_rate,
            )
        audio_dur = waveform.shape[1] / self._sample_rate

        # Romanize each sentence and tokenize individually
        sentence_tokens: list[list[int]] = []
        for sent in sentences:
            roman = _romanize(sent)
            tokens = self._tokenizer(roman) if roman.strip() else []
            sentence_tokens.append(tokens)

        # Build concatenated token sequence + per-sentence ranges
        all_tokens: list[int] = []
        sentence_ranges: list[tuple[int, int]] = []
        for tokens in sentence_tokens:
            start = len(all_tokens)
            all_tokens.extend(tokens)
            sentence_ranges.append((start, len(all_tokens)))

        if not all_tokens:
            logger.warning("MMS_FA: no valid tokens after romanization")
            return [None] * len(sentences)

        # Get CTC emission probabilities (chunked to bound attention cost)
        try:
            emission = self._compute_emission(waveform)
        except Exception as e:
            logger.warning(
                "MMS_FA emission failed (audio %.1fs, %d samples): %s",
                audio_dur, waveform.shape[1], e,
            )
            return [None] * len(sentences)

        n_frames = emission.shape[1]
        fps = n_frames / audio_dur  # frames per second

        # Run CTC forced alignment
        try:
            token_spans = self._aligner(emission[0], all_tokens)
        except Exception as e:
            logger.warning("MMS_FA forced alignment failed: %s", e)
            return [None] * len(sentences)

        n_spans = len(token_spans)
        logger.info(
            "MMS_FA alignment: %d tokens → %d spans, audio=%.1fs, fps=%.1f",
            len(all_tokens), n_spans, audio_dur, fps,
        )

        # Extract time range for each sentence
        results: list[Optional[tuple[float, float]]] = []
        for start_idx, end_idx in sentence_ranges:
            if start_idx >= n_spans or end_idx > n_spans or start_idx == end_idx:
                results.append(None)
                continue
            start_sec = token_spans[start_idx].start / fps
            end_sec = token_spans[end_idx - 1].end / fps
            results.append((start_sec, end_sec))

        aligned_count = sum(1 for r in results if r is not None)
        logger.info(
            "MMS_FA: aligned %d/%d sentences", aligned_count, len(sentences),
        )
        return results

    def _compute_emission(self, waveform):
        """Compute CTC emissions in ~30s chunks concatenated along time.

        Attention within a chunk is enough for frame-level CTC alignment,
        and keeps memory/time linear in audio length.
        """
        import torch

        chunk_samples = int(_EMISSION_CHUNK_SECONDS * self._sample_rate)
        total = waveform.shape[1]

        if total <= chunk_samples:
            with torch.no_grad():
                emission, _ = self._model(waveform.to(self._device))
            return emission.cpu()

        parts = []
        offset = 0
        while offset < total:
            end = offset + chunk_samples
            # Fold a short tail into the last chunk instead of running a
            # sub-second forward pass
            if total - end < self._sample_rate:
                end = total
            piece = waveform[:, offset:end].to(self._device)
            with torch.no_grad():
                emission, _ = self._model(piece)
            parts.append(emission.cpu())
            offset = end
        return torch.cat(parts, dim=1)


# ---------------------------------------------------------------------------
# Text romanization for MMS_FA
# ---------------------------------------------------------------------------

def _romanize(text: str) -> str:
    """Convert text to romanized form for MMS_FA tokenizer.

    Chinese characters → pinyin (via pypinyin).
    ASCII letters → lowercase.
    Punctuation/digits/other → removed.
    """
    parts: list[str] = []
    for char in text:
        if _is_cjk(char):
            if _pinyin is not None:
                py = _pinyin(char, style=_PinyinStyle.NORMAL)[0][0]
                parts.append(py)
            # Without pypinyin, CJK chars are skipped (partial alignment)
        elif char.isascii() and char.isalpha():
            parts.append(char.lower())

    return " ".join(parts)


def _is_cjk(char: str) -> bool:
    """Check if a character is CJK (Chinese/Japanese/Korean)."""
    cp = ord(char)
    return (
        (0x4E00 <= cp <= 0x9FFF)
        or (0x3400 <= cp <= 0x4DBF)
        or (0xF900 <= cp <= 0xFAFF)
        or (0x20000 <= cp <= 0x2A6DF)
    )
