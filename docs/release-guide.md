# OpenMeet 打包与发布指南

> 面向维护者：如何从源码产出 Windows 安装包，以及发布到 GitHub Releases 的流程。
> 用户侧的安装说明见 [README](../README.md#-快速开始)，模型选择见 [配置指南](configuration-guide.md)。

---

## 1. 安装包里有什么

只有**一个**安装包 `OpenMeet_x.y.z_x64-setup.exe`（约 430MB，LZMA 压缩），不分 CPU / GPU 版：

| 安装目录内容 | 大小（解压后） | 说明 |
|---|---|---|
| `openmeet.exe` | ~19MB | Tauri 桌面壳（Rust + React） |
| `python/` | ~1.7GB | 嵌入式 Python 3.11 + 全部依赖（**CPU 版 torch**） |
| `asr_service/` | ~1MB | FastAPI 服务源码（不含 tests / `__pycache__`） |
| `ffmpeg/ffmpeg.exe` | ~200MB | 音频解码 |
| `uninstall.exe` | | 卸载时整目录清除 `python/ asr_service/ ffmpeg/` |

**为什么不分 GPU 版**：CUDA 版 torch + cuDNN 约 2.6GB，加上运行时超过 5GB，而 NSIS 安装器和 GitHub Release 单文件都限制在 2GB 以内。因此采用：

- 安装包内置 CPU torch，任何机器装完即可用
- 首次启动时 `asr_service/gpu_setup.py --check` 检测 NVIDIA 显卡；有则在**后台**从阿里云镜像 `pip install torch torchaudio`（cu128），失败回官方源
- 前端收到 `gpu-setup` 事件弹提示：安装中 → 装完请重启 / 失败已回退 CPU
- 日志：`%LOCALAPPDATA%\com.openmeet.app\logs\gpu_setup.log`、`asr_service.log`

安装模式为 **当前用户**（`%LOCALAPPDATA%\OpenMeet`），不需要管理员权限——这也是 pip 能在安装目录里后装 CUDA 的前提。

**模型不在安装包里**：应用内从魔搭（ModelScope）国内源下载。

## 2. 运行时布局是怎么被识别的

`src-tauri/src/sidecar.rs` 的 `resolve_layout()`：

1. `exe 所在目录/python/python.exe` 且 `exe 所在目录/asr_service/` 都存在 → **打包模式**
   - 工作目录 = 安装目录，`python -m asr_service.main`
   - `PATH` 前置 `ffmpeg/`，清掉 `PYTHONPATH` / `PYTHONHOME`（避免读到用户机器上别的 Python）
   - 无控制台窗口（`CREATE_NO_WINDOW`），stdout/stderr 落日志文件
   - GPU 组件后台安装
2. 否则 → **开发模式**：仓库根目录 + `.venv`，行为与之前一致（GPU 检测同步执行、日志打到终端）

嵌入式 Python 的 `python311._pth` 里加了 `..`，所以 `asr_service` 包能从安装目录被 import。

## 3. 出包

前置条件（构建机，仅需一次）：

- Node 20+、Rust stable、Visual Studio Build Tools（C++ 桌面开发）
- 本地 wheel 缓存（可选但强烈建议）：用 `pip download -r asr_service/requirements.txt -d <dir>` 预下载一份，通过 `-WheelsDir` 指定，脚本会优先从这里离线安装，2 分钟装完；没有则走阿里云镜像
- `ffmpeg.exe`（静态构建版即可，用 `-FfmpegExe` 指定路径）
- Tauri 首次打 NSIS 会从 GitHub 下载 NSIS 工具链，需要能访问 GitHub

```powershell
# 全量：组装 runtime/ + tauri build
powershell -ExecutionPolicy Bypass -File scripts/build_release.ps1

# 只改了前端 / Rust，运行时不变
powershell -ExecutionPolicy Bypass -File scripts/build_release.ps1 -SkipRuntime

# 只组装运行时，不打包（调试用）
powershell -ExecutionPolicy Bypass -File scripts/build_release.ps1 -RuntimeOnly
```

脚本做的事（`scripts/build_release.ps1`）：

| 步骤 | 内容 | 失败时 |
|---|---|---|
| 1 | 下载嵌入式 Python 3.11（华为云镜像 → python.org），写 `._pth` | 中止 |
| 2 | 引导 pip（官方 get-pip → 镜像 pip wheel），自升级到最新 | 中止 |
| 3 | 装依赖：**pass 1** 纯离线 `--no-index --find-links wheels`；**pass 2** 阿里云镜像补缺；校验 torch 是 CPU 版 | 中止 |
| 4 | robocopy `asr_service/`，排除 `__pycache__` `tests` `*.pyc` `.env` `*.db` | 中止 |
| 5 | 拷 `ffmpeg.exe` | 中止 |
| 6 | 扫描 `runtime/` 里有无 `*.db / .env / *.pem / *.key`（防止用户数据混入） | 中止 |
| 7 | 用运行时 Python 冒烟：import 所有引擎 | 中止 |
| 8 | 从 `src-tauri/nsis/hooks.nsh.in` 生成带绝对路径的 `hooks.nsh` | |
| 9 | `npx tauri build -c src-tauri/tauri.release.conf.json` | 中止 |

产物：`src-tauri/target/release/bundle/nsis/OpenMeet_<ver>_x64-setup.exe`

改了 `asr_service/` 的 Python 代码 → 需要重新组装运行时（全量，或 `-RuntimeOnly` 后 `-SkipRuntime`）。
改了 `requirements.txt` → 全量，并注意新依赖是否有 Windows wheel。

### 已知坑

- **Windows 系统代理**会把国内镜像流量拖慢到几十 kB/s，脚本对 `mirrors.aliyun.com` / `mirrors.huaweicloud.com` 设了 `NO_PROXY`
- 镜像站的 `get-pip.py` 是 Python 2 时代的旧版本，不能用
- `WeTextProcessing` 依赖 pynini，Windows 无 wheel，requirements 中已标记 `sys_platform != "win32"`（ITN 会回退到内置规则）
- `npm run tauri build -- --config x` 会把参数透传给 cargo 而报错，要用 `npx tauri build -c x`
- 用 Python 脚本改 `.ps1` 时小心 `\r` 被转义成回车

## 4. 发布前自测清单

```powershell
# 静默安装到临时目录
& .\src-tauri\target\release\bundle\nsis\OpenMeet_0.1.0_x64-setup.exe /S /D=E:\tmp\OpenMeetTest

# 用安装目录里的 Python 验证
cd E:\tmp\OpenMeetTest
.\python\python.exe -c "import asr_service.main, torch, faster_whisper, funasr, pyannote.audio, qwen_asr; print(torch.__version__)"
.\python\python.exe -m asr_service.gpu_setup --check   # 有 N 卡的机器应返回 3

# 静默卸载
& .\uninstall.exe /S _?=E:\tmp\OpenMeetTest
```

然后**关闭开发版**（否则 18090 端口冲突），双击安装版真实跑一遍：启动 → 设置里下载一个小模型 → 上传音频转录 → 生成纪要。

## 5. 发布到 GitHub Releases

```bash
# 1. 版本号：src-tauri/tauri.conf.json 的 "version"（安装包文件名取自这里）+ package.json
# 2. 打 tag
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0

# 3. 创建 Release 并上传安装包（gh CLI）
sha256sum src-tauri/target/release/bundle/nsis/OpenMeet_0.1.0_x64-setup.exe
gh release create v0.1.0 \
  src-tauri/target/release/bundle/nsis/OpenMeet_0.1.0_x64-setup.exe \
  --title "OpenMeet v0.1.0" \
  --notes-file docs/releases/v0.1.0.md
```

> `.github/workflows/release.yml` 已改为**仅手动触发**且不自动发布：CI 上 tauri-action 打出的包不含 Python 运行时，装上无法启动。推 tag 不会再自动建 Release。

Release notes 模板见 `docs/releases/`。写清楚：安装包内容与体积、GPU 组件自动安装、显卡驱动要求（≥570）、SmartScreen 提示、SHA256。

## 6. 路线图

- [ ] Windows 代码签名（消除 SmartScreen 警告）
- [ ] macOS `.dmg` / Linux `.AppImage`（同样的运行时组装思路，Python 用 python-build-standalone）
- [ ] 自动更新：`tauri-plugin-updater` 已接入，需生成签名密钥并在 Release 附 `latest.json`
- [ ] FunASR → sherpa-onnx，运行时可减 ~500MB
