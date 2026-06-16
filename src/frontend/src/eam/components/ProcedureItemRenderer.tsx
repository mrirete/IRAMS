import React from 'react';
import { InstructionBlock } from '../types';
import {
    CheckSquare, Square, Camera, PenTool, AlertTriangle, AlertOctagon,
    CheckCircle, XCircle, Activity, Lock, Link as LinkIcon,
    Image as ImageIcon, ExternalLink
} from 'lucide-react';

interface ProcedureItemRendererProps {
    block: InstructionBlock;
    onChange: (updates: Partial<InstructionBlock>) => void;
    readOnly?: boolean;
}

export const ProcedureItemRenderer: React.FC<ProcedureItemRendererProps> = ({ block, onChange, readOnly }) => {

    // Helper: Condition Reading Validation
    const handleConditionChange = (val: number) => {
        const isOOS = (block.minValue !== undefined && val < block.minValue) ||
            (block.maxValue !== undefined && val > block.maxValue);
        onChange({ valueNumber: val, isOutOfSpec: isOOS });
    };

    // Border color logic
    const getBorderColor = () => {
        if (block.passFail === 'FAIL' || block.isOutOfSpec) return 'border-red-500';
        if (block.passFail === 'FLAG') return 'border-amber-500';
        if (block.passFail === 'PASS' || block.valueBoolean) return 'border-green-500';
        if (block.type === 'HEADING') return 'border-blue-400';
        if (block.type === 'ISOLATION_CHECK') return 'border-red-300';
        if (block.type === 'SIGNATURE') return 'border-blue-300';
        return 'border-slate-300';
    };

    // Heading renders differently
    if (block.type === 'HEADING') {
        return (
            <div className="border-l-4 border-blue-400 pl-3 py-2 mb-1 mt-4">
                <h3 className="font-bold text-slate-800 text-base">{block.label}</h3>
            </div>
        );
    }

    // Section break
    if (block.type === 'SECTION') {
        return (
            <div className="py-2 my-2">
                <div className="h-px bg-slate-200 w-full" />
                {block.label && <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider text-center mt-1">{block.label}</p>}
            </div>
        );
    }

    return (
        <div className={`border-l-4 p-4 rounded-r-lg bg-white mb-3 shadow-sm ${getBorderColor()}`}>
            {/* Label */}
            <h4 className="font-semibold text-slate-800 text-sm mb-2 flex flex-col gap-1">
                <div className="flex items-start gap-2">
                    <span className="mt-0.5">{block.label}</span>
                    {block.required && <span className="text-red-500 text-xs font-normal bg-red-50 px-1.5 py-0.5 rounded">*Required</span>}
                </div>

                {/* P-F Interval Warning */}
                {block.passFail === 'FLAG' && (
                    <div className="flex items-center gap-2 text-xs font-bold text-amber-600 bg-amber-50 p-1.5 rounded border border-amber-100 w-fit">
                        <Activity size={12} />
                        <span>Potential Failure Detected (Start of P-F Interval) - Monitor closely</span>
                    </div>
                )}
            </h4>

            {/* Media / Reference Materials */}
            {block.media && block.media.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                    {block.media.map(m => (
                        <a
                            key={m.id}
                            href={m.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 bg-slate-50 hover:bg-slate-100 px-3 py-1.5 rounded border border-slate-200 text-xs text-blue-600 transition-colors"
                        >
                            {m.type === 'IMAGE' ? <ImageIcon size={14} /> : <LinkIcon size={14} />}
                            <span className="truncate max-w-[200px]">{m.label || 'Reference Material'}</span>
                            <ExternalLink size={10} className="opacity-50" />
                        </a>
                    ))}
                </div>
            )}

            {/* Inputs based on Type */}
            <div className="space-y-3">

                {/* CHECKBOX */}
                {block.type === 'CHECKBOX' && (
                    <button
                        className={`flex items-center gap-3 w-full p-3 rounded-lg border transition-all text-left ${block.valueBoolean ? 'bg-green-50 border-green-200 text-green-800' : 'bg-slate-50 border-slate-200 hover:border-blue-300'}`}
                        onClick={() => onChange({ valueBoolean: !block.valueBoolean })}
                        disabled={readOnly}
                    >
                        {block.valueBoolean ? <CheckSquare className="text-green-600" /> : <Square className="text-slate-400" />}
                        <span className="font-medium">{block.valueBoolean ? 'Completed' : 'Mark as Complete'}</span>
                    </button>
                )}

                {/* TEXT */}
                {block.type === 'TEXT' && (
                    <textarea
                        className="w-full border border-slate-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-primary-500"
                        placeholder="Enter observations..."
                        value={block.valueString || ''}
                        onChange={(e) => onChange({ valueString: e.target.value })}
                        disabled={readOnly}
                        rows={3}
                    />
                )}

                {/* NUMBER */}
                {block.type === 'NUMBER' && (
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            className="flex-1 border border-slate-300 rounded-lg p-3 text-sm font-mono focus:ring-2 focus:ring-primary-500"
                            placeholder="Enter value..."
                            value={block.valueNumber ?? ''}
                            onChange={(e) => onChange({ valueNumber: parseFloat(e.target.value) })}
                            disabled={readOnly}
                        />
                        {block.uom && <span className="text-sm font-medium text-slate-500">{block.uom}</span>}
                    </div>
                )}

                {/* DATE */}
                {block.type === 'DATE' && (
                    <input
                        type="date"
                        className="w-full border border-slate-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-primary-500"
                        value={block.valueDate || ''}
                        onChange={(e) => onChange({ valueDate: e.target.value })}
                        disabled={readOnly}
                    />
                )}

                {/* PASS_FAIL (Inspection) — equal-width buttons */}
                {block.type === 'PASS_FAIL' && (
                    <>
                        <div className="grid grid-cols-3 gap-2">
                            <button
                                disabled={readOnly}
                                onClick={() => onChange({ passFail: 'PASS', failNotes: '' })}
                                className={`py-3 rounded-lg font-bold flex items-center justify-center gap-2 transition-all ${block.passFail === 'PASS'
                                    ? 'bg-green-600 text-white shadow-md'
                                    : 'bg-slate-100 text-slate-500 hover:bg-green-50 hover:text-green-600'
                                    }`}
                            >
                                <CheckCircle size={18} /> Pass
                            </button>
                            <button
                                disabled={readOnly}
                                onClick={() => onChange({ passFail: 'FAIL' })}
                                className={`py-3 rounded-lg font-bold flex items-center justify-center gap-2 transition-all ${block.passFail === 'FAIL'
                                    ? 'bg-red-600 text-white shadow-md'
                                    : 'bg-slate-100 text-slate-500 hover:bg-red-50 hover:text-red-600'
                                    }`}
                            >
                                <XCircle size={18} /> Fail
                            </button>
                            <button
                                disabled={readOnly}
                                onClick={() => onChange({ passFail: 'FLAG' })}
                                className={`py-3 rounded-lg font-bold flex items-center justify-center gap-2 transition-all ${block.passFail === 'FLAG'
                                    ? 'bg-amber-500 text-white shadow-md'
                                    : 'bg-slate-100 text-slate-500 hover:bg-amber-50 hover:text-amber-600'
                                    }`}
                            >
                                <AlertTriangle size={18} /> Flag
                            </button>
                        </div>
                        {/* Mandatory Notes on Fail/Flag */}
                        {(block.passFail === 'FAIL' || block.passFail === 'FLAG') && (
                            <div className="animate-in fade-in slide-in-from-top-2">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                                    {block.passFail === 'FAIL' ? 'Failure Reason & Remedy (Required)' : 'Flag Notes (Potential Failure Symptoms)'}
                                </label>
                                <textarea
                                    className={`w-full border rounded-lg p-2 text-sm focus:ring-2 ${block.passFail === 'FAIL' ? 'border-red-200 bg-red-50 focus:ring-red-500' : 'border-amber-200 bg-amber-50 focus:ring-amber-500'}`}
                                    placeholder={block.passFail === 'FAIL' ? "Describe the functional failure and corrective action..." : "Describe observable symptoms..."}
                                    value={block.failNotes || ''}
                                    onChange={(e) => onChange({ failNotes: e.target.value })}
                                    disabled={readOnly}
                                />
                            </div>
                        )}
                    </>
                )}

                {/* YES_NO_NA */}
                {block.type === 'YES_NO_NA' && (
                    <div className="grid grid-cols-3 gap-2">
                        {(['YES', 'NO', 'NA'] as const).map((opt) => (
                            <button
                                key={opt}
                                disabled={readOnly}
                                onClick={() => onChange({ yesNoNa: opt })}
                                className={`py-3 rounded-lg font-bold text-sm flex items-center justify-center transition-all ${block.yesNoNa === opt
                                    ? (opt === 'YES' ? 'bg-green-600 text-white shadow-md' : opt === 'NO' ? 'bg-red-600 text-white shadow-md' : 'bg-slate-600 text-white shadow-md')
                                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                                    }`}
                            >
                                {opt === 'NA' ? 'N/A' : opt}
                            </button>
                        ))}
                    </div>
                )}

                {/* CONDITION_READING */}
                {block.type === 'CONDITION_READING' && (
                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            <input
                                type="number"
                                className={`flex-1 border-2 rounded-lg p-3 text-lg font-mono font-bold focus:ring-2 focus:ring-primary-500 ${block.isOutOfSpec ? 'border-red-300 bg-red-50 text-red-900' : 'border-slate-300'}`}
                                placeholder="0.00"
                                value={block.valueNumber ?? ''}
                                onChange={(e) => handleConditionChange(parseFloat(e.target.value))}
                                disabled={readOnly}
                            />
                            <span className="font-bold text-slate-500">{block.uom}</span>
                        </div>

                        {/* Tolerance Display */}
                        <div className="flex justify-between text-xs text-slate-400 font-mono px-1">
                            <span>Min: {block.minValue ?? '-'}</span>
                            <span>Target: {block.targetValue ?? '-'}</span>
                            <span>Max: {block.maxValue ?? '-'}</span>
                        </div>

                        {block.isOutOfSpec && (
                            <div className="mt-2 text-xs font-bold text-red-600 flex items-center gap-1">
                                <AlertOctagon size={12} /> Reading is Out of Spec - Create Corrective Work Order
                            </div>
                        )}
                    </div>
                )}

                {/* METER_READING */}
                {block.type === 'METER_READING' && (
                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            <input
                                type="number"
                                className="flex-1 border-2 rounded-lg p-3 text-lg font-mono font-bold focus:ring-2 focus:ring-primary-500 border-slate-300"
                                placeholder="Current reading"
                                value={block.valueNumber ?? ''}
                                onChange={(e) => onChange({ valueNumber: parseFloat(e.target.value) })}
                                disabled={readOnly}
                            />
                            <span className="font-bold text-slate-500">{block.meterUom || 'hrs'}</span>
                        </div>
                        {block.previousReading !== undefined && (
                            <div className="flex justify-between text-xs text-slate-400 px-1">
                                <span>Previous: {block.previousReading}</span>
                                {block.valueNumber !== undefined && (
                                    <span className="font-semibold text-blue-600">
                                        Delta: +{(block.valueNumber - block.previousReading).toFixed(1)}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* CHECKLIST */}
                {block.type === 'CHECKLIST' && (
                    <div className="space-y-2">
                        {(block.checklistItems || []).map((item, idx) => (
                            <label key={item.id} className="flex items-center gap-3 p-2 rounded hover:bg-slate-50 cursor-pointer border border-transparent hover:border-slate-200">
                                <input
                                    type="checkbox"
                                    className="rounded p-2 text-blue-600 focus:ring-primary-500 w-5 h-5 border-slate-300"
                                    checked={item.checked}
                                    onChange={(e) => {
                                        const newItems = [...(block.checklistItems || [])];
                                        newItems[idx].checked = e.target.checked;
                                        onChange({ checklistItems: newItems });
                                    }}
                                    disabled={readOnly}
                                />
                                <span className={`text-sm ${item.checked ? 'text-slate-500 line-through' : 'text-slate-700'}`}>
                                    {item.label}
                                </span>
                            </label>
                        ))}
                    </div>
                )}

                {/* PROCEDURE (step-by-step) */}
                {block.type === 'PROCEDURE' && (
                    <div className="space-y-2">
                        {(block.procedureSteps || []).map((step, idx) => (
                            <label key={step.id} className="flex items-start gap-3 p-2 rounded hover:bg-slate-50 cursor-pointer border border-transparent hover:border-slate-200">
                                <input
                                    type="checkbox"
                                    className="rounded text-blue-600 focus:ring-primary-500 w-5 h-5 border-slate-300 mt-0.5"
                                    checked={step.completed}
                                    onChange={(e) => {
                                        const newSteps = [...(block.procedureSteps || [])];
                                        newSteps[idx].completed = e.target.checked;
                                        onChange({ procedureSteps: newSteps });
                                    }}
                                    disabled={readOnly}
                                />
                                <div className="flex-1">
                                    <span className={`text-sm ${step.completed ? 'text-slate-500 line-through' : 'text-slate-700'}`}>
                                        <span className="font-mono text-xs text-slate-400 mr-1">{idx + 1}.</span>
                                        {step.text}
                                    </span>
                                </div>
                            </label>
                        ))}
                    </div>
                )}

                {/* PHOTO */}
                {block.type === 'PHOTO' && (
                    <div>
                        {block.photoUrls && block.photoUrls.length > 0 ? (
                            <div className="grid grid-cols-3 gap-2 mb-2">
                                {block.photoUrls.map((url, idx) => (
                                    <div key={idx} className="aspect-square bg-slate-100 rounded-lg border border-slate-200 flex items-center justify-center overflow-hidden">
                                        <img src={url} alt={`Evidence ${idx + 1}`} className="object-cover w-full h-full" />
                                    </div>
                                ))}
                            </div>
                        ) : null}
                        {!readOnly && (
                            <button
                                className="w-full p-4 border-2 border-dashed border-slate-300 rounded-lg flex flex-col items-center gap-2 hover:bg-slate-50 hover:border-blue-300 transition-colors"
                                onClick={() => {
                                    const url = prompt('Enter photo/file URL:');
                                    if (url) onChange({ photoUrls: [...(block.photoUrls || []), url] });
                                }}
                            >
                                <Camera size={20} className="text-slate-400" />
                                <span className="text-xs text-slate-500 font-medium">Capture Photo / Upload File</span>
                            </button>
                        )}
                    </div>
                )}

                {/* SIGNATURE */}
                {block.type === 'SIGNATURE' && (
                    <div>
                        {block.signedBy ? (
                            <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
                                <PenTool size={18} className="text-green-600" />
                                <div>
                                    <p className="text-sm font-semibold text-green-800">Signed</p>
                                    <p className="text-xs text-green-600">{block.signatureRole && `${block.signatureRole} - `}{block.signedAt ? new Date(block.signedAt).toLocaleString() : ''}</p>
                                </div>
                            </div>
                        ) : (
                            <button
                                disabled={readOnly}
                                onClick={() => onChange({ signedBy: 'current-user', signedAt: new Date().toISOString() })}
                                className="w-full p-4 border-2 border-dashed border-blue-300 rounded-lg flex flex-col items-center gap-2 hover:bg-blue-50 transition-colors"
                            >
                                <PenTool size={20} className="text-blue-400" />
                                <span className="text-xs text-blue-600 font-medium">
                                    {block.signatureRole ? `Sign as ${block.signatureRole}` : 'Apply Digital Signature'}
                                </span>
                            </button>
                        )}
                    </div>
                )}

                {/* ISOLATION_CHECK (LOTO) */}
                {block.type === 'ISOLATION_CHECK' && (
                    <div className="space-y-2">
                        <div className="flex items-center gap-3 p-2 bg-red-50 border border-red-100 rounded-lg">
                            <Lock size={16} className="text-red-500" />
                            <div className="flex-1 text-xs">
                                {block.energyType && <span className="font-bold text-red-700 uppercase">{block.energyType}</span>}
                                {block.lockNumber && <span className="ml-2 text-red-600">Lock #{block.lockNumber}</span>}
                            </div>
                        </div>
                        <button
                            disabled={readOnly}
                            onClick={() => onChange({ isolationVerified: !block.isolationVerified })}
                            className={`w-full py-3 rounded-lg font-bold flex items-center justify-center gap-2 transition-all ${block.isolationVerified
                                ? 'bg-green-600 text-white shadow-md'
                                : 'bg-red-100 text-red-700 hover:bg-red-200 border border-red-300'
                                }`}
                        >
                            {block.isolationVerified ? <CheckCircle size={18} /> : <Lock size={18} />}
                            {block.isolationVerified ? 'Isolation Verified' : 'Verify Isolation'}
                        </button>
                    </div>
                )}

            </div>
        </div>
    );
};
