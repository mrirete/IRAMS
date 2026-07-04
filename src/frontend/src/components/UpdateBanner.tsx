import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';

/**
 * No-service-worker update notifier.
 *
 * Polls /version.json (emitted at build time with the current commit SHA) and,
 * when a newer build than the one currently running is detected, shows a
 * dismissible banner with a USER-initiated refresh. The reload happens only on an
 * explicit click — never automatically — so it can't race Supabase's refresh-token
 * rotation the way an auto-reload does. No service worker, no forced reload, no
 * manual "clear site data" for users.
 */
export const UpdateBanner: React.FC = () => {
    const [show, setShow] = useState(false);
    const [latestSha, setLatestSha] = useState<string | null>(null);
    const dismissedSha = useRef<string | null>(null);
    const current = typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'dev';

    useEffect(() => {
        if (current === 'dev') return;                                            // local dev — nothing to update to
        if (typeof window !== 'undefined' && window.top !== window.self) return;  // embedded iframe — parent owns updates

        let stopped = false;
        const check = async () => {
            if (stopped) return;
            try {
                // AbortSignal.timeout: a stalled connection can leave this pending
                // forever (observed in the wild) — abort and try again next tick.
                const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
                if (!res.ok) return;
                const data = await res.json();
                const latest: string | undefined = data?.sha;
                if (latest && latest !== current && latest !== dismissedSha.current) {
                    setLatestSha(latest);
                    setShow(true);
                }
            } catch {
                /* offline / transient network error — ignore, try again next tick */
            }
        };

        const onVisible = () => { if (document.visibilityState === 'visible') check(); };
        const intervalId = window.setInterval(check, 5 * 60 * 1000); // every 5 minutes
        const initialId = window.setTimeout(check, 15000);           // first check shortly after load
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('online', check);

        return () => {
            stopped = true;
            window.clearInterval(intervalId);
            window.clearTimeout(initialId);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('online', check);
        };
    }, [current]);

    if (!show) return null;

    return (
        <div className="fixed bottom-20 md:bottom-4 right-4 z-[100] max-w-xs bg-white border border-slate-200 rounded-xl shadow-2xl p-4 animate-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-start gap-3">
                <div className="p-2 bg-primary-50 text-primary-600 rounded-lg flex-shrink-0">
                    <RefreshCw size={18} />
                </div>
                <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-sm text-slate-800">Update available</h4>
                    <p className="text-xs text-slate-500 mt-0.5">A newer version of IRAMS is ready.</p>
                    <div className="flex gap-2 mt-3">
                        <button
                            onClick={() => window.location.reload()}
                            className="px-3 py-1.5 bg-primary-600 hover:bg-primary-500 text-white rounded-lg text-xs font-semibold transition-colors"
                        >
                            Refresh now
                        </button>
                        <button
                            onClick={() => { dismissedSha.current = latestSha; setShow(false); }}
                            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-semibold transition-colors"
                        >
                            Later
                        </button>
                    </div>
                </div>
                <button onClick={() => { dismissedSha.current = latestSha; setShow(false); }} className="text-slate-400 hover:text-slate-600 flex-shrink-0" aria-label="Dismiss"><X size={16} /></button>
            </div>
        </div>
    );
};
