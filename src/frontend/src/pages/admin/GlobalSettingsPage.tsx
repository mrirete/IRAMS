import React, { useState } from 'react';
import { Settings, DollarSign, Bell, Shield, Info, Save, RotateCcw, Check, Globe, Layers } from 'lucide-react';
import { useSettings, CURRENCY_OPTIONS, TIMEZONE_OPTIONS } from '../../contexts/SettingsContext';
import type { Currency, DateFormatOption } from '../../contexts/SettingsContext';
import { ModuleLicensingPanel } from '../../components/admin/ModuleLicensingPanel';

// ─────────────────────────────────────────────────────────
//  Tabs
// ─────────────────────────────────────────────────────────

type SettingsTab = 'general' | 'financial' | 'notifications' | 'security' | 'modules' | 'about';

const TABS: { key: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { key: 'general', label: 'General', icon: <Globe size={16} /> },
    { key: 'financial', label: 'Financial', icon: <DollarSign size={16} /> },
    { key: 'notifications', label: 'Notifications', icon: <Bell size={16} /> },
    { key: 'security', label: 'Security', icon: <Shield size={16} /> },
    { key: 'modules', label: 'Modules', icon: <Layers size={16} /> },
    { key: 'about', label: 'About', icon: <Info size={16} /> },
];

// ─────────────────────────────────────────────────────────
//  Component
// ─────────────────────────────────────────────────────────

