import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
        errorInfo: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error, errorInfo: null };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("Uncaught error:", error, errorInfo);
        (this as any).setState({ error, errorInfo });
    }

    public render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
                    <div className="bg-white p-8 rounded-lg shadow-xl max-w-2xl w-full border border-red-200">
                        <h1 className="text-2xl font-bold text-red-600 mb-4">Something went wrong</h1>
                        <div className="bg-red-50 p-4 rounded border border-red-100 mb-6 overflow-auto max-h-96">
                            <p className="font-semibold text-red-900 mb-2">Error Message:</p>
                            <pre className="text-sm text-red-800 font-mono whitespace-pre-wrap mb-4">
                                {this.state.error?.toString()}
                            </pre>
                            {this.state.errorInfo && (
                                <>
                                    <p className="font-semibold text-red-900 mb-2">Component Stack:</p>
                                    <pre className="text-xs text-red-700 font-mono whitespace-pre-wrap">
                                        {this.state.errorInfo.componentStack}
                                    </pre>
                                </>
                            )}
                        </div>
                        <div className="flex gap-4">
                            <button
                                onClick={() => window.location.reload()}
                                className="px-4 py-2 bg-relantern-500 text-white rounded hover:bg-relantern-600 font-medium"
                            >
                                Reload Application
                            </button>
                            <button
                                onClick={() => {
                                    localStorage.clear();
                                    window.location.reload();
                                }}
                                className="px-4 py-2 bg-slate-200 text-slate-700 rounded hover:bg-slate-300 font-medium"
                            >
                                Clear Cache & Reload
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return (this as any).props.children;
    }
}
