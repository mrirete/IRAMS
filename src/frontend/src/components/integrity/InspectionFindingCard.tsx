import React, { useState } from 'react';
import {
    AlertTriangle, Trash2, ChevronDown, ChevronUp, Wrench, Camera,
    Shield, MapPin, Gauge, FileText, MoreVertical, X, Loader2, CheckCircle2
} from 'lucide-react';
import type {
    InspectionFinding, FindingSeverity, FindingStatus,
    DamageMechanism, CML, InspectionType
} from '../../types/integrity';

// ── Severity Config ──
const SEVERITY_CONFIG: Record<FindingSeverity, { label: string; bg: string; text: string; border: string; dot: string }> = {
    critical: { label: 'Critical', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-300', dot: 'bg-red-500' },
    major: { label: 'Major', bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-300', dot: 'bg-orange-500' },
    moderate: { label: 'Moderate', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-300', dot: 'bg-amber-500' },
    minor: { label: 'Minor', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-300', dot: 'bg-emerald-500' },
    observation: { label: 'Observation', bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-300', dot: 'bg-slate-400' },
};

const STATUS_CONFIG: Record<FindingStatus, { label: string; bg: string; text: string }> = {
    open: { label: 'Open', bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700' },
    actioned: { label: 'Actioned', bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700' },
    deferred: { label: 'Deferred', bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700' },
    closed: { label: 'Closed', bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700' },
};

const STATUS_CYCLE: FindingStatus[] = ['open', 'actioned', 'deferred', 'closed'];

const NDE_LABELS: Record<InspectionType, string> = {
    UT: 'Ultrasonic', MFL: 'Mag. Flux', RT: 'Radiographic',
    PT: 'Dye Penetrant', MT: 'Magnetic Particle', VT: 'Visual', PAUT: 'Phased Array UT',
};

interface InspectionFindingCardProps {
    finding: InspectionFinding;
    damageMechanisms: DamageMechanism[];
    cmls: CML[];
    onUpdate: (id: string, updates: Partial<InspectionFinding>) => void;
    onDelete: (id: string) => void;
    onDraftWR?: (finding: InspectionFinding) => Promise<void>;
    readonly?: boolean;
}

export const InspectionFindingCard: React.FC<InspectionFindingCardProps> = ({
    finding, damageMechanisms, cmls, onUpdate, onDelete, onDraftWR, readonly,
}) => {
    const [expanded, setExpanded] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [draftingWR, setDraftingWR] = useState(false);
    const [wrDrafted, setWrDrafted] = useState(false);
    const sev = SEVERITY_CONFIG[finding.severity];
    const stat = STATUS_CONFIG[finding.status];

    const cycleStatus = () => {
        if (readonly) return;
        const idx = STATUS_CYCLE.indexOf(finding.status);
        const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
        onUpdate(finding.id, { status: next });
    };

    const leftBorderColor = finding.severity === 'critical' ? 'border-l-red-500'
        : finding.severity === 'major' ? 'border-l-orange-500'
        : finding.severity === 'moderate' ? 'border-l-amber-500'
        : finding.severity === 'minor' ? 'border-l-emerald-500'
        : 'border-l-slate-400';

    return (
        <div className={`bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-300 border-l-4 ${leftBorderColor}`}>
            {/* Header */}
            <div className="px-4 py-3 flex items-start gap-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
                {/* Sequence Badge */}
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${sev.bg} ${sev.text}`}>
                    #{finding.sequence}
                </div>

                <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-800 font-medium line-clamp-2">{finding.description}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        {/* Severity */}
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-md border ${sev.bg} ${sev.text} ${sev.border}`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${sev.dot}`} />
                            {sev.label}
                        </span>
                        {/* Status */}
                        <button
                            onClick={(e) => { e.stopPropagation(); cycleStatus(); }}
                            className={`px-2 py-0.5 text-[10px] font-bold rounded-md border ${stat.bg} ${stat.text} transition-colors hover:opacity-80`}
                            title={readonly ? stat.label : 'Click to change status'}
                        >
                            {stat.label}
                        </button>
                        {/* NDE Method */}
                        {finding.nde_method && (
                            <span className="px-2 py-0.5 text-[10px] font-medium rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                                {NDE_LABELS[finding.nde_method] || finding.nde_method}
                            </span>
                        )}
                        {/* CML */}
                        {finding.cml_number && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-md bg-cyan-50 text-cyan-700 border border-cyan-200">
                                <MapPin size={9} /> {finding.cml_number}
                            </span>
                        )}
                        {/* Measurement */}
                        {finding.measurement_value != null && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-md bg-blue-50 text-blue-700 border border-blue-200">
                                <Gauge size={9} /> {finding.measurement_value} {finding.measurement_unit || 'mm'}
                            </span>
                        )}
                        {/* Action Required */}
                        {finding.action_required && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-md bg-red-50 text-red-600 border border-red-200 animate-pulse">
                                <AlertTriangle size={9} /> Action Req'd
                            </span>
                        )}
                    </div>
                </div>

                <button className="p-1 text-slate-400 hover:text-slate-600 transition-colors shrink-0">
                    {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
            </div>

            {/* Expanded Content */}
            {expanded && (
                <div className="border-t border-slate-100 px-4 py-4 space-y-4 animate-in slide-in-from-top-2 duration-200">
                    {/* Description */}
                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Description</label>
                        {readonly ? (
                            <p className="text-sm text-slate-700">{finding.description}</p>
                        ) : (
                            <textarea
                                value={finding.description}
                                onChange={e => onUpdate(finding.id, { description: e.target.value })}
                                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-300 focus:border-cyan-400 resize-none transition-all"
                                rows={3}
                            />
                        )}
                    </div>

                    {/* Damage Mechanism + CML Row */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                <Shield size={10} className="inline mr-1" /> Damage Mechanism
                            </label>
                            {readonly ? (
                                <p className="text-sm text-slate-700">{finding.damage_mechanism_name || '—'}</p>
                            ) : (
                                <select
                                    value={finding.damage_mechanism_id || ''}
                                    onChange={e => {
                                        const dm = damageMechanisms.find(d => d.id === e.target.value);
                                        onUpdate(finding.id, {
                                            damage_mechanism_id: e.target.value || undefined,
                                            damage_mechanism_name: dm?.mechanism_name,
                                        });
                                    }}
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-300 transition-all"
                                >
                                    <option value="">— None —</option>
                                    {damageMechanisms.map(dm => (
                                        <option key={dm.id} value={dm.id}>{dm.api_571_code} — {dm.mechanism_name}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                <MapPin size={10} className="inline mr-1" /> CML Reference
                            </label>
                            {readonly ? (
                                <p className="text-sm text-slate-700">{finding.cml_number || '—'}</p>
                            ) : (
                                <select
                                    value={finding.cml_id || ''}
                                    onChange={e => {
                                        const cml = cmls.find(c => c.id === e.target.value);
                                        onUpdate(finding.id, {
                                            cml_id: e.target.value || undefined,
                                            cml_number: cml?.cml_number,
                                        });
                                    }}
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-300 transition-all"
                                >
                                    <option value="">— None —</option>
                                    {cmls.map(c => (
                                        <option key={c.id} value={c.id}>{c.cml_number} ({c.component_type})</option>
                                    ))}
                                </select>
                            )}
                        </div>
                    </div>

                    {/* Measurement (only when CML selected) */}
                    {finding.cml_id && (
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                    <Gauge size={10} className="inline mr-1" /> Measurement
                                </label>
                                {readonly ? (
                                    <p className="text-sm text-slate-700">{finding.measurement_value ?? '—'} {finding.measurement_unit || 'mm'}</p>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number" step="0.01" min="0"
                                            value={finding.measurement_value ?? ''}
                                            onChange={e => onUpdate(finding.id, { measurement_value: parseFloat(e.target.value) || undefined })}
                                            placeholder="0.00"
                                            className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-300 transition-all"
                                        />
                                        <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-2 rounded-lg border border-slate-200">
                                            {finding.measurement_unit || 'mm'}
                                        </span>
                                    </div>
                                )}
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Unit</label>
                                {readonly ? null : (
                                    <select
                                        value={finding.measurement_unit || 'mm'}
                                        onChange={e => onUpdate(finding.id, { measurement_unit: e.target.value })}
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-300 transition-all"
                                    >
                                        <option value="mm">mm</option>
                                        <option value="mils">mils</option>
                                        <option value="inches">inches</option>
                                    </select>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Recommendation */}
                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                            <FileText size={10} className="inline mr-1" /> Recommendation
                        </label>
                        {readonly ? (
                            <p className="text-sm text-slate-700">{finding.recommendation || '—'}</p>
                        ) : (
                            <textarea
                                value={finding.recommendation || ''}
                                onChange={e => onUpdate(finding.id, { recommendation: e.target.value })}
                                placeholder="Technical recommendation for remediation..."
                                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-cyan-300 resize-none transition-all"
                                rows={2}
                            />
                        )}
                    </div>

                    {/* Media */}
                    {finding.media_urls.length > 0 && (
                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                <Camera size={10} className="inline mr-1" /> Evidence Photos ({finding.media_urls.length})
                            </label>
                            <div className="flex gap-2 overflow-x-auto pb-2">
                                {finding.media_urls.map((url, i) => (
                                    <div key={i} className="w-20 h-20 bg-slate-100 border border-slate-200 rounded-lg flex items-center justify-center shrink-0">
                                        <Camera size={20} className="text-slate-300" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Action Bar */}
                    {!readonly && (
                        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                            <div className="flex items-center gap-2">
                                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={finding.action_required || false}
                                        onChange={e => onUpdate(finding.id, { action_required: e.target.checked })}
                                        className="w-4 h-4 rounded border-slate-300 text-red-500 focus:ring-red-300"
                                    />
                                    Action Required
                                </label>
                                {finding.action_required && (
                                    <button
                                        onClick={async () => {
                                            if (!onDraftWR || draftingWR || wrDrafted) return;
                                            setDraftingWR(true);
                                            try {
                                                await onDraftWR(finding);
                                                setWrDrafted(true);
                                                onUpdate(finding.id, { status: 'actioned' });
                                                setTimeout(() => setWrDrafted(false), 3000);
                                            } catch { /* handled upstream */ }
                                            setDraftingWR(false);
                                        }}
                                        disabled={draftingWR || wrDrafted || !onDraftWR}
                                        className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold rounded-lg border transition-all ${wrDrafted ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100'} disabled:opacity-50`}
                                    >
                                        {draftingWR ? <><Loader2 size={11} className="animate-spin" /> Drafting…</>
                                            : wrDrafted ? <><CheckCircle2 size={11} /> WR Drafted</>
                                            : <><Wrench size={11} /> Draft WR</>}
                                    </button>
                                )}
                            </div>

                            {confirmDelete ? (
                                <div className="flex items-center gap-2">
                                    <span className="text-[11px] text-red-600 font-medium">Delete finding?</span>
                                    <button onClick={() => onDelete(finding.id)} className="px-2 py-1 text-[11px] font-bold text-white bg-red-500 rounded-md hover:bg-red-600 transition-colors">Yes</button>
                                    <button onClick={() => setConfirmDelete(false)} className="px-2 py-1 text-[11px] font-medium text-slate-500 bg-slate-100 rounded-md hover:bg-slate-200 transition-colors">No</button>
                                </div>
                            ) : (
                                <button onClick={() => setConfirmDelete(true)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Delete finding">
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>
                    )}

                    {/* Metadata footer */}
                    <div className="flex items-center gap-3 text-[10px] text-slate-400 pt-1">
                        <span>By {finding.created_by}</span>
                        <span>•</span>
                        <span>{new Date(finding.created_at).toLocaleString()}</span>
                    </div>
                </div>
            )}
        </div>
    );
};
