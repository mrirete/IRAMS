import React, { useRef } from 'react';
import { Download, Pin, ChevronRight, Info } from 'lucide-react';

interface ReportChartCardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  height?: number;
  onExport?: () => void;
  onPin?: () => void;
  onDrillDown?: () => void;
  drillDownLabel?: string;
  className?: string;
  filterBadge?: string;
  infoTooltip?: string;
}

export const ReportChartCard: React.FC<ReportChartCardProps> = ({
  title, subtitle, children, height = 300, onExport, onPin, onDrillDown, drillDownLabel, className = '', filterBadge, infoTooltip,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={cardRef} className={`bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden hover:shadow-md transition-shadow ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {onDrillDown ? (
                <h3
                  className="text-sm font-bold text-slate-800 truncate hover:text-blue-600 cursor-pointer transition-colors"
                  onClick={onDrillDown}
                  title={drillDownLabel || 'Click to view details'}
                >{title}</h3>
              ) : (
                <h3 className="text-sm font-bold text-slate-800 truncate">{title}</h3>
              )}
              {infoTooltip && (
                <span className="relative group">
                  <Info size={13} className="text-slate-400 hover:text-blue-500 cursor-help transition-colors" />
                  <span className="absolute left-1/2 -translate-x-1/2 top-full mt-2 px-3 py-2 bg-slate-900 text-white text-[11px] font-medium rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto whitespace-normal w-56 z-[100] leading-relaxed">
                    {infoTooltip}
                  </span>
                </span>
              )}
              {onDrillDown && (
                <button
                  onClick={onDrillDown}
                  className="p-0.5 rounded hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors"
                  title="View details"
                >
                  <ChevronRight size={14} />
                </button>
              )}
            </div>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5 font-medium">{subtitle}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {filterBadge && (
            <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-bold rounded-full mr-1">
              {filterBadge}
            </span>
          )}
          {onPin && (
            <button onClick={onPin} className="p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors" title="Pin to Dashboard">
              <Pin size={14} />
            </button>
          )}
          {onExport && (
            <button onClick={onExport} className="p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors" title="Export">
              <Download size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Chart Area */}
      <div className="px-5 pb-5 pt-4" style={{ height }}>
        {children}
      </div>
    </div>
  );
};
