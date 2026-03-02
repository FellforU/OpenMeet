import { invoke, convertFileSrc } from "@tauri-apps/api/core";

/**
 * Try to load audio via asset protocol; fall back to base64 blob if that fails.
 * Returns the usable object URL, or null on complete failure.
 */
export async function loadAudioUrl(audioPath: string): Promise<string | null> {
  // 1. Try Tauri asset protocol (zero-copy, fast)
  try {
    const assetUrl = convertFileSrc(audioPath) + `?t=${Date.now()}`;
    const ok = await new Promise<boolean>((resolve) => {
      const probe = new Audio();
      probe.onloadedmetadata = () => {
        probe.src = "";
        resolve(true);
      };
      probe.onerror = () => resolve(false);
      probe.src = assetUrl;
    });
    if (ok) return assetUrl;
  } catch {
    // convertFileSrc unavailable outside Tauri
  }

  // 2. Fallback: read file as base64 via Rust IPC
  try {
    const base64 = await invoke<string>("read_audio_file", { path: audioPath });
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: "audio/wav" });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}
