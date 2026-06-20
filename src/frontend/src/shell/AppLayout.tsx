import React, { useState, useEffect, lazy, Suspense } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { MobileBottomNav } from './MobileBottomNav';
import { useRelantern } from '../eam/contexts/RelanternContext';
import { initOfflineExecutors } from '../eam/services/offlineExecutors';

// ── Lazy-loaded panels (not needed on initial render) ──
// RelanternCoPilot statically pulled in geminiService (@google/genai, ~130 KB gz)
// on every page. Lazy-load it so that AI chunk stays off the critical path; its
// floating button just appears a beat after first paint.
const RelanternCoPilot = lazy(() => import('../components/shell/RelanternCoPilot').then(m => ({ default: m.RelanternCoPilot })));
const RelanternAI = lazy(() => import('../eam/components/RelanternAI').then(m => ({ default: m.RelanternAI })));
const DevicePreviewer = lazy(() => import('../components/dev/DevicePreviewer').then(m => ({ default: m.DevicePreviewer })));
const ReportRequestForm = lazy(() => import('../eam/components/ReportRequestForm').then(m => ({ default: m.ReportRequestForm })));
const CommandPalette = lazy(() => import('./CommandPalette').then(m => ({ default: m.CommandPalette })));

interface AppLayoutProps {
    children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const [isQuickReportOpen, setIsQuickReportOpen] = useState(false);
    const [isPaletteOpen, setIsPaletteOpen] = useState(false);
    // Computed once at mount (lazy init) — avoids a setState-in-effect cascade.
    const [isMainFrame] = useState(() => typeof window === 'undefined' || window.top === window.self);
    const { isOpen: isRelanternOpen, contextData, contextType, closeRelantern } = useRelantern();

    // Listen for custom sidebar toggle events from MobileBottomNav "More" button
    useEffect(() => {
        const handler = () => setIsSidebarOpen(prev => !prev);
        window.addEventListener('toggle-sidebar', handler);
        return () => window.removeEventListener('toggle-sidebar', handler);
    }, []);

    // Register offline-queue executors once + replay any writes queued in a prior offline session.
    useEffect(() => { initOfflineExecutors(); }, []);

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
                <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6 relative bg-slate-50 text-slate-900">
                    {children}
                </main>
            </div>

            {/* Relantern AI Panel — lazy loaded on first open */}
            {isRelanternOpen && (
                <Suspense fallback={null}>
                    <RelanternAI
                        isOpen={isRelanternOpen}
                        onClose={closeRelantern}
                        contextData={contextData}
                        contextType={contextType}
                    />
                </Suspense>
            )}

            {/* Device Previewer Shell - Only render if we are the top window to prevent inception */}
            {isMainFrame && isPreviewOpen && (
                <Suspense fallback={null}>
                    <DevicePreviewer onClose={() => setIsPreviewOpen(false)} />
                </Suspense>
            )}

            {/* Relantern CoPilot — Floating AI Coach (lazy: keeps the AI client off the critical path) */}
            <Suspense fallback={null}>
                <RelanternCoPilot />
            </Suspense>

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

            {/* Mobile Bottom Tab Navigation — visible only on < 768px */}
            <MobileBottomNav />
        </div>
    );
};

