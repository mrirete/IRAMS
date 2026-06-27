import React from 'react';
import { InstructionBlock, InstructionBlockType, ProcedureMedia } from '../types';
import {
    Type, CheckSquare, Hash, Calendar, Camera, PenTool, Activity, Gauge,
    AlertTriangle, Lock, Trash2, ListChecks, HelpCircle, Link as LinkIcon,
    Image as ImageIcon, MoreVertical, CheckCircle, XCircle, Plus,
    ClipboardCheck, FileText, X, Copy
} from 'lucide-react';

interface ProcedureItemEditorProps {
    block: InstructionBlock;
    onChange: (updates: Partial<InstructionBlock>) => void;
    onDelete: () => void;
    onDuplicate?: () => void;
    onAddSibling?: () => void;
}

/** Collapsible observation field — hidden until technician clicks to add */
const TextObservationField: React.FC<{ value: string; onChange: (val: string) => void }> = ({ value, onChange }) => {
    const [isOpen, setIsOpen] = React.useState(!!value);
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);

    React.useEffect(() => {
        if (isOpen && textareaRef.current && !value) {
            textareaRef.current.focus();
        }
    }, [isOpen]);

    // Remove ONLY the observation — the instruction block itself stays.
    const removeObservation = () => { onChange(''); setIsOpen(false); };

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="mt-2 w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-400 hover:text-amber-600 border border-dashed border-slate-200 hover:border-amber-300 rounded-lg bg-slate-50/50 hover:bg-amber-50/50 transition-all"
            >
                <PenTool size={12} />
                Add observation / note…
            </button>
        );
    }

    // Distinct, clearly-labelled secondary note so it's never confused with the
    // instruction above it — and removable on its own.
    return (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/40 p-2">
            <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wide text-amber-700 flex items-center gap-1">
                    <PenTool size={10} /> Observation
                </span>
                <button
                    onClick={removeObservation}
                    title="Remove this observation (keeps the instruction)"
                    className="text-[10px] text-slate-400 hover:text-red-500 flex items-center gap-0.5"
                >
                    <X size={11} /> Remove
                </button>
            </div>
            <textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="Operator note / observation recorded during the job…"
                className="w-full min-h-[80px] border border-amber-200 rounded-lg bg-white text-slate-700 text-sm p-3 resize-y focus:ring-1 focus:ring-amber-400 focus:border-amber-400"
                rows={3}
            />
        </div>
    );
};

