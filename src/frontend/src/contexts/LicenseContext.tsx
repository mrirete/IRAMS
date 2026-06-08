/**
 * License Context
 * ═══════════════
 * Holds which modules AND sub-modules are enabled, persisted to localStorage.
 * Default: ALL modules and sub-modules enabled (full enterprise license).
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import type { ModuleId } from '../config/moduleRegistry';
import { MODULE_REGISTRY, MODULE_MAP } from '../config/moduleRegistry';

// ── All module IDs (default = full license) ──────────────

const ALL_MODULE_IDS: ModuleId[] = MODULE_REGISTRY.map(m => m.id);

/** Collect every child.id from modules that have children */
const ALL_SUB_MODULE_IDS: string[] = MODULE_REGISTRY.flatMap(m => m.children?.map(c => c.id) ?? []);

const STORAGE_KEY = 'ers_license_modules';
const SUB_STORAGE_KEY = 'ers_license_submodules';

// ── Context ──────────────────────────────────────────────

interface LicenseContextValue {
    enabledModules: Set<ModuleId>;
    enabledSubModules: Set<string>;
    isModuleEnabled: (id: ModuleId) => boolean;
    isSubModuleEnabled: (childId: string) => boolean;
    isRouteEnabled: (path: string) => boolean;
    toggleModule: (id: ModuleId) => void;
    toggleSubModule: (childId: string) => void;
    setModules: (ids: ModuleId[]) => void;
    resetToFull: () => void;
}

const LicenseContext = createContext<LicenseContextValue>({
    enabledModules: new Set(ALL_MODULE_IDS),
    enabledSubModules: new Set(ALL_SUB_MODULE_IDS),
    isModuleEnabled: () => true,
    isSubModuleEnabled: () => true,
    isRouteEnabled: () => true,
    toggleModule: () => { },
    toggleSubModule: () => { },
    setModules: () => { },
    resetToFull: () => { },
});

export const useLicense = () => useContext(LicenseContext);

// ── Provider ─────────────────────────────────────────────

export const LicenseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [enabledModules, setEnabledModules] = useState<Set<ModuleId>>(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = new Set(JSON.parse(stored) as ModuleId[]);
                // Auto-merge newly-registered modules that weren't in the stored set
                // This prevents new modules (e.g. 'audits') from being blocked
                // when an existing user has stale localStorage
                for (const id of ALL_MODULE_IDS) {
                    if (!parsed.has(id)) parsed.add(id);
                }
                return parsed;
            }
        } catch { /* ignore */ }
        return new Set(ALL_MODULE_IDS);
    });

    const [enabledSubModules, setEnabledSubModules] = useState<Set<string>>(() => {
        try {
            const stored = localStorage.getItem(SUB_STORAGE_KEY);
            if (stored) {
                const parsed = new Set(JSON.parse(stored) as string[]);
                // Auto-merge newly-registered sub-modules
                for (const id of ALL_SUB_MODULE_IDS) {
                    if (!parsed.has(id)) parsed.add(id);
                }
                return parsed;
            }
        } catch { /* ignore */ }
        return new Set(ALL_SUB_MODULE_IDS);
    });

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...enabledModules]));
    }, [enabledModules]);

    useEffect(() => {
        localStorage.setItem(SUB_STORAGE_KEY, JSON.stringify([...enabledSubModules]));
    }, [enabledSubModules]);

    const isModuleEnabled = useCallback((id: ModuleId) => {
        // Core is always enabled
        if (id === 'core') return true;
        return enabledModules.has(id);
    }, [enabledModules]);

    const isSubModuleEnabled = useCallback((childId: string) => {
        return enabledSubModules.has(childId);
    }, [enabledSubModules]);

    /** Build a lookup from route path → child id for sub-module gating */
    const routeToChildId = useMemo(() => {
        const map = new Map<string, string>();
        for (const mod of MODULE_REGISTRY) {
            if (!mod.children) continue;
            for (const child of mod.children) {
                map.set(child.path, child.id);
            }
        }
        return map;
    }, []);

    const isRouteEnabled = useCallback((path: string) => {
        // Find which module owns this route
        const mod = MODULE_REGISTRY.find(m =>
            m.routes.some(r => path === r || path.startsWith(r + '/'))
        );
        if (!mod) return true; // Unknown routes are allowed
        if (!isModuleEnabled(mod.id)) return false;

        // Check sub-module gating (exact child route match)
        const childId = routeToChildId.get(path);
        if (childId && !enabledSubModules.has(childId)) return false;

        return true;
    }, [isModuleEnabled, enabledSubModules, routeToChildId]);

    const toggleModule = useCallback((id: ModuleId) => {
        if (id === 'core') return; // Can't disable core
        setEnabledModules(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
                // Auto-enable dependencies
                const mod = MODULE_MAP.get(id);
                mod?.dependencies.forEach(dep => next.add(dep));
            }
            return next;
        });
    }, []);

    const toggleSubModule = useCallback((childId: string) => {
        setEnabledSubModules(prev => {
            const next = new Set(prev);
            if (next.has(childId)) {
                next.delete(childId);
            } else {
                next.add(childId);
            }
            return next;
        });
    }, []);

    const setModules = useCallback((ids: ModuleId[]) => {
        setEnabledModules(new Set(['core', ...ids]));
    }, []);

    const resetToFull = useCallback(() => {
        setEnabledModules(new Set(ALL_MODULE_IDS));
        setEnabledSubModules(new Set(ALL_SUB_MODULE_IDS));
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(SUB_STORAGE_KEY);
    }, []);

    return (
        <LicenseContext.Provider value={{
            enabledModules, enabledSubModules,
            isModuleEnabled, isSubModuleEnabled, isRouteEnabled,
            toggleModule, toggleSubModule,
            setModules, resetToFull,
        }}>
            {children}
        </LicenseContext.Provider>
    );
};
