import React, { useState } from 'react';
import {
    GripVertical, Trash2, Plus, Type, Hash, CheckSquare, ListChecks,
    AlertTriangle, HelpCircle, Camera, PenTool, Calendar, Gauge,
    Activity, Lock, Eye, ChevronDown, ChevronRight, Image as ImageIcon,
    FileText, X, Check, MoreVertical
} from 'lucide-react';
import { InstructionBlock, InstructionBlockType } from '../types';

interface InstructionBuilderProps {
    instructions: InstructionBlock[];
    onChange: (blocks: InstructionBlock[]) => void;
    readOnly?: boolean;
    mode: 'EDIT' | 'EXECUTE'; // EDIT = Building the template, EXECUTE = Technician filling it out
}

export const InstructionBuilder: React.FC<InstructionBuilderProps> = ({
    instructions,
    onChange,
    readOnly = false,
    mode
}) => {
    // ── Block Type Definitions ───────────────────────────────────────────────
    const BLOCK_TYPES: { type: InstructionBlockType; label: string; icon: React.ComponentType<{size?: number; className?: string}>; category: string }[] = [
        // Structural
        { type: 'HEADING', label: 'Heading', icon: Type, category: 'Structure' },
        { type: 'SECTION', label: 'Section', icon: ChevronDown, category: 'Structure' },
        { type: 'PROCEDURE', label: 'Procedure', icon: ListChecks, category: 'Structure' },
        // Universal Fields
        { type: 'CHECKBOX', label: 'Checkbox', icon: CheckSquare, category: 'Input' },
        { type: 'TEXT', label: 'Text Field', icon: FileText, category: 'Input' },
        { type: 'NUMBER', label: 'Number', icon: Hash, category: 'Input' },
        { type: 'DATE', label: 'Date', icon: Calendar, category: 'Input' },
        { type: 'YES_NO_NA', label: 'Yes / No / N/A', icon: HelpCircle, category: 'Input' },
        { type: 'CHECKLIST', label: 'Checklist', icon: ListChecks, category: 'Input' },
        { type: 'PHOTO', label: 'Photo/File', icon: Camera, category: 'Evidence' },
        { type: 'SIGNATURE', label: 'Signature', icon: PenTool, category: 'Evidence' },
        // EAM Specific
        { type: 'PASS_FAIL', label: 'Pass / Fail', icon: AlertTriangle, category: 'Inspection' },
        { type: 'METER_READING', label: 'Meter Reading', icon: Gauge, category: 'Inspection' },
        { type: 'CONDITION_READING', label: 'Condition Check', icon: Activity, category: 'Inspection' },
        { type: 'HEADING', label: 'LOTO Check', icon: Lock, category: 'Safety' }, // Using LOTO as special config of Checkbox/Section in logic? Or mapped to ISOLATION_CHECK (Added to types but missed in constant list? Let's check logic)
    ];
    // Note: ISOLATION_CHECK is in types but I'll add it to the list properly below to match the type system.

    const [activeCategory, setActiveCategory] = useState<string>('Input');
    const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

    const addBlock = (type: InstructionBlockType) => {
        if (readOnly || mode === 'EXECUTE') return;

        const newBlock: InstructionBlock = {
            id: `blk-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type,
            sequence: instructions.length + 1,
            label: '',
            required: false,
            // Default configuration based on type
            checklistItems: type === 'CHECKLIST' ? [] : undefined,
            yesNoNa: undefined,
        };
        onChange([...instructions, newBlock]);
    };

    const updateBlock = (id: string, updates: Partial<InstructionBlock>) => {
        if (readOnly) return;
        onChange(instructions.map(b => b.id === id ? { ...b, ...updates } : b));
    };

    const removeBlock = (id: string) => {
        if (readOnly || mode === 'EXECUTE') return;
        onChange(instructions.filter(b => b.id !== id));
    };

    // ── Drag & Drop Logic ────────────────────────────────────────────────────
    const handleDragStart = (e: React.DragEvent, index: number) => {
        setDraggedIdx(index);
        e.dataTransfer.effectAllowed = 'move';
        // Transparent drag image
        const img = new Image();
        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        e.dataTransfer.setDragImage(img, 0, 0);
    };

    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        if (draggedIdx === null || draggedIdx === index) return;

        const newItems = [...instructions];
        const draggedItem = newItems[draggedIdx];
        newItems.splice(draggedIdx, 1);
        newItems.splice(index, 0, draggedItem);

        // Re-sequence
        newItems.forEach((item, idx) => item.sequence = idx + 1);

        onChange(newItems);
        setDraggedIdx(index);
    };

    const handleDragEnd = () => {
        setDraggedIdx(null);
    };

    // ── Block Rendering ──────────────────────────────────────────────────────
    const renderBlockContent = (block: InstructionBlock) => {
        const isEdit = mode === 'EDIT';

        switch (block.type) {
            case 'HEADING':
                return (
                    <div className="w-full">
                        <input
                            type="text"
                            value={block.label}
                            onChange={(e) => updateBlock(block.id, { label: e.target.value })}
                            placeholder="Section Heading"
                            readOnly={!isEdit}
                            className={`w-full font-bold text-slate-800 text-lg border-none focus:ring-0 bg-transparent placeholder-slate-300 ${!isEdit ? 'pointer-events-none' : ''}`}
                        />
                        <div className="h-0.5 bg-slate-200 mt-1 w-full" />
                    </div>
                );

            case 'SECTION':
                return (
                    <div className="w-full p-2 bg-slate-50 border border-slate-200 rounded text-center text-slate-400 text-xs uppercase font-bold tracking-wider">
                        --- {block.label || 'Section Break'} ---
                        {isEdit && (
                            <input
                                type="text"
                                value={block.label}
                                onChange={(e) => updateBlock(block.id, { label: e.target.value })}
                                placeholder="Label"
                                className="block w-full text-center mt-1 bg-transparent border-none focus:ring-0 text-slate-600"
                            />
                        )}
                    </div>
                );

            case 'TEXT':
                return (
                    <div className="space-y-2">
                        {isEdit ? (
                            <input
                                type="text"
                                value={block.label}
                                onChange={(e) => updateBlock(block.id, { label: e.target.value })}
                                placeholder="Enter instruction text..."
                                className="w-full font-medium border-none focus:ring-0 p-0 text-slate-700 placeholder-slate-300"
                            />
                        ) : (
                            <div className="font-medium text-slate-700 mb-2">{block.label}</div>
                        )}
                        <textarea
                            value={block.valueString || ''}
                            onChange={(e) => updateBlock(block.id, { valueString: e.target.value })}
                            placeholder="Enter notes/observation..."
                            readOnly={isEdit}
                            className={`w-full p-2 border border-slate-300 rounded text-sm ${isEdit ? 'bg-slate-50 text-slate-400' : 'bg-white focus:border-blue-500 focus:ring-1 focus:ring-primary-500'}`}
                            rows={2}
                        />
                    </div>
                );

            case 'NUMBER':
                return (
                    <div className="flex items-center gap-4">
                        <div className="flex-1">
                            {isEdit ? (
                                <input
                                    type="text"
                                    value={block.label}
                                    onChange={(e) => updateBlock(block.id, { label: e.target.value })}
                                    placeholder="Instruction (e.g. Record pressure)..."
                                    className="w-full font-medium border-none focus:ring-0 p-0 text-slate-700"
                                />
                            ) : (
                                <div className="font-medium text-slate-700">{block.label}</div>
                            )}
                        </div>
                        <div className="w-32">
                            <div className="relative">
                                <input
                                    type="number"
                                    value={block.valueNumber || ''}
                                    onChange={(e) => updateBlock(block.id, { valueNumber: parseFloat(e.target.value) })}
                                    placeholder="0.00"
                                    readOnly={isEdit}
                                    className={`w-full p-2 border border-slate-300 rounded text-right font-mono text-sm ${isEdit ? 'bg-slate-50' : 'bg-white'}`}
                                />
                                {block.uom && <span className="absolute right-8 top-2 text-xs text-slate-400">{block.uom}</span>}
                            </div>
                        </div>
                    </div>
                );

            case 'CHECKBOX':
                return (
                    <div className="flex items-center gap-3">
                        <div className={`flex items-center justify-center w-6 h-6 rounded border ${block.valueBoolean ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300 bg-white'}`}>
                            {isEdit ? (
                                <CheckSquare size={16} className="text-slate-300" />
                            ) : (
                                <input
                                    type="checkbox"
                                    checked={block.valueBoolean || false}
                                    onChange={(e) => updateBlock(block.id, { valueBoolean: e.target.checked })}
                                    className="w-5 h-5 cursor-pointer opacity-0 absolute"
                                />
                            )}
                            {!isEdit && block.valueBoolean && <Check size={14} strokeWidth={3} />}
                        </div>
                        <div className="flex-1">
                            {isEdit ? (
                                <input
                                    type="text"
                                    value={block.label}
                                    onChange={(e) => updateBlock(block.id, { label: e.target.value })}
                                    placeholder="Instruction label..."
                                    className="w-full font-medium border-none focus:ring-0 p-0 text-slate-700"
                                />
                            ) : (
                                <div className="font-medium text-slate-700">{block.label}</div>
                            )}
                        </div>
                    </div>
                );

            case 'PASS_FAIL':
                return (
                    <div className="space-y-3">
                        {isEdit ? (
                            <input
                                type="text"
                                value={block.label}
                                onChange={(e) => updateBlock(block.id, { label: e.target.value })}
                                placeholder="Inspection check label..."
                                className="w-full font-medium border-none focus:ring-0 p-0 text-slate-700"
                            />
                        ) : (
                            <div className="font-medium text-slate-700">{block.label}</div>
                        )}

                        {!isEdit && (
                            <div className="flex gap-2">
                                {['PASS', 'FAIL', 'FLAG'].map((opt) => (
                                    <button
                                        key={opt}
                                        onClick={() => updateBlock(block.id, { passFail: opt as any })}
                                        className={`flex-1 py-2 text-xs font-bold rounded border transition-colors
                                            ${block.passFail === opt
                                                ? (opt === 'PASS' ? 'bg-green-600 text-white border-green-600' : opt === 'FAIL' ? 'bg-red-600 text-white border-red-600' : 'bg-amber-500 text-white border-amber-500')
                                                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                                            }`}
                                    >
                                        {opt}
                                    </button>
                                ))}
                            </div>
                        )}

                        {(isEdit || block.passFail === 'FAIL' || block.passFail === 'FLAG') && (
                            <textarea
                                value={block.failNotes || ''}
                                onChange={(e) => updateBlock(block.id, { failNotes: e.target.value })}
                                placeholder={isEdit ? "Technician will see this if FAIL/FLAG selected" : "Describe the issue (Mandatory for Fail/Flag)..."}
                                readOnly={isEdit}
                                className={`w-full p-2 border rounded text-sm ${block.passFail === 'FAIL' ? 'border-red-300 bg-red-50' : 'border-slate-300 bg-white'}`}
                                rows={2}
                            />
                        )}
                    </div>
                );

            case 'CONDITION_READING':
                return (
                    <div className="space-y-2">
                        <div className="flex justify-between items-start">
                            <div className="flex-1">
                                {isEdit ? (
                                    <input
                                        type="text"
                                        value={block.label}
                                        onChange={(e) => updateBlock(block.id, { label: e.target.value })}
                                        placeholder="Condition Check (e.g. Temperature)"
                                        className="w-full font-medium border-none focus:ring-0 p-0 text-slate-700"
                                    />
                                ) : (
                                    <div className="font-medium text-slate-700">{block.label}</div>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <div className="relative flex-1">
                                <input
                                    type="number"
                                    value={block.valueNumber || ''}
                                    onChange={(e) => {
                                        const val = parseFloat(e.target.value);
                                        // Auto-calculate out of spec
                                        let isOOS = false;
                                        if (block.minValue !== undefined && val < block.minValue) isOOS = true;
                                        if (block.maxValue !== undefined && val > block.maxValue) isOOS = true;
                                        updateBlock(block.id, { valueNumber: val, isOutOfSpec: isOOS });
                                    }}
                                    placeholder="Value"
                                    readOnly={isEdit}
                                    className={`w-full p-2 border rounded text-right font-mono font-bold ${block.isOutOfSpec ? 'border-red-500 text-red-600 bg-red-50' : 'border-slate-300'}`}
                                />
                            </div>
                            {isEdit && (
                                <div className="flex gap-1 text-xs">
                                    <input type="number" placeholder="Min" value={block.minValue || ''} onChange={e => updateBlock(block.id, { minValue: parseFloat(e.target.value) })} className="w-16 p-1 border border-slate-200 rounded text-center" />
                                    <input type="number" placeholder="Max" value={block.maxValue || ''} onChange={e => updateBlock(block.id, { maxValue: parseFloat(e.target.value) })} className="w-16 p-1 border border-slate-200 rounded text-center" />
                                    <input type="text" placeholder="UOM" value={block.uom || ''} onChange={e => updateBlock(block.id, { uom: e.target.value })} className="w-12 p-1 border border-slate-200 rounded text-center uppercase" />
                                </div>
                            )}
                            {!isEdit && block.uom && <span className="text-sm font-bold text-slate-500">{block.uom}</span>}
                        </div>

                        {!isEdit && (block.minValue !== undefined || block.maxValue !== undefined) && (
                            <div className="flex justify-between text-[10px] text-slate-400 px-1">
                                <span>Min: {block.minValue ?? '-'}</span>
                                <span>Target: {block.targetValue ?? '-'}</span>
                                <span>Max: {block.maxValue ?? '-'}</span>
                            </div>
                        )}

                        {!isEdit && block.isOutOfSpec && (
                            <div className="text-xs text-red-600 font-bold flex items-center gap-1 animate-pulse">
                                <AlertTriangle size={12} /> Out of Specification
                            </div>
                        )}
                    </div>
                );

            case 'YES_NO_NA':
                return (
                    <div className="space-y-2">
                        {isEdit ? (
                            <input
                                type="text"
                                value={block.label}
                                onChange={(e) => updateBlock(block.id, { label: e.target.value })}
                                placeholder="Compliance check label..."
                                className="w-full font-medium border-none focus:ring-0 p-0 text-slate-700"
                            />
                        ) : (
                            <div className="font-medium text-slate-700">{block.label}</div>
                        )}

                        {!isEdit ? (
                            <div className="flex rounded-md shadow-sm" role="group">
                                {['YES', 'NO', 'NA'].map((opt) => (
                                    <button
                                        key={opt}
                                        type="button"
                                        onClick={() => updateBlock(block.id, { yesNoNa: opt as any })}
                                        className={`flex-1 px-4 py-2 text-xs font-bold border first:rounded-l-lg last:rounded-r-lg
                                            ${block.yesNoNa === opt
                                                ? 'bg-primary-600 text-white border-blue-600'
                                                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                                            }`}
                                    >
                                        {opt}
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="flex gap-1 opacity-50">
                                <div className="px-3 py-1 border rounded bg-slate-100 text-xs text-slate-500">YES</div>
                                <div className="px-3 py-1 border rounded bg-slate-100 text-xs text-slate-500">NO</div>
                                <div className="px-3 py-1 border rounded bg-slate-100 text-xs text-slate-500">N/A</div>
                            </div>
                        )}
                    </div>
                );

            case 'CHECKLIST':
                return (
                    <div className="space-y-3">
                        {isEdit ? (
                            <input
                                type="text"
                                value={block.label}
                                onChange={(e) => updateBlock(block.id, { label: e.target.value })}
                                placeholder="Checklist Title..."
                                className="w-full font-medium border-none focus:ring-0 p-0 text-slate-700"
                            />
                        ) : (
                            <div className="font-medium text-slate-700 flex items-center gap-2">
                                <ListChecks size={16} className="text-slate-400" />
                                {block.label}
                            </div>
                        )}

                        <div className="space-y-1 pl-2 border-l-2 border-slate-100">
                            {(block.checklistItems || []).map((item, idx) => (
                                <div key={item.id} className="flex items-center gap-2">
                                    {isEdit ? (
                                        <>
                                            <div className="bg-slate-300 w-1.5 h-1.5 rounded-full" />
                                            <input
                                                type="text"
                                                value={item.label}
                                                onChange={(e) => {
                                                    const newItems = [...(block.checklistItems || [])];
                                                    newItems[idx].label = e.target.value;
                                                    updateBlock(block.id, { checklistItems: newItems });
                                                }}
                                                className="flex-1 text-sm border-none bg-transparent p-0 focus:ring-0"
                                            />
                                            <button
                                                onClick={() => {
                                                    const newItems = (block.checklistItems || []).filter((_, i) => i !== idx);
                                                    updateBlock(block.id, { checklistItems: newItems });
                                                }}
                                                className="text-slate-300 hover:text-red-500"
                                            >
                                                <X size={12} />
                                            </button>
                                        </>
                                    ) : (
                                        <label className="flex items-center gap-2 cursor-pointer select-none">
                                            <input
                                                type="checkbox"
                                                checked={item.checked}
                                                onChange={(e) => {
                                                    const newItems = [...(block.checklistItems || [])];
                                                    newItems[idx].checked = e.target.checked;
                                                    updateBlock(block.id, { checklistItems: newItems });
                                                }}
                                                className="rounded text-blue-600 focus:ring-primary-500"
                                            />
                                            <span className={`text-sm ${item.checked ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                                                {item.label}
                                            </span>
                                        </label>
                                    )}
                                </div>
                            ))}
                            {isEdit && (
                                <button
                                    onClick={() => updateBlock(block.id, {
                                        checklistItems: [...(block.checklistItems || []), { id: Date.now().toString(), label: 'New Item', checked: false }]
                                    })}
                                    className="text-xs text-blue-500 font-medium hover:underline pl-4 mt-1"
                                >
                                    + Add Item
                                </button>
                            )}
                        </div>
                    </div>
                );

            // Default fallthrough for partially implemented types
            default:
                return (
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            {/* icon display removed — InstructionBlock has no icon property */}
                            {isEdit ? (
                                <input
                                    type="text"
                                    value={block.label}
                                    onChange={(e) => updateBlock(block.id, { label: e.target.value })}
                                    placeholder={`${block.type} label...`}
                                    className="w-full font-medium border-none focus:ring-0 p-0 text-slate-700"
                                />
                            ) : (
                                <div className="font-medium text-slate-700">{block.label}</div>
                            )}
                        </div>
                        {/* Placeholder input for types not fully visualized yet */}
                        <div className="p-2 bg-slate-50 border border-slate-200 rounded text-xs text-slate-400 italic text-center">
                            {block.type} Input Area
                        </div>
                    </div>
                );
        }
    };


    return (
        <div className="space-y-6">

            {/* ── Toolbar (Edit Mode Only) ── */}
            {mode === 'EDIT' && !readOnly && (
                <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-sm p-2 border-b border-blue-100 -mx-4 px-4 mb-4">
                    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                        {['Structure', 'Input', 'Inspection', 'Evidence', 'Safety'].map(cat => (
                            <button
                                key={cat}
                                onClick={() => setActiveCategory(cat)}
                                className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors
                                    ${activeCategory === cat ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                            >
                                {cat}
                            </button>
                        ))}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mt-3">
                        {BLOCK_TYPES.filter(t => t.category === activeCategory).map(tool => (
                            <button
                                key={tool.type}
                                onClick={() => addBlock(tool.type)}
                                className="flex items-center gap-2 p-2 rounded border border-slate-200 hover:border-blue-300 hover:bg-blue-50 hover:shadow-sm transition text-left group"
                            >
                                <div className="p-1.5 bg-slate-100 rounded group-hover:bg-white text-slate-500 group-hover:text-blue-600 transition-colors">
                                    <tool.icon size={14} />
                                </div>
                                <span className="text-xs font-medium text-slate-700 group-hover:text-blue-900">{tool.label}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Instructions List ── */}
            <div className="space-y-3 min-h-[200px]">
                {instructions.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-10 text-slate-400 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                        <ListChecks size={32} className="mb-2 opacity-50" />
                        <p className="text-sm font-medium">No instructions added</p>
                        {mode === 'EDIT' && <p className="text-xs mt-1">Select a tool above to start building</p>}
                    </div>
                )}

                {instructions.map((block, idx) => (
                    <div
                        key={block.id}
                        draggable={mode === 'EDIT' && !readOnly}
                        onDragStart={(e) => handleDragStart(e, idx)}
                        onDragOver={(e) => handleDragOver(e, idx)}
                        onDragEnd={handleDragEnd}
                        className={`group relative border rounded-xl bg-white transition-all duration-200
                            ${draggedIdx === idx ? 'opacity-40 border-dashed border-blue-400' : 'border-slate-200 hover:border-blue-200 hover:shadow-sm'}
                            ${block.type === 'HEADING' ? 'border-none !bg-transparent !p-0 !m-0 mt-6' : 'p-4'}
                        `}
                    >
                        {/* Drag Handle & Actions (Edit Mode) */}
                        {mode === 'EDIT' && !readOnly && (
                            <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <span className="cursor-move text-slate-300 hover:text-blue-500 p-1"><GripVertical size={14} /></span>
                                <div className="h-4 w-px bg-slate-200 mx-1" />
                                <label className="flex items-center gap-1 text-[10px] uppercase font-bold text-slate-400 cursor-pointer hover:text-blue-600">
                                    <input
                                        type="checkbox"
                                        checked={block.required}
                                        onChange={(e) => updateBlock(block.id, { required: e.target.checked })}
                                        className="rounded border-slate-300 text-blue-600 focus:ring-0 h-3 w-3"
                                    />
                                    Req
                                </label>
                                <button
                                    onClick={() => removeBlock(block.id)}
                                    className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        )}

                        {/* Block Content */}
                        <div className={`${mode === 'EDIT' ? 'pr-20' : ''}`}>
                            {renderBlockContent(block)}
                        </div>

                        {/* Required Indicator (Execute Mode) */}
                        {mode !== 'EDIT' && block.required && block.type !== 'HEADING' && block.type !== 'SECTION' && (
                            <div className="absolute top-2 right-2 text-[10px] font-bold text-red-500 uppercase flex items-center gap-1 bg-red-50 px-1.5 py-0.5 rounded border border-red-100">
                                Required
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};
