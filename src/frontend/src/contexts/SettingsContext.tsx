/**
 * Settings Context
 * ════════════════
 * App-wide configuration: currency, timezone, date format, locale, site config.
 * Persisted to localStorage, USD default.
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

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

interface SettingsContextValue {
    settings: AppSettings;
    updateSettings: (partial: Partial<AppSettings>) => void;
    resetSettings: () => void;
    formatCurrency: (amount: number) => string;
}

const SettingsContext = createContext<SettingsContextValue>({
    settings: DEFAULT_SETTINGS,
    updateSettings: () => { },
    resetSettings: () => { },
    formatCurrency: (n) => `$${n.toLocaleString()}`,
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

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [settings, setSettings] = useState<AppSettings>(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
        } catch { /* ignore */ }
        return DEFAULT_SETTINGS;
    });

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }, [settings]);

    const updateSettings = useCallback((partial: Partial<AppSettings>) => {
        setSettings(prev => ({ ...prev, ...partial }));
    }, []);

    const resetSettings = useCallback(() => {
        setSettings(DEFAULT_SETTINGS);
        localStorage.removeItem(STORAGE_KEY);
    }, []);

    const formatCurrency = useCallback((amount: number) => {
        const sym = CURRENCY_SYMBOLS[settings.currency] || '$';
        return `${sym}${amount.toLocaleString(settings.locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    }, [settings.currency, settings.locale]);

    return (
        <SettingsContext.Provider value={{ settings, updateSettings, resetSettings, formatCurrency }}>
            {children}
        </SettingsContext.Provider>
    );
};
