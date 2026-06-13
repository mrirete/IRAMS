/**
 * AskRelanternButton — Reusable floating AI button for module pages
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

    if (compact) {
        return (
            <button
                onClick={handleClick}
                title={tooltip}
                className={`p-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg hover:from-blue-600 hover:to-blue-700 shadow-sm hover:shadow-md transition-all ${className}`}
            >
                <Sparkles size={16} />
            </button>
        );
    }

    return (
        <button
            onClick={handleClick}
            title={tooltip}
            className={`flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg text-sm font-medium hover:from-blue-600 hover:to-blue-700 shadow-sm hover:shadow-md transition-all ${className}`}
        >
            <Sparkles size={14} />
            <span>Ask Specialist</span>
        </button>
    );
};
