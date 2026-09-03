/**
 * ModuleLicensingPanel — the org-wide module ON/OFF (licensing) surface.
 *
 * This is the LICENSING layer of access control: which modules & sub-modules are
 * active for the whole deployment. It is distinct from the RBAC "Module Access"
 * (which roles/users may use an ACTIVE module). Both now live under Admin →
 * Access Control so licensing + authorization are managed from one place; the
 * shared useLicense() state means either mount edits the same thing.
 */
import React from 'react';
import { Layers } from 'lucide-react';
import { MODULE_REGISTRY, TIER_META } from '../../config/moduleRegistry';
import type { ModuleTier } from '../../config/moduleRegistry';
import { useLicense } from '../../contexts/LicenseContext';

const TIERS: ModuleTier[] = ['core', 'reliability', 'integrity', 'intelligence', 'sustainability', 'financial'];

export const ModuleLicensingPanel: React.FC = () => {
    const { enabledModules, enabledSubModules, toggleModule, toggleSubModule, resetToFull, ceiling, tier, trialEndsAt } = useLicense();
    const planLabel = tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : null;
    const trialDays = trialEndsAt ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000)) : null;
    const outsidePlan = (id: string) => !!(ceiling && !ceiling.has(id as never));

    return (
        <div>
            <div className="flex items-center justify-between mb-1">
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    <Layers size={18} className="text-primary-600" /> Module Licensing
                </h3>
                <button onClick={resetToFull} className="text-xs text-slate-500 hover:text-primary-600 transition-colors font-semibold">
                    Reset to Full License
                </button>
            </div>

            <p className="text-sm text-slate-500 mb-2">
                {enabledModules.size} of {MODULE_REGISTRY.length} modules enabled org-wide. Core modules cannot be disabled.
                A disabled module is hidden for <em>everyone</em>, regardless of role — use <strong>Module Access</strong> for per-role control.
            </p>
            {planLabel && (
                <p className="text-xs text-slate-500 mb-5 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    Your plan: <strong>{planLabel}</strong>{trialDays != null ? <> — trial, <strong>{trialDays} day{trialDays === 1 ? '' : 's'}</strong> left</> : ''}.
                    {ceiling ? ' Modules marked "not in plan" are decided by the plan, not by these switches — contact sales@relantern.com to change plans.' : ' Every module is licensed; these switches only hide modules.'}
                </p>
            )}

            <div className="space-y-6">
                {TIERS.map(tier => {
                    const meta = TIER_META[tier];
                    const mods = MODULE_REGISTRY.filter(m => m.tier === tier);
                    if (mods.length === 0) return null;

                    return (
                        <div key={tier}>
                            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider mb-3 ${meta.bg} ${meta.color} border ${meta.border}`}>
                                {meta.label} Tier
                            </div>
                            <div className="space-y-2">
                                {mods.map(mod => {
                                    const Icon = mod.icon;
                                    const locked = outsidePlan(mod.id);
                                    const isEnabled = enabledModules.has(mod.id) && !locked;
                                    const isCore = mod.id === 'core';

                                    return (
                                        <div key={mod.id}>
                                            {/* Parent module card */}
                                            <div className={`flex items-center justify-between p-3.5 rounded-lg border transition-all ${isEnabled
                                                ? 'bg-white border-slate-200 hover:border-slate-300 shadow-sm'
                                                : 'bg-slate-100 border-slate-200 opacity-50'
                                                }`}>
                                                <div className="flex items-center gap-3">
                                                    <Icon size={18} className={isEnabled ? meta.color : 'text-slate-400'} />
                                                    <div>
                                                        <p className={`text-sm font-bold ${isEnabled ? 'text-slate-800' : 'text-slate-500'}`}>
                                                            {mod.label}
                                                            {locked && <span className="ml-2 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Not in plan</span>}
                                                        </p>
                                                        <p className="text-xs text-slate-500">{mod.description}</p>
                                                    </div>
                                                </div>
                                                <div
                                                    onClick={() => !isCore && !locked && toggleModule(mod.id)}
                                                    title={locked ? 'Decided by your plan — contact sales to change plans' : undefined}
                                                    className={`relative w-11 h-6 rounded-full transition-colors ${isCore || locked ? 'bg-slate-300 cursor-not-allowed' : isEnabled ? 'bg-accent-cyan cursor-pointer' : 'bg-slate-300 cursor-pointer'
                                                        }`}
                                                >
                                                    <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform ${isEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                                                        }`} />
                                                </div>
                                            </div>

                                            {/* Sub-module rows (individually toggleable) */}
                                            {mod.children && isEnabled && (
                                                <div className="ml-6 mt-1 space-y-1">
                                                    {mod.children.map(child => {
                                                        const childEnabled = enabledSubModules.has(child.id);
                                                        return (
                                                            <div key={child.id} className={`flex items-center justify-between p-2.5 pl-4 rounded-lg border transition-all ${childEnabled
                                                                ? 'border-slate-200 bg-white shadow-sm'
                                                                : 'border-slate-100 bg-slate-50 opacity-50'
                                                                }`}>
                                                                <div className="flex items-center gap-2.5">
                                                                    <div className={`w-1.5 h-1.5 rounded-full transition-colors ${childEnabled ? meta.color.replace('text-', 'bg-') : 'bg-slate-300'}`} />
                                                                    <p className={`text-sm transition-colors font-medium ${childEnabled ? 'text-slate-700' : 'text-slate-400'}`}>{child.label}</p>
                                                                    <span className="text-[10px] text-slate-400 font-mono">{child.path}</span>
                                                                </div>
                                                                <div
                                                                    onClick={() => toggleSubModule(child.id)}
                                                                    className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${childEnabled ? 'bg-accent-cyan/80' : 'bg-slate-300'}`}
                                                                >
                                                                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-md transition-transform ${childEnabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default ModuleLicensingPanel;
