import React from 'react';
import { Inbox } from 'lucide-react';

export interface UnifiedEmptyStateProps {
    /** Icon to show — defaults to Inbox */
    icon?: React.ReactNode;
    /** Primary heading */
    title?: string;
    /** Secondary description text */
    description?: string;
    /** Optional action button */
    action?: {
        label: string;
        onClick: () => void;
        icon?: React.ReactNode;
    };
}

export const UnifiedEmptyState: React.FC<UnifiedEmptyStateProps> = ({
    icon,
    title = 'No items found',
    description,
    action,
}) => {
    return (
        <div className="unified-empty-state">
            <div className="unified-empty-state-icon">
                {icon || <Inbox size={22} />}
            </div>
            <div className="unified-empty-state-title">{title}</div>
            {description && (
                <div className="unified-empty-state-desc">{description}</div>
            )}
            {action && (
                <button
                    onClick={action.onClick}
                    className="mt-2 px-4 py-1.5 text-xs font-bold bg-primary-600 text-white rounded-lg hover:bg-primary-500 transition-colors flex items-center gap-2 shadow-sm"
                >
                    {action.icon}
                    {action.label}
                </button>
            )}
        </div>
    );
};
