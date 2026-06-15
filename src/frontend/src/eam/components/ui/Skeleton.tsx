import React from 'react';
import { cn } from './cn';

/**
 * Skeleton — loading placeholder primitive. Replaces ad-hoc spinners for list/detail
 * loading states so the layout doesn't jump when data arrives.
 */
export const Skeleton: React.FC<{ className?: string }> = ({ className }) => (
    <div className={cn('animate-pulse rounded bg-slate-200', className)} />
);

/** SkeletonRows — N stacked line placeholders, for list loading states. */
export const SkeletonRows: React.FC<{ rows?: number; className?: string }> = ({ rows = 6, className }) => (
    <div className={cn('space-y-2 p-3', className)}>
        {Array.from({ length: rows }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
        ))}
    </div>
);
