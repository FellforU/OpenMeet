"""Auto-degradation strategy for engine selection.

Selects the best available engine based on:
1. Available GPU VRAM
2. Language requirements
3. Cloud API key availability

Strategy: Local GPU (large) → Local GPU (small) → Cloud API → Local CPU (tiny)
"""

from dataclasses import dataclass
from enum import Enum


class EngineMode(str, Enum):
    LOCAL = "local"
    CLOUD = "cloud"


@dataclass
class EngineRecommendation:
    engine: str
    model_size: str
    mode: EngineMode
    reason: str


# VRAM requirements (approximate, in GB)
VRAM_REQUIREMENTS = {
    "whisper": {"tiny": 1.0, "base": 1.5, "small": 2.0, "medium": 4.0, "large-v3": 6.0},
    "qwen3": {"qwen3-asr-0.6B": 3.0, "qwen3-asr-1.7B": 6.0},
    "paraformer": {"paraformer-large": 2.0},
}

CHINESE_CODES = {"zh", "yue", "wuu", "min_nan", "gan", "hakka", "xiang"}


def get_recommended_engine(
    language: str,
    available_vram_gb: float,
    has_openai_key: bool,
    has_alibaba_key: bool,
) -> EngineRecommendation:
    """Recommend the best engine based on available resources.

    Priority:
    1. Best local engine that fits in VRAM
    2. Cloud API fallback
    3. Smallest local model as last resort
    """
    is_chinese = language in CHINESE_CODES

    # Step 1: Try best local engine
    if is_chinese and available_vram_gb >= 3.0:
        if available_vram_gb >= 6.0:
            return EngineRecommendation(
                engine="qwen3",
                model_size="qwen3-asr-1.7B",
                mode=EngineMode.LOCAL,
                reason="Sufficient VRAM for Qwen3 1.7B (best Chinese accuracy)",
            )
        return EngineRecommendation(
            engine="qwen3",
            model_size="qwen3-asr-0.6B",
            mode=EngineMode.LOCAL,
            reason="Qwen3 0.6B fits available VRAM",
        )

    if not is_chinese and available_vram_gb >= 1.0:
        if available_vram_gb >= 6.0:
            return EngineRecommendation(
                engine="whisper",
                model_size="large-v3",
                mode=EngineMode.LOCAL,
                reason="Sufficient VRAM for Whisper large-v3 (best accuracy)",
            )
        if available_vram_gb >= 4.0:
            return EngineRecommendation(
                engine="whisper",
                model_size="medium",
                mode=EngineMode.LOCAL,
                reason="Whisper medium fits available VRAM",
            )
        if available_vram_gb >= 2.0:
            return EngineRecommendation(
                engine="whisper",
                model_size="small",
                mode=EngineMode.LOCAL,
                reason="Whisper small fits available VRAM",
            )
        return EngineRecommendation(
            engine="whisper",
            model_size="base",
            mode=EngineMode.LOCAL,
            reason="Whisper base fits available VRAM",
        )

    if is_chinese and available_vram_gb >= 2.0:
        return EngineRecommendation(
            engine="paraformer",
            model_size="paraformer-large",
            mode=EngineMode.LOCAL,
            reason="Paraformer fits available VRAM (Chinese optimized)",
        )

    # Step 2: Cloud API fallback
    if is_chinese and has_alibaba_key:
        return EngineRecommendation(
            engine="alibaba-asr",
            model_size="paraformer-v2",
            mode=EngineMode.CLOUD,
            reason="Insufficient VRAM, using Alibaba Cloud ASR",
        )

    if has_openai_key:
        return EngineRecommendation(
            engine="openai-whisper",
            model_size="whisper-1",
            mode=EngineMode.CLOUD,
            reason="Insufficient VRAM, using OpenAI Whisper API",
        )

    if not is_chinese and has_alibaba_key:
        return EngineRecommendation(
            engine="alibaba-asr",
            model_size="paraformer-v2",
            mode=EngineMode.CLOUD,
            reason="Insufficient VRAM, using Alibaba Cloud ASR",
        )

    # Step 3: Last resort - smallest local model
    return EngineRecommendation(
        engine="whisper",
        model_size="tiny",
        mode=EngineMode.LOCAL,
        reason="No GPU/cloud available, using Whisper tiny (CPU mode)",
    )
