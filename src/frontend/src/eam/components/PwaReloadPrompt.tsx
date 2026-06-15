import React from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, X } from 'lucide-react';

export const PwaReloadPrompt: React.FC = () => {
    const {
        needRefresh: [needRefresh, setNeedRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        onRegistered(r) {
            console.log('SW Registered:', r);
        },
        onRegisterError(error) {
            console.log('SW registration error', error);
        },
    });

    if (!needRefresh) return null;

    return (
        <div className="fixed bottom-20 md:bottom-4 right-4 z-50 bg-slate-900 text-white p-4 rounded-lg shadow-xl border border-slate-700 max-w-sm animate-in slide-in-from-bottom duration-300">
            <div className="flex items-start gap-3">
                <div className="p-2 bg-primary-600 rounded-lg">
                    <RefreshCw size={20} className="animate-spin-slow" />
                </div>
                <div className="flex-1">
                    <h4 className="font-semibold text-sm">Update Available</h4>
                    <p className="text-xs text-slate-400 mt-1">
                        A new version of Relantern is available. Refresh to update.
                    </p>
                    <div className="flex gap-2 mt-3">
                        <button
                            onClick={() => updateServiceWorker(true)}
                            className="px-3 py-1.5 bg-primary-600 hover:bg-primary-500 rounded text-xs font-medium transition"
                        >
                            Refresh Now
                        </button>
                        <button
                            onClick={() => setNeedRefresh(false)}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-xs font-medium transition"
                        >
                            Dismiss
                        </button>
                    </div>
                </div>
                <button
                    onClick={() => setNeedRefresh(false)}
                    className="text-slate-500 hover:text-white"
                >
                    <X size={16} />
                </button>
            </div>
        </div>
    );
};
