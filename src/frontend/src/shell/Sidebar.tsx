import React, { useState, useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronRight, Lock, Database, X, Flame } from 'lucide-react';
import { MODULE_REGISTRY, type ModuleDefinition, type SidebarChild } from '../config/moduleRegistry';
import { useLicense } from '../contexts/LicenseContext';
import { useAuth } from '../eam/contexts/AuthContext';
import type { ModuleName } from '../eam/types';

/**
 * ═══ Route → RBAC Permission Key Mapping ═══
 * Maps each sidebar route to the AuthContext permission key
 * that controls its visibility. This bridges the gap between
 * the Module Registry (license layer) and ROLE_PERMISSION_TEMPLATES (RBAC layer).
 */
const ROUTE_TO_PERMISSION: Record<string, ModuleName> = {
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
    // ── Reliability Suite (dedicated permission key) ──
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
    '/comply/loto': 'integrity',
    '/comply/psm': 'integrity',
    '/comply/rbi': 'integrity',
    '/comply/regulatory': 'integrity',
    '/comply/inspection-schedule': 'integrity',
    '/comply/thickness-data': 'integrity',
    '/comply/corrosion-rates': 'integrity',
    '/comply/damage-mechanisms': 'integrity',
    '/comply/ffs': 'integrity',
    '/comply/iow-dashboard': 'integrity',
    '/comply/regulatory-preparedness': 'integrity',
    // ── Audits Suite (standalone module) ──
    '/audits': 'audits',
    '/audits/templates': 'audits',
    '/audits/schedule': 'audits',
    '/audits/corrective-actions': 'audits',
    // ── Admin Suite ──
    '/eam-admin': 'admin',
    '/admin/connectors': 'admin',
    '/admin/connectors/new': 'admin',
    '/admin/settings': 'admin',
    '/admin/error-logs': 'admin',
    '/admin/activity-log': 'activityLog',
    '/system-health': 'admin',
};

interface SidebarProps {
    isOpen: boolean;
    onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
    const location = useLocation();
    const { isModuleEnabled } = useLicense();
    const { permissions, role, loading: authLoading } = useAuth();

    // ── Admin-tier roles bypass the license gate (always see all modules) ──
    const isAdminTier = role === 'SUPER_ADMIN' || role === 'SYS_ADMIN';

    // ── RBAC Check: Does the user have view permission for a given route? ──
    const hasPermission = (path: string): boolean => {
        // While auth is loading, hide everything except dashboard for safety
        if (authLoading || !permissions) return path === '/';
        const permKey = ROUTE_TO_PERMISSION[path];
        if (!permKey) return true; // Routes not in map (e.g. comply sub-pages) default to visible
        return permissions[permKey]?.view === true;
    };

