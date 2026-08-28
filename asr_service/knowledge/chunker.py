"""Text chunking utilities for knowledge indexing."""

from dataclasses import dataclass


@dataclass
class Chunk:
    """A text chunk with metadata."""

    text: str
    source_type: str  # "segment" | "summary" | "note" | "attachment"
    project_id: str
    metadata: dict  # speaker, timestamp, filename, etc.


def chunk_text(
    text: str,
    chunk_size: int = 500,
    overlap: int = 50,
) -> list[str]:
    """Split text into overlapping chunks by character count.

    Tries to split at sentence boundaries when possible.
    """
    if not text or not text.strip():
        return []

    if len(text) <= chunk_size:
        return [text]

    chunks = []
    start = 0
    sentence_endings = set("。！？.!?\n")

    while start < len(text):
        end = min(start + chunk_size, len(text))

        # Try to find a sentence boundary near the end
        if end < len(text):
            best_break = -1
            search_start = max(start + chunk_size - overlap, start)
            for i in range(end, search_start, -1):
                if text[i - 1] in sentence_endings:
                    best_break = i
                    break
            if best_break > start:
                end = best_break

        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)

        # Move forward with overlap
        start = end - overlap if end < len(text) else end

    return chunks


def chunk_segments(
    segments: list[dict],
    project_id: str,
    chunk_size: int = 500,
) -> list[Chunk]:
    """Chunk transcription segments, grouping consecutive segments."""
    if not segments:
        return []

    chunks = []
    buffer_text = ""
    buffer_start = segments[0].get("start_time", 0)
    buffer_speaker = segments[0].get("speaker")

    for seg in segments:
        seg_text = seg.get("text", "").strip()
        if not seg_text:
            continue

        if len(buffer_text) + len(seg_text) > chunk_size and buffer_text:
            chunks.append(
                Chunk(
                    text=buffer_text.strip(),
                    source_type="segment",
                    project_id=project_id,
                    metadata={
                        "start_time": buffer_start,
                        "end_time": seg.get("end_time", 0),
                        "speaker": buffer_speaker,
                    },
                )
            )
            buffer_text = seg_text + " "
            buffer_start = seg.get("start_time", 0)
            buffer_speaker = seg.get("speaker")
        else:
            buffer_text += seg_text + " "

    if buffer_text.strip():
        chunks.append(
            Chunk(
                text=buffer_text.strip(),
                source_type="segment",
                project_id=project_id,
                metadata={
                    "start_time": buffer_start,
                    "speaker": buffer_speaker,
                },
            )
        )

    return chunks
