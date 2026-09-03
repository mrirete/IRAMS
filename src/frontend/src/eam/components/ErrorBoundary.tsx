import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Copy, Check } from 'lucide-react';
import { Button } from './ui';
import { errorLog } from '../services/ErrorLogService';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
    copied: boolean;
}

/** Keys that must survive an app-data reset: queued offline field writes would
 *  otherwise be destroyed (a technician's unsent work orders/readings). */
const PRESERVE_ON_RESET = ['ers_offline_queue_v1'];

/** Short, stable reference code from the error message — for support tickets. */
function errorCode(message: string): string {
    let h = 5381;
    for (let i = 0; i < message.length; i++) h = ((h << 5) + h + message.charCodeAt(i)) >>> 0;
    return `ERR-${h.toString(36).toUpperCase().slice(0, 6)}`;
}

const buildSha = typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'dev';

export class ErrorBoundary extends Component<Props, State> {
    public state: State = { hasError: false, error: null, errorInfo: null, copied: false };

    public static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error, errorInfo: null };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error:', error, errorInfo);
        this.setState({ error, errorInfo });
        // Launch review B8: a render crash is the one error the global
        // listeners never see — record it with the build and the page.
        try {
            errorLog.capture({
                severity: 'critical', category: 'system', module: 'ui', action: 'render_crash',
                message: error?.message || 'Render crash', error,
                inputSnapshot: { page: window.location.pathname, build: buildSha, componentStack: (errorInfo?.componentStack || '').slice(0, 2000) },
            });
        } catch { /* never let telemetry break the fallback UI */ }
    }

    private details(): string {
        const { error, errorInfo } = this.state;
        return [
            `IREAMS error report — ${errorCode(error?.message || 'unknown')}`,
            `Time:  ${new Date().toISOString()}`,
            `Build: ${buildSha}`,
            `Page:  ${window.location.href}`,
            '',
            `Error: ${error?.toString() || 'unknown'}`,
            '',
            'Component stack:',
            errorInfo?.componentStack || '(not captured)',
            '',
            'Stack:',
            error?.stack || '(not captured)',
        ].join('\n');
    }

    private copyDetails = async () => {
        try {
            await navigator.clipboard.writeText(this.details());
            this.setState({ copied: true });
            setTimeout(() => this.setState({ copied: false }), 2500);
        } catch {
            // Clipboard blocked — fall back to a selectable prompt.
            window.prompt('Copy the error details below:', this.details());
        }
    };

    private resetAppData = () => {
        try {
            const preserved = PRESERVE_ON_RESET
                .map(k => [k, localStorage.getItem(k)] as const)
                .filter(([, v]) => v !== null);
            localStorage.clear();
            preserved.forEach(([k, v]) => localStorage.setItem(k, v as string));
        } catch { /* storage unavailable — reload is still the recovery */ }
        window.location.reload();
    };

    public render() {
        if (this.state.hasError) {
            const code = errorCode(this.state.error?.message || 'unknown');
            return (
                <div className="min-h-[60vh] flex items-center justify-center bg-slate-50 p-4">
                    <div className="bg-white p-6 md:p-8 rounded-card shadow-card max-w-lg w-full border border-slate-200 text-center">
                        <div className="w-14 h-14 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto mb-4">
                            <AlertTriangle size={26} className="text-amber-600" />
                        </div>
                        <h1 className="text-xl font-bold text-slate-800 mb-2">Something went wrong on this page</h1>
                        <p className="text-sm text-slate-500 mb-1">
                            The rest of IREAMS is unaffected. Reloading usually fixes it — your unsent field work is kept safe either way.
                        </p>
                        <p className="text-xs text-slate-400 font-mono mb-5">
                            Reference {code} · build {buildSha}
                        </p>

                        <div className="flex flex-wrap justify-center gap-2 mb-4">
                            <Button onClick={() => window.location.reload()} leftIcon={<RefreshCw size={15} />}>
                                Reload application
                            </Button>
                            <Button variant="secondary" onClick={this.copyDetails} leftIcon={this.state.copied ? <Check size={15} /> : <Copy size={15} />}>
                                {this.state.copied ? 'Copied' : 'Copy details for support'}
                            </Button>
                        </div>

                        <details className="text-left bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4">
                            <summary className="text-xs font-semibold text-slate-500 cursor-pointer select-none">Technical details</summary>
                            <pre className="text-[11px] text-slate-600 font-mono whitespace-pre-wrap mt-2 max-h-48 overflow-auto">
                                {this.state.error?.toString()}
                                {this.state.errorInfo?.componentStack || ''}
                            </pre>
                        </details>

                        <button
                            onClick={this.resetAppData}
                            className="text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2"
                        >
                            Still stuck? Reset app data &amp; reload (signs you out; keeps unsent field work)
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
