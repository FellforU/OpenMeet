import { invoke } from "@tauri-apps/api/core";

export interface HttpFetchResponse {
  status: number;
  body: string;
}

/** Route HTTP requests through Tauri's Rust layer to bypass CORS/CSP. */
export async function tauriFetch(
  url: string,
  options: {
    method: string;
    headers?: Record<string, string>;
    body?: string;
  }
): Promise<HttpFetchResponse> {
  return invoke<HttpFetchResponse>("http_fetch", {
    url,
    method: options.method,
    headers: options.headers ?? null,
    body: options.body ?? null,
  });
}
