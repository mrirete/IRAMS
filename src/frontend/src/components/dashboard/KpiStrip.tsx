import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Wrench, Package, Shield, CheckCircle2, HeartPulse, TrendingUp, TrendingDown, Minus } from 'lucide-react';

// ─────────────────────────────────────────────────────────
//  Animated Counter Hook
// ─────────────────────────────────────────────────────────

function useAnimatedValue(target: number, duration = 1200) {
    const [value, setValue] = useState(0);
    useEffect(() => {
        let start = 0;
        const step = target / (duration / 16);
        const timer = setInterval(() => {
            start += step;
            if (start >= target) {
                setValue(target);
                clearInterval(timer);
            } else {
                setValue(Math.floor(start));
            }
        }, 16);
        return () => clearInterval(timer);
    }, [target, duration]);
    return value;
}

// ─────────────────────────────────────────────────────────
//  KPI Data
// ─────────────────────────────────────────────────────────

interface KpiCard {
    label: string;
    value: number;
    format: 'number' | 'percent' | 'currency';
    trend: 'up' | 'down' | 'stable';
    trendValue: string;
    trendGood: boolean;
    sparkline: number[];
    icon: React.ReactNode;
    color: string;
    route: string;
}

const KPI_DATA: KpiCard[] = [
    {
        label: 'Total Assets', value: 1248, format: 'number',
        trend: 'up', trendValue: '+12', trendGood: true,
        sparkline: [1180, 1195, 1205, 1212, 1228, 1240, 1248],
        icon: <Activity size={20} />, color: 'text-accent-cyan', route: '/assets',
    },
    {
        label: 'Fleet Health', value: 78, format: 'percent',
        trend: 'down', trendValue: '-2.1%', trendGood: false,
        sparkline: [84, 83, 82, 81, 80, 79, 78],
        icon: <HeartPulse size={20} />, color: 'text-yellow-500', route: '/predict',
    },
    {
        label: 'Open Work Orders', value: 87, format: 'number',
        trend: 'up', trendValue: '+5', trendGood: false,
        sparkline: [62, 68, 72, 75, 80, 84, 87],
        icon: <Wrench size={20} />, color: 'text-orange-400', route: '/work',
    },
    {
        label: 'Inventory Alerts', value: 14, format: 'number',
        trend: 'down', trendValue: '-3', trendGood: true,
        sparkline: [22, 20, 19, 18, 17, 16, 14],
        icon: <Package size={20} />, color: 'text-purple-400', route: '/inventory',
    },
    {
        label: 'Safety Open Items', value: 6, format: 'number',
        trend: 'stable', trendValue: '0', trendGood: true,
        sparkline: [8, 7, 7, 6, 6, 6, 6],
        icon: <Shield size={20} />, color: 'text-red-400', route: '/loto',
    },
    {
        label: 'Compliance Score', value: 94, format: 'percent',
        trend: 'up', trendValue: '+1.2%', trendGood: true,
        sparkline: [89, 90, 91, 92, 93, 93, 94],
        icon: <CheckCircle2 size={20} />, color: 'text-accent-safe', route: '/regulatory',
    },
];

// ─────────────────────────────────────────────────────────
//  Component
// ─────────────────────────────────────────────────────────

export const KpiStrip: React.FC = () => {
    const navigate = useNavigate();

    return (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {KPI_DATA.map((kpi, idx) => (
                <KpiCardItem key={kpi.label} kpi={kpi} index={idx} onClick={() => navigate(kpi.route)} />
            ))}
        </div>
    );
};

const KpiCardItem: React.FC<{ kpi: KpiCard; index: number; onClick: () => void }> = ({ kpi, index, onClick }) => {
    const animatedValue = useAnimatedValue(kpi.value);

    // Build sparkline SVG
    const min = Math.min(...kpi.sparkline);
    const max = Math.max(...kpi.sparkline);
    const range = max - min || 1;
    const w = 60;
    const h = 20;
    const path = kpi.sparkline.map((v, i) => {
        const x = (i / (kpi.sparkline.length - 1)) * w;
        const y = h - ((v - min) / range) * h;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    const TrendIcon = kpi.trend === 'up' ? TrendingUp : kpi.trend === 'down' ? TrendingDown : Minus;
    const trendColor = kpi.trendGood ? 'text-accent-safe' : kpi.trend === 'stable' ? 'text-slate-500' : 'text-red-400';

    const formatValue = (v: number) => {
        if (kpi.format === 'percent') return `${v}%`;
        if (kpi.format === 'currency') return `$${v.toLocaleString()}`;
        return v.toLocaleString();
    };

    return (
        <button
            onClick={onClick}
            className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 text-left hover:border-slate-300 hover:shadow-lg hover:scale-[1.02] transition-all group"
            style={{ animationDelay: `${index * 80}ms` }}
        >
            <div className="flex items-center justify-between mb-3">
                <div className={`p-2 rounded-lg bg-slate-50 ${kpi.color} group-hover:scale-110 transition-transform`}>
                    {kpi.icon}
                </div>
                <div className={`flex items-center gap-1 text-[10px] font-bold ${trendColor}`}>
                    <TrendIcon size={10} />
                    <span>{kpi.trendValue}</span>
                </div>
            </div>

            <p className="text-2xl font-bold text-slate-800 font-mono mb-0.5">
                {formatValue(animatedValue)}
            </p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{kpi.label}</p>

            {/* Sparkline */}
            <div className="mt-2">
                <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-4" preserveAspectRatio="none">
                    <path
                        d={path}
                        fill="none"
                        stroke={kpi.trendGood ? '#22c55e' : kpi.trend === 'stable' ? '#64748b' : '#ef4444'}
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={0.6}
                    />
                </svg>
            </div>
        </button>
    );
};