export const GlobalSettingsPage: React.FC = () => {
    const { resetSettings } = useSettings();
    const [tab, setTab] = useState<SettingsTab>('general');
    const [saved, setSaved] = useState(false);

    const handleSave = () => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                        <Settings size={22} className="text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-black text-slate-900 tracking-tight">Global Settings</h1>
                        <p className="text-slate-500 text-sm font-medium">Enterprise-wide configuration &amp; preferences</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={resetSettings} className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 hover:text-slate-800 rounded-lg text-sm font-semibold transition-all shadow-sm">
                        <RotateCcw size={14} /> Reset Defaults
                    </button>
                    <button onClick={handleSave} className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all shadow-sm ${saved ? 'bg-emerald-500 text-white' : 'bg-accent-cyan hover:bg-primary-400 text-brand-900 shadow-[0_0_15px_rgba(6,182,212,0.25)]'}`}>
                        {saved ? <><Check size={14} /> Saved</> : <><Save size={14} /> Save Changes</>}
                    </button>
                </div>
            </div>

            {/* Tab Bar + Content */}
            <div className="flex gap-6">
                {/* Sidebar Tabs */}
                <div className="w-52 shrink-0 space-y-1">
                    {TABS.map(t => (
                        <button
                            key={t.key}
                            onClick={() => setTab(t.key)}
                            className={`w-full flex items-center gap-2.5 px-4 py-3 rounded-lg text-sm font-semibold transition-all text-left ${tab === t.key
                                ? 'bg-accent-cyan/10 text-primary-700 border border-accent-cyan/30 shadow-sm'
                                : 'text-slate-600 hover:text-slate-800 hover:bg-slate-100 border border-transparent'
                                }`}
                        >
                            {t.icon} {t.label}
                        </button>
                    ))}
                </div>

                {/* Content Panel */}
                <div className="flex-1 bg-white border border-slate-200 rounded-xl p-6 min-h-[500px] shadow-sm">
                    {tab === 'general' && <GeneralTab />}
                    {tab === 'financial' && <FinancialTab />}
                    {tab === 'notifications' && <NotificationsTab />}
                    {tab === 'security' && <SecurityTab />}
                    {tab === 'modules' && <ModulesTab />}
                    {tab === 'about' && <AboutTab />}
                </div>
            </div>
        </div>
    );
};

// ── Reusable Field ────────────────────────────────────────

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
    <div className="flex items-start justify-between gap-8 py-5 border-b border-slate-100 last:border-0">
        <div className="min-w-[200px]">
            <p className="text-sm font-bold text-slate-800">{label}</p>
            {hint && <p className="text-xs text-slate-500 mt-1 leading-relaxed">{hint}</p>}
        </div>
        <div className="flex-1 max-w-sm">{children}</div>
    </div>
);

const selectClass = "w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-800 font-medium focus:outline-none focus:border-accent-cyan focus:ring-2 focus:ring-accent-cyan/20 transition-all";
const inputClass = "w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-800 font-medium focus:outline-none focus:border-accent-cyan focus:ring-2 focus:ring-accent-cyan/20 transition-all placeholder-slate-400";

// ── General Tab ───────────────────────────────────────────

const GeneralTab: React.FC = () => {
    const { settings, updateSettings } = useSettings();
    return (
        <div>
            <h3 className="text-lg font-bold text-slate-900 mb-1 flex items-center gap-2"><Globe size={18} className="text-primary-600" /> General Configuration</h3>
            <p className="text-sm text-slate-500 mb-4">Core platform settings for locale, timezone, and identity.</p>
            <Field label="Site Name" hint="The name displayed in the top bar and reports">
                <input value={settings.siteName} onChange={e => updateSettings({ siteName: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Timezone" hint="Default timezone for all timestamps">
                <select value={settings.timezone} onChange={e => updateSettings({ timezone: e.target.value })} className={selectClass}>
                    {TIMEZONE_OPTIONS.map(tz => <option key={tz} value={tz}>{tz.replace('_', ' ')}</option>)}
                </select>
            </Field>
            <Field label="Date Format">
                <select value={settings.dateFormat} onChange={e => updateSettings({ dateFormat: e.target.value as DateFormatOption })} className={selectClass}>
                    <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                    <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                    <option value="YYYY-MM-DD">YYYY-MM-DD (ISO)</option>
                </select>
            </Field>
            <Field label="Locale" hint="Number and text formatting">
                <select value={settings.locale} onChange={e => updateSettings({ locale: e.target.value })} className={selectClass}>
                    <option value="en-US">English (US)</option>
                    <option value="en-GB">English (UK)</option>
                    <option value="ar-SA">Arabic (Saudi Arabia)</option>
                    <option value="fr-FR">French</option>
                    <option value="de-DE">German</option>
                    <option value="es-ES">Spanish</option>
                </select>
            </Field>
        </div>
    );
};

// ── Financial Tab ─────────────────────────────────────────

const FinancialTab: React.FC = () => {
    const { settings, updateSettings } = useSettings();
    return (
        <div>
            <h3 className="text-lg font-bold text-slate-900 mb-1 flex items-center gap-2"><DollarSign size={18} className="text-emerald-600" /> Financial Configuration</h3>
            <p className="text-sm text-slate-500 mb-4">Currency, fiscal year, and cost reporting preferences.</p>
            <Field label="Default Currency" hint="All monetary values displayed in this currency">
                <select value={settings.currency} onChange={e => updateSettings({ currency: e.target.value as Currency })} className={selectClass}>
                    {CURRENCY_OPTIONS.map(c => <option key={c.code} value={c.code}>{c.symbol} {c.label} ({c.code})</option>)}
                </select>
            </Field>
            <Field label="Fiscal Year Start" hint="Month when the fiscal year begins">
                <select value={settings.fiscalYearStart} onChange={e => updateSettings({ fiscalYearStart: Number(e.target.value) })} className={selectClass}>
                    {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m, i) => (
                        <option key={i + 1} value={i + 1}>{m}</option>
                    ))}
                </select>
            </Field>
            <div className="mt-5 p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
                <p className="text-sm text-emerald-700 font-semibold">💡 Currency changes apply globally. All cost fields, reports, and KPIs will display in the selected currency.</p>
            </div>
        </div>
    );
};

// ── Notifications Tab ─────────────────────────────────────

const NotificationsTab: React.FC = () => {
    const { settings, updateSettings } = useSettings();
    return (
        <div>
            <h3 className="text-lg font-bold text-slate-900 mb-1 flex items-center gap-2"><Bell size={18} className="text-amber-600" /> Notification Preferences</h3>
            <p className="text-sm text-slate-500 mb-4">Escalation thresholds, email alerts, and warning timeframes.</p>
            <Field label="Escalation Tier Threshold" hint="Governance tier that triggers escalation alerts">
                <select value={settings.escalationTierThreshold} onChange={e => updateSettings({ escalationTierThreshold: Number(e.target.value) })} className={selectClass}>
                    <option value={1}>Tier 1 — Low</option>
                    <option value={2}>Tier 2 — Medium</option>
                    <option value={3}>Tier 3 — High</option>
                    <option value={4}>Tier 4 — Critical</option>
                </select>
            </Field>
            <Field label="Email Notifications">
                <label className="flex items-center gap-3 cursor-pointer">
                    <div className={`relative w-12 h-6.5 rounded-full transition-colors ${settings.emailNotifications ? 'bg-accent-cyan' : 'bg-slate-300'}`} onClick={() => updateSettings({ emailNotifications: !settings.emailNotifications })}>
                        <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform ${settings.emailNotifications ? 'translate-x-[26px]' : 'translate-x-0.5'}`} />
                    </div>
                    <span className="text-sm font-semibold text-slate-700">{settings.emailNotifications ? 'Enabled' : 'Disabled'}</span>
                </label>
            </Field>
            <Field label="Badge Expiry Warning" hint="Days before certification expiry to show warning">
                <div className="flex items-center gap-2">
                    <input type="number" min={7} max={90} value={settings.badgeExpiryWarningDays} onChange={e => updateSettings({ badgeExpiryWarningDays: Number(e.target.value) })} className={`${inputClass} w-24`} />
                    <span className="text-sm text-slate-600 font-semibold">days</span>
                </div>
            </Field>
        </div>
    );
};

