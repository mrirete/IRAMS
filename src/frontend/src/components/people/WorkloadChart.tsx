import React from 'react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    Legend,
    ReferenceLine,
} from 'recharts';
import { Users, AlertTriangle } from 'lucide-react';

// ─────────────────────────────────────────────────────────
//  Mock Data
// ─────────────────────────────────────────────────────────

interface WorkloadEntry {
    name: string;
    role: string;
    cm: number;     // Corrective Maintenance hours
    pm: number;     // Preventive Maintenance hours
    project: number; // Project hours
    total: number;
}

const WORKLOAD_DATA: WorkloadEntry[] = [
    { name: 'J. Carter', role: 'Technician', cm: 18, pm: 16, project: 8, total: 42 },
    { name: 'M. Lopez', role: 'Technician', cm: 12, pm: 20, project: 6, total: 38 },
    { name: 'A. Al-Rashid', role: 'Engineer', cm: 8, pm: 10, project: 28, total: 46 },
    { name: 'S. Chen', role: 'Planner', cm: 4, pm: 6, project: 22, total: 32 },
    { name: 'D. Okonkwo', role: 'Supervisor', cm: 6, pm: 8, project: 14, total: 28 },
    { name: 'R. Patel', role: 'Technician', cm: 22, pm: 14, project: 10, total: 46 },
];

const OVERLOAD_THRESHOLD = 40;

// ─────────────────────────────────────────────────────────
//  Component
// ─────────────────────────────────────────────────────────

export const WorkloadChart: React.FC = () => {
    const overloaded = WORKLOAD_DATA.filter(w => w.total > OVERLOAD_THRESHOLD).length;
    const avgHours = (WORKLOAD_DATA.reduce((s, w) => s + w.total, 0) / WORKLOAD_DATA.length).toFixed(1);

    const CustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const d = payload[0].payload as WorkloadEntry;
            return (
                <div className="bg-slate-50 border border-slate-300 p-3 rounded-lg shadow-xl min-w-[180px]">
                    <p className="text-slate-700 text-sm font-medium border-b border-slate-200 pb-1 mb-2">{d.name} <span className="text-slate-400">({d.role})</span></p>
                    <div className="space-y-1 text-xs">
                        <div className="flex justify-between"><span className="text-red-400">Corrective:</span><span className="font-bold text-slate-700">{d.cm}h</span></div>
                        <div className="flex justify-between"><span className="text-accent-cyan">Preventive:</span><span className="font-bold text-slate-700">{d.pm}h</span></div>
                        <div className="flex justify-between"><span className="text-blue-400">Project:</span><span className="font-bold text-slate-700">{d.project}h</span></div>
                        <div className="flex justify-between border-t border-slate-200 pt-1">
                            <span className="text-slate-500">Total:</span>
                            <span className={`font-bold ${d.total > OVERLOAD_THRESHOLD ? 'text-red-400' : 'text-accent-safe'}`}>{d.total}h/wk</span>
                        </div>
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-accent-cyan/10 rounded-lg text-accent-cyan">
                        <Users size={20} />
                    </div>
                    <div>
                        <h3 className="text-base font-semibold text-slate-800">Weekly Workload Distribution</h3>
                        <p className="text-xs text-slate-400">Avg {avgHours}h/wk · Threshold: {OVERLOAD_THRESHOLD}h/wk</p>
                    </div>
                </div>
                {overloaded > 0 && (
                    <div className="flex items-center gap-1 px-2 py-1 bg-red-500/10 border border-red-500/30 rounded-full text-xs text-red-400 font-bold">
                        <AlertTriangle size={12} /> {overloaded} overloaded
                    </div>
                )}
            </div>

            <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={WORKLOAD_DATA} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                        <XAxis type="number" stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => `${v}h`} />
                        <YAxis type="category" dataKey="name" width={85} stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(51, 65, 85, 0.2)' }} />
                        <Legend
                            verticalAlign="top"
                            height={30}
                            iconType="circle"
                            iconSize={8}
                            formatter={(value: string) => <span className="text-xs text-slate-500 ml-1">{value}</span>}
                        />
                        <ReferenceLine x={OVERLOAD_THRESHOLD} stroke="#ef4444" strokeDasharray="4 3" opacity={0.6} label={{ value: `${OVERLOAD_THRESHOLD}h`, position: 'top', fill: '#ef4444', fontSize: 10 }} />
                        <Bar dataKey="cm" name="Corrective" stackId="hours" fill="#ef4444" radius={[0, 0, 0, 0]} maxBarSize={22} />
                        <Bar dataKey="pm" name="Preventive" stackId="hours" fill="#06b6d4" radius={[0, 0, 0, 0]} maxBarSize={22} />
                        <Bar dataKey="project" name="Project" stackId="hours" fill="#a855f7" radius={[0, 4, 4, 0]} maxBarSize={22} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};
