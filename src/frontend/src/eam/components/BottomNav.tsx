import React, { useState, useEffect, useRef, useCallback } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Inbox,
  ClipboardList,
  Package,
  Menu,
} from 'lucide-react';

interface BottomNavProps {
  onOpenSidebar: () => void;
  unreadCount?: number;
}

const NAV_ITEMS = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard, exact: true },
  { label: 'Requests', to: '/requests', icon: Inbox },
  { label: 'Work', to: '/work-orders', icon: ClipboardList },
  { label: 'Assets', to: '/assets', icon: Package },
];

export const BottomNav: React.FC<BottomNavProps> = ({ onOpenSidebar, unreadCount = 0 }) => {
  const location = useLocation();

  // G9: Auto-hide on scroll-down, show on scroll-up
  const [visible, setVisible] = useState(true);
  const lastScrollY = useRef(0);
  const ticking = useRef(false);

  const handleScroll = useCallback(() => {
    if (ticking.current) return;
    ticking.current = true;

    requestAnimationFrame(() => {
      const currentY = window.scrollY;
      const delta = currentY - lastScrollY.current;

      // Only hide if scrolled down more than 10px (debounce jitter)
      if (delta > 10 && currentY > 60) {
        setVisible(false);
      } else if (delta < -10 || currentY <= 10) {
        setVisible(true);
      }

      lastScrollY.current = currentY;
      ticking.current = false;
    });
  }, []);

  useEffect(() => {
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // Also listen to scroll events on the main content area
  useEffect(() => {
    const mainEl = document.querySelector('main');
    if (!mainEl) return;

    const handleMainScroll = () => {
      const currentY = mainEl.scrollTop;
      const delta = currentY - lastScrollY.current;

      if (delta > 10 && currentY > 60) {
        setVisible(false);
      } else if (delta < -10 || currentY <= 10) {
        setVisible(true);
      }

      lastScrollY.current = currentY;
    };

    mainEl.addEventListener('scroll', handleMainScroll, { passive: true });
    return () => mainEl.removeEventListener('scroll', handleMainScroll);
  }, []);

  // Always show when route changes
  useEffect(() => {
    setVisible(true);
    lastScrollY.current = 0;
  }, [location.pathname]);

  return (
    <nav
      className={`
        fixed bottom-0 left-0 right-0 z-30 md:hidden
        bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-[0_-2px_10px_rgba(0,0,0,0.06)]
        transition-transform duration-300 ease-in-out
        ${visible ? 'translate-y-0' : 'translate-y-full'}
      `}
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex items-stretch h-14">
        {NAV_ITEMS.map((item) => {
          const isActive = item.exact
            ? location.pathname === item.to
            : location.pathname.startsWith(item.to);

          return (
            <NavLink
              key={item.to}
              to={item.to}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors touch-target"
            >
              <item.icon
                size={20}
                className={isActive ? 'text-relantern-500' : 'text-slate-400'}
              />
              <span
                className={`text-[10px] font-medium leading-none ${
                  isActive ? 'text-relantern-600 font-bold' : 'text-slate-500'
                }`}
              >
                {item.label}
              </span>
            </NavLink>
          );
        })}

        {/* More button */}
        <button
          onClick={onOpenSidebar}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 relative touch-target"
        >
          <Menu size={20} className="text-slate-400" />
          <span className="text-[10px] font-medium text-slate-500 leading-none">More</span>
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1/4 min-w-[16px] h-4 flex items-center justify-center text-[9px] font-bold text-white bg-red-500 rounded-full px-1">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </div>
    </nav>
  );
};
