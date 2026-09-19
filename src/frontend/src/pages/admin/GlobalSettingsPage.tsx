import React, { useState } from 'react';
import { Settings, DollarSign, Bell, Shield, Info, Save, RotateCcw, Check, Globe, Layers, AlertTriangle, ArrowRight } from 'lucide-react';
import { useSettings, CURRENCY_OPTIONS, TIMEZONE_OPTIONS } from '../../contexts/SettingsContext';
import type { Currency, DateFormatOption } from '../../contexts/SettingsContext';
import { Link } from 'react-router-dom';
import { MFAPanel } from '../../components/security/MFAPanel';

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
    const { resetSettings, saveSettings, loading, dirty } = useSettings();
    const [tab, setTab] = useState<SettingsTab>('general');
    const [saved, setSaved] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // This button used to flip its own label to "Saved" for two seconds and
    // write nothing at all, on a page headed "Enterprise-wide configuration".
    // It now persists and reports the truth either way — a refused save says so.
    const handleSave = async () => {
        setSaving(true);
        setError(null);
        const result = await saveSettings();
        setSaving(false);
        if (result.ok) {
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } else {
            setError(result.reason);
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Header — stacks on a phone. Side by side, "Global Settings" wrapped
                to two lines and pushed Save Changes off the right edge. */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20 shrink-0">
                        <Settings size={22} className="text-white" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">Global Settings</h1>
                        <p className="text-slate-500 text-[12.5px] sm:text-sm font-medium">Enterprise-wide configuration &amp; preferences</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <button onClick={resetSettings} className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 h-11 sm:h-auto sm:py-2.5 bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 hover:text-slate-800 rounded-lg text-sm font-semibold transition-all shadow-sm whitespace-nowrap">
                        <RotateCcw size={14} /> Reset Defaults
                    </button>
                    <button onClick={handleSave} disabled={saving || loading}
                        className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-5 h-11 sm:h-auto sm:py-2.5 rounded-lg text-sm font-bold transition-all shadow-sm whitespace-nowrap disabled:opacity-60 ${saved ? 'bg-emerald-500 text-white' : 'bg-accent-cyan hover:bg-primary-400 text-brand-900 shadow-[0_0_15px_rgba(6,182,212,0.25)]'}`}>
                        {saving ? <><Save size={14} /> Saving…</>
                            : saved ? <><Check size={14} /> Saved</>
                                : <><Save size={14} /> Save Changes{dirty ? ' •' : ''}</>}
                    </button>
                </div>
            </div>

            {/* A refused or failed save has to be visible. The whole reason this
                page was rewritten is that it reported success it never had. */}
            {error && (
                <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                    <AlertTriangle size={16} className="text-red-500 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                        <p className="text-sm font-bold text-red-800">Not saved</p>
                        <p className="text-[13px] text-red-700 break-words">{error}</p>
                    </div>
                </div>
            )}

            {/* Tab Bar + Content */}
            <div className="flex flex-col md:flex-row gap-4 md:gap-6">
                {/* Sidebar Tabs — horizontal scroll on mobile, sidebar on desktop */}
                <div className="w-full md:w-52 shrink-0 flex md:block gap-1 overflow-x-auto scrollbar-hide md:overflow-visible space-y-0 md:space-y-1">
                    {TABS.map(t => (
                        <button
                            key={t.key}
                            onClick={() => setTab(t.key)}
                            /* w-auto on a phone: w-full made every tab fill the
                               viewport, so the scroller showed exactly one tab and
                               the other five were invisible rather than merely
                               off-screen. */
                            className={`w-auto md:w-full shrink-0 whitespace-nowrap flex items-center gap-2.5 px-4 py-3 rounded-lg text-sm font-semibold transition-all text-left ${tab === t.key
                                ? 'bg-accent-cyan/10 text-primary-700 border border-accent-cyan/30 shadow-sm'
                                : 'text-slate-600 hover:text-slate-800 hover:bg-slate-100 border border-transparent'
                                }`}
                        >
                            {t.icon} {t.label}
                        </button>
                    ))}
                </div>

                {/* Content Panel */}
                <div className="flex-1 min-w-0 bg-white border border-slate-200 rounded-xl p-4 md:p-6 min-h-[500px] shadow-sm">
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
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-8 py-5 border-b border-slate-100 last:border-0">
        <div className="sm:min-w-[200px]">
            <p className="text-sm font-bold text-slate-800">{label}</p>
            {hint && <p className="text-xs text-slate-500 mt-1 leading-relaxed">{hint}</p>}
        </div>
        <div className="w-full sm:flex-1 sm:max-w-sm">{children}</div>
    </div>
);

const selectClass = "w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-800 font-medium focus:outline-none focus:border-accent-cyan focus:ring-2 focus:ring-accent-cyan/20 transition-all";
const inputClass = "w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-800 font-medium focus:outline-none focus:border-accent-cyan focus:ring-2 focus:ring-accent-cyan/20 transition-all placeholder-slate-400";

/**
 * Number inputs get a fixed width, not `w-full` capped by a max.
 *
 * Field puts its label and hint in a flex sibling of the control. A long hint
 * grows that sibling, and `w-full` on the input then resolves against whatever
 * space is left — for Session Timeout that came out at 43px, narrow enough that
 * the spinner covered the digits and the field read as empty while holding 30.
 * A fixed basis cannot be squeezed by the length of the copy beside it.
 */
const numberInputClass = inputClass.replace('w-full', 'w-28 shrink-0');

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
            <p className="text-sm text-slate-500 mb-4">Email alerts and warning timeframes.</p>

            {/* There are two notification screens and they do different jobs.
                This one sets workspace-wide preferences; the rules table decides
                which event notifies whom, on which channel. Neither used to
                mention the other, so they read as one setting in two places. */}
            <Link to="/eam-admin" className="flex items-start gap-2.5 p-3 mb-5 rounded-xl border border-slate-200 bg-slate-50 hover:border-primary-300 hover:bg-primary-50/40 transition group">
                <Bell size={14} className="mt-0.5 shrink-0 text-primary-600" />
                <span className="text-xs text-slate-600 leading-relaxed">
                    These are workspace-wide preferences. To choose which event notifies whom, and on which
                    channel, open <strong className="text-slate-800 group-hover:text-primary-700">System Administration › Notifications</strong>.
                </span>
                <ArrowRight size={14} className="mt-0.5 shrink-0 text-slate-300 group-hover:text-primary-500" />
            </Link>
            {/* "Escalation Tier Threshold" was removed here rather than left in
                place. It offered four governance tiers and no code anywhere in
                the product read the chosen value — there is no escalation engine
                behind it to configure. Per-event routing lives in Admin ›
                Notifications, which is a real rules table. A dropdown that
                changes nothing is worse than an absent one: it tells an
                administrator a control exists. */}
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
                    <input type="number" min={7} max={90} value={settings.badgeExpiryWarningDays} onChange={e => updateSettings({ badgeExpiryWarningDays: Number(e.target.value) })} className={numberInputClass} />
                    <span className="text-sm text-slate-600 font-semibold">days</span>
                </div>
            </Field>
        </div>
    );
};

// ── Security Tab ──────────────────────────────────────────

/**
 * Security tab.
 *
 * These three values used to be printed back as read-only text under a banner
 * saying they were "managed by the system administrator". They were managed by
 * nobody: each was stored on the company record and read by no other code in
 * the product, so a workspace that displayed "✓ Enforced" enforced nothing.
 *
 * They are now editable and each one states who acts on it, because two of the
 * three are enforced in this application and the third is not enforceable from
 * here at all. Saying which is which is the point of the tab.
 */
const SecurityTab: React.FC = () => {
    const { settings, updateSettings } = useSettings();
    return (
        <div>
            <h3 className="text-lg font-bold text-slate-900 mb-1 flex items-center gap-2"><Shield size={18} className="text-red-500" /> Security Configuration</h3>
            <p className="text-sm text-slate-500 mb-4">Authentication, session management, and access controls.</p>

            {/* Per-account enrolment for whoever is reading this page. */}
            <div className="mb-5">
                <MFAPanel isAdmin />
            </div>

            <Field
                label="Session Timeout"
                hint="Signs a session out after this long with no mouse, key or touch input. A warning appears in the final minute. Set 0 to never time out."
            >
                <div className="flex items-center gap-2">
                    <input
                        type="number" min={0} max={1440}
                        className={numberInputClass}
                        value={settings.sessionTimeoutMinutes}
                        onChange={e => updateSettings({ sessionTimeoutMinutes: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                    />
                    <span className="text-sm text-slate-500 font-medium">minutes</span>
                </div>
            </Field>

            <Field
                label="MFA Enforcement"
                hint="When on, anyone without a verified authenticator app is stopped at a setup screen before they can use the workspace."
            >
                <label className="flex items-center gap-3 cursor-pointer">
                    <input
                        type="checkbox"
                        className="w-4 h-4 accent-primary-600"
                        checked={settings.mfaEnforced}
                        onChange={e => updateSettings({ mfaEnforced: e.target.checked })}
                    />
                    <span className={`text-sm font-bold ${settings.mfaEnforced ? 'text-emerald-700' : 'text-slate-600'}`}>
                        {settings.mfaEnforced ? 'Required for everyone' : 'Optional'}
                    </span>
                </label>
                {settings.mfaEnforced && (
                    <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                        Enforced in this application. It stops the console, not the API — a token holder
                        calling the database directly is governed by its own policies.
                    </p>
                )}
            </Field>

            <Field
                label="Password Minimum Length"
                hint="Applied when a password is changed from inside the workspace, by the person or by an administrator."
            >
                <div className="flex items-center gap-2">
                    <input
                        type="number" min={8} max={72}
                        className={numberInputClass}
                        value={settings.passwordMinLength}
                        onChange={e => updateSettings({ passwordMinLength: Math.max(8, parseInt(e.target.value, 10) || 8) })}
                    />
                    <span className="text-sm text-slate-500 font-medium">characters</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                    Signup and invitation acceptance happen before this workspace's settings can be read,
                    so those two forms keep the platform floor. The identity provider also enforces its own
                    minimum and rejects anything shorter, whatever is set here.
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

/**
 * Modules tab — a signpost, not a second editor.
 *
 * This used to render ModuleLicensingPanel, the identical control that System
 * Administration › Module Licensing renders. Two screens wrote the same org-wide
 * switches, neither said which one won, and the banner here pointed at "Admin →
 * Access Control", a tab that does not exist under either name. An administrator
 * had no way to know they were looking at one setting twice.
 *
 * Licensing now has one home, beside the per-role Module Access it is constantly
 * confused with. This tab says where that is.
 */
const ModulesTab: React.FC = () => (
    <div className="space-y-4">
        <h3 className="text-lg font-bold text-slate-900 mb-1 flex items-center gap-2"><Layers size={18} className="text-primary-600" /> Modules</h3>
        <p className="text-sm text-slate-500">Which modules are switched on for this workspace, and who may use them.</p>

        <Link
            to="/eam-admin"
            className="flex items-start gap-3 p-4 rounded-xl border border-slate-200 bg-white hover:border-primary-300 hover:bg-primary-50/40 transition group"
        >
            <Layers size={18} className="mt-0.5 shrink-0 text-primary-600" />
            <div className="min-w-0">
                <p className="text-sm font-bold text-slate-800 group-hover:text-primary-700">Module Licensing &amp; User Access</p>
                <p className="text-[13px] text-slate-500 mt-1 leading-relaxed">
                    Org-wide licensing decides which modules exist for everyone. Module Access decides which
                    roles may open them. Both live in System Administration so the two layers are edited together.
                </p>
            </div>
            <ArrowRight size={16} className="mt-1 shrink-0 text-slate-300 group-hover:text-primary-500" />
        </Link>
    </div>
);
