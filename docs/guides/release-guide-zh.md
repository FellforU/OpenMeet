# OpenMeet 发版指南

> **最后更新**: 2026-04-09

---

## 概述

OpenMeet 使用 GitHub Actions 自动构建和发布。当推送 `v*` 格式的 tag 时，CI 会自动构建 Windows / macOS / Linux 三平台安装包，并发布到 GitHub Releases。客户端内置自动更新检测。

---

## 前置配置（仅首次需要）

### 1. Updater 签名密钥

密钥已生成并配置：

| 文件 | 位置 | 说明 |
|------|------|------|
| 私钥 | `~/.tauri/openmeet.key` | **保密！勿泄露、勿丢失** |
| 公钥 | `~/.tauri/openmeet.key.pub` | 已配置在 `src-tauri/tauri.conf.json` |

> **警告：** 如果丢失私钥或密码，将无法签署更新包，自动更新将失效。

### 2. GitHub Secrets

在仓库 Settings → Secrets and variables → Actions 中已配置：

| Secret | 说明 |
|--------|------|
| `TAURI_SIGNING_PRIVATE_KEY` | 私钥文件内容 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码（留空则无需设置） |

如需重新设置：

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/openmeet.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD  # 如有密码
```

---

## 发版流程

### 1. 确认代码就绪

```bash
# 确保在主分支且代码已提交
git status

# 确保测试通过
source .venv/bin/activate
python -m pytest tests/ -v

# 确保前端构建正常
npm run build
```

### 2. 更新版本号

需要同步更新三个文件中的版本号：

```bash
# 1. package.json
#    "version": "x.x.x"

# 2. src-tauri/tauri.conf.json
#    "version": "x.x.x"

# 3. src-tauri/Cargo.toml
#    version = "x.x.x"
```

版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)：

- **主版本号** (MAJOR): 不兼容的 API 变更
- **次版本号** (MINOR): 向后兼容的新功能
- **修订号** (PATCH): 向后兼容的 Bug 修复

### 3. 提交版本变更

```bash
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
git commit -m "chore: bump version to x.x.x"
git push
```

### 4. 创建 Tag 并推送

```bash
git tag v0.1.0
git push origin v0.1.0
```

### 5. 等待 CI 构建

推送 tag 后，GitHub Actions 会自动：

1. 创建一个 **Draft Release**
2. 并行构建三个平台的安装包：
   - Windows: `OpenMeet_x.x.x_x64-setup.exe` + `.msi`
   - macOS (ARM): `OpenMeet_x.x.x_aarch64.dmg`
   - macOS (Intel): `OpenMeet_x.x.x_x64.dmg`
   - Linux: `OpenMeet_x.x.x_amd64.AppImage` + `.deb`
3. 上传安装包和签名文件到 Release
4. 自动发布 Release（从 Draft 变为 Published）

查看构建进度：

```bash
gh run list --limit 5
gh run watch    # 实时观看最新的 run
```

或访问：https://github.com/FellforU/OpenMeet/actions

### 6. 验证发布

```bash
# 查看最新 Release
gh release view v0.1.0

# 列出所有 Release 资产
gh release view v0.1.0 --json assets --jq '.assets[].name'
```

或访问：https://github.com/FellforU/OpenMeet/releases

---

## 自动更新机制

### 工作原理

1. 客户端启动时请求 `https://github.com/FellforU/OpenMeet/releases/latest/download/latest.json`
2. `latest.json` 包含最新版本号和各平台下载链接
3. 如果有新版本，客户端提示用户更新
4. 下载安装包并使用公钥验证签名
5. 验证通过后执行更新

### latest.json 格式

`tauri-action` 会自动生成此文件并上传到 Release：

```json
{
  "version": "0.1.0",
  "notes": "Release notes from GitHub",
  "pub_date": "2026-04-09T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "...",
      "url": "https://github.com/FellforU/OpenMeet/releases/download/v0.1.0/OpenMeet_0.1.0_x64-setup.nsis.zip"
    },
    "darwin-aarch64": {
      "signature": "...",
      "url": "https://github.com/FellforU/OpenMeet/releases/download/v0.1.0/OpenMeet.app.tar.gz"
    },
    "linux-x86_64": {
      "signature": "...",
      "url": "https://github.com/FellforU/OpenMeet/releases/download/v0.1.0/OpenMeet_0.1.0_amd64.AppImage.tar.gz"
    }
  }
}
```

---

## 故障排查

### CI 构建失败

```bash
# 查看失败日志
gh run list --status failure --limit 5
gh run view <run-id> --log-failed
```

常见问题：

| 问题 | 解决方案 |
|------|---------|
| Secret 未配置 | 检查 GitHub Secrets 是否正确设置 |
| Rust 编译失败 | 检查 `Cargo.toml` 依赖版本 |
| 前端构建失败 | 确认 `npm run build` 本地通过 |
| 签名失败 | 确认 `TAURI_SIGNING_PRIVATE_KEY` 内容正确 |

### 删除错误的 Release

```bash
# 删除 Release 和 Tag
gh release delete v0.1.0 --yes
git push --delete origin v0.1.0
git tag -d v0.1.0
```

### 重新触发构建

```bash
# 删除旧 tag 后重新推送
git tag v0.1.0
git push origin v0.1.0
```

---

## 快速参考

```bash
# 完整发版（一键操作）
VERSION=0.2.0 && \
  sed -i "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" package.json src-tauri/tauri.conf.json && \
  sed -i "s/^version = \".*\"/version = \"$VERSION\"/" src-tauri/Cargo.toml && \
  git add -A && \
  git commit -m "chore: bump version to $VERSION" && \
  git push && \
  git tag "v$VERSION" && \
  git push origin "v$VERSION"
```
