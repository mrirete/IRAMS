import React, { useState, useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronRight, Lock, Database, X, Flame } from 'lucide-react';
import { MODULE_REGISTRY, type ModuleDefinition, type SidebarChild, type ModuleId } from '../config/moduleRegistry';
import { MODULE_ID_TO_PERM_KEY } from '../config/modulePermissions';
import { useLicense } from '../contexts/LicenseContext';
import { useAuth } from '../eam/contexts/AuthContext';
import { useEdition } from '../lib/useEdition';
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
    // ── Reliability Specialist (hero product — reliability permission) ──
    '/specialist': 'reliability',
    '/specialist/import': 'reliability',
    '/specialist/assessment': 'reliability',
    '/specialist/deliver': 'reliability',
    '/specialist/manuals': 'reliability',
    // ── Reliability Suite (dedicated permission key) ──
    '/reliability-metrics': 'reliability',
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
    '/admin/settings': 'admin',
    '/admin/hierarchy': 'admin',
    '/admin/manufacturers': 'admin',
    '/admin/work-centers': 'admin',
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
    const { edition } = useEdition();

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
     * For premium suites, check the permission key directly at the module
     * level — if view is explicitly false, the entire sidebar section is
     * hidden even if individual children might pass.
     *
     * The map lives in config/modulePermissions and is shared with the router's
     * Gated helper, so what the nav hides and what the route refuses can never
     * drift apart.
     */
    const isModulePermitted = (moduleId: string): boolean => {
        const permKey = MODULE_ID_TO_PERM_KEY[moduleId as ModuleId];
        if (!permKey) return true; // Core modules don't have a module-level gate
        if (authLoading || !permissions) return false;
        return permissions[permKey]?.view === true;
    };

    // ── Module filtering: Edition gate → License gate → Module RBAC gate → Child RBAC gate ──
    const visibleModules = useMemo(() => {
        return MODULE_REGISTRY.filter(m => {
            // 0. Edition gate (strategy §5.2): Specialist edition hides the EAM
            //    section (except Core: Home/Assets/Admin stay — they are the
            //    platform basics the Specialist's data lives in).
            if (edition === 'specialist' && m.section === 'eam' && m.id !== 'core') return false;

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
    }, [permissions, authLoading, isModuleEnabled, isAdminTier, edition]);

    // ── Blue active highlight for active, crisp slate for inactive ──
    const activeBgStyle: React.CSSProperties = {
        background: 'var(--color-primary-50)',
        color: 'var(--color-primary-600)',
        borderLeft: '3px solid var(--color-primary-600)',
    };

    const linkClass = (isActive: boolean) =>
        `w-full flex items-center px-3 py-2.5 rounded-xl text-[13.5px] transition-all duration-150 group tracking-[-0.01em] ${isActive
            ? 'text-primary-600 font-semibold'
            : 'text-slate-600 hover:bg-primary-50 hover:text-slate-800 font-medium'
        }`;

    const subLinkClass = (isActive: boolean) =>
        `block w-full text-left px-3 py-1.5 rounded-lg text-[13px] transition-all duration-150 tracking-[-0.01em] ${isActive
            ? 'text-primary-600 font-semibold bg-primary-50'
            : 'text-slate-600 hover:text-slate-800 hover:bg-primary-50 font-medium'
        }`;

    const renderModule = (mod: ModuleDefinition) => {
        const Icon = mod.icon;

        // Core module renders Home + Asset Register explicitly
        if (mod.id === 'core') {
            return (
                <React.Fragment key="core-nav">
                    {hasPermission('/') && (
                        <NavLink key="home" to="/" end onClick={onClose} className={({ isActive }) => linkClass(isActive)} style={({ isActive }) => isActive ? activeBgStyle : undefined}>
                            {({ isActive }) => (
                                <>
                                    <Icon size={18} className={`mr-3 flex-shrink-0 transition-colors ${isActive ? 'text-primary-600' : 'text-slate-500 group-hover:text-slate-700'}`} />
                                    <span className="flex-1 text-left">Dashboard</span>
                                </>
                            )}
                        </NavLink>
                    )}
                    {hasPermission('/assets') && (
                        <NavLink key="assets" to="/assets" onClick={onClose} className={({ isActive }) => linkClass(isActive)} style={({ isActive }) => isActive ? activeBgStyle : undefined}>
                            {({ isActive }) => (
                                <>
                                    <Database size={18} className={`mr-3 flex-shrink-0 transition-colors ${isActive ? 'text-primary-600' : 'text-slate-500 group-hover:text-slate-700'}`} />
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
                        style={isSectionActive ? activeBgStyle : undefined}
                    >
                        <Icon size={18} className={`mr-3 flex-shrink-0 transition-colors ${isSectionActive ? 'text-primary-600' : 'text-slate-500 group-hover:text-slate-700'}`} />
                        <span className="flex-1 text-left">{mod.label}</span>
                        {isExpanded
                            ? <ChevronDown size={14} className={isSectionActive ? 'text-primary-400' : 'text-slate-400'} />
                            : <ChevronRight size={14} className={isSectionActive ? 'text-primary-400' : 'text-slate-400'} />
                        }
                    </button>

                    {isExpanded && (
                        <div className="mt-1 mb-2 ml-6 pl-3 border-l border-slate-200 space-y-0.5">
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
                                    style={({ isActive }) => isActive ? activeBgStyle : undefined}
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
                <NavLink key={mod.id} to={mod.path} onClick={onClose} className={({ isActive }) => linkClass(isActive)} style={({ isActive }) => isActive ? activeBgStyle : undefined}>
                    {({ isActive }) => (
                        <>
                            <Icon size={18} className={`mr-3 flex-shrink-0 transition-colors ${isActive ? 'text-primary-600' : 'text-slate-500 group-hover:text-slate-700'}`} />
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
        <div className="w-64 h-full bg-white border-r border-slate-200/80 flex flex-col overflow-y-auto">
            {/* ── IRAMS Logo ── */}
            <div className="px-5 py-5 flex items-center justify-between border-b border-slate-200/80">
                <div
                    className="flex items-center gap-3 group cursor-default"
                    title="IRAMS — Integrated Reliability & Asset Management Specialist by Relantern"
                >
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-relantern-400 to-relantern-600 flex items-center justify-center shadow-lg shadow-relantern-500/25 group-hover:shadow-relantern-500/40 transition-shadow">
                        <Flame size={20} className="text-white" />
                    </div>
                    <div className="flex flex-col min-w-0">
                        <span className="font-bold text-[16px] tracking-wide text-slate-800 whitespace-nowrap">IRAMS</span>
                        <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-[0.08em] group-hover:text-relantern-600 transition-colors whitespace-nowrap">by Relantern</span>
                    </div>
                </div>
                {/* Close button (mobile only) */}
                <button onClick={onClose} className="md:hidden p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors">
                    <X size={18} />
                </button>
            </div>

            <nav className="flex-1 px-3 pt-3 space-y-0.5 pb-6">
                {/* ── Section 1: EAM — Enterprise Asset Management ── */}
                {(() => {
                    const eamModules = visibleModules.filter(m => m.section === 'eam');
                    if (eamModules.length === 0) return null;
                    return (
                        <>
                            <div className="px-3 pt-1 pb-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">EAM</span>
                                    <div className="flex-1 h-px bg-gradient-to-r from-slate-200 to-transparent" />
                                </div>
                            </div>
                            {eamModules.map(renderModule)}
                        </>
                    );
                })()}

                {/* ── Section 2: Reliability Suite — ERS ── */}
                {(() => {
                    const ersModules = visibleModules.filter(m => m.section === 'ers');
                    if (ersModules.length === 0) return null;
                    return (
                        <>
                            <div className="px-3 pt-4 pb-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-blue-500">Reliability Suite</span>
                                    <span className="text-[8px] font-black uppercase tracking-[0.1em] text-blue-400 bg-blue-50 px-1.5 py-0.5 rounded-full">ERS</span>
                                    <div className="flex-1 h-px bg-gradient-to-r from-blue-200 to-transparent" />
                                </div>
                            </div>
                            {ersModules.map(renderModule)}
                        </>
                    );
                })()}

                {/* ── Section 3: Platform — Reports ── */}
                {(() => {
                    const platformModules = visibleModules.filter(m => m.section === 'platform');
                    if (platformModules.length === 0) return null;
                    return (
                        <>
                            <div className="px-3 pt-4 pb-2">
                                <div className="flex items-center gap-2">
                                    <div className="flex-1 h-px bg-gradient-to-r from-slate-200 to-transparent" />
                                </div>
                            </div>
                            {platformModules.map(renderModule)}
                        </>
                    );
                })()}

                {/* Admin Accordion — RBAC-gated: only visible to users with admin.view */}
                {hasAdminAccess && (
                    <div className="pt-4 mt-4 border-t border-slate-200/80">
                        <button
                            onClick={() => toggleSection('admin')}
                            className={linkClass(isAdminActive)}
                            style={isAdminActive ? activeBgStyle : undefined}
                        >
                            <Lock size={18} className={`mr-3 flex-shrink-0 transition-colors ${isAdminActive ? 'text-primary-600' : 'text-slate-500 group-hover:text-slate-700'}`} />
                            <span className="flex-1 text-left">Admin</span>
                            {adminExpanded
                                ? <ChevronDown size={14} className={isAdminActive ? 'text-primary-400' : 'text-slate-400'} />
                                : <ChevronRight size={14} className={isAdminActive ? 'text-primary-400' : 'text-slate-400'} />
                            }
                        </button>

                        {adminExpanded && (
                            <div className="mt-1 mb-2 ml-6 pl-3 border-l border-slate-200 space-y-0.5">
                                {/* First: the onboarding motion a new tenant starts with. */}
                                <NavLink to="/admin/migration" onClick={onClose} className={({ isActive }) => subLinkClass(isActive)} style={({ isActive }) => isActive ? activeBgStyle : undefined}>
                                    Migration Center
                                </NavLink>
                                <NavLink to="/eam-admin" onClick={onClose} className={({ isActive }) => subLinkClass(isActive)} style={({ isActive }) => isActive ? activeBgStyle : undefined}>
                                    Dictionaries & Permissions
                                </NavLink>
                                <NavLink to="/admin/invitations" onClick={onClose} className={({ isActive }) => subLinkClass(isActive)} style={({ isActive }) => isActive ? activeBgStyle : undefined}>
                                    Invitations
                                </NavLink>
                                <NavLink to="/admin/connectors" end onClick={onClose} className={({ isActive }) => subLinkClass(isActive)} style={({ isActive }) => isActive ? activeBgStyle : undefined}>
                                    Connector Hub
                                </NavLink>
                                <NavLink to="/admin/connectors/new" onClick={onClose} className={({ isActive }) => subLinkClass(isActive)} style={({ isActive }) => isActive ? activeBgStyle : undefined}>
                                    New Connector
                                </NavLink>
                                <NavLink to="/admin/settings" onClick={onClose} className={({ isActive }) => subLinkClass(isActive)} style={({ isActive }) => isActive ? activeBgStyle : undefined}>
                                    Global Settings
                                </NavLink>
                                <NavLink to="/admin/companies" onClick={onClose} className={({ isActive }) => subLinkClass(isActive)} style={({ isActive }) => isActive ? activeBgStyle : undefined}>
                                    Companies
                                </NavLink>
                                <NavLink to="/admin/hierarchy" onClick={onClose} className={({ isActive }) => subLinkClass(isActive)} style={({ isActive }) => isActive ? activeBgStyle : undefined}>
                                    Hierarchy Config
                                </NavLink>
                                <NavLink to="/admin/manufacturers" onClick={onClose} className={({ isActive }) => subLinkClass(isActive)} style={({ isActive }) => isActive ? activeBgStyle : undefined}>
                                    Manufacturers
                                </NavLink>
                                <NavLink to="/admin/work-centers" onClick={onClose} className={({ isActive }) => subLinkClass(isActive)} style={({ isActive }) => isActive ? activeBgStyle : undefined}>
                                    Work Centers
                                </NavLink>
                                <NavLink to="/admin/error-logs" onClick={onClose} className={({ isActive }) => subLinkClass(isActive)} style={({ isActive }) => isActive ? activeBgStyle : undefined}>
                                    Error Logs
                                </NavLink>
                                {/* Activity Log — SUPER_ADMIN only (activityLog.view gate) */}
                                {permissions?.activityLog?.view && (
                                    <NavLink to="/admin/activity-log" onClick={onClose} className={({ isActive }) => subLinkClass(isActive)} style={({ isActive }) => isActive ? activeBgStyle : undefined}>
                                        <span className="flex items-center gap-1.5">
                                            Activity Log
                                        <span className="text-[8px] font-black text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded-full uppercase tracking-wider">Super</span>
                                        </span>
                                    </NavLink>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </nav>

            {/* ── Version Footer ── build SHA lets you confirm at a glance which commit is deployed ── */}
            <div
                className="px-5 py-3 border-t border-slate-200/80 text-[10px] text-slate-400 font-medium"
                title={`Built ${__BUILD_TIME__}`}
            >
                IRAMS by Relantern · v2.0 · <span className="font-mono text-slate-500">{__BUILD_SHA__}</span>
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
                        className="fixed inset-0 bg-black/20 z-40 md:hidden backdrop-enter backdrop-blur-sm"
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
