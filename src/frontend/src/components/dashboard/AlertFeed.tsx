import React from 'react';
import { Bell, AlertTriangle, Wrench, Zap, ShieldAlert, Clock } from 'lucide-react';

// ─────────────────────────────────────────────────────────
//  Alert/WR Types
// ─────────────────────────────────────────────────────────

interface FeedItem {
    id: string;
    type: 'prediction' | 'work_request' | 'safety';
    severity: 'emergency' | 'high' | 'medium' | 'low' | 'info';
    title: string;
    asset: string;
    timestamp: Date;
    description: string;
}

const FEED_DATA: FeedItem[] = [
    { id: 'f-001', type: 'prediction', severity: 'high', title: 'Accelerated Bearing Wear', asset: 'K-601', timestamp: new Date(Date.now() - 7200000), description: 'Vibration signature indicates early inner race spalling' },
    { id: 'f-002', type: 'work_request', severity: 'medium', title: 'WR-2026-0891: High vibration on DE bearing', asset: 'P-101A', timestamp: new Date(Date.now() - 14400000), description: 'Pending review — Criticality A' },
    { id: 'f-003', type: 'prediction', severity: 'medium', title: 'Discharge Pressure Dropping', asset: 'P-102', timestamp: new Date(Date.now() - 86400000), description: 'Discharge pressure 5% below dynamic threshold' },
    { id: 'f-004', type: 'safety', severity: 'high', title: 'LOTO Expiring — Compressor Overhaul', asset: 'K-601', timestamp: new Date(Date.now() - 172800000), description: 'LOTO-2026-043 expires in 12 hours' },
    { id: 'f-005', type: 'work_request', severity: 'low', title: 'WR-2026-0890: Abnormal noise during startup', asset: 'MTR-101A', timestamp: new Date(Date.now() - 259200000), description: 'In progress — Criticality B' },
    { id: 'f-006', type: 'prediction', severity: 'low', title: 'Minor Seal Leak Rate Increase', asset: 'K-601', timestamp: new Date(Date.now() - 345600000), description: 'Primary seal leak rate increased by 12%' },
    { id: 'f-007', type: 'work_request', severity: 'info', title: 'WR-2026-0888: Quarterly lube oil change', asset: 'GT-301', timestamp: new Date(Date.now() - 432000000), description: 'Scheduled — routine PM' },
    { id: 'f-008', type: 'safety', severity: 'medium', title: 'MoC Review Required — Flow Change', asset: 'V-602', timestamp: new Date(Date.now() - 518400000), description: 'Process flow parameter change awaiting engineering review' },
];

function relativeTime(d: Date): string {
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return days === 1 ? 'Yesterday' : `${days}d ago`;
}

const SEVERITY_STYLES: Record<FeedItem['severity'], string> = {
    emergency: 'bg-red-500/20 border-red-500/50 text-red-400',
    high: 'bg-orange-500/15 border-orange-500/40 text-orange-400',
    medium: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-500',
    low: 'bg-slate-100/50 border-slate-300 text-slate-600',
    info: 'bg-white/50 border-slate-200 text-slate-500',
};

const TYPE_ICONS: Record<FeedItem['type'], React.ReactNode> = {
    prediction: <Zap size={14} />,
    work_request: <Wrench size={14} />,
    safety: <ShieldAlert size={14} />,
};

// ─────────────────────────────────────────────────────────
//  Component
// ─────────────────────────────────────────────────────────

export const AlertFeed: React.FC = () => {
    const highCount = FEED_DATA.filter(f => f.severity === 'emergency' || f.severity === 'high').length;

    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 flex flex-col h-full">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-red-500/10 rounded-lg text-red-400">
                        <Bell size={20} />
                    </div>
                    <div>
                        <h3 className="text-base font-semibold text-slate-800">Live Alert Feed</h3>
                        <p className="text-xs text-slate-400">{FEED_DATA.length} items · {highCount} high priority</p>
                    </div>
                </div>
                {highCount > 0 && (
                    <div className="flex items-center gap-1 px-2 py-1 bg-red-500/10 border border-red-500/30 rounded-full text-xs text-red-400 font-bold animate-pulse">
                        <AlertTriangle size={12} /> {highCount} urgent
                    </div>
                )}
            </div>

            <div className="space-y-2 overflow-y-auto flex-1 max-h-[320px] pr-1 scrollbar-thin scrollbar-thumb-brand-700 scrollbar-track-transparent">
                {FEED_DATA.map((item, idx) => (
                    <div
                        key={item.id}
                        className={`border rounded-lg p-3 transition-all hover:scale-[1.01] cursor-pointer ${SEVERITY_STYLES[item.severity]} ${item.severity === 'emergency' ? 'animate-pulse' : ''}`}
                        style={{ animationDelay: `${idx * 60}ms` }}
                    >
                        <div className="flex items-start gap-3">
                            <div className="mt-0.5 opacity-70">{TYPE_ICONS[item.type]}</div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-sm font-semibold truncate">{item.title}</p>
                                    <div className="flex items-center gap-1 text-[10px] opacity-60 shrink-0">
                                        <Clock size={10} />
                                        {relativeTime(item.timestamp)}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                    <span className="text-[10px] font-bold bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200/50">{item.asset}</span>
                                    <p className="text-[11px] opacity-70 truncate">{item.description}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
