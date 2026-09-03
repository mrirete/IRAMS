/**
 * ModuleGate — Route Guard
 * ════════════════════════
 * Wraps a route's element. If the module is disabled, shows a paywall card.
 *
 * Launch review B1: the card now says WHICH plan the tenant is on, which plan
 * includes the module, and how long a trial has left — and it no longer sends
 * people to a local toggle panel that cannot change the server-side plan.
 */

import React from 'react';
import { Lock, ArrowRight, Mail, Settings } from 'lucide-react';
import { useLicense } from '../contexts/LicenseContext';
import { MODULE_MAP, TIER_META } from '../config/moduleRegistry';
import type { ModuleId } from '../config/moduleRegistry';
import { TIER_FAMILIES } from '../config/tierMap';
import type { PricingTier } from '../config/tierMap';
import { useNavigate } from 'react-router-dom';

interface ModuleGateProps {
    moduleId: ModuleId;
    children: React.ReactNode;
}

const PLAN_LABEL: Record<PricingTier, string> = { starter: 'Starter', professional: 'Professional', enterprise: 'Enterprise' };
const SALES_MAIL = 'sales@relantern.com';

/** The cheapest plan whose families include this module's family. */
function planThatIncludes(family: string | undefined): PricingTier {
    if (!family) return 'enterprise';
    for (const plan of ['starter', 'professional', 'enterprise'] as PricingTier[]) {
        const fams = TIER_FAMILIES[plan];
        if (fams === 'all' || fams.includes(family as never)) return plan;
    }
    return 'enterprise';
}

export const ModuleGate: React.FC<ModuleGateProps> = ({ moduleId, children }) => {
    const { isModuleEnabled, ceiling, tier, trialEndsAt } = useLicense();
    const navigate = useNavigate();

    if (isModuleEnabled(moduleId)) {
        return <>{children}</>;
    }

    const mod = MODULE_MAP.get(moduleId);
    const family = mod ? TIER_META[mod.tier] : null;
    // Excluded by the PLAN (server ceiling) vs hidden by an admin's local toggle.
    const outsidePlan = !!(ceiling && !ceiling.has(moduleId));
    const currentPlan = (tier && PLAN_LABEL[tier as PricingTier]) || (tier ?? 'your plan');
    const neededPlan = PLAN_LABEL[planThatIncludes(mod?.tier)];
    const trialDaysLeft = trialEndsAt ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000)) : null;
    const subject = encodeURIComponent(`IREAMS: enable ${mod?.label || moduleId} (${neededPlan} plan)`);

    return (
        <div className="flex items-center justify-center min-h-[60vh] animate-in fade-in duration-300">
            <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-2xl p-8 text-center">
                <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-slate-50 border border-slate-300 flex items-center justify-center">
                    <Lock size={28} className="text-slate-400" />
                </div>

                <h2 className="text-xl font-bold text-slate-800 mb-2">
                    {outsidePlan ? `${mod?.label || 'This module'} is not in the ${currentPlan} plan` : `${mod?.label || 'Module'} is switched off`}
                </h2>
                <p className="text-sm text-slate-500 mb-4">
                    {outsidePlan
                        ? <>It is included in the <strong>{neededPlan}</strong> plan{trialDaysLeft != null && trialDaysLeft > 0 ? <> — your trial has <strong>{trialDaysLeft} day{trialDaysLeft === 1 ? '' : 's'}</strong> left.</> : '.'}</>
                        : <>An administrator has hidden this module for the whole organisation. It can be switched back on under Admin › Settings › Module Licensing.</>}
                </p>

                {family && (
                    <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${family.bg} ${family.color} border ${family.border} mb-6`}>
                        {family.label} family
                    </div>
                )}

                {mod && (
                    <p className="text-xs text-slate-400 mb-6 border-t border-slate-200 pt-4">
                        {mod.description}
                    </p>
                )}

                <div className="flex items-center justify-center gap-2 flex-wrap">
                    {outsidePlan ? (
                        <a href={`mailto:${SALES_MAIL}?subject=${subject}`}
                           className="flex items-center gap-2 px-5 py-2.5 bg-primary-600 hover:bg-primary-500 text-white rounded-xl text-sm font-semibold transition-all">
                            <Mail size={14} /> Talk to sales about {neededPlan}
                        </a>
                    ) : (
                        <button onClick={() => navigate('/admin/settings')}
                            className="flex items-center gap-2 px-5 py-2.5 bg-primary-600 hover:bg-primary-500 text-white rounded-xl text-sm font-semibold transition-all">
                            <Settings size={14} /> Module Licensing <ArrowRight size={14} />
                        </button>
                    )}
                    <button onClick={() => navigate('/')} className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50">
                        Back to Dashboard
                    </button>
                </div>
            </div>
        </div>
    );
};
