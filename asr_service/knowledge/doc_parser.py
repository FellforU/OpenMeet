"""Document text extraction for attachments."""

import asyncio
from pathlib import Path


async def extract_text(file_path: str) -> str:
    """Extract text from a document file.

    Supports: PDF, DOCX, TXT, MD, CSV.
    Returns empty string for unsupported formats.
    """
    path = Path(file_path)
    if not path.exists():
        return ""

    ext = path.suffix.lower()

    if ext == ".pdf":
        return await _extract_pdf(file_path)
    elif ext == ".docx":
        return await _extract_docx(file_path)
    elif ext in (".txt", ".md", ".csv"):
        return await _extract_text_file(file_path)
    else:
        return ""


async def _extract_pdf(file_path: str) -> str:
    def _read():
        import pymupdf

        doc = pymupdf.open(file_path)
        texts = []
        for page in doc:
            texts.append(page.get_text())
        doc.close()
        return "\n".join(texts)

    return await asyncio.to_thread(_read)


async def _extract_docx(file_path: str) -> str:
    def _read():
        from docx import Document

        doc = Document(file_path)
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip())

    return await asyncio.to_thread(_read)


async def _extract_text_file(file_path: str) -> str:
    def _read():
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()

    return await asyncio.to_thread(_read)
