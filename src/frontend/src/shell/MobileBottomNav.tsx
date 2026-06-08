import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Wrench, Package, ClipboardList, MoreHorizontal } from 'lucide-react';

/**
 * MobileBottomNav — Native-app style bottom tab bar for mobile viewports.
 * Visible only on screens < 768px (hidden via CSS `.mobile-bottom-nav`).
 * Provides one-thumb access to the 4 most-used EAM modules + "More" overflow.
 *
 * Pattern: MaintainX / Upkeep / Limble mobile navigation paradigm.
 */

interface NavItem {
    id: string;
    label: string;
    icon: React.ElementType;
    path: string;
}

const NAV_ITEMS: NavItem[] = [
    { id: 'home', label: 'Home', icon: LayoutDashboard, path: '/dashboard' },
    { id: 'work', label: 'Work', icon: Wrench, path: '/work-orders' },
    { id: 'assets', label: 'Assets', icon: Package, path: '/assets' },
    { id: 'requests', label: 'Requests', icon: ClipboardList, path: '/work-requests' },
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
                const Icon = item.icon;
                const active = isActive(item.path);
                return (
                    <button
                        key={item.id}
                        onClick={() => navigate(item.path)}
                        className={`mobile-bottom-nav-item ${active ? 'active' : ''}`}
                        aria-current={active ? 'page' : undefined}
                    >
                        <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
                        <span>{item.label}</span>
                    </button>
                );
            })}
            {/* "More" overflow — opens sidebar on tap */}
            <button
                onClick={() => {
                    // Dispatch a custom event that AppLayout's sidebar listens for
                    window.dispatchEvent(new CustomEvent('toggle-sidebar'));
                }}
                className="mobile-bottom-nav-item"
            >
                <MoreHorizontal size={20} strokeWidth={1.8} />
                <span>More</span>
            </button>
        </nav>
    );
};
