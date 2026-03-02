"""Auto-detect GPU and install CUDA-enabled PyTorch if needed.

Runs as a pre-startup step before the ASR service.
- Detects NVIDIA GPU via nvidia-smi
- Checks if current PyTorch has CUDA support
- If GPU detected but torch is CPU-only, installs CUDA version automatically
"""

import logging
import re
import subprocess
import sys

logging.basicConfig(level=logging.INFO, format="[gpu_setup] %(message)s")
logger = logging.getLogger(__name__)

# Available PyTorch CUDA builds (newest first)
# Map (cuda_major, cuda_minor) -> pip index URL suffix
_CUDA_BUILDS = [
    ((12, 8), "cu128"),
    ((12, 6), "cu126"),
    ((12, 4), "cu124"),
    ((12, 1), "cu121"),
    ((11, 8), "cu118"),
]

_INDEX_BASE = "https://download.pytorch.org/whl"


def _get_nvidia_cuda_version() -> tuple[int, int] | None:
    """Run nvidia-smi and extract the CUDA driver version.

    Returns (major, minor) tuple or None if no NVIDIA GPU.
    """
    try:
        result = subprocess.run(
            ["nvidia-smi"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            return None
        match = re.search(r"CUDA Version:\s*(\d+)\.(\d+)", result.stdout)
        if match:
            return (int(match.group(1)), int(match.group(2)))
        return None
    except FileNotFoundError:
        return None
    except Exception as e:
        logger.warning("nvidia-smi failed: %s", e)
        return None


def _get_best_index_url(cuda_version: tuple[int, int]) -> str | None:
    """Find the best PyTorch CUDA index URL for the given driver version.

    NVIDIA drivers are backward compatible, so CUDA 13.0 driver can run
    cu128 (CUDA 12.8) PyTorch runtime.
    """
    for required, suffix in _CUDA_BUILDS:
        if cuda_version >= required:
            return f"{_INDEX_BASE}/{suffix}"
    return None


def _torch_has_cuda() -> bool:
    """Check if the currently installed torch has CUDA support."""
    try:
        import torch
        return torch.cuda.is_available()
    except ImportError:
        return False


def _torch_is_cuda_build() -> bool:
    """Check if torch was compiled with CUDA (even if GPU is not detected at runtime)."""
    try:
        import torch
        return torch.version.cuda is not None and "+cu" in torch.__version__
    except (ImportError, AttributeError):
        return False


def _install_cuda_torch(index_url: str) -> bool:
    """Install CUDA-enabled PyTorch via pip."""
    cmd = [
        sys.executable, "-m", "pip", "install",
        "torch", "torchaudio",
        "--index-url", index_url,
    ]
    logger.info("Running: %s", " ".join(cmd))
    try:
        subprocess.check_call(cmd)
        return True
    except subprocess.CalledProcessError as e:
        logger.error("pip install failed (exit code %d)", e.returncode)
        return False


def main() -> int:
    """Auto-detect GPU and install CUDA PyTorch if needed.

    Returns:
        0: No action needed (already CUDA or no GPU)
        1: CUDA torch installed successfully (restart needed)
        2: Installation failed
    """
    # Step 1: Check for NVIDIA GPU
    cuda_version = _get_nvidia_cuda_version()
    if not cuda_version:
        logger.info("No NVIDIA GPU detected, using CPU mode")
        return 0

    logger.info("NVIDIA GPU detected, CUDA driver version: %d.%d", *cuda_version)

    # Step 2: Check if torch already has CUDA
    if _torch_has_cuda():
        import torch
        logger.info(
            "CUDA already available: %s (%s)",
            torch.cuda.get_device_name(0),
            torch.__version__,
        )
        return 0

    # Step 3: Check if torch is a CUDA build but GPU isn't detected at runtime
    # (rare edge case — driver issue, not a torch installation issue)
    if _torch_is_cuda_build():
        import torch
        logger.warning(
            "PyTorch is a CUDA build (%s) but torch.cuda.is_available()=False. "
            "This may be a driver compatibility issue.",
            torch.__version__,
        )
        return 0

    # Step 4: Find the best CUDA index URL
    index_url = _get_best_index_url(cuda_version)
    if not index_url:
        logger.warning(
            "No compatible PyTorch CUDA build for CUDA %d.%d",
            *cuda_version,
        )
        return 0

    # Step 5: Install CUDA torch
    logger.info("Installing CUDA PyTorch from %s ...", index_url)
    if _install_cuda_torch(index_url):
        logger.info("CUDA PyTorch installed successfully")
        return 1
    else:
        logger.error("Failed to install CUDA PyTorch, falling back to CPU")
        return 2


if __name__ == "__main__":
    sys.exit(main())
