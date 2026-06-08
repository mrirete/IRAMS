
import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Package,
  ClipboardList,
  Calendar,
  Boxes,
  Bell,
  Activity,
  BarChart2,
  FileBarChart,
  Settings,
  Menu,
  X,
  Inbox,
  Repeat,
  CalendarRange,
  ShoppingCart,
  Truck,
  DollarSign,
  Shield
} from 'lucide-react';

import { useAuth } from '../contexts/AuthContext';
import { ModuleName } from '../types';

interface SidebarProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, setIsOpen }) => {
  const { permissions } = useAuth();

  const links: { name: string; to: string; icon: any; permission?: ModuleName }[] = [
    { name: 'Dashboard', to: '/', icon: LayoutDashboard, permission: 'dashboard' },
    { name: 'Requests', to: '/requests', icon: Inbox, permission: 'requests' },
    { name: 'Work Management', to: '/work-orders', icon: ClipboardList, permission: 'workOrders' },
    { name: 'Recurring Work', to: '/recurring-work', icon: Repeat, permission: 'pm' },
    { name: 'Scheduling', to: '/scheduling', icon: CalendarRange, permission: 'scheduling' },
    { name: 'Purchasing', to: '/purchase-orders', icon: ShoppingCart, permission: 'purchasing' },
    { name: 'Assets', to: '/assets', icon: Package, permission: 'assets' },
    { name: 'Inventory', to: '/inventory', icon: Boxes, permission: 'inventory' },
    { name: 'Condition Data', to: '/readings', icon: Activity, permission: 'readings' },
    { name: 'Analytics', to: '/analytics', icon: BarChart2, permission: 'analytics' },
    { name: 'Reports', to: '/reports', icon: FileBarChart, permission: 'analytics' },
    { name: 'People', to: '/contacts', icon: Users, permission: 'contacts' }, // Renamed from Users and Contacts
    { name: 'Vendors', to: '/vendors', icon: Truck, permission: 'vendors' },
    { name: 'FinOps', to: '/finops', icon: DollarSign, permission: 'finops' },
    { name: 'Change Control', to: '/management-of-change', icon: Shield, permission: 'moc' },
    { name: 'Notifications', to: '/notifications', icon: Bell, permission: 'notifications' },
    { name: 'Admin', to: '/eam-admin', icon: Settings, permission: 'admin' },
  ];

  const visibleLinks = links.filter(link => {
    if (!link.permission) return true; // Public
    // If permissions not loaded yet (shouldn't happen if loading blocked), defaults to hidden for safety
    return permissions?.[link.permission]?.view === true;
  });

  const sidebarClasses = `
    fixed inset-y-0 left-0 z-40 w-64 bg-slate-900 text-slate-300 transform transition-transform duration-300 ease-in-out
    ${isOpen ? 'translate-x-0' : '-translate-x-full'}
    md:translate-x-0 md:static md:inset-auto
  `;

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className={sidebarClasses}>
        <div className="flex items-center h-16 px-6 bg-slate-950 border-b border-slate-800">
          <div className="w-8 h-8 bg-relantern-500 rounded-lg flex items-center justify-center mr-3" aria-hidden="true">
            <span className="text-white font-bold">R</span>
          </div>
          <span className="text-white font-bold tracking-wider text-lg">RELANTERN</span>
          <button
            onClick={() => setIsOpen(false)}
            className="ml-auto md:hidden text-slate-400 hover:text-white"
            aria-label="Close sidebar"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="p-4 space-y-1 overflow-y-auto h-[calc(100vh-4rem)]">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-2 mt-4">Modules</div>
          {visibleLinks.map((link) => (
            <NavLink
              key={link.name}
              to={link.to}
              onClick={() => window.innerWidth < 768 && setIsOpen(false)}
              className={({ isActive }) => `
                        flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                        ${isActive
                  ? 'bg-relantern-500 text-white shadow-lg shadow-blue-900/20'
                  : 'hover:bg-slate-800 hover:text-white'
                }
                    `}
            >
              <link.icon size={18} />
              {link.name}
            </NavLink>
          ))}

          <div className="mt-8 px-3">
            <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
              <h4 className="text-white text-xs font-bold mb-1">System Status</h4>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full bg-green-500"></span>
                <span className="text-xs text-slate-400">Online</span>
              </div>
              <p className="text-[10px] text-slate-500">v4.2.0 (Stable)</p>
            </div>
          </div>
        </nav>
      </div>
    </>
  );
};
