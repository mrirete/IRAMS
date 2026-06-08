import React from 'react';
import { Plus } from 'lucide-react';

/**
 * FloatingActionButton (FAB) — Primary creation action for mobile viewports.
 * Anchored to bottom-right, above the MobileBottomNav.
 * CSS-hidden on md+ screens via the `.fab` class.
 *
 * Usage:
 *   <FloatingActionButton onClick={() => setCreateModalOpen(true)} label="New Work Order" />
 */

interface FloatingActionButtonProps {
    onClick: () => void;
    label?: string;
    icon?: React.ReactNode;
}

export const FloatingActionButton: React.FC<FloatingActionButtonProps> = ({
    onClick,
    label = 'Create',
    icon,
}) => {
    return (
        <button
            className="fab"
            onClick={onClick}
            aria-label={label}
            title={label}
        >
            {icon || <Plus size={26} strokeWidth={2.5} />}
        </button>
    );
};
