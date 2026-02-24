import asyncio
import subprocess
import tempfile
from pathlib import Path
from typing import Optional


async def preprocess_audio(
    input_path: str,
    output_dir: Optional[str] = None,
    sample_rate: int = 16000,
) -> str:
    """Convert audio/video to WAV format suitable for ASR.

    Returns path to the converted WAV file.
    """
    input_file = Path(input_path)
    if not input_file.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    if output_dir:
        out_dir = Path(output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
    else:
        out_dir = Path(tempfile.mkdtemp(prefix="openmeet_"))

    output_path = out_dir / f"{input_file.stem}_16k.wav"

    cmd = [
        "ffmpeg", "-y",
        "-i", str(input_path),
        "-ar", str(sample_rate),
        "-ac", "1",
        "-c:a", "pcm_s16le",
        str(output_path),
    ]

    def _run():
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"ffmpeg conversion failed: {result.stderr[:500]}"
            )
        return str(output_path)

    return await asyncio.to_thread(_run)
