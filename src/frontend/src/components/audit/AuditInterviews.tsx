/**
 * AuditInterviews.tsx — Step 4: Interviews
 *
 * Structured interview register to cross-validate that the
 * documented AMS works in practice. Tracks department coverage
 * and captures key findings per interviewee.
 *
 * Standards: ISO 55001 §9.2 (Internal audit), ISO 55012 (People competence)
 */

import React, { useState, useMemo } from 'react';
import { MessageSquare, Plus, ArrowRight, ArrowLeft, Trash2, ChevronDown, ChevronUp, Users } from 'lucide-react';
import type { InterviewRecord } from '../../eam/services/AuditTypes';
import { INTERVIEW_DEPARTMENTS } from '../../eam/services/AuditTypes';

interface Props {
    initialData?: InterviewRecord[];
    onComplete: (data: InterviewRecord[]) => void;
    onBack: () => void;
}

function makeId() { return crypto.randomUUID?.() || Math.random().toString(36).substring(2); }

const EMPTY_RECORD: Omit<InterviewRecord, 'id'> = {
    name: '', role: '', department: 'Operations', keyFindings: '', notes: '',
};

export const AuditInterviews: React.FC<Props> = ({ initialData, onComplete, onBack }) => {
    const [records, setRecords] = useState<InterviewRecord[]>(initialData?.length ? initialData : []);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    // Department coverage tracking
    const coveredDepts = useMemo(() => {
        const set = new Set<string>();
        records.forEach(r => set.add(r.department));
        return set;
    }, [records]);

    const addRecord = () => {
        const newRec: InterviewRecord = { id: makeId(), ...EMPTY_RECORD };
        setRecords(prev => [...prev, newRec]);
        setExpandedId(newRec.id);
    };

    const removeRecord = (id: string) => {
        setRecords(prev => prev.filter(r => r.id !== id));
        if (expandedId === id) setExpandedId(null);
    };

    const updateRecord = (id: string, patch: Partial<InterviewRecord>) => {
        setRecords(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
    };

    return (
        <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
            {/* Header */}
            <div className="text-center mb-2">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-green-500/20">
                    <MessageSquare size={24} className="text-white" />
                </div>
                <h2 className="text-2xl font-black text-slate-800">Step 4 — Interviews</h2>
                <p className="text-sm text-slate-500 mt-1">Structured interview register — validate the system works in practice</p>
            </div>

            {/* Department Coverage */}
            <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
                <div className="flex items-center gap-2 mb-3">
                    <Users size={14} className="text-green-500" />
                    <span className="text-xs font-bold text-slate-600 uppercase">Department Coverage</span>
                    <span className="text-[10px] text-slate-400 ml-auto">
                        {coveredDepts.size} of {INTERVIEW_DEPARTMENTS.length} departments
                    </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {INTERVIEW_DEPARTMENTS.map(dept => (
                        <span
                            key={dept}
                            className={`text-[10px] font-bold px-2 py-1 rounded-md border transition-all ${
                                coveredDepts.has(dept)
                                    ? 'bg-green-50 border-green-200 text-green-700'
                                    : 'bg-slate-50 border-slate-200 text-slate-400'
                            }`}
                        >
                            {dept}
                        </span>
                    ))}
                </div>
            </div>

            {/* Interview Records */}
            {records.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-2xl px-8 py-12 text-center">
                    <MessageSquare size={32} className="text-slate-300 mx-auto mb-3" />
                    <p className="text-sm text-slate-500">No interviews recorded yet.</p>
                    <p className="text-xs text-slate-400 mt-1">Add interviews to validate the AMS operates in practice, not just on paper.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {records.map((rec, idx) => {
                        const isExpanded = expandedId === rec.id;
                        return (
                            <div key={rec.id} className={`bg-white border rounded-xl overflow-hidden transition-all ${isExpanded ? 'border-green-300 shadow-md' : 'border-slate-200'}`}>
                                {/* Collapsed header */}
                                <button
                                    onClick={() => setExpandedId(isExpanded ? null : rec.id)}
                                    className="w-full px-5 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors"
                                >
                                    <div className="flex items-center gap-3">
                                        <span className="w-7 h-7 rounded-lg bg-green-50 text-green-600 flex items-center justify-center text-xs font-bold">
                                            {idx + 1}
                                        </span>
                                        <div className="text-left">
                                            <p className="text-sm font-medium text-slate-700">
                                                {rec.name || <span className="text-slate-400 italic">Unnamed interviewee</span>}
                                            </p>
                                            <p className="text-[10px] text-slate-400">
                                                {rec.role && `${rec.role} · `}{rec.department}
                                            </p>
                                        </div>
                                    </div>
                                    {isExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                                </button>

                                {/* Expanded form */}
                                {isExpanded && (
                                    <div className="px-5 pb-5 border-t border-slate-100 pt-4 space-y-3">
                                        <div className="grid grid-cols-3 gap-3">
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Name</label>
                                                <input
                                                    value={rec.name}
                                                    onChange={e => updateRecord(rec.id, { name: e.target.value })}
                                                    placeholder="Full name"
                                                    className="input-field text-sm"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Role / Position</label>
                                                <input
                                                    value={rec.role}
                                                    onChange={e => updateRecord(rec.id, { role: e.target.value })}
                                                    placeholder="e.g., Shift Supervisor"
                                                    className="input-field text-sm"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Department</label>
                                                <select
                                                    value={rec.department}
                                                    onChange={e => updateRecord(rec.id, { department: e.target.value })}
                                                    className="input-field text-sm"
                                                >
                                                    {INTERVIEW_DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Key Findings</label>
                                            <textarea
                                                value={rec.keyFindings}
                                                onChange={e => updateRecord(rec.id, { keyFindings: e.target.value })}
                                                placeholder="Summarize key findings from this interview — what works, what doesn't, what's missing?"
                                                rows={3}
                                                className="input-field text-sm resize-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Additional Notes</label>
                                            <textarea
                                                value={rec.notes}
                                                onChange={e => updateRecord(rec.id, { notes: e.target.value })}
                                                placeholder="Body language, confidence level, contradictions observed..."
                                                rows={2}
                                                className="input-field text-sm resize-none"
                                            />
                                        </div>
                                        <div className="flex justify-end">
                                            <button
                                                onClick={() => removeRecord(rec.id)}
                                                className="text-xs text-red-400 hover:text-red-600 flex items-center gap-1 transition-colors"
                                            >
                                                <Trash2 size={12} /> Remove Interview
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Add Interview Button */}
            <button
                onClick={addRecord}
                className="w-full py-3 border border-dashed border-green-300 rounded-xl text-green-600 font-bold text-sm hover:bg-green-50 transition-colors flex items-center justify-center gap-2"
            >
                <Plus size={16} /> Add Interview
            </button>

            {/* Navigation */}
            <div className="flex justify-between pt-2">
                <button onClick={onBack} className="px-5 py-3 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 flex items-center gap-2">
                    <ArrowLeft size={16} /> Back
                </button>
                <button
                    onClick={() => onComplete(records)}
                    className="px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-2"
                >
                    Proceed to 6M Assessment <ArrowRight size={16} />
                </button>
            </div>
        </div>
    );
};
