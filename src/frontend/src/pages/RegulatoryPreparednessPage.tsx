import React from 'react';
import { ShieldCheck, AlertTriangle, Calendar, TrendingUp } from 'lucide-react';
import { useSafety } from '../hooks/useSafety';

export const RegulatoryPreparednessPage: React.FC = () => {
    const { readinessScores, summary } = useSafety();

    const scoreColor = (pct: number) => {
        if (pct >= 85) return { text: 'text-green-400', bar: 'bg-green-500', border: 'border-green-500/30', bg: 'bg-green-500/5' };
        if (pct >= 65) return { text: 'text-yellow-400', bar: 'bg-yellow-500', border: 'border-yellow-500/30', bg: 'bg-yellow-500/5' };
        return { text: 'text-red-400', bar: 'bg-red-500', border: 'border-red-500/30', bg: 'bg-red-500/5' };
    };

    return (
        <div className="space-y-6 pb-20">
            <div><h1 className="text-2xl font-bold text-slate-800 tracking-tight">Regulatory Preparedness</h1><p className="text-slate-500 text-sm mt-1">Readiness scoring, gap analysis, and upcoming submission deadlines</p></div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Kpi label="Overall Readiness" value={`${summary.overall_readiness_pct}%`} icon={ShieldCheck} color={summary.overall_readiness_pct >= 80 ? 'text-green-400' : 'text-yellow-400'} bg={summary.overall_readiness_pct >= 80 ? 'bg-green-500/10' : 'bg-yellow-500/10'} />
                <Kpi label="Critical Gaps" value={summary.critical_gaps} icon={AlertTriangle} color="text-red-400" bg="bg-red-500/10" />
                <Kpi label="Areas Assessed" value={readinessScores.length} icon={TrendingUp} />
                <Kpi label="Last Assessment" value={readinessScores.length ? new Date(readinessScores[0].last_assessed).toLocaleDateString() : '—'} icon={Calendar} />
            </div>

            {/* Readiness Scorecards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {readinessScores.map(r => {
                    const c = scoreColor(r.score_pct);
                    return (
                        <div key={r.id} className={`bg-brand-800 border ${c.border} rounded-lg p-6 ${c.bg}`}>
                            <div className="flex justify-between items-start mb-4">
                                <h3 className="text-slate-800 font-semibold">{r.regulatory_area}</h3>
                                <span className={`text-3xl font-bold font-mono ${c.text}`}>{r.score_pct}%</span>
                            </div>
                            <div className="w-full bg-slate-50 rounded-full h-2.5 mb-4">
                                <div className={`h-2.5 rounded-full transition-all ${c.bar}`} style={{ width: `${r.score_pct}%` }}></div>
                            </div>
                            <div className="flex justify-between text-xs text-slate-400">
                                <span>Gaps: <span className={r.gap_count > 0 ? 'text-yellow-400 font-semibold' : 'text-brand-300'}>{r.gap_count}</span></span>
                                <span>Assessed: {new Date(r.last_assessed).toLocaleDateString()}</span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

function Kpi({ label, value, icon: Icon, color = 'text-accent-blue', bg = 'bg-accent-blue/10' }: any) {
    return (<div className="bg-white border border-slate-200 rounded-lg p-5 flex items-center shadow-sm"><div className={`p-3 rounded-md ${bg} ${color} mr-4`}><Icon size={24} /></div><div><p className="text-slate-400 text-xs uppercase tracking-wider font-semibold mb-1">{label}</p><h3 className="text-2xl font-bold text-brand-50 tracking-tight">{value}</h3></div></div>);
}
