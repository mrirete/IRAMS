import React, { useState } from 'react';
import { useConfirm } from '../contexts/ConfirmContext';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { InstructionBlock, InstructionBlockType } from '../types';
import { ProcedureItemEditor } from './ProcedureItemEditor';
import { ProcedureItemRenderer } from './ProcedureItemRenderer';
import {
    Plus, GripVertical, Type, CheckSquare, Hash, Calendar, Camera, PenTool,
    Activity, Gauge, AlertTriangle, Lock, ListChecks, HelpCircle, FileText,
    ChevronDown, ChevronUp, ClipboardCheck
} from 'lucide-react';

interface ProcedureBuilderProps {
    instructions: InstructionBlock[];
    onChange: (blocks: InstructionBlock[]) => void;
    readOnly?: boolean;
    mode: 'EDIT' | 'EXECUTE';
}

// ── Main Component ──────────────────────────────────────────────────────────

// Sortable Wrapper Component
const SortableItem: React.FC<{ id: string, children: React.ReactNode, mode: 'EDIT' | 'EXECUTE' }> = ({ id, children, mode }) => {
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
    const style = { transform: CSS.Transform.toString(transform), transition };

    return (
        <div ref={setNodeRef} style={style} className="relative group">
            {mode === 'EDIT' && (
                <div
                    {...attributes}
                    {...listeners}
                    className="absolute left-[-20px] top-4 text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing p-1 hidden sm:block"
                >
                    <GripVertical size={16} />
                </div>
            )}
            {children}
        </div>
    );
};

// Block type definitions with categories
const BLOCK_TYPES: { type: InstructionBlockType; label: string; icon: React.ComponentType<{size?: number; className?: string}>; category: string }[] = [
    // Structure
    { type: 'HEADING', label: 'Heading', icon: Type, category: 'Structure' },
    { type: 'PROCEDURE', label: 'Procedure', icon: ClipboardCheck, category: 'Structure' },
    // Input
    { type: 'CHECKBOX', label: 'Checkbox', icon: CheckSquare, category: 'Input' },
    { type: 'TEXT', label: 'Text Note', icon: FileText, category: 'Input' },
    { type: 'NUMBER', label: 'Number', icon: Hash, category: 'Input' },
    { type: 'DATE', label: 'Date', icon: Calendar, category: 'Input' },
    { type: 'YES_NO_NA', label: 'Yes / No / N/A', icon: HelpCircle, category: 'Input' },
    { type: 'CHECKLIST', label: 'Checklist', icon: ListChecks, category: 'Input' },
    // Inspection
    { type: 'PASS_FAIL', label: 'Inspection', icon: AlertTriangle, category: 'Inspection' },
    { type: 'CONDITION_READING', label: 'Condition Reading', icon: Activity, category: 'Inspection' },
    { type: 'METER_READING', label: 'Meter Reading', icon: Gauge, category: 'Inspection' },
    // Evidence
    { type: 'PHOTO', label: 'Photo / File', icon: Camera, category: 'Evidence' },
    { type: 'SIGNATURE', label: 'Signature', icon: PenTool, category: 'Evidence' },
    // Safety
    { type: 'ISOLATION_CHECK', label: 'LOTO Check', icon: Lock, category: 'Safety' },
];

const CATEGORIES = ['Structure', 'Input', 'Inspection', 'Evidence', 'Safety'];

