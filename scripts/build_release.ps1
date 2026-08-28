# Build the Windows installer (NSIS) with a bundled CPU Python runtime.
#
#   powershell -ExecutionPolicy Bypass -File scripts/build_release.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/build_release.ps1 -SkipRuntime   # runtime/ already assembled
#   powershell -ExecutionPolicy Bypass -File scripts/build_release.ps1 -RuntimeOnly   # assemble runtime/, no tauri build
#
# Output: src-tauri/target/release/bundle/nsis/OpenMeet_<ver>_x64-setup.exe
#
# The runtime is assembled under <repo>/runtime (gitignored):
#   python/       embedded Python 3.11 + pip + site-packages (CPU torch)
#   asr_service/  service sources (no __pycache__, no tests)
#   ffmpeg/       ffmpeg.exe
# Nothing from %APPDATA%, the cache dir or any local config is ever copied.
#
# GPU: the installer ships CPU torch (NSIS has a 2GB installer limit, the CUDA
# wheels alone are 2.6GB). On first launch the app detects an NVIDIA GPU and
# installs CUDA torch in the background (asr_service/gpu_setup.py).

[CmdletBinding()]
param(
  [switch]$SkipRuntime,
  [switch]$RuntimeOnly,
  # Local wheel cache to install from first (offline package env/wheels)
  [string]$WheelsDir = "E:\model\OpenMeet_offline_pkg\env\wheels",
  # ffmpeg.exe source (offline package)
  [string]$FfmpegExe = "E:\model\OpenMeet_offline_pkg\env\ffmpeg\ffmpeg.exe",
  [string]$PyVersion = "3.11.9",
  [string]$PipIndex = "https://mirrors.aliyun.com/pypi/simple"
)

$ErrorActionPreference = "Stop"
# Domestic mirrors must not go through the system proxy (slow / fake-ip)
$env:NO_PROXY = "mirrors.aliyun.com,mirrors.huaweicloud.com,localhost,127.0.0.1"
$Repo = Split-Path -Parent $PSScriptRoot
$Runtime = Join-Path $Repo "runtime"
$Dl = Join-Path $Runtime "_downloads"
$PyDir = Join-Path $Runtime "python"
$Py = Join-Path $PyDir "python.exe"

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

function Download($url, $dest) {
  if (Test-Path $dest) { Write-Host "  cached: $dest"; return }
  Write-Host "  GET $url"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
}

