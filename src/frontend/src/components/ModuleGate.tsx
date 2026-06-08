/**
 * ModuleGate — Route Guard
 * ════════════════════════
 * Wraps a route's element. If the module is disabled, shows a paywall card.
 */

import React from 'react';
import { Lock, ArrowRight } from 'lucide-react';
import { useLicense } from '../contexts/LicenseContext';
import { MODULE_MAP, TIER_META } from '../config/moduleRegistry';
import type { ModuleId } from '../config/moduleRegistry';
import { useNavigate } from 'react-router-dom';

interface ModuleGateProps {
    moduleId: ModuleId;
    children: React.ReactNode;
}

export const ModuleGate: React.FC<ModuleGateProps> = ({ moduleId, children }) => {
    const { isModuleEnabled } = useLicense();
    const navigate = useNavigate();

    if (isModuleEnabled(moduleId)) {
        return <>{children}</>;
    }

    const mod = MODULE_MAP.get(moduleId);
    const tier = mod ? TIER_META[mod.tier] : null;

    return (
        <div className="flex items-center justify-center min-h-[60vh] animate-in fade-in duration-300">
            <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-2xl p-8 text-center">
                {/* Lock Icon */}
                <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-slate-50 border border-slate-300 flex items-center justify-center">
                    <Lock size={28} className="text-slate-400" />
                </div>

                {/* Title */}
                <h2 className="text-xl font-bold text-slate-800 mb-2">
                    {mod?.label || 'Module'} Not Licensed
                </h2>
                <p className="text-sm text-slate-500 mb-4">
                    This module requires an active license to access. Contact your administrator to enable it.
                </p>

                {/* Tier Badge */}
                {tier && (
                    <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${tier.bg} ${tier.color} border ${tier.border} mb-6`}>
                        {tier.label} Tier
                    </div>
                )}

                {/* Description */}
                {mod && (
                    <p className="text-xs text-slate-400 mb-6 border-t border-slate-200 pt-4">
                        {mod.description}
                    </p>
                )}

                {/* CTA */}
                <button
                    onClick={() => navigate('/admin/settings')}
                    className="flex items-center gap-2 mx-auto px-5 py-2.5 bg-accent-cyan/10 hover:bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/30 rounded-xl text-sm font-semibold transition-all hover:scale-105"
                >
                    Manage Licenses <ArrowRight size={14} />
                </button>
            </div>
        </div>
    );
};
