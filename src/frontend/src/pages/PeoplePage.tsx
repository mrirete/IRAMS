import React, { useState } from 'react';
import {
    Users, UserCheck, AlertTriangle, ShieldCheck, Settings,
    Briefcase, FileText, CheckCircle, Clock, XCircle, Search, Filter, Award, BarChart3
} from 'lucide-react';
import { usePeople } from '../hooks/usePeople';
import type { Person } from '../types/people';
import { SkillsMatrix } from '../components/people/SkillsMatrix';
import { WorkloadChart } from '../components/people/WorkloadChart';

// ═══════════════════════════════════════════════════════════════════════
//  PAGE COMPONENT
// ═══════════════════════════════════════════════════════════════════════

export const PeoplePage: React.FC = () => {
    const { personnel, summary } = usePeople();
    const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
    const [activeTab, setActiveTab] = useState<'directory' | 'skills' | 'workload'>('directory');

    const TABS = [
        { key: 'directory' as const, label: 'Directory', icon: <Users size={16} /> },
        { key: 'skills' as const, label: 'Skills Matrix', icon: <Award size={16} /> },
        { key: 'workload' as const, label: 'Workload', icon: <BarChart3 size={16} /> },
    ];

    return (
        <div className="space-y-6 pb-20 relative">
            {/* 1. Page Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 tracking-tight">People & Workforce</h1>
                    <p className="text-slate-500 text-sm mt-1">Personnel tracking, skills matrix, and certification compliance</p>
                </div>
                <div className="flex space-x-3">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input
                            type="text"
                            placeholder="Search personnel..."
                            className="input-field pl-10 py-2 w-64 text-sm bg-slate-50 border-slate-200"
                        />
                    </div>
                    <button className="btn-secondary">
                        <Filter size={18} className="mr-2" />
                        Filters
                    </button>
                </div>
            </div>

            {/* 2. KPI Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                <KpiCard label="Total Headcount" value={summary.total_headcount} icon={Users} />
                <KpiCard label="Active Now" value={summary.active_now} icon={UserCheck} color="text-green-400" bg="bg-green-500/10" />
                <KpiCard label="Avg Utilization" value={`${summary.avg_utilization_pct}%`} icon={Settings} />
                <KpiCard label="On Leave" value={summary.on_leave} icon={Briefcase} color="text-yellow-400" bg="bg-yellow-500/10" />
                <KpiCard label="Certs at Risk" value={summary.expiring_certs} icon={AlertTriangle} color="text-red-400" bg="bg-red-500/10" />
            </div>

            {/* 3. Tab Bar */}
            <div className="flex border-b border-slate-200">
                {TABS.map(t => (
                    <button
                        key={t.key}
                        onClick={() => setActiveTab(t.key)}
                        className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${activeTab === t.key
                                ? 'text-accent-cyan border-accent-cyan'
                                : 'text-slate-500 border-transparent hover:text-brand-200'
                            }`}
                    >
                        {t.icon} {t.label}
                    </button>
                ))}
            </div>

            {/* 4. Tab Content */}
            {activeTab === 'directory' && (
                <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <PersonnelTable personnel={personnel} onSelect={setSelectedPerson} />
                </div>
            )}
            {activeTab === 'skills' && <SkillsMatrix />}
            {activeTab === 'workload' && <WorkloadChart />}

            {/* 5. Detail Panel Slide-Out */}
            {selectedPerson && <PersonDetailPanel person={selectedPerson} onClose={() => setSelectedPerson(null)} />}
        </div>
    );
};

// ═══════════════════════════════════════════════════════════════════════
//  SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════

function KpiCard({ label, value, icon: Icon, color = 'text-accent-blue', bg = 'bg-accent-blue/10' }: any) {
    return (
        <div className="bg-white border border-slate-200 rounded-lg p-5 flex items-center shadow-sm">
            <div className={`p-3 rounded-md ${bg} ${color} mr-4`}>
                <Icon size={24} />
            </div>
            <div>
                <p className="text-slate-400 text-xs uppercase tracking-wider font-semibold mb-1">{label}</p>
                <div className="flex items-baseline space-x-2">
                    <h3 className="text-2xl font-bold text-brand-50 font-sans tracking-tight">{value}</h3>
                </div>
            </div>
        </div>
    );
}

// ── Table ─────────────────────────────────────────────────────────────

function PersonnelTable({ personnel, onSelect }: { personnel: Person[], onSelect: (p: Person) => void }) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-500 uppercase bg-brand-800/50 border-b border-slate-200">
                    <tr>
                        <th className="px-6 py-4 font-semibold tracking-wider">Employee</th>
                        <th className="px-6 py-4 font-semibold tracking-wider">Primary Craft & Role</th>
                        <th className="px-6 py-4 font-semibold tracking-wider">Base Site</th>
                        <th className="px-6 py-4 font-semibold tracking-wider">Certs Status</th>
                        <th className="px-6 py-4 font-semibold tracking-wider text-right">Availability</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-brand-700/50">
                    {personnel.map((p) => {
                        const primCraft = p.skills.find(s => s.is_primary);
                        const hasAtRisk = p.certifications.some(c => c.status === 'expiring_soon' || c.status === 'expired');

                        return (
                            <tr key={p.id} onClick={() => onSelect(p)} className="hover:bg-slate-100/30 transition-colors cursor-pointer group">
                                <td className="px-6 py-4">
                                    <div className="flex items-center space-x-3">
                                        <div className="h-10 w-10 flex-shrink-0 bg-slate-100 rounded-full flex items-center justify-center text-brand-300 font-bold group-hover:bg-brand-600 transition-colors">
                                            {p.first_name[0]}{p.last_name[0]}
                                        </div>
                                        <div>
                                            <p className="text-slate-800 font-semibold">{p.first_name} {p.last_name}</p>
                                            <p className="text-slate-400 text-xs font-mono">{p.employee_id}</p>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <p className="text-slate-800 font-medium">{primCraft ? `${primCraft.craft} (${primCraft.level})` : 'N/A'}</p>
                                    <p className="text-slate-500 text-xs">{p.role}</p>
                                </td>
                                <td className="px-6 py-4 text-brand-300 font-mono text-xs">{p.base_site}</td>
                                <td className="px-6 py-4">
                                    {hasAtRisk ? (
                                        <span className="inline-flex items-center text-red-400 text-xs font-semibold bg-red-400/10 px-2 py-1 rounded">
                                            <AlertTriangle size={14} className="mr-1" /> Action Required
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center text-green-400 text-xs font-semibold bg-green-400/10 px-2 py-1 rounded">
                                            <ShieldCheck size={14} className="mr-1" /> All Valid
                                        </span>
                                    )}
                                </td>
                                <td className="px-6 py-4 text-right">
                                    {p.availability === 'active' && <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-green-500/20 text-green-400 items-center"><span className="w-1.5 h-1.5 rounded-full bg-green-400 mr-1.5"></span> Active</span>}
                                    {p.availability === 'on_leave' && <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-yellow-500/20 text-yellow-400 items-center"><span className="w-1.5 h-1.5 rounded-full bg-yellow-400 mr-1.5"></span> On Leave</span>}
                                    {p.availability === 'training' && <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-blue-500/20 text-blue-400 items-center"><span className="w-1.5 h-1.5 rounded-full bg-blue-400 mr-1.5"></span> Training</span>}
                                    {p.availability === 'off_shift' && <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-slate-100 text-slate-500 items-center"><span className="w-1.5 h-1.5 rounded-full bg-brand-400 mr-1.5"></span> Off Shift</span>}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

// ── Detail Panel ──────────────────────────────────────────────────────

function PersonDetailPanel({ person, onClose }: { person: Person; onClose: () => void }) {
    return (
        <div className="fixed inset-y-0 right-0 w-[500px] bg-slate-50 border-l border-slate-200 shadow-2xl z-40 transform transition-transform duration-300 ease-in-out flex flex-col pt-16 mt-2 ml-4">

            {/* Header */}
            <div className="flex justify-between items-start px-6 py-5 border-b border-brand-800 bg-brand-950">
                <div className="flex items-center space-x-4">
                    <div className="h-14 w-14 flex-shrink-0 bg-slate-100 rounded-full flex items-center justify-center text-brand-300 text-xl font-bold">
                        {person.first_name[0]}{person.last_name[0]}
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-white tracking-tight">{person.first_name} {person.last_name}</h2>
                        <div className="flex items-center text-slate-500 text-sm mt-1">
                            <span className="font-mono bg-brand-800 px-1.5 rounded mr-2">{person.employee_id}</span>
                            {person.role}
                        </div>
                    </div>
                </div>
                <button onClick={onClose} className="p-2 text-slate-500 hover:text-white hover:bg-slate-50 rounded-full transition-colors">
                    <XCircle size={24} />
                </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-8">

                {/* 1. Skill Matrix */}
                <section>
                    <h3 className="text-sm font-semibold text-brand-300 uppercase tracking-widest mb-4 flex items-center">
                        <Award size={16} className="mr-2 text-accent-cyan" /> Skill Matrix
                    </h3>
                    <div className="space-y-3">
                        {person.skills.map((s, idx) => (
                            <div key={idx} className="flex justify-between items-center bg-brand-800/50 p-3 rounded-lg border border-slate-200/50">
                                <div className="flex flex-col">
                                    <span className="text-slate-800 font-medium">{s.craft}</span>
                                    {s.is_primary && <span className="text-[10px] uppercase text-accent-cyan tracking-wider font-semibold">Primary Craft</span>}
                                </div>
                                <span className="text-xs px-2 py-1 rounded bg-slate-100 text-brand-300 border border-slate-300">
                                    {s.level}
                                </span>
                            </div>
                        ))}
                    </div>
                </section>

                {/* 2. Certifications & Compliance */}
                <section>
                    <h3 className="text-sm font-semibold text-brand-300 uppercase tracking-widest mb-4 flex items-center">
                        <ShieldCheck size={16} className="mr-2 text-accent-cyan" /> Compliance & Certs
                    </h3>

                    <div className="space-y-3">
                        {person.certifications.map(c => (
                            <div key={c.id} className={`p-4 rounded-lg border flex justify-between items-center ${c.status === 'expired' ? 'bg-red-500/10 border-red-500/30' :
                                c.status === 'expiring_soon' ? 'bg-yellow-500/10 border-yellow-500/30' :
                                    'bg-green-500/5 border-green-500/20'
                                }`}>
                                <div>
                                    <div className="flex justify-between items-start mb-1">
                                        <p className="text-slate-800 font-medium text-sm pr-4 leading-tight">{c.name}</p>
                                    </div>
                                    <p className="text-slate-500 text-xs font-mono">{c.issuing_body}</p>

                                    <div className="mt-3 flex items-center space-x-4 text-xs font-mono">
                                        <div className="text-slate-400">
                                            Issued: <span className="text-brand-300">{new Date(c.issue_date).toLocaleDateString()}</span>
                                        </div>
                                        <div className={c.status === 'expired' ? 'text-red-400 font-medium' : c.status === 'expiring_soon' ? 'text-yellow-400 font-medium' : 'text-slate-400'}>
                                            Expires: {new Date(c.expiry_date).toLocaleDateString()}
                                        </div>
                                    </div>
                                </div>
                                <div>
                                    {c.status === 'valid' && <CheckCircle size={24} className="text-green-400" />}
                                    {c.status === 'expiring_soon' && <Clock size={24} className="text-yellow-400" />}
                                    {c.status === 'expired' && <AlertTriangle size={24} className="text-red-400" />}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* 3. Availability & Utilization */}
                <section>
                    <h3 className="text-sm font-semibold text-brand-300 uppercase tracking-widest mb-4 flex items-center">
                        <FileText size={16} className="mr-2 text-accent-cyan" /> Current Capacity
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-brand-800 p-4 border border-slate-200 rounded-lg">
                            <p className="text-xs text-slate-400 font-semibold uppercase mb-1">Weekly Hours</p>
                            <p className="text-2xl font-bold font-mono text-slate-800">{person.weekly_capacity_hours} <span className="text-sm text-slate-400 font-sans">hrs</span></p>
                        </div>
                        <div className="bg-brand-800 p-4 border border-slate-200 rounded-lg">
                            <p className="text-xs text-slate-400 font-semibold uppercase mb-1">Utilization</p>
                            <div className="flex items-end space-x-2">
                                <p className="text-2xl font-bold font-mono text-slate-800">{person.current_utilization_pct}%</p>
                            </div>
                            <div className="w-full bg-slate-50 rounded-full h-1.5 mt-2">
                                <div className={`h-1.5 rounded-full ${person.current_utilization_pct > 90 ? 'bg-red-400' : 'bg-green-400'}`} style={{ width: `${person.current_utilization_pct}%` }}></div>
                            </div>
                        </div>
                    </div>
                </section>
            </div>

        </div>
    );
}
