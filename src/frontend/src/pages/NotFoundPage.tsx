/**
 * NotFoundPage — an unknown URL used to render a blank main area with the
 * chrome intact (launch review B10). Say so, and offer the way home.
 */
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Compass, Home, ArrowLeft } from 'lucide-react';

export const NotFoundPage: React.FC = () => {
    const { pathname } = useLocation();
    return (
        <div className="flex items-center justify-center min-h-[60vh] p-6">
            <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-8 text-center">
                <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center">
                    <Compass size={26} className="text-slate-400" />
                </div>
                <h2 className="text-xl font-bold text-slate-800 mb-1">There is nothing at this address</h2>
                <p className="text-sm text-slate-500 mb-1">The page may have moved, or the link is out of date.</p>
                <p className="text-[11px] font-mono text-slate-400 mb-6 break-all">{pathname}</p>
                <div className="flex items-center justify-center gap-2">
                    <button onClick={() => window.history.back()} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                        <ArrowLeft size={14} /> Go back
                    </button>
                    <Link to="/" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-500">
                        <Home size={14} /> Home
                    </Link>
                </div>
            </div>
        </div>
    );
};

export default NotFoundPage;
