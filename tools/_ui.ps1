# Helper for screenshot automation: resize / click inside the OpenMeet window.
# Usage:
#   tools/_ui.ps1 resize <w> <h>
#   tools/_ui.ps1 click <x> <y>      (window-relative, DWM frame coords)
#   tools/_ui.ps1 screen
param([string]$Cmd, [int]$A = 0, [int]$B = 0)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class UiW {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
}
"@

$proc = Get-Process openmeet -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Error "OpenMeet window not found"; exit 1 }
$h = $proc.MainWindowHandle
[UiW]::ShowWindow($h, 9) | Out-Null
[UiW]::SetForegroundWindow($h) | Out-Null

switch ($Cmd) {
  "screen" { Write-Output ("{0} x {1}" -f [UiW]::GetSystemMetrics(0), [UiW]::GetSystemMetrics(1)) }
  "resize" {
    [UiW]::SetWindowPos($h, [IntPtr]::Zero, 0, 0, $A, $B, 0x0004) | Out-Null   # SWP_NOZORDER
    Start-Sleep -Milliseconds 600
    Write-Output "resized to $A x $B"
  }
  "click" {
    $r = New-Object UiW+RECT
    [UiW]::DwmGetWindowAttribute($h, 9, [ref]$r, 16) | Out-Null
    $x = $r.L + $A; $y = $r.T + $B
    [UiW]::SetCursorPos($x, $y) | Out-Null
    Start-Sleep -Milliseconds 80
    [UiW]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)   # left down
    [UiW]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)   # left up
    Start-Sleep -Milliseconds 700
    Write-Output "clicked ($A,$B)"
  }
}
