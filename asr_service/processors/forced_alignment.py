"""Forced alignment for sentence-level timestamps.

Primary: Qwen3-ForcedAligner-0.6B (qwen-asr) — char/word level, 11 languages,
far better Chinese accuracy than wav2vec2 romanization.
Fallback: torchaudio MMS_FA (wav2vec2 CTC + pinyin romanization).
Both fall back gracefully; caller uses interpolation when unavailable.

Used by diarization to accurately map speaker timeline to text positions.
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

# MMS_FA emission is computed in chunks: transformer attention is O(T²) in
# audio length, so a single forward over a full meeting is unusably slow
_EMISSION_CHUNK_SECONDS = 30.0

# Qwen3-ForcedAligner supports at most ~5 min of audio per call;
# longer meetings are windowed using rough sentence-time estimates
_QWEN_WINDOW_SECONDS = 240.0
_QWEN_SINGLE_PASS_MAX = 280.0
_QWEN_WINDOW_MARGIN = 5.0

_QWEN_MODEL_ID = "Qwen/Qwen3-ForcedAligner-0.6B"

# job.language → Qwen aligner language name
_QWEN_LANGUAGES = {
    "zh": "Chinese",
    "yue": "Cantonese",
    "en": "English",
    "ja": "Japanese",
    "ko": "Korean",
    "fr": "French",
    "de": "German",
    "it": "Italian",
    "pt": "Portuguese",
    "ru": "Russian",
    "es": "Spanish",
}


def _key_len(text: str) -> int:
    """Count alignable units (CJK chars + ASCII alnum chars).

    Punctuation and whitespace are excluded on both the sentence side and
    the aligner-output side, so the greedy matcher stays in sync even when
    the aligner drops punctuation.
    """
    return sum(1 for c in text if c.isalnum() or _is_cjk(c))


class ForcedAligner:
    """Align text sentences to audio for precise timestamps."""

    def __init__(self):
        # Qwen3-ForcedAligner (primary)
        self._qwen = None
        self._qwen_available: Optional[bool] = None
        # MMS_FA (fallback)
        self._model = None
        self._tokenizer = None
        self._aligner = None
        self._sample_rate = 16000
        self._device = "cpu"
        self._available: Optional[bool] = None

    # ------------------------------------------------------------------
    # Qwen3-ForcedAligner (primary)
    # ------------------------------------------------------------------

    def _ensure_qwen_loaded(self) -> bool:
        if self._qwen_available is not None:
            return self._qwen_available
        try:
            import torch
            from qwen_asr import Qwen3ForcedAligner
            from asr_service.services import model_source

            # 本地已有直接离线加载；否则经 ModelScope 国内源下载
            local = model_source.local_path(_QWEN_MODEL_ID)
            if not local:
                local = model_source.download_sync(_QWEN_MODEL_ID)

            if torch.cuda.is_available():
                dtype, device_map = torch.bfloat16, "cuda:0"
            else:
                dtype, device_map = torch.float32, "cpu"
            self._qwen = Qwen3ForcedAligner.from_pretrained(
                local, dtype=dtype, device_map=device_map,
            )
            self._qwen_available = True
            logger.info(
                "Qwen3-ForcedAligner-0.6B loaded (device=%s, path=%s)",
                device_map, local,
            )
        except Exception as e:
            logger.warning(
                "Qwen3-ForcedAligner unavailable, falling back to MMS_FA: %s", e,
            )
            self._qwen_available = False
        return self._qwen_available

    def _align_qwen(
        self,
        audio_np: np.ndarray,
        sr: int,
        sentences: list[str],
        rough_times: Optional[list[tuple[float, float]]],
        language: str,
    ) -> Optional[list[Optional[tuple[float, float]]]]:
        """Align via Qwen3-ForcedAligner. Returns None to request fallback."""
        if not self._ensure_qwen_loaded():
            return None

        audio_dur = len(audio_np) / sr

        # Build windows of (sentence indices, t0, t1) each ≤ ~5 min
        if audio_dur <= _QWEN_SINGLE_PASS_MAX:
            windows = [(list(range(len(sentences))), 0.0, audio_dur)]
        else:
            # Long audio needs rough per-sentence times for windowing
            if not rough_times or len(rough_times) != len(sentences):
                return None
            span = max(e for _, e in rough_times) - min(s for s, _ in rough_times)
            if span < audio_dur * 0.5:
                # Estimates are degenerate (e.g. zero-duration ASR output)
                return None

            windows = []
            cur_idx: list[int] = []
            cur_start = 0.0
            for i in range(len(sentences)):
                s_start, s_end = rough_times[i]
                if not cur_idx:
                    cur_idx = [i]
                    cur_start = s_start
                elif s_end - cur_start > _QWEN_WINDOW_SECONDS:
                    windows.append((cur_idx, cur_start, rough_times[cur_idx[-1]][1]))
                    cur_idx = [i]
                    cur_start = s_start
                else:
                    cur_idx.append(i)
            if cur_idx:
                windows.append((cur_idx, cur_start, rough_times[cur_idx[-1]][1]))

        results: list[Optional[tuple[float, float]]] = [None] * len(sentences)

        for idxs, w_start, w_end in windows:
            t0 = max(0.0, w_start - _QWEN_WINDOW_MARGIN)
            t1 = min(audio_dur, w_end + _QWEN_WINDOW_MARGIN)
            chunk = audio_np[int(t0 * sr):int(t1 * sr)]
            if len(chunk) < sr:
                continue
            text = "".join(sentences[i] for i in idxs)
            if not _key_len(text):
                continue
            try:
                aligned = self._qwen.align(
                    audio=(chunk, sr), text=text, language=language,
                )
                items = list(aligned[0])
            except Exception as e:
                logger.warning(
                    "Qwen aligner window %.0f-%.0fs failed: %r", t0, t1, e,
                )
                continue

            # Greedy matching: consume aligned items until each sentence's
            # alignable-unit count is satisfied
            item_pos = 0
            for i in idxs:
                target = _key_len(sentences[i])
                if target == 0 or item_pos >= len(items):
                    continue
                consumed = 0
                first_item = None
                last_item = None
                while item_pos < len(items) and consumed < target:
                    item = items[item_pos]
                    if first_item is None:
                        first_item = item
                    last_item = item
                    consumed += max(1, _key_len(item.text))
                    item_pos += 1
                if first_item is not None and last_item is not None:
                    results[i] = (
                        t0 + float(first_item.start_time),
                        t0 + float(last_item.end_time),
                    )

        aligned_count = sum(1 for r in results if r is not None)
        logger.info(
            "Qwen3-ForcedAligner: aligned %d/%d sentences (%d windows)",
            aligned_count, len(sentences), len(windows),
        )
        return results if aligned_count > 0 else None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def align_sentences(
        self,
        audio_np: np.ndarray,
        sr: int,
        sentences: list[str],
        rough_times: Optional[list[tuple[float, float]]] = None,
        language: Optional[str] = None,
    ) -> list[Optional[tuple[float, float]]]:
        """Align sentences to audio, returning time ranges.

        Args:
            audio_np: Mono audio as 1D float32 numpy array.
            sr: Audio sample rate.
            sentences: List of text sentences to align (in order).
            rough_times: Optional per-sentence rough (start, end) estimates,
                used to window long audio for the Qwen aligner.
            language: job language code (zh/en/...), defaults to Chinese.

        Returns:
            List of (start_sec, end_sec) for each sentence.
            None for sentences that failed to align.
        """
        if not sentences:
            return []

        qwen_language = _QWEN_LANGUAGES.get(language or "zh", "Chinese")

        def _run():
            qwen_result = self._align_qwen(
                audio_np, sr, sentences, rough_times, qwen_language,
            )
            if qwen_result is not None:
                return qwen_result
            return self._align_mms(audio_np, sr, sentences)

        return await asyncio.to_thread(_run)

    # ------------------------------------------------------------------
    # MMS_FA (fallback)
    # ------------------------------------------------------------------

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

    def _align_mms(
        self,
        audio_np: np.ndarray,
        sr: int,
        sentences: list[str],
    ) -> list[Optional[tuple[float, float]]]:
        """MMS_FA wav2vec2 CTC alignment (runs in thread)."""
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

        # Romanize each sentence into words; the MMS_FA tokenizer takes a
        # LIST OF WORDS (a raw string would be iterated char-by-char and
        # blow up on spaces with KeyError)
        all_tokens: list[list[int]] = []  # one token list per word
        sentence_ranges: list[tuple[int, int]] = []  # word-index ranges
        for sent in sentences:
            words = _romanize(sent).split()
            start = len(all_tokens)
            if words:
                try:
                    all_tokens.extend(self._tokenizer(words))
                except Exception:
                    # Some word has chars outside the model vocab —
                    # tokenize word-by-word and drop the offenders
                    for word in words:
                        try:
                            all_tokens.extend(self._tokenizer([word]))
                        except Exception:
                            pass
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

        # Run CTC forced alignment — returns one TokenSpan list per word
        try:
            word_spans = self._aligner(emission[0], all_tokens)
        except Exception as e:
            logger.warning("MMS_FA forced alignment failed: %r", e)
            return [None] * len(sentences)

        n_spans = len(word_spans)
        logger.info(
            "MMS_FA alignment: %d words → %d spans, audio=%.1fs, fps=%.1f",
            len(all_tokens), n_spans, audio_dur, fps,
        )

        # Extract time range for each sentence from its word spans
        results: list[Optional[tuple[float, float]]] = []
        for start_idx, end_idx in sentence_ranges:
            if start_idx >= n_spans or end_idx > n_spans or start_idx == end_idx:
                results.append(None)
                continue
            first = word_spans[start_idx]
            last = word_spans[end_idx - 1]
            if not first or not last:
                results.append(None)
                continue
            start_sec = first[0].start / fps
            end_sec = last[-1].end / fps
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
    ascii_buf: list[str] = []

    def _flush_ascii():
        # Consecutive ASCII letters form ONE word (e.g. "hello"), not
        # one word per letter
        if ascii_buf:
            parts.append("".join(ascii_buf))
            ascii_buf.clear()

    for char in text:
        if _is_cjk(char):
            _flush_ascii()
            if _pinyin is not None:
                py = _pinyin(char, style=_PinyinStyle.NORMAL)[0][0]
                # Keep only a-z — the MMS_FA vocab has no accented chars
                py = "".join(c for c in py.lower() if "a" <= c <= "z")
                if py:
                    parts.append(py)
            # Without pypinyin, CJK chars are skipped (partial alignment)
        elif char.isascii() and char.isalpha():
            ascii_buf.append(char.lower())
        else:
            _flush_ascii()
    _flush_ascii()

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
