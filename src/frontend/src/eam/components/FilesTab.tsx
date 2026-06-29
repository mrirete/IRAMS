import React, { useState, useRef, useMemo } from 'react';
import { Paperclip, Plus, Trash2, Download, Loader2, X, Edit3, Filter, Tag, Link2 } from 'lucide-react';
import { WorkOrder, JobFile, JobTask, DocumentCategory, DOCUMENT_CATEGORY_META } from '../types';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { useAuth } from '../contexts/AuthContext';
import { DatabaseService } from '../services/DatabaseService';
import { ImageGallery } from './ui/ImageGallery';

const ACCEPTED_DOC_TYPES = '.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.rtf,.dwg,.dxf,.png,.jpg,.jpeg,.gif,.webp,.svg,.zip,.rar';
const MAX_FILE_SIZE_MB = 50;
const ALL_CATEGORIES = Object.keys(DOCUMENT_CATEGORY_META) as DocumentCategory[];

function formatFileSize(bytes?: number): string {
    if (!bytes || bytes === 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getExtLabel(name: string): string {
    return name.split('.').pop()?.toUpperCase() || 'FILE';
}

function autoDetectCategory(fileName: string, mimeType: string): DocumentCategory | undefined {
    const lower = fileName.toLowerCase();
    if (/p[&]?id|piping.*instrument/i.test(lower) || lower.includes('pid')) return 'PID';
    if (/\.dwg$|\.dxf$/.test(lower)) return 'DRAWING';
    if (/manual|oem|handbook/i.test(lower)) return 'OEM_MANUAL';
    if (/datasheet|data.sheet|spec.sheet/i.test(lower)) return 'DATASHEET';
    if (/procedure|sop|work.instruction/i.test(lower)) return 'PROCEDURE';
    if (/safety|jsa|jha|hazard|msds|sds/i.test(lower)) return 'SAFETY';
    if (/report|summary|analysis/i.test(lower)) return 'REPORT';
    if (mimeType.startsWith('image/')) return 'PHOTO';
    if (/\.xls|\.xlsx|\.csv/.test(lower)) return 'SPREADSHEET';
    return undefined;
}

// ── Upload Modal ──
interface UploadItem { file: File; category?: DocumentCategory; description: string; taskId?: string; }

const UploadModal: React.FC<{
    items: UploadItem[];
    tasks: JobTask[];
    onConfirm: (items: UploadItem[]) => void;
    onCancel: () => void;
}> = ({ items: initialItems, tasks, onConfirm, onCancel }) => {
    const [items, setItems] = useState<UploadItem[]>(initialItems);
    const update = (i: number, patch: Partial<UploadItem>) => {
        const next = [...items]; next[i] = { ...next[i], ...patch }; setItems(next);
    };
    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onCancel}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b border-slate-200 flex justify-between items-center">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2"><Tag size={18} className="text-relantern-500" /> Classify Documents</h3>
                    <button onClick={onCancel} className="p-1.5 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
                </div>
                <div className="p-4 overflow-y-auto flex-1 space-y-3">
                    {items.map((item, i) => {
                        const catMeta = item.category ? DOCUMENT_CATEGORY_META[item.category] : null;
                        return (
                            <div key={i} className="border border-slate-200 rounded-xl p-3 space-y-2 bg-slate-50/50">
                                <div className="flex items-center gap-2">
                                    <span className="text-lg">{catMeta?.icon || '📎'}</span>
                                    <span className="font-semibold text-sm text-slate-800 truncate flex-1">{item.file.name}</span>
                                    <span className="text-[10px] text-slate-400">{formatFileSize(item.file.size)}</span>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-500 uppercase mb-0.5 block">Category</label>
                                        <select value={item.category || ''} onChange={e => update(i, { category: (e.target.value || undefined) as DocumentCategory | undefined })}
                                            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:ring-2 focus:ring-relantern-300 focus:border-relantern-400">
                                            <option value="">— Auto / None —</option>
                                            {ALL_CATEGORIES.map(c => <option key={c} value={c}>{DOCUMENT_CATEGORY_META[c].icon} {DOCUMENT_CATEGORY_META[c].label}</option>)}
                                        </select>
                                    </div>
                                    {tasks.length > 0 && (
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-500 uppercase mb-0.5 block">Link to Task</label>
                                            <select value={item.taskId || ''} onChange={e => update(i, { taskId: e.target.value || undefined })}
                                                className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:ring-2 focus:ring-relantern-300 focus:border-relantern-400">
                                                <option value="">— Work Order Level —</option>
                                                {tasks.map(t => <option key={t.id} value={t.id}>Task {t.sequence}: {t.description.substring(0, 40)}</option>)}
                                            </select>
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase mb-0.5 block">Description (optional)</label>
                                    <input type="text" value={item.description} onChange={e => update(i, { description: e.target.value })}
                                        placeholder="e.g. Compressor P&ID Rev.3, OEM service manual Ch.5…"
                                        className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-relantern-300 focus:border-relantern-400" />
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div className="p-4 border-t border-slate-200 flex justify-end gap-2">
                    <button onClick={onCancel} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                    <button onClick={() => onConfirm(items)} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-500 font-medium shadow-sm">
                        Upload {items.length} Document{items.length !== 1 ? 's' : ''}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ── Main FilesTab ──
export const FilesTab: React.FC<{ job: WorkOrder; onUpdate: (u: Partial<WorkOrder>) => void; tasks: JobTask[] }> = ({ job, onUpdate, tasks }) => {
    const { profile } = useAuth();
    const { showToast } = useToast();
    const confirm = useConfirm();
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState('');
    const [isDragOver, setIsDragOver] = useState(false);
    const [activeFilter, setActiveFilter] = useState<DocumentCategory | 'ALL'>('ALL');
    const [editingFileId, setEditingFileId] = useState<string | null>(null);
    const [pendingUpload, setPendingUpload] = useState<UploadItem[] | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const db = DatabaseService.getInstance();
    const isReadonly = job.status === 'CLOSED';

    const files = job.files || [];

    // Category counts
    const categoryCounts = useMemo(() => {
        const counts: Record<string, number> = { ALL: files.length };
        ALL_CATEGORIES.forEach(c => { counts[c] = 0; });
        files.forEach(f => { const cat = f.category || 'OTHER'; counts[cat] = (counts[cat] || 0) + 1; });
        return counts;
    }, [files]);

    // Filtered files
    const filteredFiles = useMemo(() => {
        if (activeFilter === 'ALL') return files;
        return files.filter(f => (f.category || 'OTHER') === activeFilter);
    }, [files, activeFilter]);

    // Grouped files (when filter is ALL)
    const groupedFiles = useMemo(() => {
        if (activeFilter !== 'ALL') return null;
        const groups: Record<string, JobFile[]> = {};
        files.forEach(f => {
            const cat = f.category || 'OTHER';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(f);
        });
        return groups;
    }, [files, activeFilter]);

    // Stage files for classification before upload
    const stageFiles = (fileList: FileList | null) => {
        if (!fileList || fileList.length === 0) return;
        const arr = Array.from(fileList);
        const oversized = arr.filter(f => f.size > MAX_FILE_SIZE_MB * 1024 * 1024);
        if (oversized.length > 0) {
            showToast(`File(s) exceed ${MAX_FILE_SIZE_MB}MB limit: ${oversized.map(f => f.name).join(', ')}`, 'error');
            return;
        }
        const items: UploadItem[] = arr.map(f => ({
            file: f,
            category: autoDetectCategory(f.name, f.type),
            description: '',
            taskId: undefined,
        }));
        setPendingUpload(items);
    };

    // Execute upload after classification
    const executeUpload = async (items: UploadItem[]) => {
        setPendingUpload(null);
        setIsUploading(true);
        const newFiles: JobFile[] = [];
        const uploaderName = profile?.username || profile?.fullName || 'Unknown User';

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            setUploadProgress(`Uploading ${i + 1} of ${items.length}: ${item.file.name}`);
            try {
                const url = await db.uploadFile(item.file, 'work-order-docs', 'wo_doc_');
                const jobFile: JobFile = {
                    id: `file-${Date.now()}-${i}`,
                    name: item.file.name,
                    type: item.file.type || 'application/octet-stream',
                    url,
                    uploadedBy: uploaderName,
                    uploadedAt: new Date().toISOString(),
                    sizeBytes: item.file.size,
                    category: item.category,
                    description: item.description || undefined,
                    taskId: item.taskId,
                };
                newFiles.push(jobFile);

                try {
                    await db.addEntityFile({
                        entityId: job.id, entityType: 'WORK_ORDER', name: item.file.name, url,
                        type: item.file.type || 'application/octet-stream', sizeBytes: item.file.size,
                        uploadedBy: uploaderName, category: item.category, description: item.description || undefined,
                        taskId: item.taskId,
                    });
                } catch { /* entity_files best-effort */ }

                try {
                    const catLabel = item.category ? DOCUMENT_CATEGORY_META[item.category].label : 'Uncategorized';
                    await db.addJournalEntry(job.id, 'WORK_ORDER', {
                        type: 'DOCUMENT',
                        description: `Document uploaded: ${item.file.name} [${catLabel}] (${formatFileSize(item.file.size)})`,
                        createdBy: uploaderName
                    });
                } catch { /* journal best-effort */ }
            } catch (err: any) {
                console.error(`Upload failed for ${item.file.name}:`, err);
                showToast(`Failed to upload ${item.file.name}: ${err?.message || 'Unknown error'}`, 'error');
            }
        }

        if (newFiles.length > 0) {
            onUpdate({ files: [...files, ...newFiles] });
            showToast(`${newFiles.length} document(s) uploaded successfully`, 'success');
        }
        setIsUploading(false);
        setUploadProgress('');
    };

    const removeFile = async (fileToRemove: JobFile) => {
        if (isReadonly) return;
        const ok = await confirm({
            title: 'Delete Document',
            message: `"${fileToRemove.name}" will be permanently deleted. This action cannot be undone.`,
            variant: 'danger',
            confirmLabel: 'Delete',
        });
        if (!ok) return;
        try { await db.deleteImage('work-order-docs', fileToRemove.url); } catch { }
        try {
            await db.addJournalEntry(job.id, 'WORK_ORDER', {
                type: 'DOCUMENT', description: `Document deleted: ${fileToRemove.name}`,
                createdBy: profile?.username || profile?.fullName || 'Unknown'
            });
        } catch { }
        onUpdate({ files: files.filter(f => f.id !== fileToRemove.id) });
        showToast('Document removed', 'info');
    };

    const updateFileMeta = async (fileId: string, patch: Partial<JobFile>) => {
        const updated = files.map(f => f.id === fileId ? { ...f, ...patch } : f);
        onUpdate({ files: updated });
        try { await db.updateEntityFile(fileId, patch as any); } catch { }
        setEditingFileId(null);
    };

    const onDragOver = (e: React.DragEvent) => { e.preventDefault(); if (!isReadonly) setIsDragOver(true); };
    const onDragLeave = () => setIsDragOver(false);
    const onDrop = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(false); if (!isReadonly) stageFiles(e.dataTransfer.files); };

    const getTaskLabel = (taskId?: string) => {
        if (!taskId) return null;
        const t = tasks.find(t => t.id === taskId);
        return t ? `Task ${t.sequence}` : null;
    };

    // ── Render file card ──
    const renderFileCard = (f: JobFile) => {
        const catMeta = f.category ? DOCUMENT_CATEGORY_META[f.category] : DOCUMENT_CATEGORY_META.OTHER;
        const isEditing = editingFileId === f.id;
        const taskLabel = getTaskLabel(f.taskId);

        return (
            <div key={f.id} className={`group p-3 border rounded-xl flex items-start gap-3 bg-white hover:shadow-lg hover:border-slate-300 transition-all ${catMeta.border}`}>
                {/* Category Icon */}
                <div className={`w-11 h-11 rounded-xl ${catMeta.bg} flex items-center justify-center text-xl flex-shrink-0 shadow-sm`}>
                    {catMeta.icon}
                </div>
                {/* Content */}
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-slate-800 truncate max-w-[200px]" title={f.name}>{f.name}</span>
                        {f.category && (
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${catMeta.bg} ${catMeta.color} uppercase`}>
                                {catMeta.label}
                            </span>
                        )}
                        {taskLabel && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 flex items-center gap-0.5">
                                <Link2 size={8} /> {taskLabel}
                            </span>
                        )}
                    </div>
                    {/* Description */}
                    {isEditing ? (
                        <div className="mt-1.5 space-y-1.5">
                            <div className="flex gap-1.5">
                                <select value={f.category || ''} onChange={e => updateFileMeta(f.id, { category: (e.target.value || undefined) as DocumentCategory | undefined })}
                                    className="text-[11px] border border-slate-200 rounded px-1.5 py-1 bg-white">
                                    <option value="">No category</option>
                                    {ALL_CATEGORIES.map(c => <option key={c} value={c}>{DOCUMENT_CATEGORY_META[c].icon} {DOCUMENT_CATEGORY_META[c].label}</option>)}
                                </select>
                                {tasks.length > 0 && (
                                    <select value={f.taskId || ''} onChange={e => updateFileMeta(f.id, { taskId: e.target.value || undefined })}
                                        className="text-[11px] border border-slate-200 rounded px-1.5 py-1 bg-white">
                                        <option value="">WO Level</option>
                                        {tasks.map(t => <option key={t.id} value={t.id}>Task {t.sequence}</option>)}
                                    </select>
                                )}
                            </div>
                            <input type="text" defaultValue={f.description || ''} placeholder="Add description…"
                                onBlur={e => updateFileMeta(f.id, { description: e.target.value })}
                                onKeyDown={e => { if (e.key === 'Enter') updateFileMeta(f.id, { description: (e.target as HTMLInputElement).value }); }}
                                className="w-full text-[11px] border border-slate-200 rounded px-2 py-1 focus:ring-1 focus:ring-relantern-300" autoFocus />
                        </div>
                    ) : (
                        <>
                            {f.description && <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{f.description}</p>}
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 uppercase">{getExtLabel(f.name)}</span>
                                {f.sizeBytes ? <span className="text-[10px] text-slate-400">{formatFileSize(f.sizeBytes)}</span> : null}
                                <span className="text-[10px] text-slate-400">•</span>
                                <span className="text-[10px] text-slate-400">{new Date(f.uploadedAt).toLocaleDateString()}</span>
                                <span className="text-[10px] text-slate-400">• {f.uploadedBy}</span>
                            </div>
                        </>
                    )}
                </div>
                {/* Actions */}
                <div className="flex items-center gap-0.5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    {!isReadonly && !isEditing && (
                        <button onClick={() => setEditingFileId(f.id)} title="Edit metadata"
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"><Edit3 size={14} /></button>
                    )}
                    <a href={f.url} target="_blank" rel="noreferrer" title="Download / View"
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition"><Download size={14} /></a>
                    {!isReadonly && (
                        <button onClick={() => removeFile(f)} title="Delete"
                            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"><Trash2 size={14} /></button>
                    )}
                </div>
            </div>
        );
    };

    // ── Render category group ──
    const renderGroup = (cat: string, groupFiles: JobFile[]) => {
        const meta = DOCUMENT_CATEGORY_META[cat as DocumentCategory] || DOCUMENT_CATEGORY_META.OTHER;
        return (
            <div key={cat} className="space-y-2">
                <div className="flex items-center gap-2 py-1">
                    <span className="text-base">{meta.icon}</span>
                    <span className={`text-xs font-bold uppercase ${meta.color}`}>{meta.label}</span>
                    <span className="text-[10px] text-slate-400 font-medium">{groupFiles.length}</span>
                    <div className="flex-1 border-t border-slate-100"></div>
                </div>
                <div className="space-y-2 pl-1">{groupFiles.map(renderFileCard)}</div>
            </div>
        );
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Photo Evidence */}
            <div className="bg-white border border-slate-200 rounded-lg p-4">
                <ImageGallery entityId={job.id} entityType="WORK_ORDER" bucket="assets" prefix="wo_" readonly={isReadonly} />
            </div>

            {/* Document Attachments */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                {/* Header */}
                <div className="p-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <Paperclip size={16} className="text-slate-500" />
                        <h3 className="font-bold text-slate-700">Documents</h3>
                        {files.length > 0 && (
                            <span className="text-xs bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full font-medium">{files.length}</span>
                        )}
                    </div>
                    {!isReadonly && (
                        <button onClick={() => fileInputRef.current?.click()} disabled={isUploading}
                            className="text-xs bg-primary-600 text-white px-3 py-1.5 rounded-lg hover:bg-primary-500 flex items-center gap-1.5 transition disabled:opacity-50 shadow-sm">
                            {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                            {isUploading ? 'Uploading…' : 'Upload Document'}
                        </button>
                    )}
                </div>

                {/* Category Filter Bar */}
                {files.length > 0 && (
                    <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-1.5 overflow-x-auto">
                        <Filter size={12} className="text-slate-400 shrink-0" />
                        <button onClick={() => setActiveFilter('ALL')}
                            className={`text-[10px] font-bold px-2.5 py-1 rounded-full transition whitespace-nowrap ${activeFilter === 'ALL' ? 'bg-slate-800 text-white shadow-sm' : 'bg-white text-slate-500 hover:bg-slate-100 border border-slate-200'}`}>
                            All {categoryCounts.ALL}
                        </button>
                        {ALL_CATEGORIES.filter(c => categoryCounts[c] > 0).map(c => {
                            const meta = DOCUMENT_CATEGORY_META[c];
                            return (
                                <button key={c} onClick={() => setActiveFilter(c)}
                                    className={`text-[10px] font-bold px-2.5 py-1 rounded-full transition whitespace-nowrap flex items-center gap-1 ${activeFilter === c ? `${meta.bg} ${meta.color} shadow-sm ring-1 ${meta.border}` : 'bg-white text-slate-500 hover:bg-slate-100 border border-slate-200'}`}>
                                    <span className="text-xs">{meta.icon}</span> {meta.label} {categoryCounts[c]}
                                </button>
                            );
                        })}
                    </div>
                )}

                {/* Hidden file input */}
                <input ref={fileInputRef} type="file" multiple accept={ACCEPTED_DOC_TYPES} className="hidden"
                    onChange={e => { stageFiles(e.target.files); e.target.value = ''; }} />

                {/* Upload progress */}
                {isUploading && uploadProgress && (
                    <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 flex items-center gap-2">
                        <Loader2 size={14} className="text-blue-500 animate-spin" />
                        <span className="text-xs text-blue-700 font-medium">{uploadProgress}</span>
                    </div>
                )}

                {/* Drop zone + file list */}
                <div className={`p-4 transition-colors ${isDragOver ? 'bg-relantern-50 ring-2 ring-inset ring-relantern-300' : ''}`}
                    onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
                    {files.length === 0 ? (
                        <div className={`py-16 text-center border-2 border-dashed rounded-xl cursor-pointer transition-all
                            ${isDragOver ? 'border-relantern-400 bg-relantern-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}
                            onClick={() => !isReadonly && fileInputRef.current?.click()}>
                            <Paperclip size={40} className="mx-auto mb-3 text-slate-300" />
                            <p className="text-sm font-medium text-slate-500">
                                {isReadonly ? 'No documents attached' : 'Drag & drop files here, or click to browse'}
                            </p>
                            {!isReadonly && (
                                <p className="text-xs text-slate-400 mt-1">
                                    P&IDs, Manuals, Data Sheets, Drawings, Safety Docs — Max {MAX_FILE_SIZE_MB}MB per file
                                </p>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* Grouped view when ALL filter is active */}
                            {groupedFiles ? (
                                Object.entries(groupedFiles)
                                    .sort(([a], [b]) => ALL_CATEGORIES.indexOf(a as DocumentCategory) - ALL_CATEGORIES.indexOf(b as DocumentCategory))
                                    .map(([cat, gFiles]) => renderGroup(cat, gFiles))
                            ) : (
                                <div className="space-y-2">{filteredFiles.map(renderFileCard)}</div>
                            )}

                            {/* Add more zone */}
                            {!isReadonly && (
                                <div onClick={() => fileInputRef.current?.click()}
                                    className="p-3 border border-dashed border-slate-200 rounded-lg text-center cursor-pointer hover:border-relantern-300 hover:bg-relantern-50/30 transition-all">
                                    <span className="text-xs text-slate-400 font-medium">+ Drop or click to add more documents</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Upload Classification Modal */}
            {pendingUpload && (
                <UploadModal items={pendingUpload} tasks={tasks} onConfirm={executeUpload} onCancel={() => setPendingUpload(null)} />
            )}
        </div>
    );
};