if (-not $SkipRuntime) {
  Step "Assembling runtime at $Runtime"
  New-Item -ItemType Directory -Force $Dl | Out-Null

  # ---- 1. Embedded Python -------------------------------------------------
  Step "Embedded Python $PyVersion"
  $zip = Join-Path $Dl "python-$PyVersion-embed-amd64.zip"
  try {
    Download "https://mirrors.huaweicloud.com/python/$PyVersion/python-$PyVersion-embed-amd64.zip" $zip
  } catch {
    Write-Host "  mirror failed, trying python.org"
    Download "https://www.python.org/ftp/python/$PyVersion/python-$PyVersion-embed-amd64.zip" $zip
  }
  if (Test-Path $PyDir) { Remove-Item -Recurse -Force $PyDir }
  Expand-Archive -Path $zip -DestinationPath $PyDir
  $pyTag = "python" + ($PyVersion.Split(".")[0]) + ($PyVersion.Split(".")[1])
  # Enable site-packages and make ../asr_service importable (python -m asr_service.main)
  $pth = @(
    "$pyTag.zip",
    ".",
    "Lib\site-packages",
    "..",
    "import site"
  ) -join "`r`n"
  Set-Content -Path (Join-Path $PyDir "$pyTag._pth") -Value $pth -Encoding ascii

  # ---- 2. pip ---------------------------------------------------------------
  Step "Bootstrapping pip"
  # Official get-pip first (mirrors ship a Python-2-era copy). Fallback: run pip
  # straight out of its own wheel fetched from the PyPI mirror.
  $getPip = Join-Path $Dl "get-pip.py"
  $pipOk = $false
  try {
    Download "https://bootstrap.pypa.io/get-pip.py" $getPip
    & $Py $getPip --no-warn-script-location -i $PipIndex
    $pipOk = ($LASTEXITCODE -eq 0)
  } catch { Write-Host "  get-pip download failed: $_" }
  if (-not $pipOk) {
    Write-Host "  falling back to pip wheel from $PipIndex"
    $html = (Invoke-WebRequest -Uri "$PipIndex/pip/" -UseBasicParsing).Content
    $m = [regex]::Matches($html, 'href="([^"]*?/(pip-(\d+)\.(\d+)(?:\.\d+)?-py3-none-any\.whl)[^"]*)"') |
      Sort-Object { [int]$_.Groups[3].Value }, { [int]$_.Groups[4].Value } -Descending | Select-Object -First 1
    if (-not $m) { throw "pip wheel not found on mirror" }
    $whlUrl = $m.Groups[1].Value
    if ($whlUrl -notmatch '^https?://') { $whlUrl = "https://mirrors.aliyun.com" + $whlUrl }
    $whl = Join-Path $Dl $m.Groups[2].Value
    Download $whlUrl $whl
    & $Py "$whl/pip" install --no-warn-script-location -i $PipIndex $whl
    if ($LASTEXITCODE -ne 0) { throw "pip bootstrap from wheel failed" }
  }
  # Whatever bootstrapped us, end on a current pip (old pip chokes on new metadata)
  & $Py -m pip install --no-warn-script-location -U pip -i $PipIndex
  if ($LASTEXITCODE -ne 0) { throw "pip self-upgrade failed" }
  & $Py -m pip --version

  # ---- 3. Dependencies (CPU torch) ----------------------------------------
  Step "Installing asr_service requirements"
  $req = Join-Path $Repo "asr_service\requirements.txt"
  $pipBase = @("-m", "pip", "install", "--no-warn-script-location", "--prefer-binary")
  # Pass 1: fully offline from the local wheel cache (fast; covers almost everything)
  if (Test-Path $WheelsDir) {
    Write-Host "  pass 1: offline from $WheelsDir"
    & $Py @pipBase "--no-index" "--find-links" $WheelsDir "torch" "torchaudio"
    & $Py @pipBase "--no-index" "--find-links" $WheelsDir "-r" $req
    if ($LASTEXITCODE -ne 0) { Write-Host "  (offline pass incomplete, filling from mirror)" }
  }
  # Pass 2: mirror fills whatever is missing; torch pinned to a CPU build
  Write-Host "  pass 2: online via $PipIndex"
  $pipArgs = $pipBase + @("-i", $PipIndex)
  if (Test-Path $WheelsDir) { $pipArgs += @("--find-links", $WheelsDir) }
  & $Py @pipArgs "-r" $req
  if ($LASTEXITCODE -ne 0) { throw "pip install -r requirements failed" }
  & $Py -c "import torch, sys; v = torch.__version__; print('torch', v); sys.exit(1 if '+cu' in v else 0)"
  if ($LASTEXITCODE -ne 0) { throw "CUDA torch ended up in the installer runtime - expected CPU build" }
  # Trim: tests and caches are dead weight in an installer
  Get-ChildItem -Path (Join-Path $PyDir "Lib\site-packages") -Recurse -Directory -Filter "__pycache__" |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  Get-ChildItem -Path (Join-Path $PyDir "Lib\site-packages") -Recurse -Directory -Include "tests","test" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch "\\torch\\" } |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  & $Py -m pip cache purge 2>$null | Out-Null

  # ---- 4. asr_service sources ---------------------------------------------
  Step "Copying asr_service"
  $svcDst = Join-Path $Runtime "asr_service"
  if (Test-Path $svcDst) { Remove-Item -Recurse -Force $svcDst }
  robocopy (Join-Path $Repo "asr_service") $svcDst /E /XD __pycache__ tests .pytest_cache /XF *.pyc *.log .env *.db /NFL /NDL /NJH /NJS | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy asr_service failed ($LASTEXITCODE)" }

  # ---- 5. ffmpeg ----------------------------------------------------------
  Step "Copying ffmpeg"
  $ffDst = Join-Path $Runtime "ffmpeg"
  New-Item -ItemType Directory -Force $ffDst | Out-Null
  if (Test-Path $FfmpegExe) {
    Copy-Item $FfmpegExe (Join-Path $ffDst "ffmpeg.exe") -Force
  } else {
    throw "ffmpeg.exe not found at $FfmpegExe (pass -FfmpegExe)"
  }

  # ---- 6. Sanity: no secrets / user data ----------------------------------
  Step "Scanning runtime for stray user data"
  $bad = Get-ChildItem -Path $Runtime -Recurse -File -Include "*.db","*.env",".env","openmeet.db","*.pem","*.key" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch "\\site-packages\\" }
  if ($bad) { $bad | ForEach-Object { Write-Host "  !! $($_.FullName)" }; throw "Unexpected files in runtime" }

  # ---- 7. Smoke test the runtime ------------------------------------------
  Step "Smoke test: import asr_service with bundled python"
  Push-Location $Runtime
  try {
    & $Py -c "import asr_service.main, torch, faster_whisper, funasr; print('torch', torch.__version__, 'cuda', torch.cuda.is_available())"
    if ($LASTEXITCODE -ne 0) { throw "runtime smoke test failed" }
  } finally { Pop-Location }

  $size = (Get-ChildItem $Runtime -Recurse -File | Where-Object { $_.FullName -notmatch "\\_downloads\\" } | Measure-Object Length -Sum).Sum / 1GB
  Write-Host ("  runtime size: {0:N2} GB (uncompressed)" -f $size)
}

if ($RuntimeOnly) { Write-Host "`nRuntime assembled. Skipping tauri build."; exit 0 }

# ---- 8. NSIS hooks with absolute runtime path -------------------------------
Step "Writing NSIS hooks"
foreach ($d in @("python","asr_service","ffmpeg")) {
  if (-not (Test-Path (Join-Path $Runtime $d))) { throw "runtime/$d missing - run without -SkipRuntime" }
}
$tpl = Get-Content (Join-Path $Repo "src-tauri\nsis\hooks.nsh.in") -Raw
$tpl.Replace("@RUNTIME_DIR@", $Runtime) | Set-Content (Join-Path $Repo "src-tauri\nsis\hooks.nsh") -Encoding ascii

# ---- 9. tauri build -----------------------------------------------------------
Step "npm run tauri build (nsis)"
Push-Location $Repo
try {
  npx tauri build -c src-tauri/tauri.release.conf.json
  if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }
} finally { Pop-Location }

$out = Get-ChildItem (Join-Path $Repo "src-tauri\target\release\bundle\nsis") -Filter "*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($out) {
  Write-Host ("`nInstaller: {0}  ({1:N0} MB)" -f $out.FullName, ($out.Length / 1MB)) -ForegroundColor Green
}
