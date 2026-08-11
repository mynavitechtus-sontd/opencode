import type { ApiErrorCode, ApiResult, HttpError } from "./types.js";

const BASE_URL = process.env.ITFS_API_URL ?? "http://localhost:3000";

function errorFromStatus(status: number, body: unknown): HttpError {
  const message =
    typeof body === "object" && body !== null && "error" in body
      ? String((body as Record<string, unknown>).error)
      : `HTTP ${status}`;

  const mapping: Record<number, { code: ApiErrorCode; recoverable: boolean }> = {
    401: { code: "UNAUTHORIZED", recoverable: false },
    404: { code: "NOT_FOUND", recoverable: false },
    422: { code: "VALIDATION_ERROR", recoverable: true },
    500: { code: "SERVER_ERROR", recoverable: false },
    502: { code: "SERVER_ERROR", recoverable: false },
    503: { code: "SERVER_ERROR", recoverable: false },
  };

  const mapped = mapping[status] ?? { code: "UNKNOWN" as ApiErrorCode, recoverable: false };
  return { code: mapped.code, message, status, recoverable: mapped.recoverable };
}

export class ApiClient {
  tryRefreshToken: () => Promise<boolean> = () => Promise.resolve(false);

  constructor(private getToken: () => Promise<string | null>) {}

  async get<T>(path: string, resourceKey?: string): Promise<ApiResult<T>> {
    return this.request<T>("GET", path, undefined, resourceKey);
  }

  async post<T>(path: string, body: Record<string, unknown>, resourceKey?: string): Promise<ApiResult<T>> {
    return this.request<T>("POST", path, body, resourceKey);
  }

  async patch<T>(path: string, body: Record<string, unknown>, resourceKey?: string): Promise<ApiResult<T>> {
    return this.request<T>("PATCH", path, body, resourceKey);
  }

  private async request<T>(
    method: string,
    path: string,
    body: Record<string, unknown> | undefined,
    resourceKey: string | undefined,
    isRetry = false,
  ): Promise<ApiResult<T>> {
    const token = await this.getToken();
    if (!token) {
      return {
        ok: false,
        error: { code: "AUTH_EXPIRED", message: "No access token available", status: 401, recoverable: true },
      };
    }

    return this.fetchWithRetry(method, path, body, resourceKey, token, isRetry);
  }

  private async fetchWithRetry<T>(
    method: string,
    path: string,
    body: Record<string, unknown> | undefined,
    resourceKey: string | undefined,
    token: string,
    isRetry: boolean,
    attempt = 0,
  ): Promise<ApiResult<T>> {
    const maxRetries = 3;
    const backoff = [1000, 2000, 4000];

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };

      const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!res.ok) {
        if (res.status === 401 && !isRetry) {
          const refreshed = await this.tryRefreshToken();
          if (refreshed) {
            return this.request<T>(method, path, body, resourceKey, true);
          }
          return { ok: false, error: { code: "AUTH_EXPIRED", message: "Token refresh failed", status: 401, recoverable: true } };
        }

        const json = await res.json().catch(() => null);
        return { ok: false, error: errorFromStatus(res.status, json) };
      }

      const json = await res.json();
      const data = resourceKey ? (json as Record<string, unknown>)[resourceKey] as T : json as T;
      return { ok: true, data };
    } catch (err) {
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, backoff[attempt]));
        return this.fetchWithRetry<T>(method, path, body, resourceKey, token, isRetry, attempt + 1);
      }
      return {
        ok: false,
        error: {
          code: "NETWORK_ERROR",
          message: err instanceof Error ? err.message : "Network request failed",
          status: 0,
          recoverable: false,
        },
      };
    }
  }
}
