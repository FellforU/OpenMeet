"""统一的模型下载源：ModelScope（魔搭）。

所有模型下载一律走 ModelScope 国内源，彻底绕开 HuggingFace 直连不稳、
镜像不可靠、gated 模型要 Token 的问题：

- 下载目录：{缓存目录}/models/ms/{org}__{name}/（平铺，无 blobs/snapshots 间接层）
- 完整性：下载成功并校验权重文件后写入 .download_complete 标记；
  判断"已下载"以标记 + 权重文件为准，杜绝半截包被误判为完成
"""

import asyncio
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_COMPLETE_MARKER = ".download_complete"

# 判定"有权重"的文件模式
_WEIGHT_PATTERNS = ("*.bin", "*.safetensors", "*.onnx", "*.pt", "*.ckpt")


def _models_root() -> Path:
    """模型根目录：{cacheDir}/models，未配置时用用户目录默认值。"""
    from asr_service.config import get_model_cache_dir

    cache_dir = get_model_cache_dir()
    if cache_dir:
        return Path(cache_dir)
    return Path.home() / ".cache" / "openmeet" / "models"


def ms_model_dir(repo_id: str) -> Path:
    """ModelScope 模型的本地目录。"""
    return _models_root() / "ms" / repo_id.replace("/", "__")


def has_weights(path: Path) -> bool:
    return any(f for pattern in _WEIGHT_PATTERNS for f in path.rglob(pattern))


def is_downloaded(repo_id: str, need_weights: bool = True) -> bool:
    """模型是否已完整下载（以完成标记 + 权重文件为准）。"""
    d = ms_model_dir(repo_id)
    if not (d / _COMPLETE_MARKER).exists():
        return False
    if need_weights and not has_weights(d):
        return False
    return True


def download_sync(repo_id: str, need_weights: bool = True) -> str:
    """同步下载（在线程里调用）。返回本地目录。

    ModelScope SDK 自带断点续传；完成后校验并写入完成标记。
    """
    from modelscope import snapshot_download

    target = ms_model_dir(repo_id)
    target.mkdir(parents=True, exist_ok=True)
    marker = target / _COMPLETE_MARKER
    if marker.exists():
        marker.unlink()

    logger.info("ModelScope 下载: %s → %s", repo_id, target)
    snapshot_download(repo_id, local_dir=str(target))

    if need_weights and not has_weights(target):
        raise RuntimeError(
            f"Download incomplete: no weight files in {target} after download"
        )
    marker.write_text("ok", encoding="utf-8")
    logger.info("ModelScope 下载完成: %s", repo_id)
    return str(target)


async def download(repo_id: str, need_weights: bool = True) -> str:
    """异步下载入口。"""
    return await asyncio.to_thread(download_sync, repo_id, need_weights)


def local_path(repo_id: str, need_weights: bool = True) -> Optional[str]:
    """已完整下载则返回本地目录，否则 None。"""
    if is_downloaded(repo_id, need_weights=need_weights):
        return str(ms_model_dir(repo_id))
    return None


def fetch_repo_size_sync(repo_id: str) -> int:
    """查询魔搭仓库的总文件大小（字节），失败返回 0。"""
    try:
        import requests

        r = requests.get(
            f"https://modelscope.cn/api/v1/models/{repo_id}/repo/files",
            params={"Recursive": "true"}, timeout=15,
        )
        files = (r.json().get("Data") or {}).get("Files") or []
        return sum(f.get("Size", 0) for f in files if f.get("Type") != "tree")
    except Exception:
        return 0
