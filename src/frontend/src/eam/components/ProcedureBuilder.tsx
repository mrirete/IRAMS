import React, { useState } from 'react';
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

export const ProcedureBuilder: React.FC<ProcedureBuilderProps> = ({ instructions, onChange, readOnly, mode }) => {

    const [showAddMenu, setShowAddMenu] = useState(false);
    const [activeCategory, setActiveCategory] = useState('Input');

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
    };

    const updateBlock = (id: string, updates: Partial<InstructionBlock>) => {
        onChange(instructions.map(b => b.id === id ? { ...b, ...updates } : b));
    };

    const deleteBlock = (id: string) => {
        if (window.confirm('Delete this instruction?')) {
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
        <div className="space-y-4">

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={instructions.map(i => i.id)} strategy={verticalListSortingStrategy}>
                    {/* Nested under the step: connector line + indent so it reads as a sub-folder */}
                    <div className="space-y-3 pl-3 sm:pl-6 border-l-2 border-slate-100 ml-1 sm:ml-2">
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

            {/* Add Instruction Menu (Edit Mode) */}
            {mode === 'EDIT' && !readOnly && (
                <div className="border-t border-dashed border-slate-200 mt-4 pt-4">
                    {/* Quick-add bar: most common types */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => addBlock('CHECKBOX')} className="text-xs bg-white border border-slate-200 px-3 py-1.5 rounded-md hover:bg-slate-50 hover:border-slate-300 flex items-center gap-1.5 transition-colors">
                            <CheckSquare size={12} className="text-slate-400" /> Checkbox
                        </button>
                        <button onClick={() => addBlock('TEXT')} className="text-xs bg-white border border-slate-200 px-3 py-1.5 rounded-md hover:bg-slate-50 hover:border-slate-300 flex items-center gap-1.5 transition-colors">
                            <FileText size={12} className="text-slate-400" /> Text
                        </button>
                        <button onClick={() => addBlock('PASS_FAIL')} className="text-xs bg-white border border-blue-200 px-3 py-1.5 rounded-md hover:bg-blue-50 hover:border-blue-300 flex items-center gap-1.5 font-semibold text-blue-700 transition-colors">
                            <AlertTriangle size={12} /> Inspection
                        </button>
                        <button onClick={() => addBlock('CONDITION_READING')} className="text-xs bg-white border border-blue-200 px-3 py-1.5 rounded-md hover:bg-blue-50 hover:border-blue-300 flex items-center gap-1.5 font-semibold text-blue-700 transition-colors">
                            <Activity size={12} /> Condition
                        </button>

                        <div className="h-5 w-px bg-slate-200 mx-1" />

                        <button
                            onClick={() => setShowAddMenu(!showAddMenu)}
                            className={`text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5 font-medium transition-colors ${showAddMenu ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                        >
                            <Plus size={12} /> All Types {showAddMenu ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>
                    </div>

                    {/* Expanded category menu */}
                    {showAddMenu && (
                        <div className="mt-3 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                            {/* Category tabs */}
                            <div className="flex border-b border-slate-100 bg-slate-50 px-2 pt-2 gap-1">
                                {CATEGORIES.map(cat => (
                                    <button
                                        key={cat}
                                        onClick={() => setActiveCategory(cat)}
                                        className={`px-3 py-1.5 text-xs font-semibold rounded-t-md transition-colors ${activeCategory === cat
                                            ? 'bg-white text-slate-800 border border-slate-200 border-b-white -mb-px'
                                            : 'text-slate-500 hover:text-slate-700'
                                            }`}
                                    >
                                        {cat}
                                    </button>
                                ))}
                            </div>
                            {/* Block type grid */}
                            <div className="grid grid-cols-3 gap-2 p-3">
                                {BLOCK_TYPES.filter(t => t.category === activeCategory).map(tool => (
                                    <button
                                        key={`${tool.category}-${tool.type}`}
                                        onClick={() => addBlock(tool.type)}
                                        className="flex items-center gap-2.5 p-2.5 rounded-lg border border-slate-100 hover:border-blue-300 hover:bg-blue-50 hover:shadow-sm transition text-left group"
                                    >
                                        <div className="p-1.5 bg-slate-100 rounded-md group-hover:bg-white text-slate-500 group-hover:text-blue-600 transition-colors">
                                            <tool.icon size={14} />
                                        </div>
                                        <span className="text-xs font-medium text-slate-700 group-hover:text-blue-900">{tool.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {instructions.length === 0 && mode === 'EXECUTE' && (
                <div className="text-center text-slate-400 py-8 italic">
                    No instructions defined for this task.
                </div>
            )}

            {instructions.length === 0 && mode === 'EDIT' && (
                <div className="text-center text-slate-400 py-8 italic border-2 border-dashed border-slate-100 rounded-lg">
                    Start by adding instructions above.
                </div>
            )}
        </div>
    );
};
