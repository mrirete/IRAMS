import React, { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { MobileBottomNav } from './MobileBottomNav';
import { AgentPanel } from '../agent-panel/AgentPanel';
import { RelanternAI } from '../eam/components/RelanternAI';
import { useRelantern } from '../eam/contexts/RelanternContext';
import { DevicePreviewer } from '../components/dev/DevicePreviewer';

interface AppLayoutProps {
    children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
    const [isAgentPanelOpen, setIsAgentPanelOpen] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const [isMainFrame, setIsMainFrame] = useState(true);
    const { isOpen: isRelanternOpen, contextData, contextType, closeRelantern } = useRelantern();

    useEffect(() => {
        setIsMainFrame(window.top === window.self);
    }, []);

    // Listen for custom sidebar toggle events from MobileBottomNav "More" button
    useEffect(() => {
        const handler = () => setIsSidebarOpen(prev => !prev);
        window.addEventListener('toggle-sidebar', handler);
        return () => window.removeEventListener('toggle-sidebar', handler);
    }, []);

    // ── Iframe Mode (DevicePreviewer) ──
    // We now render the FULL responsive application shell inside the DevicePreviewer iframe.
    // This allows active testing of the MobileBottomNav, responsive TopBar, and Sidebar drawer.
    // We conditionally pass parameters based on whether we are in the main window.

    return (
        <div className="eam-app flex h-screen w-full overflow-hidden bg-brand-900 text-brand-100 font-sans max-w-[100vw]">
            <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

            <div className="flex flex-col flex-1 overflow-hidden relative min-w-0">
                <TopBar
                    onToggleAgentPanel={() => setIsAgentPanelOpen(!isAgentPanelOpen)}
                    onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
                    onTogglePreview={isMainFrame ? () => setIsPreviewOpen(true) : undefined}
                />

                {/* bg-slate-50 + text-slate-900: light content area so EAM page headers are visible */}
                <main className="flex-1 overflow-y-auto overflow-x-hidden p-3 md:p-6 relative bg-slate-50 text-slate-900 md:rounded-tl-2xl">
                    {children}
                </main>
            </div>

            {isAgentPanelOpen && (
                <AgentPanel onClose={() => setIsAgentPanelOpen(false)} />
            )}

            {/* Relantern AI Panel — globally available */}
            <RelanternAI
                isOpen={isRelanternOpen}
                onClose={closeRelantern}
                contextData={contextData}
                contextType={contextType}
            />

            {/* Device Previewer Shell - Only render if we are the top window to prevent inception */}
            {isMainFrame && isPreviewOpen && (
                <DevicePreviewer onClose={() => setIsPreviewOpen(false)} />
            )}

            {/* Mobile Bottom Tab Navigation — visible only on < 768px */}
            <MobileBottomNav />
        </div>
    );
};

