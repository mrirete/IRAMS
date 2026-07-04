import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldOff, ArrowLeft, Lock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ModuleName } from '../types';

interface PermissionGateProps {
    module: ModuleName;
    children: React.ReactNode;
}

/**
 * PermissionGate — Route-level RBAC guard.
 * 
 * Distinct from ModuleGate (license-based):
 * - ModuleGate checks if the ORGANIZATION has purchased the module tier.
 * - PermissionGate checks if the USER has permission to view the module.
 * 
 * SAP Authorization Object equivalent: checks Activity 03 (Display)
 * on the user's authorization profile.
 */
export const PermissionGate: React.FC<PermissionGateProps> = ({ module, children }) => {
    const { permissions, loading, role } = useAuth();
    const navigate = useNavigate();

    // Still loading auth state — show spinner
    if (loading || permissions === null) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    // Check module view permission
    const modulePerms = permissions[module];
    const hasAccess = modulePerms?.view === true;

    if (hasAccess) {
        return <>{children}</>;
    }

    // Access Denied — styled card with role context
    return (
        <div className="flex items-center justify-center min-h-[60vh] p-4 animate-in fade-in zoom-in-95 duration-300">
            <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
                {/* Header Band */}
                <div className="bg-gradient-to-r from-red-500 to-rose-600 px-6 py-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm">
                        <Lock size={20} className="text-white" />
                    </div>
                    <div>
                        <h2 className="text-white font-bold text-lg">Access Restricted</h2>
                        <p className="text-white/80 text-xs">Authorization Required</p>
                    </div>
                </div>

                {/* Body */}
                <div className="p-6 text-center space-y-4">
                    <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto">
                        <ShieldOff size={28} className="text-red-400" />
                    </div>

                    <div>
                        <p className="text-slate-700 font-medium">
                            You do not have permission to access this module.
                        </p>
                        <p className="text-sm text-slate-500 mt-2">
                            Your current role (<span className="font-semibold text-slate-700">{role || 'Unknown'}</span>) does not include <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">{module}.view</span> access.
                        </p>
                    </div>

                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-left">
                        <p className="text-xs text-amber-800">
                            <strong>Need access?</strong> Contact your System Administrator to request elevated privileges for this module.
                        </p>
                    </div>

                    <button
                        onClick={() => navigate(-1)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors"
                    >
                        <ArrowLeft size={16} />
                        Go Back
                    </button>
                </div>
            </div>
        </div>
    );
};