    // Track which accordion sections are expanded (by module id)
    const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() => {
        const initial: Record<string, boolean> = {};
        MODULE_REGISTRY.forEach(mod => {
            if (mod.children && mod.children.some(c => location.pathname.startsWith(c.path))) {
                initial[mod.id] = true;
            }
        });
        if (location.pathname.startsWith('/admin') || location.pathname.startsWith('/eam-admin')) {
            initial['admin'] = true;
        }
        return initial;
    });

    const toggleSection = (id: string) => {
        setExpandedSections(prev => ({ ...prev, [id]: !prev[id] }));
    };

    /**
     * ═══ Module-Level RBAC Gate ═══
     * Maps MODULE_REGISTRY module IDs to their RBAC permission keys.
     * For premium suites, we check the permission key directly at the
     * module level — if view is explicitly false, the entire sidebar
     * section is hidden even if individual children might pass.
     */
    const MODULE_ID_TO_PERM_KEY: Partial<Record<string, ModuleName>> = {
        'predict': 'reliability',    // Reliability Tier → reliability permission
        'comply': 'integrity',       // Integrity → integrity permission
        'audits': 'audits',          // Audit Suite → audits permission
        'sustain': 'sustain',        // Sustain → sustain permission
    };

    const isModulePermitted = (moduleId: string): boolean => {
        const permKey = MODULE_ID_TO_PERM_KEY[moduleId];
        if (!permKey) return true; // Core modules don't have a module-level gate
        if (authLoading || !permissions) return false;
        return permissions[permKey]?.view === true;
    };

    // ── Module filtering: License gate → Module RBAC gate → Child RBAC gate ──
    const visibleModules = useMemo(() => {
        return MODULE_REGISTRY.filter(m => {
            // 1. License/package check (admin-tier roles bypass this gate)
            if (!isAdminTier && !isModuleEnabled(m.id)) return false;

            // 2. Module-level RBAC check (premium suites: reliability, integrity, sustain)
            //    This is the HIGH-LEVEL governance gate — if the admin disabled the suite
            //    for this user, the entire section is hidden.
            if (!isModulePermitted(m.id)) return false;

            // 3. RBAC check: For modules with a single path, check permission directly
            if (m.path && !m.children) {
                return hasPermission(m.path);
            }

            // 4. For accordion modules with children, show if ANY child is permitted
            if (m.children && m.children.length > 0) {
                return m.children.some(child => hasPermission(child.path));
            }

            // 5. Core module (dashboard + assets) — always check
            if (m.id === 'core') {
                return hasPermission('/') || hasPermission('/assets');
            }

            return true;
        });
    }, [permissions, authLoading, isModuleEnabled, isAdminTier]);

    // ── Premium link styling — amber active, crisp slate inactive ──
    const linkClass = (isActive: boolean) =>
        `w-full flex items-center px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-200 group ${isActive
            ? 'bg-relantern-500/15 text-relantern-300 font-semibold shadow-sm shadow-relantern-500/5'
            : 'text-brand-300 hover:bg-brand-700/80 hover:text-brand-100'
        }`;

    const subLinkClass = (isActive: boolean) =>
        `block w-full text-left px-3 py-1.5 rounded-md text-[13px] transition-all duration-200 ${isActive
            ? 'text-relantern-300 font-semibold bg-relantern-500/10'
            : 'text-brand-400 hover:text-brand-200 hover:bg-brand-700/50'
        }`;

    const renderModule = (mod: ModuleDefinition) => {
        const Icon = mod.icon;

        // Core module renders Home + Asset Register explicitly
        if (mod.id === 'core') {
            return (
                <React.Fragment key="core-nav">
                    {hasPermission('/') && (
                        <NavLink key="home" to="/" end className={({ isActive }) => linkClass(isActive)}>
                            {({ isActive }) => (
                                <>
                                    <Icon size={18} className={`mr-3 flex-shrink-0 transition-colors ${isActive ? 'text-relantern-400' : 'text-brand-400 group-hover:text-brand-200'}`} />
                                    <span className="flex-1 text-left">Dashboard</span>
                                </>
                            )}
                        </NavLink>
                    )}
                    {hasPermission('/assets') && (
                        <NavLink key="assets" to="/assets" className={({ isActive }) => linkClass(isActive)}>
                            {({ isActive }) => (
                                <>
                                    <Database size={18} className={`mr-3 flex-shrink-0 transition-colors ${isActive ? 'text-relantern-400' : 'text-brand-400 group-hover:text-brand-200'}`} />
                                    <span className="flex-1 text-left">Asset Register</span>
                                </>
                            )}
                        </NavLink>
                    )}
                </React.Fragment>
            );
        }

        // Accordion module (has children)
        if (mod.children && mod.children.length > 0) {
            // Filter children by RBAC permission
            const permittedChildren = mod.children.filter(child => hasPermission(child.path));
            if (permittedChildren.length === 0) return null; // Hide entire accordion if no children visible

            const isSectionActive = permittedChildren.some(c => location.pathname.startsWith(c.path));
            const isExpanded = expandedSections[mod.id] || false;

            return (
                <div key={mod.id}>
                    <button
                        onClick={() => toggleSection(mod.id)}
                        className={linkClass(isSectionActive)}
                    >
                        <Icon size={18} className={`mr-3 flex-shrink-0 transition-colors ${isSectionActive ? 'text-relantern-400' : 'text-brand-400 group-hover:text-brand-200'}`} />
                        <span className="flex-1 text-left">{mod.label}</span>
                        {isExpanded
                            ? <ChevronDown size={14} className="text-brand-400" />
                            : <ChevronRight size={14} className="text-brand-500" />
                        }
                    </button>

                    {isExpanded && (
                        <div className="mt-1 mb-2 ml-6 pl-3 border-l border-brand-600/50 space-y-0.5">
                            {permittedChildren.map(sub => {
                                // Use exact matching when this child's path is a prefix of siblings
                                // (e.g. '/audits' shouldn't highlight for '/audits/templates')
                                const needsEnd = permittedChildren.some(
                                    sibling => sibling.id !== sub.id && sibling.path.startsWith(sub.path + '/')
                                );
                                return (
                                <NavLink
                                    key={sub.id}
                                    to={sub.path}
                                    end={needsEnd}
                                    onClick={onClose}
                                    className={({ isActive }) => subLinkClass(isActive)}
                                >
                                    {sub.label}
                                </NavLink>
                                );
                            })}
                        </div>
                    )}
                </div>
            );
        }

        // Standard NavLink (single path)
        if (mod.path) {
            return (
                <NavLink key={mod.id} to={mod.path} onClick={onClose} className={({ isActive }) => linkClass(isActive)}>
                    {({ isActive }) => (
                        <>
                            <Icon size={18} className={`mr-3 flex-shrink-0 transition-colors ${isActive ? 'text-relantern-400' : 'text-brand-400 group-hover:text-brand-200'}`} />
                            <span className="flex-1 text-left">{mod.label}</span>
                        </>
                    )}
                </NavLink>
            );
        }

        return null;
    };

    // ── Admin section: Now RBAC-gated (no longer "always visible") ──
    const hasAdminAccess = hasPermission('/eam-admin');
    const isAdminActive = location.pathname.startsWith('/admin') || location.pathname.startsWith('/eam-admin');
    const adminExpanded = expandedSections['admin'] || false;

    const sidebarContent = (
        <div className="w-64 h-full bg-brand-800 border-r border-brand-700/60 flex flex-col overflow-y-auto">
            {/* ── IRAMS Logo ── */}
            <div className="px-5 py-5 flex items-center justify-between border-b border-brand-700/50">
                <div
                    className="flex items-center gap-3 group cursor-default"
                    title="IRAMS — Integrated Reliability & Asset Management Specialist by Relantern"
                >
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-relantern-400 to-relantern-600 flex items-center justify-center shadow-lg shadow-relantern-500/25 group-hover:shadow-relantern-500/40 transition-shadow">
                        <Flame size={20} className="text-white" />
                    </div>
                    <div className="flex flex-col min-w-0">
                        <span className="font-bold text-[16px] tracking-wide text-brand-50 whitespace-nowrap">IRAMS</span>
                        <span className="text-[9px] font-semibold text-brand-400 uppercase tracking-[0.08em] group-hover:text-relantern-400 transition-colors whitespace-nowrap">by Relantern</span>
                    </div>
                </div>
                {/* Close button (mobile only) */}
                <button onClick={onClose} className="md:hidden p-1.5 rounded-lg hover:bg-brand-700 text-brand-300 transition-colors">
                    <X size={18} />
                </button>
            </div>

            <nav className="flex-1 px-3 pt-3 space-y-0.5 pb-6">
                {visibleModules.map(renderModule)}

                {/* Admin Accordion — RBAC-gated: only visible to users with admin.view */}
                {hasAdminAccess && (
                    <div className="pt-4 mt-4 border-t border-brand-700/50">
                        <button
                            onClick={() => toggleSection('admin')}
                            className={linkClass(isAdminActive)}
                        >
                            <Lock size={18} className={`mr-3 flex-shrink-0 transition-colors ${isAdminActive ? 'text-relantern-400' : 'text-brand-400 group-hover:text-brand-200'}`} />
                            <span className="flex-1 text-left">Admin</span>
                            {adminExpanded
                                ? <ChevronDown size={14} className="text-brand-400" />
                                : <ChevronRight size={14} className="text-brand-500" />
                            }
                        </button>

                        {adminExpanded && (
                            <div className="mt-1 mb-2 ml-6 pl-3 border-l border-brand-600/50 space-y-0.5">
                                <NavLink to="/eam-admin" onClick={onClose} className={({ isActive }) => subLinkClass(isActive)}>
                                    Dictionaries & Permissions
                                </NavLink>
                                <NavLink to="/admin/connectors" end onClick={onClose} className={({ isActive }) => subLinkClass(isActive)}>
                                    Connector Hub
                                </NavLink>
                                <NavLink to="/admin/connectors/new" onClick={onClose} className={({ isActive }) => subLinkClass(isActive)}>
                                    New Connector
                                </NavLink>
                                <NavLink to="/admin/settings" onClick={onClose} className={({ isActive }) => subLinkClass(isActive)}>
                                    Global Settings
                                </NavLink>
                                <NavLink to="/admin/error-logs" onClick={onClose} className={({ isActive }) => subLinkClass(isActive)}>
                                    Error Logs
                                </NavLink>
                                {/* Activity Log — SUPER_ADMIN only (activityLog.view gate) */}
                                {permissions?.activityLog?.view && (
                                    <NavLink to="/admin/activity-log" onClick={onClose} className={({ isActive }) => subLinkClass(isActive)}>
                                        <span className="flex items-center gap-1.5">
                                            Activity Log
                                            <span className="text-[8px] font-black text-violet-400 bg-violet-500/15 px-1.5 py-0.5 rounded-full uppercase tracking-wider">Super</span>
                                        </span>
                                    </NavLink>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </nav>

            {/* ── Version Footer ── */}
            <div className="px-5 py-3 border-t border-brand-700/50 text-[10px] text-brand-400 font-medium">
                IRAMS by Relantern · v2.0
            </div>
        </div>
    );

    return (
        <>
            {/* Desktop sidebar — always visible */}
            <div className="hidden md:block flex-shrink-0">
                {sidebarContent}
            </div>

            {/* Mobile sidebar — overlay drawer */}
            {isOpen && (
                <>
                    <div
                        className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-enter"
                        onClick={onClose}
                    />
                    <div className="fixed inset-y-0 left-0 z-50 md:hidden sidebar-enter">
                        {sidebarContent}
                    </div>
                </>
            )}
        </>
    );
};
