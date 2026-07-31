/**
 * Settings Context
 * ════════════════
 * App-wide configuration: currency, timezone, date format, locale, site config.
 *
 * These are ENTERPRISE-WIDE and live on the first active company row
 * (companies.app_settings, 0235), beside companies.edition — the same
 * single-tenant model as useEdition. They used to live only in localStorage,
 * which meant they applied to one browser: two people could read the same work
 * order's costs in different currencies and its timestamps in different
 * timezones, with nothing on screen explaining the difference.
 *
 * localStorage is still used, but only as a paint cache: it lets the first
 * render use the last known values instead of flashing defaults while the
 * fetch is in flight. The database is the source of truth and overwrites it.
 *
 * Writes are admin-only, enforced by RLS (admin_update_companies → is_admin()).
 * saveSettings reports what actually happened rather than assuming success —
 * PostgREST resolves a denied write instead of throwing, so an unchecked call
 * here would report "Saved" on an RLS refusal.
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { supabase } from '../eam/lib/supabase';

// ── Types ────────────────────────────────────────────────────

export type Currency = 'USD' | 'EUR' | 'GBP' | 'AUD' | 'SAR' | 'CAD' | 'SGD';
export type DateFormatOption = 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';

export interface AppSettings {
    // General
    siteName: string;
    timezone: string;
    dateFormat: DateFormatOption;
    locale: string;
    // Financial
    currency: Currency;
    fiscalYearStart: number; // month 1-12
    // Notifications
    escalationTierThreshold: number;
    emailNotifications: boolean;
    badgeExpiryWarningDays: number;
    // Security (read-only display)
    sessionTimeoutMinutes: number;
    passwordMinLength: number;
    mfaEnforced: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
    siteName: 'ERS Production Facility',
    timezone: 'America/Chicago',
    dateFormat: 'MM/DD/YYYY',
    locale: 'en-US',
    currency: 'USD',
    fiscalYearStart: 1,
    escalationTierThreshold: 3,
    emailNotifications: true,
    badgeExpiryWarningDays: 30,
    sessionTimeoutMinutes: 30,
    passwordMinLength: 12,
    mfaEnforced: false,
};

const STORAGE_KEY = 'ers_app_settings';

// ── Context Shape ────────────────────────────────────────────

/** What a save attempt actually did. `ok: false` always carries a reason. */
export type SaveResult = { ok: true } | { ok: false; reason: string };

interface SettingsContextValue {
    settings: AppSettings;
    /** Local, immediate — the editor previews as you type. Not persisted. */
    updateSettings: (partial: Partial<AppSettings>) => void;
    /** Persist enterprise-wide. Admin-only; the result says what happened. */
    saveSettings: () => Promise<SaveResult>;
    resetSettings: () => void;
    formatCurrency: (amount: number) => string;
    /** True until the first load from the database settles. */
    loading: boolean;
    /** True when local edits have not been persisted yet. */
    dirty: boolean;
}

const SettingsContext = createContext<SettingsContextValue>({
    settings: DEFAULT_SETTINGS,
    updateSettings: () => { },
    saveSettings: async () => ({ ok: false, reason: 'Settings provider is not mounted' }),
    resetSettings: () => { },
    formatCurrency: (n) => `$${n.toLocaleString()}`,
    loading: false,
    dirty: false,
});

export const useSettings = () => useContext(SettingsContext);

// ── Currency Symbols ─────────────────────────────────────────

const CURRENCY_SYMBOLS: Record<Currency, string> = {
    USD: '$', EUR: '€', GBP: '£', AUD: 'A$', SAR: '﷼', CAD: 'C$', SGD: 'S$',
};

export const CURRENCY_OPTIONS: { code: Currency; label: string; symbol: string }[] = [
    { code: 'USD', label: 'US Dollar', symbol: '$' },
    { code: 'EUR', label: 'Euro', symbol: '€' },
    { code: 'GBP', label: 'British Pound', symbol: '£' },
    { code: 'AUD', label: 'Australian Dollar', symbol: 'A$' },
    { code: 'SAR', label: 'Saudi Riyal', symbol: '﷼' },
    { code: 'CAD', label: 'Canadian Dollar', symbol: 'C$' },
    { code: 'SGD', label: 'Singapore Dollar', symbol: 'S$' },
];

