import type { Session } from "./types";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
const KEY = "hanafudakan-session";
export function readSession(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    return s?.token && s?.playerId ? s : null;
  } catch {
    return null;
  }
}
export function saveSession(s: Session) {
  localStorage.setItem(KEY, JSON.stringify(s));
}
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`/api${path}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const body = await response.json();
    if (!response.ok)
      throw new ApiError(
        body.error || body.message || "通信に失敗しました",
        response.status,
      );
    return body;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw new Error(
        "接続がタイムアウトしました。サーバーを確認してください。",
      );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
