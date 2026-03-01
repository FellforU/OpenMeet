pub mod types;
pub mod wav;
pub mod mic;

#[cfg(target_os = "windows")]
pub mod system_windows;

#[cfg(target_os = "macos")]
pub mod system_macos;

#[cfg(target_os = "linux")]
pub mod system_linux;