// IRAMS category accents — colored dot + tinted icon chip per family
const CATEGORY_STYLES: Record<string, { dot: string; chip: string }> = {
    Structure: { dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-500' },
    Input: { dot: 'bg-blue-500', chip: 'bg-blue-50 text-blue-600' },
    Inspection: { dot: 'bg-violet-500', chip: 'bg-violet-50 text-violet-600' },
    Evidence: { dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-600' },
    Safety: { dot: 'bg-red-500', chip: 'bg-red-50 text-red-600' },
};

// The four most-used types, surfaced as one-click cards
const QUICK_TYPES: InstructionBlockType[] = ['CHECKBOX', 'TEXT', 'PASS_FAIL', 'CONDITION_READING'];

// Short labels for the narrow side rail
const RAIL_LABELS: Partial<Record<InstructionBlockType, string>> = {
    CHECKBOX: 'Checkbox', TEXT: 'Text', PASS_FAIL: 'Inspection', CONDITION_READING: 'Condition',
};

export const ProcedureBuilder: React.FC<ProcedureBuilderProps> = ({ instructions, onChange, readOnly, mode }) => {

    const confirm = useConfirm();
    const [showAddMenu, setShowAddMenu] = useState(false);
    // Mobile: the add section is a collapsed dropdown so the step stays calm
    const [mobileAddOpen, setMobileAddOpen] = useState(false);

    // DnD Sensors
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (active.id !== over?.id) {
            const oldIndex = instructions.findIndex(i => i.id === active.id);
            const newIndex = instructions.findIndex(i => i.id === over?.id);
            const newOrder = arrayMove(instructions, oldIndex, newIndex);

            const resequenced = newOrder.map((item: InstructionBlock, index: number) => ({
                ...item,
                sequence: (index + 1) * 10
            }));
            onChange(resequenced);
        }
    };

    const addBlock = (type: InstructionBlockType) => {
        const newBlock: InstructionBlock = {
            id: `inst-${Date.now()}`,
            type,
            sequence: (instructions.length + 1) * 10,
            label: type === 'HEADING' ? 'New Section' : '',
            required: false,
            checklistItems: type === 'CHECKLIST' ? [{ id: '1', label: 'Item 1', checked: false }] : undefined,
            procedureSteps: type === 'PROCEDURE' ? [{ id: '1', text: 'Step 1', completed: false }] : undefined,
        };
        onChange([...instructions, newBlock]);
        setShowAddMenu(false);
        setMobileAddOpen(false);
    };

    const updateBlock = (id: string, updates: Partial<InstructionBlock>) => {
        onChange(instructions.map(b => b.id === id ? { ...b, ...updates } : b));
    };

    const deleteBlock = async (id: string) => {
        const ok = await confirm({
            title: 'Delete Instruction',
            message: 'This instruction block will be permanently removed from the procedure.',
            variant: 'danger',
            confirmLabel: 'Delete',
        });
        if (ok) {
            onChange(instructions.filter(b => b.id !== id));
        }
    };

    const duplicateBlock = (id: string) => {
        const index = instructions.findIndex(b => b.id === id);
        if (index !== -1) {
            const blockToClone = instructions[index];
            const newBlock: InstructionBlock = {
                ...blockToClone,
                id: `inst-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                label: blockToClone.label ? `${blockToClone.label} (Copy)` : '',
            };
            const newInstructions = [...instructions];
            newInstructions.splice(index + 1, 0, newBlock);

            // Resequence
            const resequenced = newInstructions.map((item, idx) => ({
                ...item,
                sequence: (idx + 1) * 10
            }));
            onChange(resequenced);
        }
    };

    const addSiblingBlock = (id: string, type: InstructionBlockType) => {
        const index = instructions.findIndex(b => b.id === id);
        if (index !== -1) {
            const newBlock: InstructionBlock = {
                id: `inst-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                type,
                sequence: ((index + 1) + 1) * 10, // Temporary sequence, will be fixed by resequence
                label: '',
                required: false,
                checklistItems: type === 'CHECKLIST' ? [{ id: '1', label: 'Item 1', checked: false }] : undefined,
                procedureSteps: type === 'PROCEDURE' ? [{ id: '1', text: 'Step 1', completed: false }] : undefined,
            };

            const newInstructions = [...instructions];
            newInstructions.splice(index + 1, 0, newBlock);

            // Resequence
            const resequenced = newInstructions.map((item, idx) => ({
                ...item,
                sequence: (idx + 1) * 10
            }));
            onChange(resequenced);
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex items-start gap-3">
                {/* Instructions column — the list stays fully visible while adding */}
                <div className="flex-1 min-w-0 space-y-3">
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={instructions.map(i => i.id)} strategy={verticalListSortingStrategy}>
                    {/* Nested under the step: connector line + indent so it reads as a sub-folder */}
                    <div className="space-y-3 pl-2 sm:pl-6 border-l-2 border-slate-100 ml-0.5 sm:ml-2">
                        {instructions.map((block) => (
                            <SortableItem key={block.id} id={block.id} mode={mode}>
                                {mode === 'EDIT' ? (
                                    <ProcedureItemEditor
                                        block={block}
                                        onChange={(u) => updateBlock(block.id, u)}
                                        onDelete={() => deleteBlock(block.id)}
                                        onDuplicate={() => duplicateBlock(block.id)}
                                        onAddSibling={() => addSiblingBlock(block.id, block.type)}
                                    />
                                ) : (
                                    <ProcedureItemRenderer
                                        block={block}
                                        onChange={(u) => updateBlock(block.id, u)}
                                        readOnly={readOnly}
                                    />
                                )}
                            </SortableItem>
                        ))}
                    </div>
                </SortableContext>
            </DndContext>

                    {instructions.length === 0 && mode === 'EXECUTE' && (
                        <div className="text-center text-slate-400 py-8 italic">
                            No instructions defined for this task.
                        </div>
                    )}
                    {instructions.length === 0 && mode === 'EDIT' && (
                        <div className="text-center text-slate-400 py-8 italic border-2 border-dashed border-slate-100 rounded-lg">
                            No instructions yet — tap Add instruction to create the first one.
                        </div>
                    )}
                </div>

                {/* Side rail — add types without covering the list (desktop) */}
                {mode === 'EDIT' && !readOnly && (
                    <div className="hidden sm:block w-[96px] shrink-0">
                        <div className="sticky top-2 bg-white border border-slate-200 rounded-xl p-1.5 shadow-sm">
                            <div className="text-[9px] text-blue-600 uppercase font-bold tracking-wider flex items-center gap-1 mb-1 px-1">
                                <span className="w-1 h-1 rounded-full bg-blue-500 inline-block" /> Add
                            </div>
                            <div className="flex flex-col gap-0.5">
                                {QUICK_TYPES.map(qt => {
                                    const tool = BLOCK_TYPES.find(t => t.type === qt)!;
                                    const style = CATEGORY_STYLES[tool.category];
                                    return (
                                        <button
                                            key={qt}
                                            onClick={() => addBlock(qt)}
                                            className="group w-full flex flex-col items-center gap-0.5 py-1.5 rounded-lg border border-transparent hover:border-blue-200 hover:bg-blue-50/60 transition-colors"
                                            title={`Add a ${tool.label} block`}
                                        >
                                            <span className={`p-1.5 rounded-md ${style.chip}`}>
                                                <tool.icon size={14} />
                                            </span>
                                            <span className="text-[9px] font-semibold text-slate-500 group-hover:text-blue-700 leading-tight text-center">
                                                {RAIL_LABELS[qt] || tool.label}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="border-t border-slate-100 my-1" />
                            <button
                                onClick={() => setShowAddMenu(!showAddMenu)}
                                className={`w-full flex flex-col items-center gap-0.5 py-1.5 rounded-lg border transition-colors ${showAddMenu ? 'bg-blue-600 border-blue-600 text-white' : 'border-transparent text-slate-500 hover:border-blue-200 hover:bg-blue-50/60 hover:text-blue-700'}`}
                                title="Show every instruction type"
                            >
                                <Plus size={14} />
                                <span className="text-[9px] font-semibold leading-tight">All types</span>
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Mobile quick-add — collapsed dropdown so the step stays calm until needed */}
            {mode === 'EDIT' && !readOnly && (
                <div className="sm:hidden pt-1">
                    <button
                        onClick={() => { setMobileAddOpen(v => !v); if (mobileAddOpen) setShowAddMenu(false); }}
                        aria-expanded={mobileAddOpen}
                        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-colors ${
                            mobileAddOpen
                                ? 'border-blue-300 bg-blue-50/60'
                                : 'border-dashed border-slate-300 bg-slate-50/50 active:bg-slate-100'
                        }`}
                    >
                        <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-2 text-blue-600">
                            <Plus size={14} /> Add instruction
                        </span>
                        {mobileAddOpen ? <ChevronUp size={15} className="text-blue-500" /> : <ChevronDown size={15} className="text-slate-400" />}
                    </button>

                    {mobileAddOpen && (
                        <div className="mt-2 space-y-2 animate-in fade-in slide-in-from-top-1 duration-150">
                            <div className="grid grid-cols-2 gap-2">
                                {QUICK_TYPES.map(qt => {
                                    const tool = BLOCK_TYPES.find(t => t.type === qt)!;
                                    const style = CATEGORY_STYLES[tool.category];
                                    return (
                                        <button
                                            key={qt}
                                            onClick={() => addBlock(qt)}
                                            className="group flex items-center gap-2 p-2.5 bg-white border border-slate-200 rounded-lg active:scale-[0.98] hover:border-blue-300 hover:shadow-sm transition-all text-left"
                                            title={`Add a ${tool.label} block`}
                                        >
                                            <span className={`p-1.5 rounded-md transition-colors ${style.chip}`}>
                                                <tool.icon size={14} />
                                            </span>
                                            <span className="text-xs font-medium text-slate-700 group-hover:text-blue-900 truncate">{tool.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            <button
                                onClick={() => setShowAddMenu(!showAddMenu)}
                                className={`w-full text-[11px] px-2.5 py-2 rounded-lg flex items-center justify-center gap-1 font-semibold transition-colors ${showAddMenu ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                            >
                                All types {showAddMenu ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Full palette — every category visible at once, grouped rows */}
            {mode === 'EDIT' && !readOnly && showAddMenu && (
                <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2.5 animate-in fade-in slide-in-from-top-2 duration-200">
                    {CATEGORIES.map(cat => (
                        <div key={cat} className="flex flex-col sm:flex-row items-start gap-1 sm:gap-3">
                            <span className="sm:w-20 shrink-0 text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center gap-1.5 sm:mt-2">
                                <span className={`w-1.5 h-1.5 rounded-full inline-block ${CATEGORY_STYLES[cat].dot}`} /> {cat}
                            </span>
                            <div className="flex flex-wrap gap-1.5 flex-1">
                                {BLOCK_TYPES.filter(t => t.category === cat).map(tool => (
                                    <button
                                        key={`${tool.category}-${tool.type}`}
                                        onClick={() => addBlock(tool.type)}
                                        className="group flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-slate-100 hover:border-blue-300 hover:bg-blue-50/50 transition-colors"
                                    >
                                        <span className={`p-1 rounded ${CATEGORY_STYLES[cat].chip}`}>
                                            <tool.icon size={12} />
                                        </span>
                                        <span className="text-xs font-medium text-slate-600 group-hover:text-blue-800">{tool.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
