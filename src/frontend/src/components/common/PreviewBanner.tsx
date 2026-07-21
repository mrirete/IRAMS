import React from 'react';
import { AlertTriangle } from 'lucide-react';

const DEFAULT_MESSAGE = 'Preview — this screen shows illustrative data and new entries are not saved yet. Full functionality is on the roadmap.';

export const PreviewBanner: React.FC<{ message?: string }> = ({ message = DEFAULT_MESSAGE }) => (
    <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm p-3">
        <AlertTriangle size={16} className="shrink-0 mt-0.5" />
        <p>{message}</p>
    </div>
);
