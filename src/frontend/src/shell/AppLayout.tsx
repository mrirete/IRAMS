import React, { useState, useEffect, lazy, Suspense } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { MobileBottomNav } from './MobileBottomNav';
import { usePullToRefresh } from '../eam/hooks/usePullToRefresh';
import { useRelantern } from '../eam/contexts/RelanternContext';
import { initOfflineExecutors } from '../eam/services/offlineExecutors';
import { GlobalErrorToaster } from '../eam/components/GlobalErrorToaster';
import { ResetPasswordModal } from '../eam/components/modals/ResetPasswordModal';
import { supabase } from '../eam/lib/supabase';
import { DatabaseService } from '../eam/services/DatabaseService';
import { setLevelModel } from '../eam/services/hierarchyModel';
import { registerRoutePrefetch } from '../lib/lazyWithReload';
import MissionGuide from '../components/specialist/MissionGuide';

// ── Lazy-loaded panels (not needed on initial render) ──
// RelanternAI (Reliability Specialist) is the single AI chat panel — opened from
// the TopBar button and the per-page "Ask Specialist" buttons. geminiService
// dynamically imports @google/genai on first AI use, off the critical path.
// Registered for boot-time prefetch so opening them never waits on (or hangs
// on) a chunk fetch — their Suspense fallbacks are null, so a hung fetch here
// would fail silently.
const importRelanternAI = () => import('../eam/components/RelanternAI');
const importReportRequestForm = () => import('../eam/components/ReportRequestForm');
const importCommandPalette = () => import('./CommandPalette');
registerRoutePrefetch(importRelanternAI);
registerRoutePrefetch(importReportRequestForm);
registerRoutePrefetch(importCommandPalette);
const RelanternAI = lazy(() => importRelanternAI().then(m => ({ default: m.RelanternAI })));
const DevicePreviewer = lazy(() => import('../components/dev/DevicePreviewer').then(m => ({ default: m.DevicePreviewer })));
const ReportRequestForm = lazy(() => importReportRequestForm().then(m => ({ default: m.ReportRequestForm })));
const CommandPalette = lazy(() => importCommandPalette().then(m => ({ default: m.CommandPalette })));

