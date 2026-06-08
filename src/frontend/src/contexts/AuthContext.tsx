/**
 * Auth Context — Supabase Bridge
 * ═══════════════════════════════
 * Bridges the ERS auth interface to the EAM Supabase auth.
 * The EAM AuthProvider (from eam/contexts/AuthContext) is the actual
 * Supabase session manager. This context re-exports a ProtectedRoute
 * that checks the EAM auth state.
 */

import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth as useEamAuth } from '../eam/contexts/AuthContext';

// Re-export the EAM auth hook so existing ERS code can use `useAuth()`
export { useAuth as useEamAuthHook } from '../eam/contexts/AuthContext';
export { AuthProvider } from '../eam/contexts/AuthContext';

// Bridge type for ERS components that expect { isAuthenticated, isLoading }
export const useAuth = () => {
    const eam = useEamAuth();
    return {
        user: eam.profile ? {
            ...eam.profile,
            // Map EAM profile fields to ERS TopBar expected shape
            full_name: eam.profile.fullName || eam.profile.username || '',
            email: eam.profile.email || '',
            role: eam.profile.roleLabel || eam.role || '',
            departments: eam.profile.department ? [eam.profile.department] : [],
        } : null,
        isAuthenticated: !!eam.user,
        isLoading: eam.loading,
        error: null as string | null,
        login: async (_u: string, _p: string) => false, // EAM uses its own Login page
        logout: eam.signOut,
        // EAM-specific fields
        permissions: eam.permissions,
        role: eam.role,
    };
};

// ── Protected Route Wrapper (Supabase Session) ───────────────
export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user, loading } = useEamAuth();
    const location = useLocation();
    const isInIframe = typeof window !== 'undefined' && window.top !== window.self;

    if (loading) {
        // In iframe (DevicePreviewer), show a minimal silent loader — the parent
        // frame already authenticated, so the shared Supabase session will resolve
        // almost instantly. Avoid showing "Authenticating…" text that creates a
        // visual flicker loop.
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-brand-950">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-10 h-10 border-4 border-accent-cyan/30 border-t-accent-cyan rounded-full animate-spin" />
                    {!isInIframe && (
                        <p className="text-brand-400 text-sm animate-pulse">Authenticating…</p>
                    )}
                </div>
            </div>
        );
    }

    if (!user) {
        // In an iframe, never redirect to login — the parent is already authenticated.
        // Just show a silent placeholder to prevent a redirect loop.
        if (isInIframe) {
            return (
                <div className="h-screen w-screen flex items-center justify-center bg-brand-950">
                    <p className="text-brand-500 text-sm">Session loading…</p>
                </div>
            );
        }
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    return <>{children}</>;
};