// ── Security Tab ──────────────────────────────────────────

const SecurityTab: React.FC = () => {
    const { settings } = useSettings();
    return (
        <div>
            <h3 className="text-lg font-bold text-slate-900 mb-1 flex items-center gap-2"><Shield size={18} className="text-red-500" /> Security Configuration</h3>
            <p className="text-sm text-slate-500 mb-4">Authentication, session management, and access controls.</p>
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg mb-5">
                <p className="text-sm text-amber-700 font-semibold">⚠️ Security settings are managed by the system administrator and are read-only in this view.</p>
            </div>
            <Field label="Session Timeout">
                <p className="text-sm text-slate-800 font-mono font-semibold bg-slate-100 px-3 py-2.5 rounded-lg border border-slate-200">{settings.sessionTimeoutMinutes} minutes</p>
            </Field>
            <Field label="Password Minimum Length">
                <p className="text-sm text-slate-800 font-mono font-semibold bg-slate-100 px-3 py-2.5 rounded-lg border border-slate-200">{settings.passwordMinLength} characters</p>
            </Field>
            <Field label="MFA Enforcement">
                <p className={`text-sm font-bold font-mono px-3 py-2.5 rounded-lg border ${settings.mfaEnforced ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                    {settings.mfaEnforced ? '✓ Enforced' : 'Optional'}
                </p>
            </Field>
        </div>
    );
};

// ── About Tab ─────────────────────────────────────────────

const AboutTab: React.FC = () => (
    <div>
        <h3 className="text-lg font-bold text-slate-900 mb-1 flex items-center gap-2"><Info size={18} className="text-blue-500" /> About ERS</h3>
        <p className="text-sm text-slate-500 mb-5">Platform version, standards compliance, and technical stack.</p>
        <div className="space-y-4">
            <div className="flex items-center gap-4 p-5 bg-gradient-to-r from-primary-50 to-blue-50 rounded-xl border border-primary-200/60">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-accent-cyan to-blue-500 flex items-center justify-center text-2xl font-black text-white shadow-lg">E</div>
                <div>
                    <p className="text-slate-900 font-black text-lg">Enterprise Reliability System</p>
                    <p className="text-slate-600 text-sm font-medium">AI-Powered Asset Management & Reliability Intelligence</p>
                </div>
            </div>
            {[
                ['Version', 'v2.6.0-beta'],
                ['Build', '2026.02.22-r3'],
                ['License', 'Enterprise — Unlimited Assets'],
                ['Standards', 'ISO 55000 · ISO 14224 · API 580/581 · IEC 62443'],
                ['Framework', 'React 18 + Vite + FastAPI + PostgreSQL'],
            ].map(([k, v]) => (
                <div key={k} className="flex justify-between px-4 py-3 border-b border-slate-100 last:border-0">
                    <span className="text-sm font-semibold text-slate-600">{k}</span>
                    <span className="text-sm text-slate-900 font-mono font-bold">{v}</span>
                </div>
            ))}
        </div>
    </div>
);

// ── Modules & Licensing Tab ───────────────────────────────
// Shares the ModuleLicensingPanel with Admin → Access Control (same useLicense
// state — editing here or there changes the same org-wide licensing).

const ModulesTab: React.FC = () => (
    <div className="space-y-4">
        <div className="flex items-start gap-2 p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-800">
            <Info size={14} className="mt-0.5 shrink-0 text-blue-500" />
            <span>
                Licensing and per-role <strong>Module Access</strong> are now consolidated under
                <strong> Admin → Access Control</strong>. This panel edits the same org-wide licensing.
            </span>
        </div>
        <ModuleLicensingPanel />
    </div>
);