interface AppLayoutProps {
    children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
    // Forced password change: one small read of the caller's own users row.
    const [forcedPw, setForcedPw] = useState<{ id: string; username: string } | null>(null);
    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return;
                const { data } = await supabase.from('users').select('id, username, must_change_password').eq('id', user.id).maybeSingle();
                if (active && data?.must_change_password) setForcedPw({ id: data.id, username: data.username || user.email || '' });
            } catch { /* column absent on an un-migrated project — nothing to force */ }
        })();
        return () => { active = false; };
    }, []);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const [isQuickReportOpen, setIsQuickReportOpen] = useState(false);
    const [isPaletteOpen, setIsPaletteOpen] = useState(false);
    // Computed once at mount (lazy init) — avoids a setState-in-effect cascade.
    const [isMainFrame] = useState(() => typeof window === 'undefined' || window.top === window.self);
    const { isOpen: isRelanternOpen, contextData, contextType, initialPrompt, pageActions, closeRelantern } = useRelantern();

    // Shell-level pull-to-refresh: <main> is the app's ONE scroll container, so
    // the gesture lives here for every page (touch-only — desktop unaffected).
    // Query-backed pages refetch via invalidateQueries; pages with local loads
    // subscribe to the 'ers-refresh' broadcast (e.g. MyWork).
    const queryClient = useQueryClient();
    const { containerRef, isRefreshing, pullDistance, pullProgress } = usePullToRefresh({
        onRefresh: async () => {
            window.dispatchEvent(new CustomEvent('ers-refresh'));
            await queryClient.invalidateQueries();
        },
    });

    // Listen for custom sidebar toggle events from MobileBottomNav "More" button
    useEffect(() => {
        const handler = () => setIsSidebarOpen(prev => !prev);
        window.addEventListener('toggle-sidebar', handler);
        return () => window.removeEventListener('toggle-sidebar', handler);
    }, []);

    // Register offline-queue executors once + replay any writes queued in a prior offline session.
    useEffect(() => { initOfflineExecutors(); }, []);

    // Hydrate the hierarchy level model from the Admin-configured override (UAT F-010).
    // Falls back to DEFAULT_LEVELS if none saved or the fetch fails.
    useEffect(() => {
        DatabaseService.getInstance().getHierarchyConfig()
            .then(levels => { if (levels && levels.length) setLevelModel(levels as any); })
            .catch(() => { /* keep defaults */ });
    }, []);

    // Listen for the operator "Report a Problem" event (MobileBottomNav center button)
    useEffect(() => {
        const handler = () => setIsQuickReportOpen(true);
        window.addEventListener('open-quick-report', handler);
        return () => window.removeEventListener('open-quick-report', handler);
    }, []);

    // Global command palette: ⌘K / Ctrl+K, plus the `open-command-palette` event (TopBar search)
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
                e.preventDefault();
                setIsPaletteOpen(prev => !prev);
            }
        };
        const onEvent = () => setIsPaletteOpen(true);
        window.addEventListener('keydown', onKey);
        window.addEventListener('open-command-palette', onEvent);
        return () => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('open-command-palette', onEvent);
        };
    }, []);

    return (
        <div className="eam-app flex h-screen w-full overflow-hidden bg-brand-900 text-slate-800 font-sans max-w-[100vw]">
            <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

            <div className="flex flex-col flex-1 overflow-hidden relative min-w-0">
                <TopBar
                    onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
                    onTogglePreview={isMainFrame ? () => setIsPreviewOpen(true) : undefined}
                />

                {/* bg-slate-50 + text-slate-900: light content area so EAM page headers are visible */}
                <main ref={containerRef as any} className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6 relative bg-slate-50 text-slate-900">
                    {/* Pull-to-refresh indicator (collapsed to 0 height until pulled) */}
                    <div
                        className="flex items-center justify-center transition-all duration-200 overflow-hidden"
                        style={{
                            height: pullDistance > 0 || isRefreshing ? `${Math.max(pullDistance, isRefreshing ? 48 : 0)}px` : '0px',
                            opacity: pullProgress > 0.1 || isRefreshing ? 1 : 0,
                        }}
                    >
                        <div
                            className={`p-1.5 rounded-full bg-slate-200 ${isRefreshing ? 'animate-spin' : ''}`}
                            style={{ transform: isRefreshing ? undefined : `rotate(${pullProgress * 360}deg)` }}
                        >
                            <RefreshCw size={18} className={pullProgress >= 1 ? 'text-primary-600' : 'text-slate-500'} />
                        </div>
                    </div>
                    {children}
                </main>
            </div>

            {/* Forced first-sign-in password change (0310 users.must_change_password). */}
            {forcedPw && (
                <ResetPasswordModal userId={forcedPw.id} username={forcedPw.username} isSelf forced onClose={() => setForcedPw(null)} />
            )}

            {/* Specialist mission handoff — floats the active briefing mission's
                walkthrough in whatever module the user landed in. */}
            <MissionGuide />

            {/* Relantern AI Panel — lazy loaded on first open */}
            {isRelanternOpen && (
                <Suspense fallback={null}>
                    <RelanternAI
                        isOpen={isRelanternOpen}
                        onClose={closeRelantern}
                        contextData={contextData}
                        contextType={contextType}
                        initialPrompt={initialPrompt}
                        pageActions={pageActions}
                    />
                </Suspense>
            )}

            {/* Device Previewer Shell - Only render if we are the top window to prevent inception */}
            {isMainFrame && isPreviewOpen && (
                <Suspense fallback={null}>
                    <DevicePreviewer onClose={() => setIsPreviewOpen(false)} />
                </Suspense>
            )}

            {/* Operator "Report a Problem" — bottom sheet, lazy loaded on first open */}
            {isQuickReportOpen && (
                <Suspense fallback={null}>
                    <ReportRequestForm open onClose={() => setIsQuickReportOpen(false)} />
                </Suspense>
            )}

            {/* Global Command Palette (⌘K) — lazy loaded on first open */}
            {isPaletteOpen && (
                <Suspense fallback={null}>
                    <CommandPalette open onClose={() => setIsPaletteOpen(false)} />
                </Suspense>
            )}

            {/* Surfaces swallowed service errors as toasts (fail-loud) */}
            <GlobalErrorToaster />

            {/* Mobile Bottom Tab Navigation — visible only on < 768px */}
            <MobileBottomNav />
        </div>
    );
};