export const ProcedureItemEditor: React.FC<ProcedureItemEditorProps> = ({ block, onChange, onDelete, onDuplicate, onAddSibling }) => {
    const [showMenu, setShowMenu] = React.useState(false);

    const getIcon = () => {
        switch (block.type) {
            case 'HEADING': return <Type size={14} />;
            case 'TEXT': return <FileText size={14} />;
            case 'CHECKBOX': return <CheckSquare size={14} />;
            case 'NUMBER': return <Hash size={14} />;
            case 'DATE': return <Calendar size={14} />;
            case 'PHOTO': return <Camera size={14} />;
            case 'SIGNATURE': return <PenTool size={14} />;
            case 'CONDITION_READING': return <Activity size={14} />;
            case 'METER_READING': return <Gauge size={14} />;
            case 'PASS_FAIL': return <AlertTriangle size={14} />;
            case 'ISOLATION_CHECK': return <Lock size={14} />;
            case 'CHECKLIST': return <ListChecks size={14} />;
            case 'PROCEDURE': return <ClipboardCheck size={14} />;
            case 'YES_NO_NA': return <HelpCircle size={14} />;
            default: return <CheckSquare size={14} />;
        }
    };

    const getTypeLabel = (type: InstructionBlockType) => {
        const labels: Record<string, string> = {
            'HEADING': 'Heading',
            'SECTION': 'Section',
            'PROCEDURE': 'Procedure',
            'CHECKBOX': 'Checkbox',
            'TEXT': 'Text Note',
            'NUMBER': 'Number',
            'DATE': 'Date',
            'PHOTO': 'Photo / File',
            'SIGNATURE': 'Signature',
            'CHECKLIST': 'Checklist',
            'YES_NO_NA': 'Yes / No / N/A',
            'PASS_FAIL': 'Inspection',
            'METER_READING': 'Meter Reading',
            'CONDITION_READING': 'Condition Reading',
            'ISOLATION_CHECK': 'LOTO Check',
        };
        return labels[type] || type.replace(/_/g, ' ');
    };

    const handleAddMedia = (type: 'LINK' | 'IMAGE') => {
        const url = prompt(type === 'LINK' ? 'Enter URL:' : 'Enter Image URL:');
        if (!url) return;

        const newMedia: ProcedureMedia = {
            id: Math.random().toString(36).substr(2, 9),
            type,
            url,
            label: type === 'LINK' ? 'Reference Link' : 'Reference Image'
        };

        onChange({ media: [...(block.media || []), newMedia] });
    };

    const removeMedia = (mediaId: string) => {
        onChange({ media: (block.media || []).filter(m => m.id !== mediaId) });
    };

    // ─── CONTROL PREVIEW (WYSIWYG) ────────────────────────────────────────────────
    const renderControlPreview = () => {
        switch (block.type) {
            case 'HEADING':
                return null; // Heading is just the label, rendered large via styling below

            case 'PASS_FAIL':
                return (
                    <div className="flex gap-2 mt-2">
                        {['PASS', 'FAIL', 'FLAG'].map(option => (
                            <div
                                key={option}
                                onClick={() => onChange({ passFail: option as any })}
                                className={`flex-1 py-2 rounded border flex items-center justify-center gap-1 text-xs font-bold cursor-pointer transition-colors ${block.passFail === option
                                    ? (option === 'PASS' ? 'border-green-600 bg-green-600 text-white' :
                                        option === 'FAIL' ? 'border-red-600 bg-red-600 text-white' :
                                            'border-amber-500 bg-amber-500 text-white')
                                    : (option === 'PASS' ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100' :
                                        option === 'FAIL' ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100' :
                                            'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100')
                                    }`}
                            >
                                {option === 'PASS' && <CheckCircle size={14} />}
                                {option === 'FAIL' && <XCircle size={14} />}
                                {option === 'FLAG' && <AlertTriangle size={14} />}
                                {option.charAt(0) + option.slice(1).toLowerCase()}
                            </div>
                        ))}
                    </div>
                );

            case 'CHECKBOX':
                return (
                    <div className="mt-2 p-2 border border-slate-200 rounded flex items-center gap-2 bg-slate-50 text-slate-400 text-sm">
                        <CheckSquare size={16} />
                        <span>Mark as Complete</span>
                    </div>
                );

            case 'TEXT':
                return (
                    <TextObservationField
                        value={block.valueString || ''}
                        onChange={(val) => onChange({ valueString: val })}
                    />
                );

            case 'NUMBER':
                return (
                    <div className="mt-2 flex items-center gap-2 opacity-70 pointer-events-none">
                        <div className="flex-1 p-2 border rounded bg-white text-slate-400 text-sm font-mono text-right">
                            0.00
                        </div>
                    </div>
                );

            case 'DATE':
                return (
                    <div className="mt-2 opacity-70 pointer-events-none">
                        <div className="p-2 border rounded bg-white text-slate-400 text-sm flex items-center gap-2">
                            <Calendar size={14} />
                            <span>Select date...</span>
                        </div>
                    </div>
                );

            case 'YES_NO_NA':
                return (
                    <div className="flex gap-2 mt-2 opacity-80 pointer-events-none">
                        {['Yes', 'No', 'N/A'].map(opt => (
                            <div key={opt} className="flex-1 py-1.5 border rounded text-center text-xs text-slate-500 bg-slate-50">
                                {opt}
                            </div>
                        ))}
                    </div>
                );

            case 'CONDITION_READING':
                return (
                    <div className="mt-2 flex items-center gap-2 opacity-70 pointer-events-none">
                        <div className="flex-1 p-2 border rounded bg-white text-slate-400 text-sm font-mono text-center">
                            0.00
                        </div>
                        <span className="font-bold text-slate-400 text-xs">{block.uom || 'UOM'}</span>
                    </div>
                );

            case 'METER_READING':
                return (
                    <div className="mt-2 flex items-center gap-2 opacity-70 pointer-events-none">
                        <div className="flex-1 p-2 border rounded bg-white text-slate-400 text-sm font-mono text-right">
                            0
                        </div>
                        <span className="font-bold text-slate-400 text-xs">{block.meterUom || 'hrs'}</span>
                    </div>
                );

            case 'PHOTO':
                return (
                    <div className="mt-2 p-4 border-2 border-dashed border-slate-200 rounded-lg text-center bg-slate-50">
                        <Camera size={20} className="mx-auto text-slate-300 mb-1" />
                        <p className="text-xs text-slate-400">Technician captures photo evidence here</p>
                    </div>
                );

            case 'SIGNATURE':
                return (
                    <div className="mt-2 p-3 border-2 border-dashed border-slate-200 rounded-lg bg-slate-50">
                        <div className="flex items-center gap-2 text-slate-400">
                            <PenTool size={14} />
                            <span className="text-xs">Digital signature capture</span>
                        </div>
                    </div>
                );

            case 'ISOLATION_CHECK':
                return (
                    <div className="mt-2 p-2 bg-red-50 border border-red-100 rounded flex items-center gap-2 opacity-80 pointer-events-none">
                        <Lock size={14} className="text-red-400" />
                        <span className="text-xs text-red-600 font-medium">LOTO Verification Point</span>
                    </div>
                );

            default:
                return null;
        }
    };

    // Is this a heading block? Use larger label styling
    const isHeading = block.type === 'HEADING';

    return (
        <div className={`bg-white border rounded-lg shadow-sm hover:shadow-md transition-shadow group relative ${isHeading ? 'border-blue-200 bg-blue-50/30 p-2' : 'border-slate-200 p-3'}`}>

            {/* ── HEADER: Label + Type + Required + Actions ── */}
            <div className="flex flex-col gap-2 mb-2">
                {/* Row 1: Icon + Label input */}
                <div className="flex items-start gap-2">
                    <div className="mt-2 text-slate-400 flex-shrink-0">
                        {getIcon()}
                    </div>

                    <div className="flex-1 min-w-0">
                        <textarea
                            className={`w-full bg-transparent placeholder:text-slate-300 resize-none ${isHeading
                                ? 'text-base font-bold text-slate-800 border-none p-0 focus:ring-0'
                                : 'text-sm font-medium text-slate-700 border border-slate-200 rounded-md px-2.5 py-2 focus:ring-1 focus:ring-primary-500 focus:border-blue-500 hover:border-slate-300 transition-colors'}`}
                            placeholder={isHeading ? 'Section heading...' : 'Enter instruction...'}
                            value={block.label}
                            onChange={(e) => onChange({ label: e.target.value })}
                            rows={2}
                        />
                    </div>
                </div>

                {/* Row 2: Type badge + Actions (always visible, mobile-friendly) */}
                <div className="flex items-center gap-2 pl-6 flex-wrap">
                    <span className="text-[10px] text-slate-400 uppercase font-bold">
                        {getTypeLabel(block.type)}
                    </span>

                    <div className="flex-1" />

                    <div className="flex items-center gap-1">
                        {block.type !== 'HEADING' && block.type !== 'SECTION' && (
                            <label className="flex items-center gap-1.5 cursor-pointer bg-slate-50 px-2 py-1.5 rounded border border-slate-100 hover:bg-slate-100 transition-colors">
                                <input
                                    type="checkbox"
                                    className="rounded-sm border-slate-300 text-blue-600 focus:ring-primary-500 w-3.5 h-3.5"
                                    checked={block.required}
                                    onChange={(e) => onChange({ required: e.target.checked })}
                                />
                                <span className="text-[10px] uppercase font-bold text-slate-500">Req</span>
                            </label>
                        )}

                        {onAddSibling && (
                            <button
                                onClick={onAddSibling}
                                className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                title="Add item below"
                            >
                                <Plus size={16} />
                            </button>
                        )}

                        <button
                            onClick={onDelete}
                            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                            title="Delete Block"
                        >
                            <Trash2 size={16} />
                        </button>

                        <div className="relative">
                            <button
                                onClick={() => setShowMenu(!showMenu)}
                                className="p-1.5 text-slate-400 hover:text-slate-600 rounded transition-colors"
                            >
                                <MoreVertical size={16} />
                            </button>

                            {showMenu && (
                                <>
                                    <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                                    <div className="absolute right-0 top-8 bg-white shadow-lg border border-slate-200 rounded-lg z-20 w-36 py-1 flex flex-col animate-in fade-in zoom-in-95 duration-100">
                                        {onDuplicate && (
                                            <button
                                                onClick={() => { onDuplicate(); setShowMenu(false); }}
                                                className="text-xs text-left px-3 py-2.5 hover:bg-slate-50 text-slate-700 flex items-center gap-2 transition-colors"
                                            >
                                                <Copy size={12} /> Duplicate
                                            </button>
                                        )}
                                        <button
                                            onClick={() => { onDelete(); setShowMenu(false); }}
                                            className="text-xs text-left px-3 py-2.5 hover:bg-red-50 text-red-600 flex items-center gap-2 transition-colors"
                                        >
                                            <Trash2 size={12} /> Delete
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* ── BODY: Configuration & Preview ── */}
            <div className="pl-7 space-y-3">

                {/* Control Preview */}
                {renderControlPreview()}

                {/* Type-Specific Configuration */}

                {/* CONDITION_READING config */}
                {block.type === 'CONDITION_READING' && (
                    <div className="bg-slate-50 p-2 rounded border border-slate-200 grid grid-cols-4 gap-2 mt-2">
                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase">Min</label>
                            <input type="number" className="w-full text-xs p-1 border rounded" value={block.minValue ?? ''} onChange={(e) => onChange({ minValue: parseFloat(e.target.value) })} />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase">Target</label>
                            <input type="number" className="w-full text-xs p-1 border rounded" value={block.targetValue ?? ''} onChange={(e) => onChange({ targetValue: parseFloat(e.target.value) })} />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase">Max</label>
                            <input type="number" className="w-full text-xs p-1 border rounded" value={block.maxValue ?? ''} onChange={(e) => onChange({ maxValue: parseFloat(e.target.value) })} />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase">UOM</label>
                            <input type="text" className="w-full text-xs p-1 border rounded" placeholder="e.g. °C" value={block.uom ?? ''} onChange={(e) => onChange({ uom: e.target.value })} />
                        </div>
                    </div>
                )}

                {/* METER_READING config */}
                {block.type === 'METER_READING' && (
                    <div className="bg-slate-50 p-2 rounded border border-slate-200 grid grid-cols-2 gap-2 mt-2">
                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase">Unit of Measure</label>
                            <input type="text" className="w-full text-xs p-1 border rounded" placeholder="e.g. hours, km, cycles" value={block.meterUom ?? ''} onChange={(e) => onChange({ meterUom: e.target.value })} />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase">Previous Reading</label>
                            <input type="number" className="w-full text-xs p-1 border rounded" placeholder="Last known value" value={block.previousReading ?? ''} onChange={(e) => onChange({ previousReading: parseFloat(e.target.value) })} />
                        </div>
                    </div>
                )}

                {/* ISOLATION_CHECK config */}
                {block.type === 'ISOLATION_CHECK' && (
                    <div className="bg-red-50 p-2 rounded border border-red-200 grid grid-cols-2 gap-2 mt-2">
                        <div>
                            <label className="block text-[10px] font-bold text-red-400 uppercase">Energy Type</label>
                            <select
                                className="w-full text-xs p-1 border border-red-200 rounded bg-white"
                                value={block.energyType || ''}
                                onChange={(e) => onChange({ energyType: e.target.value as any })}
                            >
                                <option value="">Select...</option>
                                <option value="ELECTRICAL">Electrical</option>
                                <option value="PNEUMATIC">Pneumatic</option>
                                <option value="HYDRAULIC">Hydraulic</option>
                                <option value="MECHANICAL">Mechanical</option>
                                <option value="THERMAL">Thermal</option>
                                <option value="OTHER">Other</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-red-400 uppercase">Lock Tag #</label>
                            <input type="text" className="w-full text-xs p-1 border border-red-200 rounded" placeholder="e.g. LK-001" value={block.lockNumber ?? ''} onChange={(e) => onChange({ lockNumber: e.target.value })} />
                        </div>
                    </div>
                )}

                {/* SIGNATURE config */}
                {block.type === 'SIGNATURE' && (
                    <div className="bg-slate-50 p-2 rounded border border-slate-200 mt-2">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Required Role</label>
                        <input type="text" className="w-full text-xs p-1 border rounded" placeholder="e.g. Technician, Supervisor, HSE" value={block.signatureRole ?? ''} onChange={(e) => onChange({ signatureRole: e.target.value })} />
                    </div>
                )}

                {/* PROCEDURE config */}
                {block.type === 'PROCEDURE' && (
                    <div className="bg-slate-50 p-2 rounded border border-slate-200 space-y-2 mt-2">
                        {(block.procedureSteps || []).map((step, idx) => (
                            <div key={step.id} className="flex gap-2 items-center">
                                <span className="text-[10px] font-bold text-slate-400 w-5 text-right">{idx + 1}.</span>
                                <input
                                    type="text"
                                    className="flex-1 text-xs p-1 border rounded"
                                    value={step.text}
                                    onChange={(e) => {
                                        const newSteps = [...(block.procedureSteps || [])];
                                        newSteps[idx].text = e.target.value;
                                        onChange({ procedureSteps: newSteps });
                                    }}
                                    placeholder="Step description..."
                                />
                                <button
                                    onClick={() => {
                                        const newSteps = (block.procedureSteps || []).filter((_, i) => i !== idx);
                                        onChange({ procedureSteps: newSteps });
                                    }}
                                    className="text-slate-400 hover:text-red-500"
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        ))}
                        <button
                            onClick={() => {
                                const newSteps = [...(block.procedureSteps || []), { id: Date.now().toString(), text: '', completed: false }];
                                onChange({ procedureSteps: newSteps });
                            }}
                            className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                        >
                            <Plus size={12} /> Add Step
                        </button>
                    </div>
                )}

                {/* CHECKLIST config */}
                {block.type === 'CHECKLIST' && (
                    <div className="bg-slate-50 p-2 rounded border border-slate-200 space-y-2 mt-2">
                        {(block.checklistItems || []).map((item, idx) => (
                            <div key={item.id} className="flex gap-2">
                                <input
                                    type="text"
                                    className="flex-1 text-xs p-1 border rounded"
                                    value={item.label}
                                    onChange={(e) => {
                                        const newItems = [...(block.checklistItems || [])];
                                        newItems[idx].label = e.target.value;
                                        onChange({ checklistItems: newItems });
                                    }}
                                    placeholder="Checklist item..."
                                />
                                <button
                                    onClick={() => {
                                        const newItems = (block.checklistItems || []).filter((_, i) => i !== idx);
                                        onChange({ checklistItems: newItems });
                                    }}
                                    className="text-slate-400 hover:text-red-500"
                                >
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        ))}
                        <button
                            onClick={() => {
                                const newItems = [...(block.checklistItems || []), { id: Date.now().toString(), label: '', checked: false }];
                                onChange({ checklistItems: newItems });
                            }}
                            className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                        >
                            <Plus size={12} /> Add Item
                        </button>
                    </div>
                )}

                {/* ── FOOTER: Media Toolbar ── */}
                <div className="flex items-center gap-2 pt-2 mt-2 border-t border-slate-100">
                    <button
                        onClick={() => handleAddMedia('LINK')}
                        className="text-xs text-slate-400 hover:text-blue-600 flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-50 transition-colors"
                    >
                        <LinkIcon size={12} /> Link
                    </button>
                    <button
                        onClick={() => handleAddMedia('IMAGE')}
                        className="text-xs text-slate-400 hover:text-blue-600 flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-50 transition-colors"
                    >
                        <ImageIcon size={12} /> Image
                    </button>
                </div>

                {/* Media List with visible delete */}
                {block.media && block.media.length > 0 && (
                    <div className="space-y-1">
                        {block.media.map(m => (
                            <div key={m.id} className="flex items-center gap-2 bg-slate-50 px-2 py-1.5 rounded border border-slate-100">
                                <span className="text-slate-400">
                                    {m.type === 'LINK' ? <LinkIcon size={10} /> : <ImageIcon size={10} />}
                                </span>
                                <span className="text-xs text-blue-600 truncate flex-1">{m.url}</span>
                                <button
                                    onClick={() => removeMedia(m.id)}
                                    className="text-slate-400 hover:text-red-500 p-0.5 rounded hover:bg-red-50 transition-colors"
                                    title="Remove"
                                >
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div >
    );
};
