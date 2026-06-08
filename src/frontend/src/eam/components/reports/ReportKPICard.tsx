import React from 'react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { TrendingUp, TrendingDown, Minus, ArrowUpRight } from 'lucide-react';

interface ReportKPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: number; // +/- percentage
  trendLabel?: string;
  sparkData?: { v: number }[];
  sparkColor?: string;
  target?: number; // 0-100 gauge percentage
  targetLabel?: string;
  icon?: React.ReactNode;
  format?: 'number' | 'currency' | 'percent' | 'hours';
  ragStatus?: 'green' | 'amber' | 'red' | 'neutral';
  onClick?: () => void;
  clickLabel?: string;
}

const RAG_COLORS = {
  green: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400', ring: 'stroke-emerald-500' },
  amber: { bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-amber-400', ring: 'stroke-amber-500' },
  red: { bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'text-red-400', ring: 'stroke-red-500' },
  neutral: { bg: 'bg-slate-500/10', border: 'border-slate-500/20', text: 'text-slate-400', ring: 'stroke-slate-500' },
};

const formatValue = (value: string | number, format?: string): string => {
  if (typeof value === 'string') return value;
  switch (format) {
    case 'currency': return `$${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    case 'percent': return `${value.toFixed(1)}%`;
    case 'hours': return `${value.toFixed(1)}h`;
    case 'number': return value.toLocaleString();
    default: return String(value);
  }
};

export const ReportKPICard: React.FC<ReportKPICardProps> = ({
  title, value, subtitle, trend, trendLabel, sparkData, sparkColor = '#3b82f6',
  target, targetLabel, icon, format, ragStatus = 'neutral', onClick, clickLabel,
}) => {
  const rag = RAG_COLORS[ragStatus];
  const circumference = 2 * Math.PI * 36;
  const gaugeOffset = target != null ? circumference - (target / 100) * circumference : 0;
  const isClickable = !!onClick;

  return (
    <div
      className={`relative overflow-hidden rounded-xl border ${rag.border} bg-white shadow-sm p-5 transition-all group
        ${isClickable ? 'cursor-pointer hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0' : 'hover:shadow-md'}`}
      onClick={onClick}
      title={clickLabel}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.(); } : undefined}
    >
      {/* Click arrow indicator */}
      {isClickable && (
        <div className="absolute top-2 right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
          <ArrowUpRight size={14} className="text-slate-400" />
        </div>
      )}
      {/* Sparkline Background */}
      {sparkData && sparkData.length > 1 && (
        <div className="absolute inset-0 opacity-20 group-hover:opacity-30 transition-opacity">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`spark-${title.replace(/\s/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={sparkColor} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={sparkColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={sparkColor} fill={`url(#spark-${title.replace(/\s/g, '')})`} strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="relative z-10 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 text-slate-500">
            {icon && <span className={`${rag.text} shrink-0`}>{icon}</span>}
            <span className="text-xs font-semibold uppercase tracking-wider truncate" title={title}>{title}</span>
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-1 truncate" title={String(formatValue(value, format))}>{formatValue(value, format)}</div>
          {subtitle && <div className="text-[11px] font-medium text-slate-400 mt-1 truncate" title={subtitle}>{subtitle}</div>}

          {/* Trend Badge */}
          {trend != null && (
            <div className={`inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full text-xs font-semibold
              ${trend > 0 ? 'bg-emerald-50 text-emerald-600' : trend < 0 ? 'bg-red-50 text-red-600' : 'bg-slate-50 text-slate-600'}`}
            >
              {trend > 0 ? <TrendingUp size={12} /> : trend < 0 ? <TrendingDown size={12} /> : <Minus size={12} />}
              {trend > 0 ? '+' : ''}{trend.toFixed(1)}%
              {trendLabel && <span className="text-slate-500 ml-1">{trendLabel}</span>}
            </div>
          )}
        </div>

        {/* Gauge Ring */}
        {target != null && (
          <div className="relative w-14 h-14 flex-shrink-0 mt-1">
            <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90 drop-shadow-sm">
              <circle cx="40" cy="40" r="36" fill="none" stroke="currentColor" className="text-slate-100" strokeWidth="6" />
              <circle
                cx="40" cy="40" r="36" fill="none" className={rag.ring} strokeWidth="6"
                strokeDasharray={circumference} strokeDashoffset={gaugeOffset}
                strokeLinecap="round" style={{ transition: 'stroke-dashoffset 1s ease' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xs font-bold text-slate-700">{target}%</span>
            </div>
            {targetLabel && <div className="text-[9px] text-slate-400 text-center mt-1 font-medium truncate" title={targetLabel}>{targetLabel}</div>}
          </div>
        )}
      </div>
    </div>
  );
};
