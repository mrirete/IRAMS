import React, { useRef, useEffect, useState, useCallback } from 'react';

export interface ScrollTabStripProps {
    /**
     * The currently-active tab id. When it changes, the active button is
     * scrolled into view. The active button must carry `data-active="true"`.
     */
    activeId: string;
    /** Classes applied to the inner scrolling flex row (gap, bg, padding, etc.). */
    className?: string;
    /** The tab buttons. The active one should have `data-active="true"`. */
    children: React.ReactNode;
    /** Inline style forwarded to the scrolling row (e.g. scroll-snap). */
    style?: React.CSSProperties;
}

/**
 * Mobile-friendly horizontal tab strip wrapper.
 *
 * Wraps an existing row of tab buttons (the page keeps its own button markup
 * and styling) and adds the three things a narrow-screen tab row needs:
 *   1. horizontal scroll with the scrollbar hidden,
 *   2. fading edge affordances (left/right) that appear only when there is
 *      more to scroll, so users know to swipe — fixes "I didn't realise there
 *      were more tabs",
 *   3. the active tab auto-scrolling into view on change.
 *
 * Reuses the `.tab-scroll-container` / `.has-overflow` CSS already defined in
 * index.css (right fade) and adds a matching left fade via `.has-overflow-start`.
 */
export const ScrollTabStrip: React.FC<ScrollTabStripProps> = ({
    activeId,
    className = '',
    children,
    style,
}) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [overflowEnd, setOverflowEnd] = useState(false);
    const [overflowStart, setOverflowStart] = useState(false);

    const checkOverflow = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        const canScroll = el.scrollWidth > el.clientWidth + 1;
        const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
        const atStart = el.scrollLeft <= 2;
        setOverflowEnd(canScroll && !atEnd);
        setOverflowStart(canScroll && !atStart);
    }, []);

    useEffect(() => {
        checkOverflow();
        const el = scrollRef.current;
        if (!el) return;
        el.addEventListener('scroll', checkOverflow, { passive: true });
        window.addEventListener('resize', checkOverflow);
        return () => {
            el.removeEventListener('scroll', checkOverflow);
            window.removeEventListener('resize', checkOverflow);
        };
    }, [checkOverflow]);

    // Re-check + recentre whenever the active tab changes.
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const active = el.querySelector('[data-active="true"]') as HTMLElement | null;
        // Centre the active tab by scrolling ONLY this strip. scrollIntoView()
        // would bubble up and scroll every scrollable ancestor — on mobile that
        // drags the whole page sideways (content clipped on the left edge).
        if (active && el.scrollWidth > el.clientWidth + 1) {
            const cRect = el.getBoundingClientRect();
            const aRect = active.getBoundingClientRect();
            const delta = (aRect.left - cRect.left) - (el.clientWidth - aRect.width) / 2;
            el.scrollBy({ left: delta, behavior: 'smooth' });
        }
        // Overflow state may change after content/layout settles.
        const id = window.setTimeout(checkOverflow, 0);
        return () => window.clearTimeout(id);
    }, [activeId, checkOverflow]);

    return (
        <div className={`tab-scroll-container ${overflowEnd ? 'has-overflow' : ''} ${overflowStart ? 'has-overflow-start' : ''}`}>
            <div ref={scrollRef} className={`overflow-x-auto scrollbar-hide ${className}`} style={style}>
                {children}
            </div>
        </div>
    );
};
