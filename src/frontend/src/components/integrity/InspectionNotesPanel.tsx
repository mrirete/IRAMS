import React, { useState } from 'react';
import { MessageSquare, Plus, Clock, Shield, Leaf, Eye, FileText, Camera } from 'lucide-react';
import type { InspectionNote, InspectionNoteType } from '../../types/integrity';

const NOTE_TYPE_CONFIG: Record<InspectionNoteType, { label: string; icon: React.ReactNode; bg: string; text: string; border: string; dot: string }> = {
    observation: { label: 'Observation', icon: <Eye size={10} />, bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500' },
    safety: { label: 'Safety', icon: <Shield size={10} />, bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', dot: 'bg-red-500' },
    environmental: { label: 'Environmental', icon: <Leaf size={10} />, bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
    general: { label: 'General', icon: <FileText size={10} />, bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', dot: 'bg-slate-400' },
};

interface InspectionNotesPanelProps {
    notes: InspectionNote[];
    onAdd: (note: Omit<InspectionNote, 'id' | 'created_at'>) => void;
    readonly?: boolean;
    currentUser?: string;
    inspectionId: string;
}

export const InspectionNotesPanel: React.FC<InspectionNotesPanelProps> = ({
    notes, onAdd, readonly, currentUser = 'Current User', inspectionId,
}) => {
    const [newContent, setNewContent] = useState('');
    const [newType, setNewType] = useState<InspectionNoteType>('general');
    const [showInput, setShowInput] = useState(false);

    const sortedNotes = [...notes].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const handleSubmit = () => {
        if (!newContent.trim()) return;
        onAdd({
            inspection_id: inspectionId,
            content: newContent.trim(),
            note_type: newType,
            created_by: currentUser,
        });
        setNewContent('');
        setNewType('general');
        setShowInput(false);
    };

    return (
        <div className="space-y-4">
            {/* Header + Add Button */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="w-1 h-5 rounded-full bg-gradient-to-b from-blue-400 to-cyan-400" />
                    <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Field Notes</h3>
                    <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-medium">{notes.length}</span>
                </div>
                {!readonly && (
                    <button
                        onClick={() => setShowInput(!showInput)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-cyan-700 bg-cyan-50 border border-cyan-200 rounded-lg hover:bg-cyan-100 transition-colors"
                    >
                        <Plus size={12} /> Add Note
                    </button>
                )}
            </div>

            {/* New Note Input */}
            {showInput && !readonly && (
                <div className="bg-white/80 backdrop-blur-sm border border-cyan-200/60 rounded-xl p-4 space-y-3 shadow-sm animate-in slide-in-from-top-2 duration-200">
                    <textarea
                        value={newContent}
                        onChange={e => setNewContent(e.target.value)}
                        placeholder="Record your observation, safety note, or field comment..."
                        className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-cyan-300 focus:border-cyan-400 resize-none transition-all"
                        rows={3}
                        autoFocus
                    />
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <select
                                value={newType}
                                onChange={e => setNewType(e.target.value as InspectionNoteType)}
                                className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-300 transition-all"
                            >
                                <option value="general">General</option>
                                <option value="observation">Observation</option>
                                <option value="safety">Safety</option>
                                <option value="environmental">Environmental</option>
                            </select>
                        </div>
                        <div className="flex items-center gap-2">
                            <button onClick={() => { setShowInput(false); setNewContent(''); }} className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
                                Cancel
                            </button>
                            <button
                                onClick={handleSubmit}
                                disabled={!newContent.trim()}
                                className="px-4 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-cyan-500 to-blue-500 rounded-lg hover:from-cyan-600 hover:to-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
                            >
                                Save Note
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Notes Timeline */}
            {sortedNotes.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
                    <MessageSquare size={28} className="mx-auto text-slate-300 mb-2" />
                    <p className="text-sm text-slate-500 font-medium">No field notes recorded</p>
                    <p className="text-xs text-slate-400 mt-1">Add notes to document observations during the inspection</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {sortedNotes.map((note, idx) => {
                        const cfg = NOTE_TYPE_CONFIG[note.note_type];
                        return (
                            <div key={note.id} className="flex gap-3 group">
                                {/* Timeline dot */}
                                <div className="flex flex-col items-center shrink-0 pt-1">
                                    <div className={`w-2.5 h-2.5 rounded-full ${cfg.dot} ring-2 ring-white shadow-sm`} />
                                    {idx < sortedNotes.length - 1 && (
                                        <div className="w-px flex-1 bg-slate-200 mt-1" />
                                    )}
                                </div>

                                {/* Note Card */}
                                <div className="flex-1 bg-white border border-slate-200 rounded-xl p-3 shadow-sm group-hover:shadow-md transition-all duration-200 mb-1">
                                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-md border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
                                            {cfg.icon} {cfg.label}
                                        </span>
                                        <span className="text-[10px] text-slate-400 font-medium">{note.created_by}</span>
                                        <span className="inline-flex items-center gap-1 text-[10px] text-slate-400 ml-auto">
                                            <Clock size={9} /> {new Date(note.created_at).toLocaleString()}
                                        </span>
                                    </div>
                                    <p className="text-sm text-slate-700 leading-relaxed">{note.content}</p>
                                    {note.media_url && (
                                        <div className="mt-2 w-16 h-16 bg-slate-100 border border-slate-200 rounded-lg flex items-center justify-center">
                                            <Camera size={16} className="text-slate-300" />
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
