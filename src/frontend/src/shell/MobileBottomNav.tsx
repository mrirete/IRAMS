import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Wrench, Package, ClipboardList, MoreHorizontal } from 'lucide-react';

/**
 * MobileBottomNav — Native-app style bottom tab bar for mobile viewports.
 * Visible only on screens < 768px (hidden via CSS `.mobile-bottom-nav`).
 * Provides one-thumb access to the 4 most-used EAM modules + "More" overflow.
 *
 * Pattern: MaintainX-style — operator/technician-first navigation.
 * Color: MaintainX Blue (#246CFF) active state.
 */

interface NavItem {
    id: string;
    label: string;
    icon: React.ElementType;
    path: string;
    /** Show a notification badge dot */
    badge?: boolean;
}

const NAV_ITEMS: NavItem[] = [
    { id: 'home',     label: 'Home',     icon: LayoutDashboard, path: '/dashboard' },
    { id: 'work',     label: 'My Work',  icon: Wrench,          path: '/work-orders' },
    { id: 'requests', label: 'Requests', icon: ClipboardList,   path: '/requests' },
    { id: 'assets',   label: 'Assets',   icon: Package,         path: '/assets' },
];

export const MobileBottomNav: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();

    const isActive = (path: string) => {
        if (path === '/dashboard') return location.pathname === '/' || location.pathname.startsWith('/dashboard');
        return location.pathname.startsWith(path);
    };

    return (
        <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
            {NAV_ITEMS.map(item => {
                const active = isActive(item.path);
                return (
                    <button
                        key={item.id}
                        onClick={() => navigate(item.path)}
                        className={`mobile-bottom-nav-item ${active ? 'active' : ''}`}
                        aria-current={active ? 'page' : undefined}
                    >
                        <span className="nav-icon relative">
                            {React.createElement(item.icon as any, {
                                size: 22,
                                strokeWidth: active ? 2.4 : 1.6,
                            })}
                            {item.badge && <span className="nav-badge-dot" />}
                        </span>
                        <span className={`text-[10px] leading-none ${active ? 'font-bold' : 'font-medium'}`}>
                            {item.label}
                        </span>
                    </button>
                );
            })}
            {/* "More" overflow — opens sidebar on tap */}
            <button
                onClick={() => {
                    window.dispatchEvent(new CustomEvent('toggle-sidebar'));
                }}
                className="mobile-bottom-nav-item"
            >
                <span className="nav-icon">
                    <MoreHorizontal size={22} strokeWidth={1.6} />
                </span>
                <span className="text-[10px] leading-none font-medium">More</span>
            </button>
        </nav>
    );
};
