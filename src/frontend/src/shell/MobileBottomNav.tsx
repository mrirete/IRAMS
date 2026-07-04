import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Wrench, Package, Plus, Boxes } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * MobileBottomNav — native-app style bottom tab bar for mobile viewports.
 * Visible only on screens < 768px (hidden via CSS `.mobile-bottom-nav`).
 *
 * Pattern: MaintainX-style operator/technician-first navigation with a raised
 * center "Report" button that opens the QuickReport bottom sheet (operator's
 * fastest path to log a problem). Color: MaintainX Blue (#246CFF) active state.
 */

interface NavItem {
    id: string;
    label: string;
    icon: LucideIcon;
    path: string;
    badge?: boolean;
}

// Two items either side of the raised center "Report" action.
const LEFT_ITEMS: NavItem[] = [
    { id: 'home', label: 'Home',    icon: LayoutDashboard, path: '/dashboard' },
    { id: 'work', label: 'My Work', icon: Wrench,          path: '/my-work' },
];
const RIGHT_ITEMS: NavItem[] = [
    { id: 'assets',    label: 'Assets',    icon: Package, path: '/assets' },
    { id: 'inventory', label: 'Inventory', icon: Boxes,   path: '/inventory' },
];

export const MobileBottomNav: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();

    const isActive = (path: string) => {
        if (path === '/dashboard') return location.pathname === '/' || location.pathname.startsWith('/dashboard');
        return location.pathname.startsWith(path);
    };

    const renderItem = (item: NavItem) => {
        const active = isActive(item.path);
        const Icon = item.icon;
        return (
            <button
                key={item.id}
                onClick={() => navigate(item.path)}
                className={`mobile-bottom-nav-item ${active ? 'active' : ''}`}
                aria-current={active ? 'page' : undefined}
            >
                <span className="nav-icon relative">
                    <Icon size={22} strokeWidth={active ? 2.4 : 1.6} />
                    {item.badge && <span className="nav-badge-dot" />}
                </span>
                <span className={`text-[10px] leading-none ${active ? 'font-bold' : 'font-medium'}`}>{item.label}</span>
            </button>
        );
    };

    return (
        <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
            {LEFT_ITEMS.map(renderItem)}

            {/* Raised center "Report" action — opens the QuickReport bottom sheet */}
            <button
                onClick={() => window.dispatchEvent(new CustomEvent('open-quick-report'))}
                className="mobile-bottom-nav-item"
                aria-label="Report a problem"
            >
                <span className="flex flex-col items-center -mt-5">
                    <span className="w-12 h-12 rounded-full bg-primary-600 text-white flex items-center justify-center shadow-lg shadow-primary-600/30 border-4 border-white active:scale-95 transition-transform">
                        <Plus size={24} strokeWidth={2.6} />
                    </span>
                    <span className="text-[10px] leading-none font-bold text-primary-600 mt-1">Report</span>
                </span>
            </button>

            {RIGHT_ITEMS.map(renderItem)}
        </nav>
    );
};
