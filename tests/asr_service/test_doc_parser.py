"""Tests for the document parser."""

import pytest

from asr_service.knowledge.doc_parser import extract_text


@pytest.mark.asyncio
async def test_extract_text_file(tmp_path):
    f = tmp_path / "test.txt"
    f.write_text("Hello world\nLine 2", encoding="utf-8")
    result = await extract_text(str(f))
    assert "Hello world" in result
    assert "Line 2" in result


@pytest.mark.asyncio
async def test_extract_markdown(tmp_path):
    f = tmp_path / "test.md"
    f.write_text("# Title\n\nContent here", encoding="utf-8")
    result = await extract_text(str(f))
    assert "Title" in result


@pytest.mark.asyncio
async def test_extract_nonexistent():
    result = await extract_text("/nonexistent/file.txt")
    assert result == ""


@pytest.mark.asyncio
async def test_extract_unsupported(tmp_path):
    f = tmp_path / "test.xyz"
    f.write_bytes(b"binary data")
    result = await extract_text(str(f))
    assert result == ""
