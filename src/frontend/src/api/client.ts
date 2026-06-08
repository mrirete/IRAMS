/**
 * ERS API Client
 * ══════════════
 * Centralized fetch wrapper with JWT token management,
 * auto-refresh, and 401 redirect logic.
 */

const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1';

// ── Token Storage ────────────────────────────────────────────

const TOKEN_KEY = 'ers_access_token';
const REFRESH_KEY = 'ers_refresh_token';

export function getAccessToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
    return localStorage.getItem(REFRESH_KEY);
}

export function setTokens(access: string, refresh: string): void {
    localStorage.setItem(TOKEN_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
}

// ── Response Types ───────────────────────────────────────────

export interface ApiSuccess<T> {
    ok: true;
    data: T;
    status: number;
}

export interface ApiError {
    ok: false;
    error: string;
    status: number;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ── Core Fetch ───────────────────────────────────────────────

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;

    try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken }),
        });

        if (!res.ok) return false;

        const data = await res.json();
        setTokens(data.access_token, data.refresh_token);
        return true;
    } catch {
        return false;
    }
}

/**
 * Authenticated fetch wrapper.
 * Automatically attaches Bearer token and handles 401 with refresh.
 */
export async function apiFetch<T>(
    path: string,
    options: RequestInit = {},
): Promise<ApiResponse<T>> {
    const token = getAccessToken();

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> || {}),
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    try {
        let res = await fetch(`${API_BASE}${path}`, {
            ...options,
            headers,
        });

        // If 401, try refresh once
        if (res.status === 401 && token) {
            if (!isRefreshing) {
                isRefreshing = true;
                refreshPromise = tryRefresh();
            }

            const refreshed = await refreshPromise;
            isRefreshing = false;
            refreshPromise = null;

            if (refreshed) {
                // Retry original request with new token
                const newToken = getAccessToken();
                headers['Authorization'] = `Bearer ${newToken}`;
                res = await fetch(`${API_BASE}${path}`, {
                    ...options,
                    headers,
                });
            } else {
                // Refresh failed — force logout
                clearTokens();
                window.location.href = '/login';
                return { ok: false, error: 'Session expired', status: 401 };
            }
        }

        if (!res.ok) {
            const body = await res.json().catch(() => ({ detail: res.statusText }));
            return {
                ok: false,
                error: body.detail || body.message || `HTTP ${res.status}`,
                status: res.status,
            };
        }

        const data = await res.json() as T;
        return { ok: true, data, status: res.status };

    } catch (err: any) {
        return {
            ok: false,
            error: err.message || 'Network error',
            status: 0,
        };
    }
}

// ── Convenience methods ──────────────────────────────────────

export function apiGet<T>(path: string) {
    return apiFetch<T>(path, { method: 'GET' });
}

export function apiPost<T>(path: string, body: unknown) {
    return apiFetch<T>(path, {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

export function apiPut<T>(path: string, body: unknown) {
    return apiFetch<T>(path, {
        method: 'PUT',
        body: JSON.stringify(body),
    });
}

export function apiDelete<T>(path: string) {
    return apiFetch<T>(path, { method: 'DELETE' });
}
