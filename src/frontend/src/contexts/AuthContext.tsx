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
// MEMOIZED: this must return referentially-stable objects between renders.
// It previously built a fresh `user` (and `departments` array) on every call,
// which silently broke any consumer that put those in an effect dependency
// array — see useReliabilityPresence, where that caused an infinite
// setState/effect loop that starved Suspense retries app-wide.
export const useAuth = () => {
    const eam = useEamAuth();
    return React.useMemo(() => ({
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
    }), [eam.profile, eam.user, eam.loading, eam.permissions, eam.role, eam.signOut]);
};

// ── Protected Route Wrapper (Supabase Session) ───────────────
export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user, loading } = useEamAuth();
    const location = useLocation();
    const isInIframe = typeof window !== 'undefined' && window.top !== window.self;

    if (loading) {
        return (
            <div className="h-screen w-screen flex items-center justify-center" style={{ background: '#f8fafc' }}>
                <div className="flex flex-col items-center gap-3">
                    {/* Brand mark */}
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                         style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 2c0 0-4 4-4 8a4 4 0 0 0 8 0c0-4-4-8-4-8z" />
                            <path d="M12 14v4" />
                            <path d="M10 22h4" />
                        </svg>
                    </div>
                    {/* Progress bar */}
                    <div className="w-32 h-1 rounded-full overflow-hidden" style={{ background: '#e2e8f0' }}>
                        <div className="h-full rounded-full" style={{
                            background: 'linear-gradient(90deg, #f59e0b, #ea580c)',
                            animation: 'authProgress 1.2s ease-in-out infinite',
                            width: '40%',
                        }} />
                    </div>
                    <style>{`@keyframes authProgress { 0% { transform: translateX(-100%); } 100% { transform: translateX(350%); } }`}</style>
                    {!isInIframe && (
                        <p className="text-xs font-medium" style={{ color: '#94a3b8' }}>Loading IREAMS…</p>
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