export const TIMEZONE_OPTIONS = [
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Houston', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
    'Asia/Dubai', 'Asia/Riyadh', 'Asia/Singapore', 'Asia/Tokyo',
    'Australia/Sydney', 'Pacific/Auckland',
];

// ── Provider ─────────────────────────────────────────────────

/**
 * The first active company row — the tenant, per the 0173 single-tenant model.
 *
 * Falls back to selecting the id alone if app_settings is absent, so a build
 * running ahead of migration 0235 still resolves the tenant and a save attempt
 * surfaces the real database error instead of a misleading "no company row".
 */
async function fetchTenantRow(): Promise<{ id: string; app_settings: Partial<AppSettings> } | null> {
    const base = () => supabase
        .from('companies')
        .select('id, app_settings')
        .eq('active', true)
        .order('created_at', { ascending: true })
        .limit(1);

    const { data, error } = await base();
    if (!error) return (data?.[0] as { id: string; app_settings: Partial<AppSettings> }) ?? null;

    const fallback = await supabase
        .from('companies')
        .select('id')
        .eq('active', true)
        .order('created_at', { ascending: true })
        .limit(1);
    if (fallback.error || !fallback.data?.length) return null;
    return { id: (fallback.data[0] as { id: string }).id, app_settings: {} };
}

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [settings, setSettings] = useState<AppSettings>(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
        } catch { /* ignore */ }
        return DEFAULT_SETTINGS;
    });
    const [companyId, setCompanyId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [dirty, setDirty] = useState(false);

    // Load the enterprise settings. Failure is not fatal: the cached values (or
    // defaults) stay in force and the app keeps working, which is what should
    // happen when the column is missing pre-migration or the network is down.
    useEffect(() => {
        let alive = true;
        void (async () => {
            const row = await fetchTenantRow();
            if (!alive) return;
            if (row) {
                setCompanyId(row.id);
                if (row.app_settings && typeof row.app_settings === 'object') {
                    setSettings(prev => ({ ...prev, ...row.app_settings }));
                }
            }
            setLoading(false);
            setDirty(false);
        })();
        return () => { alive = false; };
    }, []);

    // Paint cache only — see the header. The database remains the source of truth.
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }, [settings]);

    const updateSettings = useCallback((partial: Partial<AppSettings>) => {
        setSettings(prev => ({ ...prev, ...partial }));
        setDirty(true);
    }, []);

    const saveSettings = useCallback(async (): Promise<SaveResult> => {
        if (!companyId) {
            return { ok: false, reason: 'No active company row to save against. Create one in Admin → Companies.' };
        }
        // Read { error }: PostgREST RESOLVES an RLS denial rather than throwing,
        // so a try/catch alone would let a refused write report success.
        const { data, error } = await supabase
            .from('companies')
            .update({ app_settings: settings })
            .eq('id', companyId)
            .select('id');

        if (error) {
            return { ok: false, reason: error.message };
        }
        if (!data?.length) {
            // Zero rows updated with no error is what an RLS USING(...) failure
            // looks like from the client: permitted to try, permitted to see
            // nothing changed.
            return { ok: false, reason: 'Not saved — your role cannot change enterprise settings (admins only).' };
        }
        setDirty(false);
        return { ok: true };
    }, [companyId, settings]);

    const resetSettings = useCallback(() => {
        setSettings(DEFAULT_SETTINGS);
        localStorage.removeItem(STORAGE_KEY);
        setDirty(true);   // reverting is itself an unsaved change
    }, []);

    const formatCurrency = useCallback((amount: number) => {
        const sym = CURRENCY_SYMBOLS[settings.currency] || '$';
        return `${sym}${amount.toLocaleString(settings.locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    }, [settings.currency, settings.locale]);

    return (
        <SettingsContext.Provider value={{ settings, updateSettings, saveSettings, resetSettings, formatCurrency, loading, dirty }}>
            {children}
        </SettingsContext.Provider>
    );
};
