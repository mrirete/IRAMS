/**
 * Auth API
 * ════════
 * Login, refresh, and user profile endpoints.
 * Supports mock mode (VITE_USE_MOCK=true) for standalone frontend dev.
 */

import { apiFetch, setTokens, clearTokens } from './client';

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';

// ── Types ────────────────────────────────────────────────────

export interface TokenResponse {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
}

export interface User {
    id: string;
    username: string;
    email: string;
    full_name: string;
    role: string;
    is_active: boolean;
    mfa_enabled: boolean;
    departments: string[];
}

export interface AuditLog {
    audit_id: string;
    timestamp: string;
    user_id: string;
    username: string;
    action: string;
    entity_type: string;
    entity_id: string;
    governance_tier: number;
    changes: Record<string, unknown>;
    ip_address: string | null;
}

// ── Mock Users ───────────────────────────────────────────────

const MOCK_USERS: Record<string, { password: string; user: User }> = {
    admin: {
        password: 'password',
        user: {
            id: '11111111-1111-1111-1111-111111111111',
            username: 'admin',
            email: 'admin@ers.internal',
            full_name: 'System Administrator',
            role: 'admin',
            is_active: true,
            mfa_enabled: false,
            departments: ['IT', 'Management'],
        },
    },
    tech1: {
        password: 'password',
        user: {
            id: '22222222-2222-2222-2222-222222222222',
            username: 'tech1',
            email: 'tech1@ers.internal',
            full_name: 'Field Technician',
            role: 'technician',
            is_active: true,
            mfa_enabled: false,
            departments: ['Maintenance'],
        },
    },
    planner1: {
        password: 'password',
        user: {
            id: '33333333-3333-3333-3333-333333333333',
            username: 'planner1',
            email: 'planner1@ers.internal',
            full_name: 'Maintenance Planner',
            role: 'planner',
            is_active: true,
            mfa_enabled: false,
            departments: ['Planning'],
        },
    },
};

let _currentMockUser: User | null = null;

// ── API Functions ────────────────────────────────────────────

/**
 * Login with username/password.
 * In mock mode, validates against hardcoded users.
 * In real mode, uses OAuth2 form against FastAPI backend.
 */
export async function loginUser(
    username: string,
    password: string,
): Promise<{ user: User; token: TokenResponse } | { error: string }> {

    // ── MOCK MODE ────────────────────────────────────────
    if (USE_MOCK) {
        await new Promise(r => setTimeout(r, 400)); // simulate latency

        const entry = MOCK_USERS[username];
        if (!entry || entry.password !== password) {
            return { error: 'Invalid username or password' };
        }

        const mockToken: TokenResponse = {
            access_token: `mock_access_${username}_${Date.now()}`,
            refresh_token: `mock_refresh_${username}_${Date.now()}`,
            token_type: 'bearer',
            expires_in: 1800,
        };

        setTokens(mockToken.access_token, mockToken.refresh_token);
        _currentMockUser = entry.user;

        return { user: entry.user, token: mockToken };
    }

    // ── REAL API MODE ────────────────────────────────────
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);

    try {
        const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1';
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData.toString(),
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({ detail: 'Login failed' }));
            return { error: body.detail || 'Invalid credentials' };
        }

        const token: TokenResponse = await res.json();
        setTokens(token.access_token, token.refresh_token);

        const meRes = await getMe();
        if ('error' in meRes) {
            return { error: meRes.error };
        }

        return { user: meRes, token };
    } catch (err: any) {
        return { error: err.message || 'Network error' };
    }
}

/**
 * Get current user profile.
 */
export async function getMe(): Promise<User | { error: string }> {
    if (USE_MOCK) {
        if (_currentMockUser) return _currentMockUser;
        return { error: 'Not authenticated' };
    }

    const res = await apiFetch<User>('/auth/me');
    if (!res.ok) {
        return { error: res.error };
    }
    return res.data;
}

/**
 * Logout - clear tokens.
 */
export function logoutUser(): void {
    clearTokens();
    _currentMockUser = null;
}

/**
 * Get audit logs (admin only).
 */
export async function getAuditLogs(): Promise<AuditLog[] | { error: string }> {
    if (USE_MOCK) {
        return [];
    }
    const res = await apiFetch<AuditLog[]>('/auth/audit');
    if (!res.ok) {
        return { error: res.error };
    }
    return res.data;
}
