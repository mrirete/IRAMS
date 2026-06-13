import React from 'react';
import { Award, AlertTriangle } from 'lucide-react';

// ─────────────────────────────────────────────────────────
//  Mock Data
// ─────────────────────────────────────────────────────────

interface PersonSkill {
    personId: string;
    name: string;
    role: string;
}

interface Competency {
    id: string;
    name: string;
}

const PERSONNEL: PersonSkill[] = [
    { personId: 'p-001', name: 'James Carter', role: 'Technician' },
    { personId: 'p-002', name: 'Maria Lopez', role: 'Technician' },
    { personId: 'p-003', name: 'Ahmed Al-Rashid', role: 'Engineer' },
    { personId: 'p-004', name: 'Sarah Chen', role: 'Planner' },
    { personId: 'p-005', name: 'David Okonkwo', role: 'Supervisor' },
    { personId: 'p-006', name: 'Raj Patel', role: 'Technician' },
];

const COMPETENCIES: Competency[] = [
    { id: 'c-rot', name: 'Rotating Equip' },
    { id: 'c-elec', name: 'Electrical' },
    { id: 'c-inst', name: 'Instrumentation' },
    { id: 'c-weld', name: 'Welding' },
    { id: 'c-vib', name: 'Vibration Analysis' },
    { id: 'c-ndt', name: 'NDT' },
    { id: 'c-scaf', name: 'Scaffolding' },
    { id: 'c-conf', name: 'Confined Space' },
];

// Proficiency: 0=N/A, 1=Novice, 2=Basic, 3=Competent, 4=Proficient, 5=Expert
// Negative values = expiring certification
const SKILL_MATRIX: Record<string, Record<string, number>> = {
    'p-001': { 'c-rot': 5, 'c-elec': 3, 'c-inst': 2, 'c-weld': 4, 'c-vib': 4, 'c-ndt': 0, 'c-scaf': 3, 'c-conf': -3 },
    'p-002': { 'c-rot': 3, 'c-elec': 5, 'c-inst': 4, 'c-weld': 0, 'c-vib': 2, 'c-ndt': 3, 'c-scaf': 0, 'c-conf': 4 },
    'p-003': { 'c-rot': 4, 'c-elec': 4, 'c-inst': 5, 'c-weld': 0, 'c-vib': 5, 'c-ndt': 4, 'c-scaf': 0, 'c-conf': 2 },
    'p-004': { 'c-rot': 2, 'c-elec': 1, 'c-inst': 1, 'c-weld': 0, 'c-vib': 3, 'c-ndt': 0, 'c-scaf': 0, 'c-conf': -1 },
    'p-005': { 'c-rot': 4, 'c-elec': 3, 'c-inst': 3, 'c-weld': 2, 'c-vib': 4, 'c-ndt': 3, 'c-scaf': 2, 'c-conf': 4 },
    'p-006': { 'c-rot': 3, 'c-elec': 2, 'c-inst': 0, 'c-weld': 5, 'c-vib': 1, 'c-ndt': -2, 'c-scaf': 4, 'c-conf': 3 },
};

const LEVEL_COLORS: Record<number, string> = {
    0: 'bg-slate-50 text-brand-700',
    1: 'bg-white text-slate-500',
    2: 'bg-blue-900/40 text-blue-400',
    3: 'bg-accent-cyan/10 text-accent-cyan',
    4: 'bg-accent-safe/10 text-accent-safe',
    5: 'bg-blue-500/15 text-blue-400',
};

const LEVEL_LABELS = ['—', 'Novice', 'Basic', 'Competent', 'Proficient', 'Expert'];

// ─────────────────────────────────────────────────────────
//  Component
// ─────────────────────────────────────────────────────────

export const SkillsMatrix: React.FC = () => {
    const expiringCount = Object.values(SKILL_MATRIX).reduce((cnt, skills) =>
        cnt + Object.values(skills).filter(v => v < 0).length, 0
    );

    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
                        <Award size={20} />
                    </div>
                    <div>
                        <h3 className="text-base font-semibold text-slate-800">Competency Skills Matrix</h3>
                        <p className="text-xs text-slate-400">{PERSONNEL.length} personnel · {COMPETENCIES.length} competencies</p>
                    </div>
                </div>
                {expiringCount > 0 && (
                    <div className="flex items-center gap-1 px-2 py-1 bg-red-500/10 border border-red-500/30 rounded-full text-xs text-red-400 font-bold">
                        <AlertTriangle size={12} /> {expiringCount} expiring
                    </div>
                )}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
                {LEVEL_LABELS.map((label, i) => (
                    <span key={i} className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${LEVEL_COLORS[i]}`}>
                        {i}: {label}
                    </span>
                ))}
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30 ml-1">
                    ⚠ Expiring
                </span>
            </div>

            {/* Matrix Grid */}
            <div className="overflow-x-auto">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="border-b border-slate-200">
                            <th className="text-left py-2 px-3 text-slate-400 font-medium sticky left-0 bg-white min-w-[140px]">Name</th>
                            <th className="text-left py-2 px-2 text-slate-400 font-medium min-w-[80px]">Role</th>
                            {COMPETENCIES.map(c => (
                                <th key={c.id} className="text-center py-2 px-1 text-slate-400 font-medium min-w-[70px]">
                                    <span className="writing-mode-vertical" style={{ writingMode: 'horizontal-tb' }}>{c.name}</span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-brand-700/50">
                        {PERSONNEL.map(person => {
                            const skills = SKILL_MATRIX[person.personId] || {};
                            return (
                                <tr key={person.personId} className="hover:bg-slate-100/20 transition-colors">
                                    <td className="py-2 px-3 text-slate-700 font-medium sticky left-0 bg-white">{person.name}</td>
                                    <td className="py-2 px-2 text-slate-500">{person.role}</td>
                                    {COMPETENCIES.map(c => {
                                        const raw = skills[c.id] || 0;
                                        const isExpiring = raw < 0;
                                        const level = Math.abs(raw);
                                        return (
                                            <td key={c.id} className="py-1.5 px-1 text-center">
                                                <div className={`inline-flex items-center justify-center w-8 h-8 rounded-lg text-[10px] font-bold transition-all hover:scale-110 cursor-default ${isExpiring ? 'bg-red-500/15 text-red-400 border border-red-500/30 animate-pulse' : LEVEL_COLORS[level]
                                                    }`}>
                                                    {isExpiring && '⚠'}
                                                    {level}
                                                </div>
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
