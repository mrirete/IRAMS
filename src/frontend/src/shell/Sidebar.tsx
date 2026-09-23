import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronRight, Lock, Database, X, Flame } from 'lucide-react';
import { MODULE_REGISTRY, type ModuleDefinition } from '../config/moduleRegistry';
import { ADMIN_NAV, adminItemActive, isAdminPath } from '../config/adminNav';
import { useNavVisibility } from './useNavVisibility';

interface SidebarProps {
    isOpen: boolean;
    onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
    const location = useLocation();
    // License, edition and RBAC gates — shared with the command palette.
    const { visibleModules, hasPermission, hasAdminAccess, canSeeAdminItem } = useNavVisibility();

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
    const isAdminActive = isAdminPath(location.pathname);
    const adminExpanded = expandedSections['admin'] || false;

    const sidebarContent = (
        <div className="w-64 h-full bg-white border-r border-slate-200/80 flex flex-col overflow-y-auto">
            {/* ── IREAMS Logo ── */}
            <div className="px-5 py-5 flex items-center justify-between border-b border-slate-200/80">
                <div
                    className="flex items-center gap-3 group cursor-default"
                    title="IREAMS — Integrated Reliability and Enterprise Management System by Relantern"
                >
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-relantern-400 to-relantern-600 flex items-center justify-center shadow-lg shadow-relantern-500/25 group-hover:shadow-relantern-500/40 transition-shadow">
                        <Flame size={20} className="text-white" />
                    </div>
                    <div className="flex flex-col min-w-0">
                        <span className="font-bold text-[16px] tracking-wide text-slate-800 whitespace-nowrap">IREAMS</span>
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

                {/* ── Section: Assess & Improve — the maturity loop every tenant runs (tier core) ── */}
                {(() => {
                    const assessModules = visibleModules.filter(m => m.section === 'assess');
                    if (assessModules.length === 0) return null;
                    return (
                        <>
                            <div className="px-3 pt-4 pb-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-violet-500">Assess & Improve</span>
                                    <div className="flex-1 h-px bg-gradient-to-r from-violet-200 to-transparent" />
                                </div>
                            </div>
                            {assessModules.map(renderModule)}
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
                            <div className="mt-1 mb-2 ml-6 pl-3 border-l border-slate-200">
                                {/* Two groups from config/adminNav — the same names the palette
                                    and the breadcrumb use. Data first: the onboarding motion a
                                    new tenant starts with. */}
                                {ADMIN_NAV.map(group => {
                                    const sections = group.sections
                                        .map(sec => ({ ...sec, items: sec.items.filter(canSeeAdminItem) }))
                                        .filter(sec => sec.items.length > 0);
                                    if (sections.length === 0) return null;
                                    return (
                                        <div key={group.label} className="pt-1.5 first:pt-0">
                                            {/* Headings are never smaller than what they head: same size,
                                                told apart by weight and colour. */}
                                            <div className="px-3 pt-1.5 pb-1 text-[13px] font-semibold text-slate-800">{group.label}</div>
                                            <div className="space-y-0.5">
                                                {sections.map((sec, si) => {
                                                    // A captioned section (Integrations) is a real row that opens and
                                                    // closes its pages — open by default; lit when one of them is the
                                                    // current page, so collapsing it never hides where you are.
                                                    const holdsActive = sec.items.some(i => adminItemActive(i, location.pathname));
                                                    const secKey = `admin-${sec.caption ?? si}`;
                                                    const open = !sec.caption || expandedSections[secKey] !== false;
                                                    return (
                                                    <div key={sec.caption ?? si}>
                                                        {sec.caption && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setExpandedSections(prev => ({ ...prev, [secKey]: !open }))}
                                                                aria-expanded={open}
                                                                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-[13px] tracking-[-0.01em] transition-colors hover:bg-primary-50 ${holdsActive ? 'text-primary-600 font-semibold' : 'text-slate-600 font-medium hover:text-slate-800'}`}
                                                            >
                                                                <span>{sec.caption}</span>
                                                                {open ? <ChevronDown size={13} className="text-slate-400" /> : <ChevronRight size={13} className="text-slate-400" />}
                                                            </button>
                                                        )}
                                                        {open && (
                                                        <div className={sec.caption ? 'ml-3 pl-2 border-l border-slate-200 space-y-0.5' : 'space-y-0.5'}>
                                                            {sec.items.map(item => {
                                                                const active = adminItemActive(item, location.pathname);
                                                                return (
                                                                    <NavLink key={item.to} to={item.to} onClick={onClose}
                                                                        className={subLinkClass(active)} style={active ? activeBgStyle : undefined}
                                                                        aria-current={active ? 'page' : undefined}>
                                                                        {item.badge ? (
                                                                            <span className="flex items-center gap-1.5">
                                                                                {item.label}
                                                                                <span className="text-[8px] font-black text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded-full uppercase tracking-wider">{item.badge}</span>
                                                                            </span>
                                                                        ) : item.label}
                                                                    </NavLink>
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
                        )}
                    </div>
                )}
            </nav>

            {/* ── Version Footer ── build SHA lets you confirm at a glance which commit is deployed ── */}
            <div
                className="px-5 py-3 border-t border-slate-200/80 text-[10px] text-slate-400 font-medium"
                title={`Built ${__BUILD_TIME__}`}
            >
                IREAMS by Relantern · v2.0 · <span className="font-mono text-slate-500">{__BUILD_SHA__}</span>
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
                        className="fixed inset-0 bg-black/20 z-[45] md:hidden backdrop-enter backdrop-blur-sm"
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
