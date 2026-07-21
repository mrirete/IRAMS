import React, { useState, useEffect } from 'react';
import {
    Search, Plus, Edit2, Trash2, BookOpen, AlertCircle, Wrench, HardHat,
    ClipboardList, Clock, Layers, FileText, CheckSquare, Save, X, Sparkles, Shield,
    Lock, GitBranch, AlertTriangle, Tag
} from 'lucide-react';
import { DatabaseService } from '../../services/DatabaseService';
import { LibraryTask, DictionaryEntry, InventoryItem, InstructionBlock } from '../../types';
import { ProcedureBuilder } from '../../components/ProcedureBuilder';

import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../contexts/ConfirmContext';

// Reusing types from parent if possible, but defining local props
interface TaskLibraryManagerProps { }

export const TaskLibraryManager: React.FC<TaskLibraryManagerProps> = () => {
    const { permissions, user } = useAuth();
    const confirm = useConfirm();
    const [tasks, setTasks] = useState<LibraryTask[]>([]);
    const [searchTerm, setSearchTerm] = useState('');

    if (permissions && !permissions.taskLibrary?.view) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-slate-400">
                <Shield size={64} className="mb-4 opacity-20" />
                <h2 className="text-xl font-bold text-slate-700">Access Denied</h2>
                <p className="text-sm text-slate-500 mt-2">You do not have permission to view the Task Library.</p>
            </div>
        );
    }
    const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
    const [loading, setLoading] = useState(true);

    const [editingTask, setEditingTask] = useState<LibraryTask | null>(null);
    const [showModal, setShowModal] = useState(false);

    const db = DatabaseService.getInstance();

    useEffect(() => {
        loadTasks();
    }, []);

    const loadTasks = async () => {
        setLoading(true);
        try {
            const data = await db.getLibraryTasks();
            setTasks(data);
        } catch (e) {
            console.error("Failed to load library tasks", e);
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = () => {
        setEditingTask({
            id: '', // New
            code: '',
            title: '',
            description: '',
            category: 'MAINTENANCE',
            estimatedDuration: 0,
            instructions: [],
            safetyRequirements: [],
            inventory: [],
            roles: [],
            files: [],
            assetClassCodes: [],
            version: 1,
            isLocked: false,
        });
        setShowModal(true);
    };

    const handleEdit = async (task: LibraryTask) => {
        // Fetch full details
        try {
            const fullTask = await db.getLibraryTask(task.id);
            if (fullTask) {
                setEditingTask(fullTask);
                setShowModal(true);
            }
        } catch (e) {
            alert("Error loading task details");
        }
    };

    const handleDelete = async (id: string) => {
        const task = tasks.find(t => t.id === id);
        if (task?.isLocked) {
            alert('🔒 This template is locked (used on a completed Work Order). It cannot be deleted. Create a new version instead.');
            return;
        }
        if (!confirm("Are you sure you want to delete this task template?")) return;
        try {
            await db.deleteLibraryTask(id);
            setTasks(prev => prev.filter(t => t.id !== id));
        } catch (e: any) {
            alert("Error deleting task: " + (e.message || e));
        }
    };

    // Enhancement 3: Create new version of a locked template (MoC workflow)
    const handleCreateNewVersion = async (taskId: string) => {
        try {
            const newVersion = await db.createNewVersion(taskId, user?.id || 'unknown');
            if (newVersion) {
                await loadTasks();
                setEditingTask(newVersion);
                setShowModal(true);
                alert(`✅ New version created: ${newVersion.code} (v${newVersion.version}). You may now edit the new version.`);
            }
        } catch (e: any) {
            alert('Error creating new version: ' + (e.message || e));
        }
    };

    const filteredTasks = tasks.filter(t =>
        (selectedCategory === 'ALL' || t.category === selectedCategory) &&
        (t.title.toLowerCase().includes(searchTerm.toLowerCase()) || t.code?.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    return (
        <div className="flex h-full flex-col bg-white">
            {/* Header / Filter Bar */}
            <div className="p-4 md:p-6 border-b border-slate-200 flex flex-col md:flex-row md:justify-between md:items-center gap-3 bg-slate-50">
                <div>
                    <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                        <BookOpen className="text-blue-600" /> Task Library
                    </h2>
                    <p className="text-sm text-slate-500">Manage reusable usage templates for Maintenance, Inspection, and Safety.</p>
                </div>
                <div className="flex flex-wrap gap-3">
                    <select
                        className="p-2 border border-slate-300 rounded-lg text-sm bg-white"
                        value={selectedCategory}
                        onChange={e => setSelectedCategory(e.target.value)}
                    >
                        <option value="ALL">All Categories</option>
                        <option value="MAINTENANCE">Maintenance</option>
                        <option value="INSPECTION">Inspection</option>
                        <option value="SAFETY">Safety</option>
                        <option value="PROJECT">Project</option>
                    </select>
                    <div className="relative">
                        <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                        <input
                            type="text"
                            placeholder="Search library..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm w-full sm:w-64"
                        />
                    </div>
                    <button
                        onClick={handleCreate}
                        className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 text-sm font-medium shadow-sm transition-colors"
                    >
                        <Plus size={16} /> New Template
                    </button>
                </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredTasks.map(task => (
                        <div key={task.id} className={`border rounded-xl p-5 hover:shadow-md transition-shadow bg-white flex flex-col group ${task.isLocked ? 'border-amber-300 bg-amber-50/30' : 'border-slate-200'}`}>
                            <div className="flex justify-between items-start mb-3">
                                <div className="flex items-center gap-2">
                                    <span className={`px-2 py-1 rounded text-xs font-bold uppercase tracking-wider ${task.category === 'MAINTENANCE' ? 'bg-orange-100 text-orange-700' :
                                        task.category === 'SAFETY' ? 'bg-red-100 text-red-700' :
                                        task.category === 'INSPECTION' ? 'bg-blue-100 text-blue-700' :
                                            'bg-blue-100 text-blue-700'
                                        }`}>
                                        {task.category}
                                    </span>
                                    {/* Enhancement 3: Lock badge */}
                                    {task.isLocked && (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200 flex items-center gap-1" title={`Locked — used on a completed WO. Locked by ${task.lockedBy || 'system'}`}>
                                            <Lock size={10} /> Locked
                                        </span>
                                    )}
                                    {/* Enhancement 3: Version badge */}
                                    {(task.version || 1) > 1 && (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200 flex items-center gap-1">
                                            <GitBranch size={10} /> v{task.version}
                                        </span>
                                    )}
                                </div>
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    {task.isLocked ? (
                                        <button
                                            onClick={() => handleCreateNewVersion(task.id)}
                                            className="p-1.5 hover:bg-blue-100 rounded text-blue-600 hover:text-blue-700"
                                            title="Create New Version (Management of Change)"
                                        >
                                            <GitBranch size={14} />
                                        </button>
                                    ) : (
                                        <button onClick={() => handleEdit(task)} className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-blue-600">
                                            <Edit2 size={14} />
                                        </button>
                                    )}
                                    <button onClick={() => handleDelete(task.id)} className={`p-1.5 hover:bg-slate-100 rounded ${task.isLocked ? 'text-slate-300 cursor-not-allowed' : 'text-slate-500 hover:text-red-600'}`}>
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>

                            <h3 className="font-bold text-slate-800 text-lg mb-1 truncate" title={task.title}>{task.title}</h3>
                            <div className="text-xs text-slate-400 font-mono mb-2">{task.code || 'NO-CODE'}</div>

                            {/* Enhancement 2: Asset class tags */}
                            {(task.assetClassCodes || []).length > 0 && (
                                <div className="flex flex-wrap gap-1 mb-3">
                                    {task.assetClassCodes!.map(code => (
                                        <span key={code} className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary-50 text-primary-700 border border-primary-200 flex items-center gap-0.5">
                                            <Tag size={9} /> {code}
                                        </span>
                                    ))}
                                </div>
                            )}

                            <p className="text-sm text-slate-600 line-clamp-3 mb-4 flex-1">
                                {task.description || 'No description provided.'}
                            </p>

                            <div className="pt-4 border-t border-slate-100 flex justify-between items-center text-xs text-slate-500">
                                <div className="flex items-center gap-3">
                                    <span className="flex items-center gap-1"><Clock size={12} /> {task.estimatedDuration}h</span>
                                    <span className="flex items-center gap-1"><CheckSquare size={12} /> {task.instructions?.length || 0} Steps</span>
                                </div>
                                <span className="flex items-center gap-1"><Layers size={12} /> {(task.inventory?.length || 0) + (task.roles?.length || 0)} Res</span>
                            </div>
                        </div>
                    ))}
                    {filteredTasks.length === 0 && (
                        <div className="col-span-full py-12 text-center text-slate-400">
                            <BookOpen className="mx-auto mb-4 opacity-50" size={48} />
                            <p>No templates found matching your search.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Modal */}
            {showModal && editingTask && (
                <TaskEditorModal
                    task={editingTask}
                    onClose={() => setShowModal(false)}
                    onSave={async (t, inv, roles, files) => {
                        try {
                            if (!t.id) {
                                // Create
                                await db.createLibraryTask(t, inv, roles, files, user?.id || 'unknown');
                            } else {
                                // Update
                                await db.updateLibraryTask(t.id, t, inv, roles, files);
                            }
                            setShowModal(false);
                            loadTasks();
                        } catch (e: any) {
                            alert("Error: " + e.message);
                        }
                    }}
                />
            )}
        </div>
    );
};

// --- Sub-Component: Task Editor Modal ---

const TaskEditorModal: React.FC<{
    task: LibraryTask;
    onClose: () => void;
    onSave: (task: LibraryTask, inventory: any[], roles: any[], files: any[]) => Promise<void>;
}> = ({ task, onClose, onSave }) => {
    // Local State
    const [formData, setFormData] = useState<LibraryTask>(task);
    // Separate state for relations because they might be complex
    const [inventory, setInventory] = useState<any[]>(task.inventory || []);
    const [roles, setRoles] = useState<any[]>(task.roles || []);
    const [localFiles, setLocalFiles] = useState<any[]>(task.files || []);

    // AI State
    const [isThinking, setIsThinking] = useState(false);

    // Heuristic AI Suggestion
    const handleAutoSuggest = () => {
        setIsThinking(true);
        setTimeout(() => {
            // Heuristics based on description
            const desc = (formData.description + " " + formData.title).toLowerCase();
            const newRoles = [...roles];
            const newInventory = [...inventory]; // In real app, we'd search DB

            // Roles
            if (desc.includes('electrical') || desc.includes('wire') || desc.includes('motor')) {
                if (!newRoles.find(r => r.roleCode === 'ELEC')) {
                    newRoles.push({ roleCode: 'ELEC', quantity: 1, estimatedHours: formData.estimatedDuration || 2 });
                }
            }
            if (desc.includes('pump') || desc.includes('bearing') || desc.includes('seal')) {
                if (!newRoles.find(r => r.roleCode === 'MECH')) {
                    newRoles.push({ roleCode: 'MECH', quantity: 1, estimatedHours: formData.estimatedDuration || 2 });
                }
            }

            // Inventory (Mock suggestions)
            if (desc.includes('bearing')) {
                newInventory.push({ inventoryItemId: 'mock-bearing-id', itemDescription: 'Ball Bearing 6205', quantity: 1, notes: 'Auto-suggested' });
            }
            if (desc.includes('filter')) {
                newInventory.push({ inventoryItemId: 'mock-filter-id', itemDescription: 'Oil Filter Type A', quantity: 1 });
            }

            setRoles(newRoles);
            setInventory(newInventory);

            // Suggest Time
            if (desc.includes('service') && formData.estimatedDuration === 0) {
                setFormData(prev => ({ ...prev, estimatedDuration: 2 }));
            } else if (desc.includes('inspect') && formData.estimatedDuration === 0) {
                setFormData(prev => ({ ...prev, estimatedDuration: 1 }));
            }

            setIsThinking(false);
        }, 1500);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95">
                <div className="p-4 border-b flex justify-between items-center bg-slate-50">
                    <h3 className="font-bold text-lg text-slate-800">{formData.id ? 'Edit Template' : 'New Library Task'}</h3>
                    <button onClick={onClose}><X size={20} className="text-slate-400 hover:text-slate-600" /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* Enhancement 3: MoC Warning for locked templates */}
                    {formData.isLocked && (
                        <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 flex items-start gap-3">
                            <AlertTriangle size={20} className="text-amber-600 mt-0.5 flex-shrink-0" />
                            <div>
                                <h4 className="font-bold text-amber-800 text-sm">Template Locked — Management of Change Required</h4>
                                <p className="text-xs text-amber-700 mt-1">
                                    This template is locked because it has been used on a completed Work Order. Direct edits are not permitted.
                                    To modify, use <strong>"Create New Version"</strong> from the template card to create an unlocked copy.
                                </p>
                                <p className="text-[10px] text-amber-500 mt-1">
                                    Locked at: {formData.lockedAt ? new Date(formData.lockedAt).toLocaleString() : 'Unknown'} | Locked by: {formData.lockedBy || 'System'}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Core Info */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Task Code</label>
                            <input
                                className="w-full p-2 border rounded text-sm font-mono"
                                value={formData.code}
                                onChange={e => setFormData({ ...formData, code: e.target.value })}
                                placeholder="e.g. MAINT-PUMP-01"
                                disabled={formData.isLocked}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Category</label>
                            <select
                                className="w-full p-2 border rounded text-sm"
                                value={formData.category}
                                onChange={e => setFormData({ ...formData, category: e.target.value as any })}
                                disabled={formData.isLocked}
                            >
                                <option value="MAINTENANCE">Maintenance</option>
                                <option value="INSPECTION">Inspection</option>
                                <option value="SAFETY">Safety</option>
                                <option value="PROJECT">Project</option>
                            </select>
                        </div>

                        {/* Enhancement 2: Asset Class Association */}
                        <div className="col-span-2">
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                                <Tag size={11} className="inline mr-1" /> Asset Classes (ISO 14224)
                            </label>
                            <div className="flex flex-wrap gap-1.5 p-2 border rounded bg-white min-h-[38px]">
                                {(formData.assetClassCodes || []).map(code => (
                                    <span key={code} className="px-2 py-0.5 bg-primary-50 text-primary-700 border border-primary-200 rounded text-xs font-medium flex items-center gap-1">
                                        {code}
                                        {!formData.isLocked && (
                                            <button
                                                onClick={() => setFormData({
                                                    ...formData,
                                                    assetClassCodes: (formData.assetClassCodes || []).filter(c => c !== code)
                                                })}
                                                className="text-primary-400 hover:text-red-500 ml-0.5"
                                            >
                                                <X size={10} />
                                            </button>
                                        )}
                                    </span>
                                ))}
                                {!formData.isLocked && (
                                    <select
                                        className="text-xs border-0 bg-transparent text-slate-400 focus:outline-none cursor-pointer"
                                        value=""
                                        onChange={e => {
                                            const val = e.target.value;
                                            if (val && !(formData.assetClassCodes || []).includes(val)) {
                                                setFormData({
                                                    ...formData,
                                                    assetClassCodes: [...(formData.assetClassCodes || []), val]
                                                });
                                            }
                                        }}
                                    >
                                        <option value="">+ Add class...</option>
                                        {['PUMP', 'COMPRESSOR', 'TURBINE', 'MOTOR', 'GENERATOR', 'VALVE', 'HEAT_EXCHANGER',
                                          'VESSEL', 'PIPING', 'CRANE', 'CONVEYOR', 'INSTRUMENT', 'ELECTRICAL', 'HVAC', 'SAFETY_SYSTEM'
                                        ].filter(c => !(formData.assetClassCodes || []).includes(c)).map(c => (
                                            <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
                                        ))}
                                    </select>
                                )}
                            </div>
                            <p className="text-[10px] text-slate-400 mt-1">Tag templates to specific equipment classes for contextual filtering in WO/PM pickers.</p>
                        </div>

                        <div className="col-span-2">
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Title</label>
                            <input
                                className="w-full p-2 border rounded text-sm font-bold"
                                value={formData.title}
                                onChange={e => setFormData({ ...formData, title: e.target.value })}
                                placeholder="e.g. Monthly Pump Inspection"
                                disabled={formData.isLocked}
                            />
                        </div>
                        <div className="col-span-2">
                            <div className="flex justify-between items-center mb-1">
                                <label className="block text-xs font-bold text-slate-500 uppercase">Description / Scope</label>
                                <button
                                    onClick={handleAutoSuggest}
                                    type="button"
                                    disabled={isThinking || formData.isLocked}
                                    className="text-xs flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium px-2 py-1 bg-blue-50 rounded-full border border-blue-100 transition-colors disabled:opacity-50"
                                >
                                    <Sparkles size={12} className={isThinking ? "animate-spin" : ""} />
                                    {isThinking ? 'Analyzing Task...' : 'Auto-Suggest Resources'}
                                </button>
                            </div>
                            <textarea
                                className="w-full p-2 border rounded text-sm h-24"
                                value={formData.description}
                                onChange={e => setFormData({ ...formData, description: e.target.value })}
                                placeholder="Describe the task in detail. The AI can use this to suggest parts."
                                disabled={formData.isLocked}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Est. Hours</label>
                            <input
                                type="number"
                                className="w-full p-2 border rounded text-sm"
                                value={formData.estimatedDuration}
                                onChange={e => setFormData({ ...formData, estimatedDuration: parseFloat(e.target.value) })}
                                disabled={formData.isLocked}
                            />
                        </div>
                    </div>

                    {/* Resources Preview Section (Mock) */}
                    <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                        <h4 className="font-bold text-sm text-slate-700 mb-3 flex items-center gap-2"><Wrench size={14} /> Required Resources</h4>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {/* Roles */}
                            <div className="bg-white p-3 rounded border border-slate-200">
                                <h5 className="text-xs font-bold text-slate-500 uppercase mb-2">Labour / Roles</h5>
                                {roles.length === 0 ? <p className="text-xs text-slate-400 italic">No roles specified.</p> : (
                                    <ul className="space-y-1">
                                        {roles.map((r, i) => (
                                            <li key={i} className="text-sm flex justify-between">
                                                <span>{r.roleCode}</span>
                                                <span className="text-slate-500 text-xs">x{r.quantity} ({r.estimatedHours}h)</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>

                            {/* Inventory */}
                            <div className="bg-white p-3 rounded border border-slate-200">
                                <h5 className="text-xs font-bold text-slate-500 uppercase mb-2">Spare Parts</h5>
                                {inventory.length === 0 ? <p className="text-xs text-slate-400 italic">No parts specified.</p> : (
                                    <ul className="space-y-1">
                                        {inventory.map((item, i) => (
                                            <li key={i} className="text-sm flex justify-between">
                                                <span className="truncate pr-2">{item.itemDescription || item.inventoryItemId}</span>
                                                <span className="text-slate-500 text-xs text-nowrap">x{item.quantity}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Files Section */}
                    <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                        <div className="flex justify-between items-center mb-3">
                            <h4 className="font-bold text-sm text-slate-700 flex items-center gap-2"><FileText size={14} /> Attachments & Media</h4>
                            <button
                                type="button"
                                onClick={async () => {
                                    const url = await confirm.prompt({
                                        title: 'Add Document or Media Link',
                                        message: 'Enter direct URL to technical document or manual:',
                                        defaultValue: 'https://example.com/manual.pdf',
                                        placeholder: 'https://...',
                                        confirmLabel: 'Attach File',
                                        icon: <FileText size={20} className="text-blue-600" />
                                    });
                                    if (url) {
                                        const name = url.split('/').pop() || 'file';
                                        setLocalFiles([...localFiles, {
                                            name: name,
                                            url: url,
                                            type: 'DOCUMENT'
                                        }]);
                                    }
                                }}
                                className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 font-medium"
                            >
                                <Plus size={12} /> Add File
                            </button>
                        </div>

                        {localFiles.length === 0 ? (
                            <p className="text-xs text-slate-400 italic">No files attached.</p>
                        ) : (
                            <ul className="space-y-2">
                                {localFiles.map((file, i) => (
                                    <li key={i} className="flex items-center justify-between bg-white p-2 rounded border border-slate-200 text-sm">
                                        <div className="flex items-center gap-2 truncate">
                                            <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center text-slate-500 text-xs uppercase font-bold">
                                                {file.type ? (file.type.includes('/') ? file.type.split('/')[1] : file.type) : 'FILE'}
                                            </div>
                                            <div>
                                                <div className="font-medium text-slate-700 truncate">{file.name}</div>
                                                <div className="text-xs text-slate-400">{file.uploadedAt || 'Just now'}</div>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => setLocalFiles(localFiles.filter((_, idx) => idx !== i))}
                                            className="text-slate-400 hover:text-red-500"
                                        >
                                            <X size={14} />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <div className="border border-slate-200 rounded-lg p-4 bg-white">
                        <h4 className="font-bold text-sm text-slate-700 mb-3 flex items-center gap-2"><ClipboardList size={14} /> Procedure Steps</h4>
                        <ProcedureBuilder
                            instructions={formData.instructions || []}
                            onChange={(blocks) => setFormData({ ...formData, instructions: blocks })}
                            mode="EDIT"
                        />
                    </div>

                </div>

                <div className="p-4 border-t bg-slate-50 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg text-sm font-medium">Cancel</button>
                    <button
                        onClick={() => onSave(formData, inventory, roles, localFiles)}
                        className="px-6 py-2 bg-primary-600 text-white rounded-lg text-sm font-bold hover:bg-primary-500 shadow-sm"
                    >
                        Save Template
                    </button>
                </div>
            </div>
        </div>
    );
}
