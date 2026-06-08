import React from 'react';
import { RefreshCw } from 'lucide-react';
import { usePullToRefresh } from '../hooks/usePullToRefresh';

interface PullToRefreshWrapperProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  className?: string;
}

export const PullToRefreshWrapper: React.FC<PullToRefreshWrapperProps> = ({
  onRefresh,
  children,
  className = '',
}) => {
  const { containerRef, isRefreshing, pullDistance, pullProgress } = usePullToRefresh({
    onRefresh,
  });

  return (
    <div
      ref={containerRef}
      className={`relative overflow-auto ${className}`}
      style={{ WebkitOverflowScrolling: 'touch' }}
    >
      {/* Pull Indicator */}
      <div
        className="flex items-center justify-center transition-all duration-200 overflow-hidden"
        style={{
          height: pullDistance > 0 || isRefreshing ? `${Math.max(pullDistance, isRefreshing ? 48 : 0)}px` : '0px',
          opacity: pullProgress > 0.1 || isRefreshing ? 1 : 0,
        }}
      >
        <div className="flex flex-col items-center gap-1 py-2">
          <div
            className={`p-1.5 rounded-full bg-slate-100 ${isRefreshing ? 'animate-spin' : ''}`}
            style={{
              transform: isRefreshing ? undefined : `rotate(${pullProgress * 360}deg)`,
              transition: isRefreshing ? undefined : 'transform 0.1s',
            }}
          >
            <RefreshCw
              size={18}
              className={`${pullProgress >= 1 ? 'text-relantern-500' : 'text-slate-400'} transition-colors`}
            />
          </div>
          <span className="text-[10px] font-medium text-slate-400">
            {isRefreshing
              ? 'Refreshing…'
              : pullProgress >= 1
                ? 'Release to refresh'
                : 'Pull to refresh'}
          </span>
        </div>
      </div>

      {/* Content */}
      {children}
    </div>
  );
};
