/**
 * AskRelanternButton — Reusable AI button for module pages
 * 
 * Drop this into any page's header area. It builds context from the module's
 * current state and opens the Reliability Specialist panel.
 * 
 * Usage:
 *   <AskRelanternButton contextType="asset" contextSummary="Asset P-101 (Centrifugal Pump)..." />
 */

import React from 'react';
import { Sparkles } from 'lucide-react';
import { useRelantern } from '../contexts/RelanternContext';

interface AskRelanternButtonProps {
    /** Module context type — matches QUICK_ACTIONS keys in RelanternAI */
    contextType: string;
    /** Context summary string to send to the AI */
    contextSummary: string;
    /** Optional tooltip */
    tooltip?: string;
    /** Compact mode — smaller button */
    compact?: boolean;
    /** Custom class overrides */
    className?: string;
}

export const AskRelanternButton: React.FC<AskRelanternButtonProps> = ({
    contextType,
    contextSummary,
    tooltip = 'Ask Reliability Specialist',
    compact = false,
    className = '',
}) => {
    const { openRelantern } = useRelantern();

    const handleClick = () => {
        openRelantern(contextSummary, contextType);
    };

    // Same flat gold chip as the top-bar Specialist button: one AI identity
    // everywhere, no gradients. Icon-only on phones so it never wraps a header.
    const chip = 'inline-flex items-center justify-center gap-1.5 min-h-[36px] min-w-[36px] rounded-lg border border-relantern-200 bg-relantern-50 text-relantern-700 hover:bg-relantern-100 hover:text-relantern-800 transition-colors flex-shrink-0';

    if (compact) {
        return (
            <button
                onClick={handleClick}
                title={tooltip}
                aria-label={tooltip}
                className={`${chip} p-2 ${className}`}
            >
                <Sparkles size={15} />
            </button>
        );
    }

    return (
        <button
            onClick={handleClick}
            title={tooltip}
            aria-label={tooltip}
            className={`${chip} px-2 sm:px-3 py-1.5 text-sm font-semibold whitespace-nowrap ${className}`}
        >
            <Sparkles size={15} />
            <span className="hidden sm:inline">Ask Specialist</span>
        </button>
    );
};
