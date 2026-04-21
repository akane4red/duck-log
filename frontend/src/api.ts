import type { ApiResponse } from "./types";

function resolveApiBaseUrl() {
  const configured = window.localStorage.getItem("duck-log-api-base");
  if (configured) return configured.replace(/\/+$/, "");

  if (window.location.port === "3001") return window.location.origin;
  return "http://127.0.0.1:3001";
}

export const apiBaseUrl = resolveApiBaseUrl();

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers ?? {});
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }

  const targetUrl = `${apiBaseUrl}${path}`;
  let response: Response;
  try {
    response = await fetch(targetUrl, { ...options, headers });
  } catch (error) {
    const message = (error as Error).message || "Network request failed";
    throw new Error(
      `Unable to reach backend at ${targetUrl}. ${message}. ` +
        "Check that backend is running on port 3001, and clear localStorage key 'duck-log-api-base' if it points to an old URL."
    );
  }

  const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null;

  if (!response.ok || !payload?.ok || payload.data === undefined) {
    throw new Error(payload?.error ?? `Request failed with ${response.status}`);
  }

  return payload.data;
}

/** Multipart upload — do not set Content-Type (browser sets boundary). */
export async function postMultipart<T>(path: string, formData: FormData): Promise<T> {
  const targetUrl = `${apiBaseUrl}${path}`;
  let response: Response;
  try {
    response = await fetch(targetUrl, { method: "POST", body: formData });
  } catch (error) {
    const message = (error as Error).message || "Network request failed";
    throw new Error(
      `Unable to reach backend at ${targetUrl}. ${message}. ` +
        "Check that backend is running on port 3001, and clear localStorage key 'duck-log-api-base' if it points to an old URL."
    );
  }

  const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null;

  if (!response.ok || !payload?.ok || payload.data === undefined) {
    throw new Error(payload?.error ?? `Request failed with ${response.status}`);
  }

  return payload.data;
}

export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${apiBaseUrl}/health`);
    const payload = (await response.json().catch(() => null)) as { ok?: boolean } | null;
    return Boolean(payload?.ok);
  } catch {
    return false;
  }
}
