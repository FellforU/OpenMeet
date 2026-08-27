# Capture the running OpenMeet window into docs/assets/<name>.png
# Usage: powershell -ExecutionPolicy Bypass -File tools/screenshot.ps1 <name>
param([Parameter(Mandatory = $true)][string]$Name)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
}
"@

$proc = Get-Process openmeet -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Error "OpenMeet window not found"; exit 1 }
$h = $proc.MainWindowHandle
if ([Win32]::IsIconic($h)) { [Win32]::ShowWindow($h, 9) | Out-Null; Start-Sleep -Milliseconds 400 }
[Win32]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 300

# DWM extended frame bounds exclude the invisible resize border
$r = New-Object Win32+RECT
[Win32]::DwmGetWindowAttribute($h, 9, [ref]$r, 16) | Out-Null
$w = $r.R - $r.L; $hh = $r.B - $r.T
if ($w -le 0) { [Win32]::GetWindowRect($h, [ref]$r) | Out-Null; $w = $r.R - $r.L; $hh = $r.B - $r.T }

$bmp = New-Object System.Drawing.Bitmap $w, $hh
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
$g.Dispose()

$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root "docs\assets"
New-Item -ItemType Directory -Force $dir | Out-Null
$out = Join-Path $dir "$Name.png"
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "saved $out ($w x $hh)"
