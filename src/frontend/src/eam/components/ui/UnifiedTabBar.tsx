import React, { useRef, useEffect, useState, useCallback } from 'react';

export interface TabDefinition {
    id: string;
    label: string;
    icon?: React.ComponentType<{ size?: number }>;
    /** If false, tab is hidden */
    show?: boolean;
    /** Badge count (e.g., number of items) */
    badge?: number;
}

export interface UnifiedTabBarProps {
    tabs: TabDefinition[];
    activeTab: string;
    onTabChange: (tabId: string) => void;
    /** Background style of the tab bar container */
    bgClassName?: string;
}

export const UnifiedTabBar: React.FC<UnifiedTabBarProps> = ({
    tabs,
    activeTab,
    onTabChange,
    bgClassName = 'bg-white',
}) => {
    const visibleTabs = tabs.filter(t => t.show !== false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [hasOverflow, setHasOverflow] = useState(false);

    // Detect horizontal overflow for fade indicator
    const checkOverflow = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        const canScroll = el.scrollWidth > el.clientWidth;
        const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
        setHasOverflow(canScroll && !atEnd);
    }, []);

    useEffect(() => {
        checkOverflow();
        const el = scrollRef.current;
        if (el) {
            el.addEventListener('scroll', checkOverflow, { passive: true });
            window.addEventListener('resize', checkOverflow);
        }
        return () => {
            if (el) el.removeEventListener('scroll', checkOverflow);
            window.removeEventListener('resize', checkOverflow);
        };
    }, [checkOverflow, visibleTabs.length]);

    // Centre the active tab by scrolling ONLY this strip. scrollIntoView() would
    // scroll every scrollable ancestor and drag the whole page sideways on mobile.
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const activeBtn = el.querySelector('.unified-tab-active') as HTMLElement | null;
        if (activeBtn && el.scrollWidth > el.clientWidth + 1) {
            const cRect = el.getBoundingClientRect();
            const aRect = activeBtn.getBoundingClientRect();
            const delta = (aRect.left - cRect.left) - (el.clientWidth - aRect.width) / 2;
            el.scrollBy({ left: delta, behavior: 'smooth' });
        }
    }, [activeTab]);

    return (
        <div className={`px-2 md:px-5 border-b border-slate-200 flex-shrink-0 ${bgClassName} tab-scroll-container ${hasOverflow ? 'has-overflow' : ''}`}>
            <div
                ref={scrollRef}
                className="flex gap-0.5 md:gap-1 overflow-x-auto scrollbar-hide"
            >
                {visibleTabs.map(tab => {
                    const isActive = activeTab === tab.id;
                    const Icon = tab.icon;

                    return (
                        <button
                            key={tab.id}
                            onClick={() => onTabChange(tab.id)}
                            className={`
                                flex items-center gap-1 md:gap-2 py-2.5 md:py-3 px-2 md:px-3 text-xs md:text-sm font-medium
                                border-b-2 whitespace-nowrap transition-colors
                                ${isActive
                                    ? 'border-blue-600 text-blue-600 unified-tab-active'
                                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                                }
                            `}
                        >
                            {Icon && <Icon size={15} />}
                            {tab.label}
                            {tab.badge !== undefined && tab.badge > 0 && (
                                <span className={`
                                    text-[10px] px-1.5 py-0.5 rounded-full font-bold leading-none
                                    ${isActive
                                        ? 'bg-blue-100 text-blue-700'
                                        : 'bg-slate-100 text-slate-500'
                                    }
                                `}>
                                    {tab.badge}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
