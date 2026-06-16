import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, Plus, Edit3, Trash2, X, Check, AlertCircle } from 'lucide-react';
import analyzeService from '../../eam/services/AnalyzeService';

// ── Props ────────────────────────────────────────────────────
interface FMEATabProps {
    fmeaWorksheets: any[];
    onNewFMEA: () => void;
    onRefresh?: () => void;
}

// ── Component ────────────────────────────────────────────────
export const FMEATab: React.FC<FMEATabProps> = ({
    fmeaWorksheets,
    onNewFMEA,
    onRefresh,
}) => {
    const navigate = useNavigate();
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [editStatus, setEditStatus] = useState('');
    const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
    const [saving, setSaving] = useState(false);

    const handleEdit = (ws: any, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingId(ws.id);
        setEditTitle(ws.title || '');
        setEditStatus(ws.status || 'draft');
    };

    const handleSaveEdit = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!editingId) return;
        setSaving(true);
        try {
            await analyzeService.updateFMEAWorksheet(editingId, {
                title: editTitle,
                status: editStatus as any,
            });
            onRefresh?.();
        } catch (err) { console.error('Error updating FMEA:', err); }
        setSaving(false);
        setEditingId(null);
    };

    const handleCancelEdit = (e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingId(null);
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setSaving(true);
        try {
            await analyzeService.deleteFMEAWorksheet(deleteTarget.id);
            onRefresh?.();
        } catch (err) { console.error('Error deleting FMEA:', err); }
        setSaving(false);
        setDeleteTarget(null);
    };

    return (
        <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl shadow-lg">
                <div className="p-5 border-b border-slate-200 flex justify-between items-center">
                    <div className="flex items-center space-x-2">
                        <ShieldAlert className="text-yellow-500" size={20} />
                        <h3 className="text-lg font-semibold text-slate-800">FMEA Worksheets</h3>
                        <span className="text-xs text-slate-500 bg-slate-50 px-2 py-0.5 rounded-full">{fmeaWorksheets.length} studies</span>
                    </div>
                    <button
                        onClick={onNewFMEA}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20 rounded-lg text-xs font-medium transition-colors"
                    >
                        <Plus size={14} /> New FMEA
                    </button>
                </div>
                <div className="p-5">
                    {fmeaWorksheets.length === 0 ? (
                        <div className="text-center py-12">
                            <ShieldAlert className="mx-auto mb-4 text-slate-500 opacity-40" size={40} />
                            <p className="text-sm text-slate-500 mb-4">No FMEA studies created yet.</p>
                            <button
                                onClick={onNewFMEA}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-accent-cyan hover:bg-primary-400 text-brand-900 font-medium rounded-lg text-sm transition-colors"
                            >
                                <Plus size={16} /> Create Your First FMEA Study
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {fmeaWorksheets.map((ws: any) => (
                                <div
                                    key={ws.id}
                                    onClick={() => editingId !== ws.id && navigate(`/analyze/fmea/${ws.id}`)}
                                    className="border border-slate-200 rounded-lg bg-slate-50 p-4 hover:bg-slate-50 transition-colors cursor-pointer group"
                                >
                                    {editingId === ws.id ? (
                                        /* Inline Edit Mode */
                                        <div className="flex items-center gap-3" onClick={e => e.stopPropagation()}>
                                            <input
                                                type="text"
                                                value={editTitle}
                                                onChange={e => setEditTitle(e.target.value)}
                                                className="flex-1 px-3 py-2 border border-primary-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                                                placeholder="Worksheet Title"
                                                autoFocus
                                            />
                                            <select
                                                value={editStatus}
                                                onChange={e => setEditStatus(e.target.value)}
                                                className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
                                            >
                                                <option value="draft">Draft</option>
                                                <option value="active">Active</option>
                                                <option value="review">Review</option>
                                                <option value="closed">Closed</option>
                                            </select>
                                            <button onClick={handleSaveEdit} disabled={saving}
                                                className="p-2 text-primary-600 hover:bg-primary-50 rounded-lg transition-colors">
                                                <Check size={16} />
                                            </button>
                                            <button onClick={handleCancelEdit}
                                                className="p-2 text-slate-400 hover:bg-slate-100 rounded-lg transition-colors">
                                                <X size={16} />
                                            </button>
                                        </div>
                                    ) : (
                                        /* Display Mode */
                                        <div className="flex justify-between items-start">
                                            <div className="flex items-center gap-3">
                                                <div className={`p-2 rounded-md ${ws.status === 'review' ? 'bg-yellow-500/10 text-yellow-500'
                                                    : ws.status === 'approved' ? 'bg-green-500/10 text-green-400'
                                                        : 'bg-slate-50 text-slate-500'
                                                    }`}>
                                                    <ShieldAlert size={20} />
                                                </div>
                                                <div>
                                                    <h4 className="text-slate-800 font-semibold group-hover:text-accent-cyan transition-colors">{ws.title || 'Untitled FMEA'}</h4>
                                                    <p className="text-xs text-slate-500 mt-0.5">
                                                        Type: <span className="uppercase">{ws.fmea_type || 'equipment'}</span>
                                                        {ws.asset_id && <> · Asset: {ws.asset_id}</>}
                                                        · Created: {new Date(ws.created_at).toLocaleDateString()}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {(ws.max_rpn > 0 || ws.high_risk_count > 0) && (
                                                    <div className="flex gap-2 text-xs">
                                                        <span className="px-2 py-0.5 bg-red-500/10 text-red-400 rounded border border-red-500/20 font-mono">
                                                            Max RPN: {ws.max_rpn || 0}
                                                        </span>
                                                        <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 rounded border border-amber-500/20 font-mono">
                                                            High Risk: {ws.high_risk_count || 0}
                                                        </span>
                                                    </div>
                                                )}
                                                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border ${ws.status === 'review' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30'
                                                    : ws.status === 'approved' ? 'bg-green-500/10 text-green-400 border-green-500/30'
                                                        : ws.status === 'draft' ? 'bg-slate-50 text-slate-600 border-slate-300'
                                                            : 'bg-slate-50 text-slate-500 border-slate-300'
                                                    }`}>
                                                    {(ws.status || 'draft').replace('_', ' ')}
                                                </span>
                                                {/* Edit & Delete buttons */}
                                                <button
                                                    onClick={e => handleEdit(ws, e)}
                                                    title="Edit worksheet"
                                                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                                                >
                                                    <Edit3 size={14} />
                                                </button>
                                                <button
                                                    onClick={e => { e.stopPropagation(); setDeleteTarget({ id: ws.id, title: ws.title || 'Untitled' }); }}
                                                    title="Delete worksheet"
                                                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Delete Confirmation Modal */}
            {deleteTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 animate-in zoom-in duration-200">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                                <AlertCircle size={20} className="text-red-600" />
                            </div>
                            <div>
                                <h3 className="text-base font-bold text-slate-800">Delete FMEA Worksheet</h3>
                                <p className="text-xs text-slate-500">This will also delete all items in this worksheet</p>
                            </div>
                        </div>
                        <p className="text-sm text-slate-600 mb-5">
                            Are you sure you want to delete <strong>"{deleteTarget.title}"</strong>?
                        </p>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setDeleteTarget(null)}
                                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                            <button onClick={handleDelete} disabled={saving}
                                className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50">
                                {saving ? 'Deleting...' : 'Delete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default FMEATab;
