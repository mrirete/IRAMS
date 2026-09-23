import { useCallback, useMemo } from 'react';
import { MODULE_REGISTRY, type ModuleDefinition, type ModuleId } from '../config/moduleRegistry';
import { MODULE_ID_TO_PERM_KEY } from '../config/modulePermissions';
import { useLicense } from '../contexts/LicenseContext';
import { useAuth } from '../eam/contexts/AuthContext';
import { useEdition } from '../lib/useEdition';
import type { ModuleName } from '../eam/types';
import type { AdminNavItem } from '../config/adminNav';

/**
 * What the navigation may show this user — one answer for the sidebar and the
 * command palette, so search never offers a page the sidebar hides (and the
 * route would then refuse).
 *
 * ═══ Route → RBAC Permission Key Mapping ═══
 * Maps each route to the AuthContext permission key that controls its
 * visibility. This bridges the Module Registry (license layer) and
 * ROLE_PERMISSION_TEMPLATES (RBAC layer).
 */
export const ROUTE_TO_PERMISSION: Record<string, ModuleName> = {
    '/': 'dashboard',
    '/assets': 'assets',
    '/work-orders': 'workOrders',
    '/requests': 'requests',
    '/recurring-work': 'pm',
    '/scheduling': 'scheduling',
    '/task-library': 'taskLibrary',
    '/management-of-change': 'moc',
    '/inventory': 'inventory',
    '/purchase-orders': 'purchasing',
    '/contacts': 'contacts',
    '/vendors': 'vendors',
    '/readings': 'readings',
    '/notifications': 'notifications',
    '/finops': 'finops',
    '/reports': 'analytics',
    // ── Reliability Specialist (hero product — reliability permission) ──
    '/specialist': 'reliability',
    '/specialist/import': 'reliability',
    '/specialist/assessment': 'reliability',
    '/specialist/deliver': 'reliability',
    '/specialist/manuals': 'reliability',
    '/specialist/roi': 'reliability',
    '/specialist/meeting': 'reliability',
    // ── Reliability Suite (dedicated permission key) ──
    '/reliability-metrics': 'reliability',
    '/failure-review': 'reliability',
    '/predict': 'reliability',
    '/reliability-modelling': 'reliability',
    '/analyze': 'reliability',
    '/analyze/rca': 'reliability',
    '/rcm': 'reliability',
    '/vision': 'reliability',
    '/knowledge-graph': 'reliability',
    // ── Sustainability Suite ──
    '/sustain': 'sustain',
    // ── Integrity Suite (dedicated permission key) ──
    // Mechanical Integrity loop steps + Process Safety share the key.
    '/comply/assess': 'integrity',
    '/comply/inspection-schedule': 'integrity',
    '/comply/measure': 'integrity',
    '/comply/evaluate': 'integrity',
    '/comply/psm': 'integrity',
    '/comply/loto': 'integrity',
    '/comply/regulatory': 'integrity',
    // ── Audits Suite (standalone module) ──
    '/audits': 'audits',
    '/audits/templates': 'audits',
    '/audits/schedule': 'audits',
    '/audits/corrective-actions': 'audits',
    // ── Admin Suite ──
    '/eam-admin': 'admin',
    '/admin/connectors': 'admin',
    '/admin/connectors/new': 'admin',
    '/admin/integrations': 'admin',
    '/admin/api-keys': 'admin',
    '/admin/settings': 'admin',
    '/admin/hierarchy': 'admin',
    '/admin/manufacturers': 'admin',
    '/admin/work-centers': 'admin',
    '/admin/error-logs': 'admin',
    '/admin/activity-log': 'activityLog',
};

export function useNavVisibility() {
    const { isModuleEnabled } = useLicense();
    const { permissions, role, loading: authLoading } = useAuth();
    const { edition } = useEdition();

    // ── Admin-tier roles bypass the license gate (always see all modules) ──
    const isAdminTier = role === 'SUPER_ADMIN' || role === 'SYS_ADMIN';

    // ── RBAC Check: Does the user have view permission for a given route? ──
    const hasPermission = useCallback((path: string): boolean => {
        // While auth is loading, hide everything except dashboard for safety
        if (authLoading || !permissions) return path === '/';
        const permKey = ROUTE_TO_PERMISSION[path];
        if (!permKey) return true; // Routes not in map (e.g. comply sub-pages) default to visible
        return permissions[permKey]?.view === true;
    }, [authLoading, permissions]);

    /**
     * ═══ Module-Level RBAC Gate ═══
     * For premium suites, check the permission key directly at the module
     * level — if view is explicitly false, the entire section is hidden even
     * if individual children might pass. The map lives in
     * config/modulePermissions and is shared with the router's Gated helper,
     * so what the nav hides and what the route refuses can never drift apart.
     */
    const isModulePermitted = useCallback((moduleId: string): boolean => {
        const permKey = MODULE_ID_TO_PERM_KEY[moduleId as ModuleId];
        if (!permKey) return true; // Core modules don't have a module-level gate
        if (authLoading || !permissions) return false;
        return permissions[permKey]?.view === true;
    }, [authLoading, permissions]);

    // ── Module filtering: Edition gate → License gate → Module RBAC gate → Child RBAC gate ──
    const visibleModules = useMemo<ModuleDefinition[]>(() => {
        return MODULE_REGISTRY.filter(m => {
            // 0. Edition gate (strategy §5.2): Specialist edition hides the EAM
            //    section (except Core: Home/Assets/Admin stay — they are the
            //    platform basics the Specialist's data lives in).
            if (edition === 'specialist' && m.section === 'eam' && m.id !== 'core') return false;
            // 1. License/package check (admin-tier roles bypass this gate)
            if (!isAdminTier && !isModuleEnabled(m.id)) return false;
            // 2. Module-level RBAC check (premium suites: reliability, integrity, sustain)
            if (!isModulePermitted(m.id)) return false;
            // 3. RBAC check: For modules with a single path, check permission directly
            if (m.path && !m.children) return hasPermission(m.path);
            // 4. For accordion modules with children, show if ANY child is permitted
            if (m.children && m.children.length > 0) return m.children.some(child => hasPermission(child.path));
            // 5. Core module (dashboard + assets) — always check
            if (m.id === 'core') return hasPermission('/') || hasPermission('/assets');
            return true;
        });
    }, [hasPermission, isModulePermitted, isModuleEnabled, isAdminTier, edition]);

    const hasAdminAccess = hasPermission('/eam-admin');
    const canSeeAdminItem = useCallback((item: AdminNavItem) =>
        hasAdminAccess && (!item.permission || permissions?.[item.permission]?.view === true), [hasAdminAccess, permissions]);

    return { visibleModules, hasPermission, hasAdminAccess, canSeeAdminItem };
}
