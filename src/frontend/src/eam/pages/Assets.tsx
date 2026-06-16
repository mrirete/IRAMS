
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    Search, Filter, Plus, ChevronRight, Activity, Zap, FileText,
    Package, DollarSign, Wrench, History, Box, Camera, AlertCircle, X,
    TrendingUp, TrendingDown, Clock, Link, CheckCircle, BarChart2,
    MapPin, Building, Factory, Save, Trash2, Copy, FolderPlus, Network,
    LineChart as LineChartIcon, CornerDownRight, ArrowUpRight, Upload, ChevronDown, Repeat,
    Download, FileSpreadsheet, QrCode, Lock, Shapes, XCircle, Hash, Layers, Cpu, FolderInput, Unlink, AlertTriangle
} from 'lucide-react';
import { UnifiedDetailHeader } from '../components/ui/UnifiedDetailHeader';
import { UnifiedTabBar } from '../components/ui/UnifiedTabBar';
import { ImageCapture } from '../components/ui/ImageCapture';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import {
    MOCK_ASSETS, MOCK_WORK_ORDERS, MOCK_CONTACTS, MOCK_DICTIONARIES,
    MOCK_READING_DEFINITIONS, MOCK_READING_LOGS, MOCK_RECURRING_JOBS
} from '../constants';
import { Asset, AssetStatus, WorkOrder, ReadingDefinition, ReadingLogEntry, Contact, DictionaryEntry, BomItem, RecurringJob, Vendor } from '../types';

import { DatabaseService } from '../services/DatabaseService';
import { errorLog } from '../services/ErrorLogService';
import { DataMapper } from '../services/DataMapper';
import BulkImportModal from '../components/modals/BulkImportModal';
import { exportAssetsToXLSX, exportAssetsToCSV } from '../services/assetTemplates';

import { AddContactModal } from '../components/modals/AddContactModal';
import { SearchableDropdown } from '../components/ui/SearchableDropdown';
import { FinancialsTab } from '../components/FinancialsTab';
import { FinOpsService } from '../services/FinOpsService';
import { ConfirmationModal } from '../components/modals/ConfirmationModal';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { AskRelanternButton } from '../components/AskRelanternButton';
import { aiContextService } from '../services/AIContextService';
import { AssetQRCode } from '../components/AssetQRCode';
import { FloatingActionButton } from '../components/ui/FloatingActionButton';
import { Button } from '../components/ui';
import { ReliabilityIntelligenceTab } from '../components/ReliabilityIntelligenceTab';

interface AssetsProps {
    onAnalyze?: (context: string) => void;
}

type TabId =
    | 'details' | 'hierarchy' | 'bom' | 'readings' | 'reliability'
    | 'jobs' | 'financials' | 'journals' | 'files' | 'tracking';




export const Assets: React.FC<AssetsProps> = ({ onAnalyze }) => {

    // Navigation
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    // Auth & Permissions
    const { permissions, profile, dataScope } = useAuth();
    const { showToast } = useToast();
    const canCreate = permissions?.assets?.create === true;
    const canEdit = permissions?.assets?.edit === true;
    const canDelete = permissions?.assets?.delete === true;

    console.log("Assets permissions check:", { canCreate, canEdit, canDelete, permissionsAssets: permissions?.assets });

    // Loading states
    const [saving, setSaving] = useState(false);

    // Debounce ref for asset detail auto-save
    const assetSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Cleanup debounce timer on unmount
    useEffect(() => {
        return () => {
            if (assetSaveTimerRef.current) clearTimeout(assetSaveTimerRef.current);
        };
    }, []);

    // State for Assets List
    const [assets, setAssets] = useState<Asset[]>([]); // Start empty
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [costCenters, setCostCenters] = useState<any[]>([]); // New Cost Centers state
    const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState<TabId>('details');
    const [aiContextForAsset, setAiContextForAsset] = useState<string>('');

    // Auto-reset tab when switching to a location that doesn't support the current tab
    // (e.g., user was on BOM tab for equipment, then clicks a location via breadcrumbs)
    useEffect(() => {
        if (selectedAsset && isLocation(selectedAsset) && (activeTab === 'bom' || activeTab === 'readings')) {
            setActiveTab('details');
        }
    }, [selectedAsset]);

    // ── Pre-build rich AI context when selected asset changes ──
    useEffect(() => {
        if (!selectedAsset) {
            setAiContextForAsset('');
            return;
        }
        let cancelled = false;
        aiContextService.buildAssetContext(selectedAsset.id).then(ctx => {
            if (!cancelled) setAiContextForAsset(ctx);
        });
        return () => { cancelled = true; };
    }, [selectedAsset?.id]);

    // Load from DB
    const refreshContacts = async () => {
        try {
            const contactData = await DatabaseService.getInstance().getContacts();
            setContacts(contactData);
        } catch (e) {
            console.error("Failed to refresh contacts", e);
        }
    };

    React.useEffect(() => {
        const load = async () => {
            try {
                const results = await Promise.allSettled([
                    DatabaseService.getInstance().getAssets(),
                    DatabaseService.getInstance().getContacts(),
                    FinOpsService.getCostCenters(),
                    DatabaseService.getInstance().getVendors()
                ]);
                // Each result resolves independently — one failure won't blank the page
                if (results[0].status === 'fulfilled') {
                    const scopedAssets = DatabaseService.filterAssetsBySiteScope(results[0].value, dataScope?.siteIds);
                    console.log(`[Assets] Site scope filter: ${results[0].value.length} → ${scopedAssets.length} assets (siteIds: ${dataScope?.siteIds || 'global'})`);
                    setAssets(scopedAssets);
                }
                else console.error("Failed to load assets", results[0].reason);

                if (results[1].status === 'fulfilled') setContacts(results[1].value);
                else console.error("Failed to load contacts", results[1].reason);

                if (results[2].status === 'fulfilled') setCostCenters(results[2].value);
                else console.warn("Cost centers unavailable", results[2].reason);

                if (results[3].status === 'fulfilled') setVendors(results[3].value);
                else console.warn("Vendors unavailable", results[3].reason);
            } catch (err) {
                console.error("Unexpected error in asset load", err);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [dataScope]); // Re-run when user's data scope changes (e.g. user switch)

    // Auto-select asset from URL query param ?id=<asset_id>
    React.useEffect(() => {
        const targetId = searchParams.get('id');
        if (targetId && assets.length > 0 && !selectedAsset) {
            const match = assets.find(a => a.id === targetId);
            if (match) {
                setSelectedAsset(match);
                // Clear the param so back-navigation doesn't re-trigger
                setSearchParams({}, { replace: true });
            }
        }
    }, [searchParams, assets, selectedAsset, setSearchParams]);

    // Auto-open Add Asset modal when navigated with ?action=create (from Dashboard quick actions)
    React.useEffect(() => {
        if (searchParams.get('action') === 'create') {
            setIsAddModalOpen(true);
            setSearchParams({}, { replace: true }); // Clean URL to prevent re-trigger on refresh
        }
    }, [searchParams, setSearchParams]);

    // Move-to-Parent Modal State (replaces drag/drop)
    const [isMoveToParentOpen, setIsMoveToParentOpen] = useState(false);
    const [moveTargetSearch, setMoveTargetSearch] = useState('');
    const [moveTargetId, setMoveTargetId] = useState<string | null>(null);

    // State for Reading Definitions (Lifted to allow adding)
    const [readingDefs, setReadingDefs] = useState<ReadingDefinition[]>([]);

    // Dictionary State
    const [dictionaries, setDictionaries] = useState<DictionaryEntry[]>([]);
    const [assetTypes, setAssetTypes] = useState<any[]>([]);

    React.useEffect(() => {
        const loadDicts = async () => {
            const dicts = await DatabaseService.getInstance().getDictionaries();
            setDictionaries(dicts);
            setAssetTypes(dicts.filter(d => d.type === 'ASSET_TYPE' && d.active));
        };
        loadDicts();
    }, []);


    // Modal State
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [addType, setAddType] = useState<'Asset' | 'Location'>('Asset');
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; assetId: string | null; assetTag: string | null }>({
        isOpen: false,
        assetId: null,
        assetTag: null
    });
    const [isDetachConfirmOpen, setIsDetachConfirmOpen] = useState(false);
    const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [showMassChange, setShowMassChange] = useState(false);

    // Asset Tag editability: SAP PM best practice — tag is immutable after first save.
    // Only editable for freshly created or duplicated assets (one-time setup).
    const [tagEditable, setTagEditable] = useState(false);

    // --- Tree & Selection State ---
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const [expandedBOMIds, setExpandedBOMIds] = useState<Set<string>>(new Set());

    const toggleSelection = (id: string) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedIds(next);
    };

    const toggleExpansion = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const next = new Set(expandedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setExpandedIds(next);
    };

    const toggleBOMExpansion = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const next = new Set(expandedBOMIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setExpandedBOMIds(next);
    };

    const selectAll = () => {
        if (selectedIds.size === assets.length) setSelectedIds(new Set());
        else setSelectedIds(new Set(assets.map(a => a.id)));
    };

    // --- Tree Logic ---
    type TreeNode = Asset & {
        children: TreeNode[];
        depth: number;
        isLastChild: boolean;       // Is this the last sibling in its parent's children?
        ancestorLastFlags: boolean[]; // For each ancestor depth, true = that ancestor was the last child (no continuing vertical line)
    };

    const treeData = useMemo(() => {
        if (searchTerm) {
            return assets.filter(a =>
                a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                a.tag.toLowerCase().includes(searchTerm.toLowerCase())
            ).map(a => ({ ...a, children: [], depth: 0, isLastChild: false, ancestorLastFlags: [] }));
        }

        const buildTree = (parentId: string | null | undefined, depth: number): TreeNode[] => {
            const siblings = assets
                .filter(a => (parentId ? a.parentId === parentId : !a.parentId))
                .sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true, sensitivity: 'base' }));
            return siblings.map((a, idx) => ({
                ...a,
                depth,
                isLastChild: idx === siblings.length - 1,
                ancestorLastFlags: [], // filled during flatten
                children: buildTree(a.id, depth + 1)
            }));
        };

        const flatten = (nodes: TreeNode[], parentFlags: boolean[] = []): TreeNode[] => {
            let result: TreeNode[] = [];
            for (const node of nodes) {
                node.ancestorLastFlags = parentFlags;
                result.push(node);
                if (expandedIds.has(node.id)) {
                    result = result.concat(flatten(node.children, [...parentFlags, node.isLastChild]));
                }
            }
            return result;
        };

        const roots = buildTree(null, 0);
        return flatten(roots);
    }, [assets, searchTerm, expandedIds]);


    const handleAddReadingDef = (assetId: string, typeCode: string) => {
        const dictEntry = MOCK_DICTIONARIES.find(d => d.type === 'READING_TYPE' && d.code === typeCode);
        if (!dictEntry) return;

        const newDef: ReadingDefinition = {
            id: `def-${Date.now()}`,
            assetId: assetId,
            readingTypeCode: dictEntry.code,
            name: dictEntry.description,
            unit: 'Unit', // Simplified
            category: dictEntry.categoryCode === 'Meter Reading' ? 'METER' : 'CONDITION',
            isActive: true,
            minWarning: 0,
            maxCritical: 100,
        };
        setReadingDefs([...readingDefs, newDef]);
    };

    const getStatusColor = (status: AssetStatus) => {
        switch (status) {
            case AssetStatus.ACTIVE: return 'bg-green-100 text-green-700 border-green-200';
            case AssetStatus.MAINTENANCE: return 'bg-amber-100 text-amber-700 border-amber-200';
            case AssetStatus.STANDBY: return 'bg-blue-100 text-blue-700 border-blue-200';
            case AssetStatus.DOWN: return 'bg-red-100 text-red-700 border-red-200';
            case AssetStatus.DECOMMISSIONED: return 'bg-slate-200 text-slate-500 border-slate-300';
            default: return 'bg-slate-100 text-slate-600 border-slate-200';
        }
    };

    const getAssetIcon = (asset: Asset) => {
        // Use typeCode if available, else fallback to category
        const type = (asset.assetType || asset.category || '').toUpperCase();
        if (type === 'SITE') return <Building size={18} className="text-blue-600" />;
        if (type === 'AREA') return <Factory size={18} className="text-blue-600" />;
        if (type === 'UNIT') return <Network size={18} className="text-blue-600" />;
        if (type === 'SYSTEM') return <FolderPlus size={18} className="text-teal-600" />;
        if (type === 'PUMP' || type === 'MOTOR' || type === 'COMPRESSOR') return <Activity size={18} className="text-slate-500" />;
        return <Package size={18} className="text-slate-400" />;
    };


    const handleUpdateAsset = async (updatedAsset: Asset) => {
        if (!canEdit) {
            showToast("You do not have permission to edit assets.", 'error');
            return;
        }
        // 1. Optimistic Update (List) — instant, no lag
        setAssets(prev => prev.map(a => a.id === updatedAsset.id ? updatedAsset : a));

        // 2. Update Selection if active — keeps banner/header in sync
        if (selectedAsset?.id === updatedAsset.id) {
            setSelectedAsset(updatedAsset);
        }

        // 3. Debounced DB persist — wait 1.5s after last change
        if (assetSaveTimerRef.current) clearTimeout(assetSaveTimerRef.current);
        const snapshot = { ...updatedAsset };
        assetSaveTimerRef.current = setTimeout(async () => {
            try {
                await DatabaseService.getInstance().updateAsset(snapshot);
                showToast('Asset saved', 'success');
            } catch (e) {
                console.error("Failed to update asset", e);
                showToast('Failed to save asset changes', 'error');
            }
        }, 1500);
    };

    const handleRowClick = (asset: Asset) => {
        setSelectedAsset(asset);
        setTagEditable(false); // Existing assets are always locked
        setActiveTab('details');
    };

    // --- Hierarchy Validation (ISO 14224) ---
    // Determines the hierarchy level of an asset from its properties
    const getHierarchyLevel = (asset: Asset): string => {
        const type = (asset.assetType || asset.category || asset.hierarchyLevel || '').toUpperCase();
        if (['SITE', 'AREA'].includes(type)) return 'SITE';
        if (type === 'UNIT') return 'UNIT';
        if (type === 'SYSTEM') return 'SYSTEM';
        if (type === 'COMPONENT') return 'COMPONENT';
        return 'EQUIPMENT'; // default
    };

    // Check if moving sourceAsset under targetAsset would create a circular reference
    const wouldCreateCycle = (sourceId: string, targetId: string): boolean => {
        let current = targetId;
        let depth = 0;
        while (current && depth < 20) {
            if (current === sourceId) return true;
            const parent = assets.find(a => a.id === current);
            current = parent?.parentId || '';
            depth++;
        }
        return false;
    };

    // Validate that the selected assets can be moved under the target
    const validateMove = (sourceIds: string[], targetId: string): { valid: boolean; reason?: string } => {
        const target = assets.find(a => a.id === targetId);
        if (!target) return { valid: false, reason: 'Target asset not found' };

        for (const id of sourceIds) {
            // Self-reference
            if (id === targetId) return { valid: false, reason: 'Cannot move asset under itself' };
            // Circular reference
            if (wouldCreateCycle(id, targetId)) {
                return { valid: false, reason: `Moving would create a circular reference` };
            }
        }
        return { valid: true };
    };

    // --- Move to Parent Action ---
    const handleMoveToParent = async () => {
        if (!moveTargetId || selectedIds.size === 0) return;

        const target = assets.find(a => a.id === moveTargetId);
        if (!target) return;

        const sourceIds = Array.from(selectedIds);
        const validation = validateMove(sourceIds, moveTargetId);
        if (!validation.valid) {
            showToast(validation.reason || 'Invalid move', 'error');
            return;
        }

        showToast(`Moving ${sourceIds.length} asset(s) under ${target.tag}...`, 'info');

        // Optimistic UI update
        setAssets(prev => prev.map(a =>
            sourceIds.includes(a.id) ? { ...a, parentId: moveTargetId } : a
        ));

        // Persist to Supabase
        try {
            await Promise.all(sourceIds.map(id => {
                const original = assets.find(a => a.id === id);
                if (!original) return Promise.resolve();
                return DatabaseService.getInstance().updateAsset({ ...original, parentId: moveTargetId });
            }));
            showToast(`✓ Moved ${sourceIds.length} asset(s) under ${target.tag}`, 'success');
        } catch (err: any) {
            showToast('Error moving assets: ' + err.message, 'error');
            // Revert on failure
            const refreshed = DatabaseService.filterAssetsBySiteScope(
                await DatabaseService.getInstance().getAssets(), dataScope?.siteIds
            );
            setAssets(refreshed);
        }

        // Expand target so user sees the result
        setExpandedIds(prev => new Set([...prev, moveTargetId]));
        setSelectedIds(new Set());
        setIsMoveToParentOpen(false);
        setMoveTargetId(null);
        setMoveTargetSearch('');
    };

    // --- Detach from Parent (Move to Root) ---
    // Step 1: Open confirmation
    const handleDetachClick = () => {
        const sourceIds = Array.from(selectedIds);
        const withParent = sourceIds.filter(id => assets.find(a => a.id === id)?.parentId);

        if (withParent.length === 0) {
            showToast('Selected assets are already at root level', 'info');
            return;
        }
        setIsDetachConfirmOpen(true);
    };

    // Step 2: Execute on confirmation
    const handleConfirmDetach = async () => {
        setIsDetachConfirmOpen(false);
        const sourceIds = Array.from(selectedIds);
        const withParent = sourceIds.filter(id => assets.find(a => a.id === id)?.parentId);

        // Optimistic UI update
        setAssets(prev => prev.map(a =>
            selectedIds.has(a.id) ? { ...a, parentId: null } : a
        ));

        try {
            await Promise.all(withParent.map(id => {
                const original = assets.find(a => a.id === id);
                if (!original) return Promise.resolve();
                return DatabaseService.getInstance().updateAsset({ ...original, parentId: null });
            }));
            showToast(`✓ Detached ${withParent.length} asset(s) to root level`, 'success');
        } catch (err: any) {
            showToast('Error detaching assets: ' + err.message, 'error');
            const refreshed = DatabaseService.filterAssetsBySiteScope(
                await DatabaseService.getInstance().getAssets(), dataScope?.siteIds
            );
            setAssets(refreshed);
        }

        setSelectedIds(new Set());
    };

    const handleBulkAdd = () => {
        // Mock File Input Trigger
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv, .xlsx';
        input.onchange = (e) => {
            showToast('Bulk import functionality would parse the selected file here.', 'info');
        };
        input.click();
    };

    // --- Actions ---
    const handleSave = async () => {
        if (!selectedAsset) return;
        // Flush any pending debounced save first
        if (assetSaveTimerRef.current) clearTimeout(assetSaveTimerRef.current);
        setSaving(true);
        try {
            await DatabaseService.getInstance().updateAsset(selectedAsset);
            showToast('Changes saved successfully.', 'success');
            // Lock the tag after first save (SAP best practice)
            setTagEditable(false);
            // Refresh list to reflect changes
            const fresh = DatabaseService.filterAssetsBySiteScope(
                await DatabaseService.getInstance().getAssets(), dataScope?.siteIds
            );
            setAssets(fresh);
            // Sync selectedAsset with the fresh data so banner/header stays current
            const refreshedSelection = fresh.find(a => a.id === selectedAsset.id);
            if (refreshedSelection) {
                setSelectedAsset(refreshedSelection);
            }
        } catch (err: any) {
            showToast('Error saving asset: ' + err.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteClick = () => {
        if (!selectedAsset) return;
        setDeleteModal({
            isOpen: true,
            assetId: selectedAsset.id,
            assetTag: selectedAsset.tag
        });
    };

    const handleConfirmDelete = async () => {
        if (!deleteModal.assetId) return;
        const assetId = deleteModal.assetId;

        // Child-asset guard: prevent deleting assets that have children
        const childCount = assets.filter(a => a.parentId === assetId).length;
        if (childCount > 0) {
            showToast(`Cannot delete: this asset has ${childCount} child asset(s). Reassign or delete children first.`, 'error');
            setDeleteModal({ isOpen: false, assetId: null, assetTag: null });
            return;
        }

        // Check if it's a local-only new asset
        if (assetId.startsWith('new-')) {
            setAssets(prev => prev.filter(a => a.id !== assetId));
            setSelectedAsset(null);
            setDeleteModal({ isOpen: false, assetId: null, assetTag: null });
            showToast('Asset removed.', 'success');
            return;
        }

        try {
            await DatabaseService.getInstance().deleteAsset(assetId);
            setAssets(prev => prev.filter(a => a.id !== assetId));
            setSelectedAsset(null);
            showToast('Asset deleted successfully.', 'success');
        } catch (err: any) {
            showToast('Error deleting asset: ' + err.message, 'error');
        } finally {
            setDeleteModal({ isOpen: false, assetId: null, assetTag: null });
        }
    };

    // ── Change Tag (audited, admin-level — SAP Change Document equivalent) ──
    const handleChangeTag = async (newTag: string, reason: string) => {
        if (!selectedAsset || !newTag.trim()) return;
        const oldTag = selectedAsset.tag;
        const actor = profile?.username || profile?.fullName || 'unknown';

        try {
            // 1. Update the tag in the assets table
            await DatabaseService.getInstance().updateAsset({ ...selectedAsset, tag: newTag.trim() });

            // 2. Write a Change Document to audit_logs (SAP CDHDR/CDPOS equivalent)
            const { supabase } = await import('../lib/supabase');
            const auditEntry = {
                table_name: 'assets',
                record_id: selectedAsset.id,
                action: 'UPDATE',
                changed_by: actor,
                timestamp: new Date().toISOString(),
                changes: JSON.stringify({
                    field: 'tag',
                    old: oldTag,
                    new: newTag.trim(),
                    reason: reason.trim(),
                    change_type: 'ASSET_TAG_CHANGE'
                })
            };
            const { error: auditError } = await supabase.from('audit_logs').insert(auditEntry);
            if (auditError) console.warn('Audit log insert failed:', auditError);

            // 3. Update local state
            const updatedAsset = { ...selectedAsset, tag: newTag.trim() };
            setAssets(prev => prev.map(a => a.id === selectedAsset.id ? updatedAsset : a));
            setSelectedAsset(updatedAsset);

            showToast(`Tag changed: ${oldTag} → ${newTag.trim()}. Change logged to audit trail.`, 'success');
        } catch (err: any) {
            showToast('Failed to change tag: ' + err.message, 'error');
        }
    };

    const handleDuplicate = async () => {
        if (!selectedAsset) return;
        const copy: Asset = {
            ...selectedAsset,
            id: `new-${Date.now()}`,
            tag: `${selectedAsset.tag}-COPY`,
            name: `${selectedAsset.name} (Copy)`
        };
        try {
            const created = await DatabaseService.getInstance().addAsset(copy);
            setAssets(prev => [...prev, created]);
            setSelectedAsset(created);
            setTagEditable(true); // Allow one-time tag rename for duplicate
            showToast('Asset duplicated successfully. You may rename the tag before saving.', 'success');
        } catch (err: any) {
            // Fallback: add locally if DB fails
            setAssets(prev => [...prev, copy]);
            setSelectedAsset(copy);
            setTagEditable(true); // Allow one-time tag rename for local fallback
            showToast('Asset duplicated locally (DB save failed: ' + err.message + ')', 'warning');
        }
    };

    const openAddModal = (type: 'Asset' | 'Location') => {
        setAddType(type);
        setIsAddModalOpen(true);
    };

    const handleCreateAsset = async (newAsset: Asset) => {
        try {
            const created = await DatabaseService.getInstance().addAsset(newAsset);
            setAssets(prev => [created, ...prev]);
            setIsAddModalOpen(false);
            setSelectedAsset(created);
            setTagEditable(true); // Allow one-time tag edit for newly created assets
            showToast(`${newAsset.tag} created successfully. You may rename the tag before saving.`, 'success');
        } catch (err: any) {
            showToast('Error creating asset: ' + err.message, 'error');
        }
    };

    const isLocation = (asset: Asset) => {
        const type = asset.assetType || asset.category || '';
        return ['SITE', 'AREA', 'UNIT', 'SYSTEM', 'Site', 'Area', 'Unit', 'System'].includes(type);
    };

    // Helper to build hierarchy path
    const getAssetPath = (current: Asset): Asset[] => {
        const path = [current];
        let curr = current;
        // Limit depth to prevent infinite loops if circular ref exists (though we check on drop)
        let depth = 0;
        while (curr.parentId && depth < 10) {
            const parent = assets.find(a => a.id === curr.parentId);
            if (parent) {
                path.unshift(parent);
                curr = parent;
            } else {
                break;
            }
            depth++;
        }
        return path;
    };


    const TABS: { id: TabId; label: string; icon: any; show?: boolean }[] = selectedAsset ? [
        { id: 'details', label: 'Details', icon: FileText, show: true },
        { id: 'hierarchy', label: 'Hierarchy', icon: Link, show: true },
        { id: 'bom', label: 'BOM', icon: Box, show: !isLocation(selectedAsset) },
        { id: 'readings', label: 'Readings', icon: Activity, show: !isLocation(selectedAsset) },
        { id: 'reliability', label: 'Reliability', icon: Cpu, show: !isLocation(selectedAsset) },
        { id: 'jobs', label: 'Work & History', icon: Wrench, show: true },
        { id: 'files', label: 'Files', icon: FolderPlus, show: true },
        { id: 'financials', label: 'Financials', icon: DollarSign, show: true },
        { id: 'tracking', label: 'Tracking', icon: History, show: true },
    ] : [];

    // Helper: count direct children of an asset
    const getChildCount = useCallback((assetId: string) => {
        return assets.filter(a => a.parentId === assetId).length;
    }, [assets]);

    // Status dot color helper (compact)
    const getStatusDotColor = (status: AssetStatus) => {
        switch (status) {
            case AssetStatus.ACTIVE: return 'bg-green-500';
            case AssetStatus.MAINTENANCE: return 'bg-amber-500';
            case AssetStatus.STANDBY: return 'bg-blue-500';
            case AssetStatus.DOWN: return 'bg-red-500';
            case AssetStatus.DECOMMISSIONED: return 'bg-slate-400';
            default: return 'bg-slate-400';
        }
    };

    return (
        <div className="flex h-full gap-4 relative">
            {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                LEFT PANEL — Switches between FULL TABLE (no selection) 
                and COMPACT CARD HIERARCHY (asset selected / split view)
               ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            <div className={`${selectedAsset ? 'ers-list-panel hidden lg:flex' : 'w-full'} flex flex-col bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden transition-all duration-300`}>

                {/* Back-to-list button (visible only on tablet/mobile when detail is showing) */}
                {selectedAsset && (
                    <button
                        onClick={() => setSelectedAsset(null)}
                        className="back-to-list-btn m-2 lg:hidden"
                    >
                        <ChevronDown size={14} className="rotate-90" />
                        Back to Asset List
                    </button>
                )}

                {/* ─── COMPACT CARD VIEW (when asset selected) ─── */}
                {selectedAsset ? (
                    <>
                        {/* Slim Header */}
                        <div className="px-3 py-2.5 border-b border-slate-100 bg-slate-50/80 flex items-center justify-between">
                            <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                                <Network size={14} className="text-slate-400" />
                                Asset Hierarchy
                            </h2>
                            <div className="flex items-center gap-1">
                                {canCreate && (
                                    <button
                                        onClick={() => openAddModal('Asset')}
                                        className="p-1.5 bg-primary-600 text-white rounded-md hover:bg-primary-500 transition"
                                        title="New Asset"
                                    >
                                        <Plus size={14} />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Compact Search */}
                        <div className="px-3 py-2 border-b border-slate-100 bg-white">
                            <div className="relative">
                                <Search className="absolute left-2.5 top-2 text-slate-400" size={14} />
                                <input
                                    type="text"
                                    placeholder="Search assets..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-primary-500 focus:outline-none bg-slate-50 focus:bg-white transition"
                                />
                            </div>
                        </div>

                        {/* Compact Card List */}
                        <div className="flex-1 overflow-y-auto">
                            {treeData.map(asset => {
                                const hasChildren = assets.some(a => a.parentId === asset.id);
                                const isExpanded = expandedIds.has(asset.id);
                                const childCount = getChildCount(asset.id);
                                const isSelected = selectedAsset?.id === asset.id;
                                const isLoc = isLocation(asset);

                                return (
                                    <div
                                        key={asset.id}
                                        onClick={() => handleRowClick(asset)}
                                        className={`cursor-pointer transition-all duration-150 border-b border-slate-50 group
                                            ${isSelected 
                                                ? (isLoc ? 'bg-emerald-50 border-l-3 border-l-emerald-500' : 'bg-blue-50 border-l-3 border-l-blue-500') 
                                                : 'border-l-3 border-l-transparent hover:bg-slate-50'
                                            }
                                        `}
                                    >
                                        <div 
                                            className="flex items-start gap-2 px-3 py-2.5"
                                            style={{ paddingLeft: `${12 + asset.depth * 20}px` }}
                                        >
                                            {/* Expand/Collapse or spacer */}
                                            <div className="flex-shrink-0 mt-0.5">
                                                {hasChildren ? (
                                                    <button
                                                        onClick={(e) => toggleExpansion(asset.id, e)}
                                                        className={`w-5 h-5 flex items-center justify-center rounded transition text-slate-400 hover:text-slate-700 hover:bg-slate-200 ${isExpanded ? 'bg-slate-100' : ''}`}
                                                    >
                                                        <ChevronRight size={14} className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                                                    </button>
                                                ) : (
                                                    <span className="w-5 h-5 flex items-center justify-center">
                                                        <span className={`w-1.5 h-1.5 rounded-full ${isLoc ? 'bg-emerald-300' : 'bg-slate-300'}`} />
                                                    </span>
                                                )}
                                            </div>

                                            {/* Type Icon */}
                                            <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center mt-0.5 ${
                                                isLoc 
                                                    ? 'bg-emerald-100 text-emerald-600' 
                                                    : 'bg-blue-100 text-blue-600'
                                            }`}>
                                                {isLoc ? <MapPin size={14} /> : <Package size={14} />}
                                            </div>

                                            {/* Content */}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className={`text-xs font-bold truncate ${isSelected ? 'text-slate-900' : 'text-slate-800 group-hover:text-blue-700'}`}>
                                                        {asset.tag}
                                                    </span>
                                                    {/* Status dot */}
                                                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${getStatusDotColor(asset.status)}`} title={asset.status} />
                                                </div>
                                                <p className="text-[11px] text-slate-500 truncate leading-tight mt-0.5">
                                                    {asset.name}
                                                </p>
                                                {asset.equipmentNumber && (
                                                    <span className="text-[9px] font-mono text-blue-500 flex items-center gap-0.5 mt-0.5">
                                                        <Hash size={8} className="flex-shrink-0" />
                                                        {asset.equipmentNumber}
                                                    </span>
                                                )}
                                                {/* Meta row */}
                                                <div className="flex items-center gap-2 mt-1">
                                                    {/* Location breadcrumb */}
                                                    {asset.location && (
                                                        <span className="text-[10px] text-slate-400 flex items-center gap-0.5 truncate">
                                                            <MapPin size={9} className="flex-shrink-0" />
                                                            {asset.location}
                                                        </span>
                                                    )}
                                                    {/* Children count */}
                                                    {childCount > 0 && (
                                                        <button
                                                            onClick={(e) => toggleExpansion(asset.id, e)}
                                                            className="text-[10px] font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded flex-shrink-0 hover:bg-blue-100 hover:text-blue-700 cursor-pointer transition-colors"
                                                            title={isExpanded ? 'Collapse children' : 'Expand children'}
                                                        >
                                                            {childCount} {childCount === 1 ? 'child' : 'children'}
                                                        </button>
                                                    )}
                                                    {/* Criticality badge */}
                                                    {asset.criticality && (
                                                        <span className={`text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center text-white flex-shrink-0 ${
                                                            asset.criticality === 'A' ? 'bg-red-500' :
                                                            asset.criticality === 'B' ? 'bg-orange-500' :
                                                            asset.criticality === 'C' ? 'bg-blue-500' : 'bg-slate-400'
                                                        }`}>
                                                            {asset.criticality}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                            {treeData.length === 0 && (
                                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                                    <Search size={32} className="mb-2 opacity-30" />
                                    <span className="text-xs">No assets found</span>
                                </div>
                            )}
                        </div>

                        {/* Asset count footer */}
                        <div className="px-3 py-2 border-t border-slate-100 bg-slate-50/50 text-[10px] text-slate-400 font-medium">
                            {assets.length} assets total
                        </div>
                    </>
                ) : (
                    /* ─── FULL TABLE VIEW (no asset selected) ─── */
                    <>
                {/* Header */}
                <div className="p-2 sm:p-3 md:p-4 border-b border-slate-100 flex flex-wrap justify-between items-center gap-2 bg-slate-50/50">
                    <h2 className="hidden sm:block text-lg font-bold text-slate-900">Asset Registry</h2>
                    <div className="hidden sm:flex flex-wrap gap-2">
                        {/* Bulk Import */}
                        {canCreate && (
                            <button
                                onClick={() => setIsBulkImportOpen(true)}
                                className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-md text-sm font-medium hover:bg-slate-50 transition shadow-sm"
                            >
                                <Upload size={16} /> Bulk Import
                            </button>
                        )}

                        {/* Export Dropdown */}
                        <div className="relative">
                            <button
                                onClick={() => setShowExportMenu(!showExportMenu)}
                                className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-md text-sm font-medium hover:bg-slate-50 transition shadow-sm"
                            >
                                <Download size={16} /> Export
                            </button>
                            {showExportMenu && (
                                <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-xl z-50 overflow-hidden">
                                    <button
                                        onClick={() => { exportAssetsToXLSX(assets); setShowExportMenu(false); }}
                                        className="w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50 flex items-center gap-2"
                                    >
                                        <FileSpreadsheet size={14} className="text-emerald-500" /> Export to Excel (.xlsx)
                                    </button>
                                    <button
                                        onClick={() => { exportAssetsToCSV(assets); setShowExportMenu(false); }}
                                        className="w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50 border-t border-slate-100 flex items-center gap-2"
                                    >
                                        <FileText size={14} className="text-blue-500" /> Export to CSV
                                    </button>
                                </div>
                            )}
                        </div>

                        {canCreate && (
                            <>
                                <button
                                    onClick={() => openAddModal('Location')}
                                    className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 transition shadow-sm"
                                >
                                    <MapPin size={16} /> New Location
                                </button>
                                <Button
                                    onClick={() => openAddModal('Asset')}
                                    size="sm"
                                    leftIcon={<Plus size={16} />}
                                    className="hidden sm:inline-flex"
                                >
                                    New Asset
                                </Button>
                            </>
                        )}
                    </div>
                </div>

                {/* Filters & Bulk Actions */}
                <div className="p-4 border-b border-slate-100 bg-white flex gap-2 items-center">
                    {selectedIds.size > 0 ? (
                        <div className="flex-1 flex items-center gap-2 bg-blue-50 p-2 rounded-lg animate-in fade-in">
                            <span className="text-xs font-bold text-blue-800 ml-2">{selectedIds.size} Selected</span>
                            <div className="h-4 w-px bg-blue-200 mx-2"></div>

                            {/* Move to Parent — MaintainX-style action */}
                            <button
                                onClick={() => {
                                    setMoveTargetId(null);
                                    setMoveTargetSearch('');
                                    setIsMoveToParentOpen(true);
                                }}
                                className="text-xs flex items-center gap-1 px-2.5 py-1.5 bg-white border border-blue-200 rounded-md text-blue-700 hover:bg-blue-100 font-medium transition-colors"
                            >
                                <FolderInput size={13} /> Move to Parent
                            </button>

                            {/* Detach from Parent */}
                            <button
                                onClick={handleDetachClick}
                                className="text-xs flex items-center gap-1 px-2.5 py-1.5 bg-white border border-blue-200 rounded-md text-blue-700 hover:bg-blue-100 font-medium transition-colors"
                            >
                                <Unlink size={13} /> Detach Parent
                            </button>

                            {/* Mass Change Dropdown (G9) */}
                            <div className="relative">
                                <button
                                    onClick={() => setShowMassChange(!showMassChange)}
                                    className="text-xs flex items-center gap-1 px-2 py-1 bg-white border border-blue-200 rounded text-blue-700 hover:bg-blue-100"
                                >
                                    <Wrench size={12} /> Mass Change <ChevronDown size={10} />
                                </button>
                                {showMassChange && (
                                    <div className="absolute left-0 top-full mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-xl z-50 divide-y divide-slate-100">
                                        <div className="p-2">
                                            <div className="text-[10px] font-bold text-slate-400 uppercase px-2 py-1">Set Status</div>
                                            {Object.values(AssetStatus).map(status => (
                                                <button
                                                    key={status}
                                                    onClick={async () => {
                                                        const selected = assets.filter(a => selectedIds.has(a.id));
                                                        for (const a of selected) {
                                                            await DatabaseService.getInstance().updateAsset({ ...a, status });
                                                        }
                                                        const refreshed = await DatabaseService.getInstance().getAssets();
                                                        setAssets(refreshed);
                                                        setSelectedIds(new Set());
                                                        setShowMassChange(false);
                                                        showToast(`Set ${selected.length} assets to ${status}`, 'success');
                                                    }}
                                                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 rounded"
                                                >
                                                    {status}
                                                </button>
                                            ))}
                                        </div>
                                        <div className="p-2">
                                            <div className="text-[10px] font-bold text-slate-400 uppercase px-2 py-1">Set Criticality</div>
                                            {(['A', 'B', 'C', 'D'] as const).map(crit => (
                                                <button
                                                    key={crit}
                                                    onClick={async () => {
                                                        const selected = assets.filter(a => selectedIds.has(a.id));
                                                        for (const a of selected) {
                                                            await DatabaseService.getInstance().updateAsset({ ...a, criticality: crit });
                                                        }
                                                        const refreshed = await DatabaseService.getInstance().getAssets();
                                                        setAssets(refreshed);
                                                        setSelectedIds(new Set());
                                                        setShowMassChange(false);
                                                        showToast(`Set ${selected.length} assets to Criticality ${crit}`, 'success');
                                                    }}
                                                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 rounded"
                                                >
                                                    Criticality {crit}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* QR batch print */}
                            <button
                                onClick={() => {
                                    const selected = assets.filter(a => selectedIds.has(a.id));
                                    if (selected.length > 0) {
                                        import('../components/AssetQRCode').then(({ batchExportQRCodes }) => {
                                            batchExportQRCodes(selected);
                                        });
                                    }
                                }}
                                className="text-xs flex items-center gap-1 px-2 py-1 bg-white border border-blue-200 rounded text-blue-700 hover:bg-blue-100"
                            >
                                <QrCode size={12} /> Print QR Labels
                            </button>

                            <button
                                onClick={() => setSelectedIds(new Set())}
                                className="text-xs px-2 py-1 text-slate-500 hover:text-slate-800 ml-auto"
                            >
                                Cancel
                            </button>
                        </div>
                    ) : (
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                            <input
                                type="text"
                                placeholder="Search tag, name..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-1 focus:ring-primary-500 focus:outline-none"
                            />
                        </div>
                    )}

                    <button className="p-2 border border-slate-300 rounded-lg bg-white text-slate-600 hover:bg-slate-50">
                        <Filter size={18} />
                    </button>
                </div>

                {/* ─── Card-Based Hierarchy View with Tree Connector Lines ─── */}
                <div className="flex-1 overflow-y-auto px-2 py-2">
                    {treeData.map(asset => {
                        const hasChildren = assets.some(a => a.parentId === asset.id);
                        const isExpanded = expandedIds.has(asset.id);
                        const childCount = getChildCount(asset.id);
                        const isLoc = isLocation(asset);
                        const isSelected = selectedIds.has(asset.id);

                        // Tree connector dimensions
                        const INDENT_PX = 32;           // Horizontal indent per depth level
                        const LINE_LEFT_OFFSET = 16;    // Center of the vertical line within each indent level
                        const BRANCH_WIDTH = 20;        // Width of horizontal branch arm

                        return (
                            <div
                                key={asset.id}
                                className={`hierarchy-row ${asset.depth > 0 ? 'hierarchy-expand-enter' : ''}`}
                                style={{ minHeight: '48px' }}
                            >
                                {/* ── Tree Connector Lines ── */}
                                {asset.depth > 0 && (
                                    <>
                                        {/* Vertical continuation lines for each ancestor level */}
                                        {asset.ancestorLastFlags.map((isLast, i) => (
                                            !isLast && (
                                                <div
                                                    key={`vl-${i}`}
                                                    className="tree-vline"
                                                    style={{ left: `${8 + i * INDENT_PX + LINE_LEFT_OFFSET}px` }}
                                                />
                                            )
                                        ))}
                                        {/* L-shaped branch for current node */}
                                        <div
                                            className="tree-hbranch"
                                            style={{
                                                left: `${8 + (asset.depth - 1) * INDENT_PX + LINE_LEFT_OFFSET}px`,
                                                top: 0,
                                                height: '100%',
                                                width: `${BRANCH_WIDTH}px`
                                            }}
                                        />
                                        {/* Continuation line below for non-last siblings */}
                                        {!asset.isLastChild && (
                                            <div
                                                className="tree-vline-below"
                                                style={{
                                                    left: `${8 + (asset.depth - 1) * INDENT_PX + LINE_LEFT_OFFSET}px`,
                                                    top: '50%',
                                                    height: '50%'
                                                }}
                                            />
                                        )}
                                    </>
                                )}

                                {/* ── Card Content ── */}
                                <div
                                    className={`hierarchy-card flex items-center gap-2 px-3 py-2 mx-1 my-0.5 cursor-pointer group bg-white
                                        ${isLoc ? 'hierarchy-card--location' : 'hierarchy-card--equipment'}
                                        ${isSelected ? 'hierarchy-card--selected' : ''}
                                    `}
                                    style={{ marginLeft: `${8 + asset.depth * INDENT_PX + (asset.depth > 0 ? BRANCH_WIDTH + 4 : 0)}px` }}
                                    onClick={() => handleRowClick(asset)}
                                >
                                    {/* Checkbox */}
                                    <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => toggleSelection(asset.id)}
                                            className="rounded border-slate-300 w-4 h-4"
                                        />
                                    </div>

                                    {/* Expand/Collapse Toggle */}
                                    <div className="flex-shrink-0">
                                        {hasChildren ? (
                                            <button
                                                onClick={(e) => toggleExpansion(asset.id, e)}
                                                className={`w-5 h-5 flex items-center justify-center rounded transition-all duration-200
                                                    ${isExpanded
                                                        ? 'bg-emerald-100 text-emerald-700 shadow-sm'
                                                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700'
                                                    }`}
                                            >
                                                <ChevronRight size={14} className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                                            </button>
                                        ) : (
                                            <span className="w-5 h-5 flex items-center justify-center">
                                                <span className={`w-1.5 h-1.5 rounded-full ${isLoc ? 'bg-emerald-300' : 'bg-blue-300'}`} />
                                            </span>
                                        )}
                                    </div>

                                    {/* Type Icon */}
                                    <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
                                        isLoc
                                            ? 'bg-emerald-100 text-emerald-600'
                                            : 'bg-blue-100 text-blue-600'
                                    }`}>
                                        {isLoc ? <MapPin size={14} /> : <Package size={14} />}
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-bold text-slate-900 group-hover:text-blue-700 truncate transition-colors">
                                                {asset.tag}
                                            </span>
                                            {/* Status dot */}
                                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${getStatusDotColor(asset.status)}`} title={asset.status} />
                                            {/* Asset class badge (inline with tag for quick identification) */}
                                            {(asset.assetClass || asset.assetType) && (
                                                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200 uppercase tracking-wider truncate max-w-[120px] hidden md:inline-block">
                                                    {asset.assetClass || asset.assetType}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-[11px] text-slate-500 truncate leading-tight mt-0.5">
                                            {asset.name}
                                        </p>
                                        {/* Meta Row 1: Children & Criticality */}
                                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                                            {/* Children count badge */}
                                            {childCount > 0 && (
                                                <button
                                                    onClick={(e) => toggleExpansion(asset.id, e)}
                                                    className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full flex-shrink-0 hover:bg-blue-100 hover:text-blue-700 transition-colors border border-blue-100"
                                                    title={isExpanded ? 'Collapse children' : 'Expand children'}
                                                >
                                                    {childCount} {childCount === 1 ? 'child' : 'children'}
                                                </button>
                                            )}
                                            {/* Criticality badge */}
                                            {asset.criticality && (
                                                <span className={`text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center text-white flex-shrink-0 ${
                                                    asset.criticality === 'A' ? 'bg-red-500' :
                                                    asset.criticality === 'B' ? 'bg-orange-500' :
                                                    asset.criticality === 'C' ? 'bg-blue-500' : 'bg-slate-400'
                                                }`}>
                                                    {asset.criticality}
                                                </span>
                                            )}
                                            {/* Separator dot */}
                                            {(asset.manufacturer || asset.model || asset.serialNumber || asset.department || asset.location) && (childCount > 0 || asset.criticality) && (
                                                <span className="w-0.5 h-3 bg-slate-200 rounded-full flex-shrink-0 hidden sm:block" />
                                            )}
                                            {/* Equipment details: Manufacturer · Model · S/N */}
                                            {!isLoc && asset.manufacturer && (
                                                <span className="text-[10px] text-slate-400 flex items-center gap-1 flex-shrink-0 hidden sm:flex" title="Manufacturer">
                                                    <Factory size={10} className="text-slate-300 flex-shrink-0" />
                                                    <span className="truncate max-w-[100px]">{asset.manufacturer}</span>
                                                </span>
                                            )}
                                            {!isLoc && asset.model && (
                                                <span className="text-[10px] text-slate-400 flex items-center gap-1 flex-shrink-0 hidden sm:flex" title="Model">
                                                    <Cpu size={10} className="text-slate-300 flex-shrink-0" />
                                                    <span className="truncate max-w-[100px]">{asset.model}</span>
                                                </span>
                                            )}
                                            {!isLoc && asset.serialNumber && (
                                                <span className="text-[10px] text-slate-400 flex items-center gap-1 flex-shrink-0 hidden lg:flex" title="Serial Number">
                                                    <Hash size={10} className="text-slate-300 flex-shrink-0" />
                                                    <span className="font-mono truncate max-w-[100px]">{asset.serialNumber}</span>
                                                </span>
                                            )}
                                            {/* Location details: Department · Location */}
                                            {asset.department && (
                                                <span className="text-[10px] text-slate-400 flex items-center gap-1 flex-shrink-0 hidden sm:flex" title="Department">
                                                    <Building size={10} className="text-slate-300 flex-shrink-0" />
                                                    <span className="truncate max-w-[100px]">{asset.department}</span>
                                                </span>
                                            )}
                                            {asset.location && (
                                                <span className="text-[10px] text-slate-400 flex items-center gap-1 flex-shrink-0 hidden lg:flex" title="Location">
                                                    <MapPin size={9} className="text-slate-300 flex-shrink-0" />
                                                    <span className="truncate max-w-[100px]">{asset.location}</span>
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* ── Right side — SAP PM-grade Status Panel ── */}
                                    <div className="hidden sm:flex items-center gap-3 flex-shrink-0">

                                        {/* Status Badge */}
                                        <span className={`text-[10px] px-2.5 py-1 rounded-md font-bold border whitespace-nowrap ${getStatusColor(asset.status)}`}>
                                            {asset.status}
                                        </span>

                                        {/* Criticality Ring — SAP Risk Profile */}
                                        {asset.criticality && (
                                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black border-2 flex-shrink-0 ${
                                                asset.criticality === 'A' ? 'border-red-400 text-red-600 bg-red-50' :
                                                asset.criticality === 'B' ? 'border-orange-400 text-orange-600 bg-orange-50' :
                                                asset.criticality === 'C' ? 'border-blue-400 text-blue-600 bg-blue-50' : 'border-slate-300 text-slate-500 bg-slate-50'
                                            }`} title={`Criticality ${asset.criticality}`}>
                                                {asset.criticality}
                                            </div>
                                        )}

                                        {/* Health Score — Donut-style indicator */}
                                        <div className="flex items-center gap-1.5" title={`Health Score: ${asset.healthScore}%`}>
                                            <div className="relative w-8 h-8">
                                                <svg className="w-8 h-8 -rotate-90" viewBox="0 0 36 36">
                                                    <circle cx="18" cy="18" r="15" fill="none" stroke="#e2e8f0" strokeWidth="3" />
                                                    <circle
                                                        cx="18" cy="18" r="15" fill="none"
                                                        strokeWidth="3"
                                                        strokeLinecap="round"
                                                        stroke={asset.healthScore > 80 ? '#22c55e' : asset.healthScore > 50 ? '#f59e0b' : '#ef4444'}
                                                        strokeDasharray={`${(asset.healthScore / 100) * 94.2} 94.2`}
                                                    />
                                                </svg>
                                                <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-slate-600">
                                                    {asset.healthScore}
                                                </span>
                                            </div>
                                        </div>

                                        {/* BOM Parts Button — only for equipment */}
                                        {!isLocation(asset) && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); toggleBOMExpansion(asset.id, e); }}
                                                className={`hidden lg:flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-all border ${
                                                    expandedBOMIds.has(asset.id)
                                                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                                                        : 'bg-white text-slate-400 border-slate-200 hover:bg-slate-50 hover:text-slate-600'
                                                }`}
                                                title="Bill of Materials"
                                            >
                                                <Box size={12} />
                                                <span>BOM</span>
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Inline BOM Expansion — only for equipment/maintainable items */}
                                {!isLocation(asset) && expandedBOMIds.has(asset.id) && (
                                    <div className="mx-2 mb-2 p-4 bg-slate-50 rounded-lg border border-slate-200 shadow-inner"
                                         style={{ marginLeft: `${16 + asset.depth * INDENT_PX + (asset.depth > 0 ? BRANCH_WIDTH + 4 : 0)}px` }}>
                                        <BOMTab asset={asset} onUpdate={handleUpdateAsset} />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    {treeData.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                            <Search size={40} className="mb-3 opacity-20" />
                            <span className="text-sm font-medium">No assets found</span>
                            <span className="text-xs mt-1">Try adjusting your search or add new assets</span>
                        </div>
                    )}
                </div>

                {/* Asset count footer */}
                <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/50 text-xs text-slate-500 font-medium flex items-center justify-between">
                    <span>{assets.length} assets total</span>
                    <span className="text-[10px] text-slate-400">
                        {assets.filter(a => !a.parentId).length} root items · {assets.filter(a => isLocation(a)).length} locations · {assets.filter(a => !isLocation(a)).length} equipment
                    </span>
                </div>
                    </>
                )}
            </div>

            {/* Right Detail Pane */}
            {
                selectedAsset && (
                    <div className="flex-1 bg-white rounded-xl shadow-lg border border-slate-200 flex flex-col overflow-hidden ers-detail-panel-enter">

                        {/* Unified Detail Header */}
                        <UnifiedDetailHeader
                            title={selectedAsset.tag}
                            subtitle={selectedAsset.name}
                            status={selectedAsset.status}
                            statusClassName={getStatusColor(selectedAsset.status as AssetStatus)}
                            icon={getAssetIcon(selectedAsset)}
                            breadcrumbs={getAssetPath(selectedAsset).map(a => a.tag)}
                            onClose={() => setSelectedAsset(null)}
                            badges={
                                <>
                                    {selectedAsset.criticality && (
                                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider border ${
                                            selectedAsset.criticality === 'A' ? 'bg-red-100 text-red-700 border-red-200' :
                                            selectedAsset.criticality === 'B' ? 'bg-orange-100 text-orange-700 border-orange-200' :
                                            selectedAsset.criticality === 'C' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                                            'bg-slate-100 text-slate-600 border-slate-200'
                                        }`}>
                                            Criticality {selectedAsset.criticality}
                                        </span>
                                    )}
                                    {selectedAsset.healthScore !== undefined && (
                                        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold border bg-slate-50 text-slate-600 border-slate-200 flex items-center gap-1">
                                            <Activity size={10} /> {selectedAsset.healthScore}%
                                        </span>
                                    )}
                                    {selectedAsset.equipmentNumber && (
                                        <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-bold border bg-blue-50 text-blue-700 border-blue-200 flex items-center gap-1" title={`Internal Equipment Number (Gen ${selectedAsset.equipmentGeneration || 1})`}>
                                            <Hash size={9} /> {selectedAsset.equipmentNumber}
                                        </span>
                                    )}
                                </>
                            }
                            metadata={
                                <>
                                    <span className="flex items-center gap-1"><MapPin size={11} /> {selectedAsset.location}</span>
                                    <span className="flex items-center gap-1">{selectedAsset.assetType || selectedAsset.category}</span>
                                </>
                            }
                            actions={[
                                ...(canEdit ? [{
                                    label: saving ? 'Saving...' : 'Save',
                                    icon: saving
                                        ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                        : <Save size={14} />,
                                    onClick: handleSave,
                                    variant: 'primary' as const,
                                    disabled: saving,
                                    isPrimary: true,
                                }] : []),
                                {
                                    label: 'Analyze',
                                    icon: <Zap size={14} />,
                                    onClick: () => navigate(`/analyze?asset=${selectedAsset.id}`),
                                    variant: 'secondary' as const,
                                    compactLabel: true,
                                },
                                ...(canCreate ? [
                                {
                                    label: 'Add Child',
                                    icon: <CornerDownRight size={14} />,
                                    onClick: () => openAddModal('Asset'),
                                    variant: 'secondary' as const,
                                    compactLabel: true,
                                },
                                {
                                    label: 'Duplicate',
                                    icon: <Copy size={14} />,
                                    onClick: handleDuplicate,
                                    variant: 'secondary' as const,
                                    compactLabel: true,
                                }] : []),
                                ...(canDelete ? [{
                                    label: 'Delete',
                                    icon: <Trash2 size={14} />,
                                    onClick: handleDeleteClick,
                                    variant: 'danger' as const,
                                    compactLabel: true,
                                }] : []),
                            ]}
                        />

                        {/* AI Context Button — hidden on mobile for space, shown md+ */}
                        <div className="hidden md:flex px-4 py-1.5 border-b border-slate-100 bg-slate-50/30 items-center">
                            <AskRelanternButton
                                contextType="assets"
                                contextSummary={aiContextForAsset || `Loading asset intelligence for ${selectedAsset.tag}...`}
                            />
                        </div>
                        {/* Safety Banner (Conditional) */}
                        {selectedAsset.criticality === 'A' && (
                            <div className="bg-red-50 px-6 py-2 border-b border-red-100 flex items-center gap-3 text-red-800 text-xs font-medium flex-shrink-0">
                                <AlertCircle size={14} />
                                <span>Safety Critical Asset: Strict Permit to Work (PTW) required for all interventions. Lockout/Tagout (LOTO) mandatory.</span>
                            </div>
                        )}

                        {/* Tabs Navigation */}
                        <UnifiedTabBar
                            tabs={TABS}
                            activeTab={activeTab}
                            onTabChange={(id) => setActiveTab(id as TabId)}
                        />

                        {/* Asset Path Breadcrumb — hidden on mobile (header already shows title) */}
                        <div className="hidden sm:flex bg-slate-50 border-b border-slate-200 px-4 md:px-6 py-1.5 items-center text-[10px] z-10 sticky top-0">
                            <span className="font-bold mr-2 text-slate-500 uppercase tracking-wider flex items-center gap-1 flex-shrink-0">
                                <Network size={10} className="text-slate-400" />
                                <span className="hidden sm:inline">Path:</span>
                            </span>
                            <div className="flex items-center flex-wrap gap-1 overflow-x-auto scrollbar-hide">
                                {(() => {
                                    const fullPath = getAssetPath(selectedAsset);
                                    // On mobile, collapse to last 2 segments with ellipsis
                                    const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
                                    const displayPath = isMobile && fullPath.length > 2
                                        ? [{ id: 'ellipsis', tag: '...', status: '' } as any, ...fullPath.slice(-2)]
                                        : fullPath;
                                    return displayPath.map((item: any, index: number, array: any[]) => (
                                        <React.Fragment key={item.id}>
                                            {index > 0 && <ChevronRight size={10} className="text-slate-300 mx-0.5 flex-shrink-0" />}
                                            {item.id === 'ellipsis' ? (
                                                <span className="text-slate-400">...</span>
                                            ) : (
                                                <button
                                                    onClick={() => setSelectedAsset(item)}
                                                    className={`px-1.5 py-0.5 rounded hover:bg-white hover:shadow-sm transition-all flex items-center gap-1 whitespace-nowrap
                                                    ${index === array.length - 1 ? 'font-bold text-slate-800 bg-white border border-slate-200 shadow-sm' : 'text-slate-500 hover:text-blue-600'}`}
                                                >
                                                    <span className={`w-1 h-1 rounded-full ${item.status === 'ACTIVE' ? 'bg-green-500' :
                                                        item.status === 'DOWN' ? 'bg-red-500' : 'bg-amber-500'
                                                        }`} />
                                                    {item.tag}
                                                </button>
                                            )}
                                        </React.Fragment>
                                    ));
                                })()}
                            </div>
                        </div>

                        {/* Tab Content */}
                        <div className="flex-1 overflow-y-auto p-3 sm:p-6 bg-slate-50">
                            {activeTab === 'details' && <DetailsTab asset={selectedAsset} assetTypes={assetTypes} contacts={contacts} vendors={vendors} costCenters={costCenters} dictionaries={dictionaries} onUpdate={handleUpdateAsset} onRefreshContacts={refreshContacts} tagEditable={tagEditable} onChangeTag={handleChangeTag} />}

                            {activeTab === 'hierarchy' && <HierarchyTab asset={selectedAsset} assets={assets} onSelect={setSelectedAsset} />}
                            {activeTab === 'bom' && !isLocation(selectedAsset) && <BOMTab asset={selectedAsset} onUpdate={handleUpdateAsset} />}
                            {activeTab === 'readings' && (
                                <ReadingsTab
                                    asset={selectedAsset}
                                    definitions={readingDefs.filter(d => d.assetId === selectedAsset.id)}
                                    onAdd={handleAddReadingDef}
                                />
                            )}
                            {activeTab === 'reliability' && !isLocation(selectedAsset) && <ReliabilityIntelligenceTab asset={selectedAsset} />}
                            {activeTab === 'jobs' && <JobsTab asset={selectedAsset} />}
                            {activeTab === 'financials' && <FinancialsTab asset={selectedAsset} />}
                            {activeTab === 'tracking' && <TrackingTab asset={selectedAsset} />}
                            {activeTab === 'files' && (
                                <div className="bg-white p-6 justify-center flex flex-col border border-slate-200 rounded-lg shadow-sm">
                                    <div className="flex justify-between items-center mb-4">
                                        <h3 className="font-bold text-slate-800">Files & Documents</h3>
                                        <button className="text-xs bg-primary-600 text-white px-3 py-1.5 rounded hover:bg-primary-500">+ Upload File</button>
                                    </div>
                                    <div className="flex flex-col items-center justify-center h-48 text-slate-400 border border-dashed border-slate-300 rounded-lg bg-slate-50">
                                        <FolderPlus size={48} className="mb-2 opacity-20" />
                                        <p>Upload equipment manuals, P&IDs, and other documents.</p>
                                    </div>
                                </div>
                            )}

                            {/* Placeholders for others */}
                            {['journals'].includes(activeTab as string) && (
                                <div className="flex flex-col items-center justify-center h-48 text-slate-400">
                                    <Box size={48} className="mb-2 opacity-20" />
                                    <p>No data available for this view yet.</p>
                                </div>
                            )}
                        </div>

                        {/* ═══ Mobile Sticky Bottom Action Bar (fixed above bottom nav) ═══ */}
                        {canEdit && (
                            <div className="sm:hidden mobile-detail-footer">
                                <Button
                                    onClick={handleSave}
                                    loading={saving}
                                    size="lg"
                                    fullWidth
                                    leftIcon={<Save size={16} />}
                                >
                                    {saving ? 'Saving...' : 'Save Changes'}
                                </Button>
                                <button
                                    onClick={() => setSelectedAsset(null)}
                                    className="px-4 py-3 bg-slate-100 text-slate-700 rounded-xl text-sm font-semibold transition-colors hover:bg-slate-200"
                                >
                                    Close
                                </button>
                            </div>
                        )}
                    </div>
                )
            }

            {/* Empty State */}
            <ConfirmationModal
                isOpen={deleteModal.isOpen}
                onClose={() => setDeleteModal({ isOpen: false, assetId: null, assetTag: null })}
                onConfirm={handleConfirmDelete}
                title="Delete Asset"
                message={`Are you sure you want to delete asset ${deleteModal.assetTag}? This action cannot be undone.`}
                type="danger"
                confirmText="Delete Asset"
            />

            {/* ━━ Move to Parent Modal (MaintainX-style) ━━ */}
            {isMoveToParentOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setIsMoveToParentOpen(false)}>
                    <div
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-slate-200">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                        <FolderInput size={20} className="text-blue-600" /> Move to Parent
                                    </h3>
                                    <p className="text-xs text-slate-500 mt-1">
                                        Select a target parent for {selectedIds.size} selected asset{selectedIds.size > 1 ? 's' : ''}
                                    </p>
                                </div>
                                <button onClick={() => setIsMoveToParentOpen(false)} className="p-1.5 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
                            </div>
                            {/* Search */}
                            <div className="relative mt-3">
                                <Search className="absolute left-3 top-2.5 text-slate-400" size={15} />
                                <input
                                    type="text"
                                    placeholder="Search by tag or name..."
                                    value={moveTargetSearch}
                                    onChange={(e) => setMoveTargetSearch(e.target.value)}
                                    className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
                                    autoFocus
                                />
                            </div>
                        </div>

                        {/* Tree Picker */}
                        <div className="flex-1 overflow-y-auto px-2 py-2" style={{ maxHeight: '400px' }}>
                            {(() => {
                                const searchLower = moveTargetSearch.toLowerCase();
                                // Filter out selected assets and their descendants
                                const selectedSet = selectedIds;
                                const isDescendantOfSelected = (assetId: string): boolean => {
                                    let curr = assetId;
                                    let depth = 0;
                                    while (curr && depth < 20) {
                                        if (selectedSet.has(curr)) return true;
                                        const parent = assets.find(a => a.id === curr);
                                        curr = parent?.parentId || '';
                                        depth++;
                                    }
                                    return false;
                                };

                                // Build flat list sorted by tree order (root first, then children)
                                const buildPickerTree = (parentId: string | null, depth: number): { asset: Asset; depth: number }[] => {
                                    const children = assets
                                        .filter(a => (a.parentId || null) === parentId)
                                        .sort((a, b) => a.tag.localeCompare(b.tag));
                                    let result: { asset: Asset; depth: number }[] = [];
                                    for (const child of children) {
                                        result.push({ asset: child, depth });
                                        result = result.concat(buildPickerTree(child.id, depth + 1));
                                    }
                                    return result;
                                };

                                const allNodes = buildPickerTree(null, 0);
                                const filtered = allNodes.filter(({ asset }) => {
                                    // Don't show selected assets as targets
                                    if (selectedSet.has(asset.id)) return false;
                                    // Don't show descendants of selected (would create cycle)
                                    if (isDescendantOfSelected(asset.id)) return false;
                                    // Apply search filter
                                    if (searchLower) {
                                        return asset.tag.toLowerCase().includes(searchLower) ||
                                               asset.name.toLowerCase().includes(searchLower);
                                    }
                                    return true;
                                });

                                if (filtered.length === 0) {
                                    return (
                                        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                                            <Search size={32} className="mb-2 opacity-50" />
                                            <span className="text-sm">No eligible targets found</span>
                                        </div>
                                    );
                                }

                                return filtered.map(({ asset: target, depth }) => {
                                    const isTargetSelected = moveTargetId === target.id;
                                    const isLoc = isLocation(target);
                                    const validation = moveTargetId === target.id ? validateMove(Array.from(selectedIds), target.id) : null;

                                    return (
                                        <button
                                            key={target.id}
                                            onClick={() => setMoveTargetId(isTargetSelected ? null : target.id)}
                                            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-all
                                                ${isTargetSelected
                                                    ? 'bg-blue-50 ring-2 ring-blue-400 text-blue-900'
                                                    : 'hover:bg-slate-50 text-slate-700'
                                                }
                                            `}
                                            style={{ paddingLeft: `${12 + depth * 20}px` }}
                                        >
                                            <div className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${
                                                isLoc ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                                            }`}>
                                                {isLoc ? <MapPin size={14} /> : <Cpu size={14} />}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="font-semibold text-xs truncate">{target.tag}</div>
                                                <div className="text-[11px] text-slate-500 truncate">{target.name}</div>
                                            </div>
                                            {isTargetSelected && (
                                                <CheckCircle size={16} className="text-blue-600 flex-shrink-0" />
                                            )}
                                        </button>
                                    );
                                });
                            })()}
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
                            {moveTargetId && (() => {
                                const target = assets.find(a => a.id === moveTargetId);
                                const validation = validateMove(Array.from(selectedIds), moveTargetId);
                                return (
                                    <div className={`text-xs mb-3 px-3 py-2 rounded-lg ${
                                        validation.valid
                                            ? 'bg-blue-50 text-blue-800 border border-blue-200'
                                            : 'bg-red-50 text-red-800 border border-red-200'
                                    }`}>
                                        {validation.valid
                                            ? <>Move <strong>{selectedIds.size}</strong> asset{selectedIds.size > 1 ? 's' : ''} under <strong>{target?.tag}</strong> — {target?.name}</>
                                            : <><AlertCircle size={12} className="inline mr-1" />{validation.reason}</>
                                        }
                                    </div>
                                );
                            })()}
                            <div className="flex gap-2 justify-end">
                                <button
                                    onClick={() => setIsMoveToParentOpen(false)}
                                    className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleMoveToParent}
                                    disabled={!moveTargetId || !validateMove(Array.from(selectedIds), moveTargetId!).valid}
                                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium flex items-center gap-2"
                                >
                                    <FolderInput size={14} /> Confirm Move
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ━━ Detach Confirmation Modal ━━ */}
            {isDetachConfirmOpen && (() => {
                const affectedAssets = Array.from(selectedIds)
                    .map(id => assets.find(a => a.id === id))
                    .filter((a): a is Asset => !!a && !!a.parentId);
                const parentNames = new Map<string, string>();
                affectedAssets.forEach(a => {
                    if (a.parentId && !parentNames.has(a.parentId)) {
                        const parent = assets.find(p => p.id === a.parentId);
                        if (parent) parentNames.set(a.parentId, `${parent.tag} — ${parent.name}`);
                    }
                });

                return (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setIsDetachConfirmOpen(false)}>
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                            {/* Header */}
                            <div className="px-6 py-4 bg-amber-50 border-b border-amber-200">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                                        <AlertTriangle size={20} className="text-amber-600" />
                                    </div>
                                    <div>
                                        <h3 className="text-base font-bold text-slate-900">Detach from Parent?</h3>
                                        <p className="text-xs text-slate-500 mt-0.5">
                                            {affectedAssets.length} asset{affectedAssets.length > 1 ? 's' : ''} will be moved to the root level
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Affected Assets List */}
                            <div className="px-6 py-4 max-h-[250px] overflow-y-auto">
                                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Affected Assets</p>
                                <div className="space-y-1.5">
                                    {affectedAssets.map(a => {
                                        const parentLabel = a.parentId ? parentNames.get(a.parentId) : '';
                                        return (
                                            <div key={a.id} className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg">
                                                <Unlink size={13} className="text-amber-500 flex-shrink-0" />
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-xs font-semibold text-slate-800 truncate">{a.tag} — {a.name}</div>
                                                    {parentLabel && (
                                                        <div className="text-[11px] text-slate-400 truncate flex items-center gap-1">
                                                            <CornerDownRight size={10} /> from {parentLabel}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex gap-2 justify-end">
                                <button
                                    onClick={() => setIsDetachConfirmOpen(false)}
                                    className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleConfirmDetach}
                                    className="px-4 py-2 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors font-medium flex items-center gap-2"
                                >
                                    <Unlink size={14} /> Detach {affectedAssets.length} Asset{affectedAssets.length > 1 ? 's' : ''}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {
                isAddModalOpen && (
                    <AddAssetModal
                        isOpen={isAddModalOpen}
                        onClose={() => setIsAddModalOpen(false)}
                        onSave={handleCreateAsset}
                        type={addType}
                        existingAssets={assets}
                        initialParentId={selectedAsset ? selectedAsset.id : undefined}
                        assetTypes={assetTypes}
                        dictionaries={dictionaries}
                        costCenters={costCenters}
                    />
                )
            }

            {/* Bulk Import Modal */}
            <BulkImportModal
                isOpen={isBulkImportOpen}
                onClose={() => setIsBulkImportOpen(false)}
                existingAssets={assets}
                allowedTypes={['asset', 'bom']}
                onImportData={async () => {}}
                onImportAssets={async (importedAssets) => {
                    let successCount = 0;
                    let failCount = 0;
                    for (const a of importedAssets) {
                        try {
                            const newAsset: Asset = {
                                id: crypto.randomUUID(),
                                tag: a.tag || '',
                                name: a.name || '',
                                assetType: a.assetType || '',
                                category: a.assetType || 'Equipment',
                                criticality: (a.criticality as any) || 'C',
                                status: (a.status as any) || 'ACTIVE',
                                department: a.department || '',
                                costCenter: a.costCenter || '',
                                location: a.location || '',
                                manufacturer: a.manufacturer || '',
                                model: a.model || '',
                                serialNumber: a.serialNumber || '',
                                description: a.description || a.name || '',
                                healthScore: 100,
                                parentId: a.parentId || undefined,
                                priority: 'MEDIUM',
                                bomItems: [],
                            };
                            await DatabaseService.getInstance().addAsset(newAsset);
                            successCount++;
                        } catch (err) {
                            failCount++;
                            errorLog.importError('assets', `Failed to import asset row: ${a.tag || 'unknown'}`, err, {
                                tag: a.tag, name: a.name, assetType: a.assetType, status: a.status,
                                criticality: a.criticality, department: a.department,
                            });
                        }
                    }
                    const refreshed = await DatabaseService.getInstance().getAssets();
                    setAssets(refreshed);
                    if (failCount > 0) {
                        showToast(`Imported ${successCount} assets, ${failCount} failed — see Error Logs`, 'warning');
                    } else {
                        showToast(`Imported ${successCount} assets`, 'success');
                    }
                }}
                onImportBOMs={async (bomGroups) => {
                    let count = 0;
                    let failCount = 0;
                    for (const group of bomGroups) {
                        const asset = assets.find(a => a.tag.toUpperCase() === group.assetTag.toUpperCase());
                        if (!asset) {
                            failCount++;
                            errorLog.importError('assets', `BOM import: asset tag "${group.assetTag}" not found in register`, undefined, {
                                assetTag: group.assetTag, itemCount: group.items.length,
                            });
                            continue;
                        }
                        try {
                            const existingBom = asset.bomItems || [];
                            const newItems: BomItem[] = group.items.map(item => ({
                                id: crypto.randomUUID(),
                                inventoryCode: item.inventoryCode || '',
                                description: item.description || '',
                                quantity: item.quantity || 1,
                                uom: item.uom || 'EA',
                                critical: item.critical || false,
                            }));
                            await DatabaseService.getInstance().updateAsset({ ...asset, bomItems: [...existingBom, ...newItems] });
                            count += newItems.length;
                        } catch (err) {
                            failCount++;
                            errorLog.importError('assets', `BOM import failed for ${group.assetTag}`, err, {
                                assetTag: group.assetTag, itemCount: group.items.length,
                            });
                        }
                    }
                    const refreshed = await DatabaseService.getInstance().getAssets();
                    setAssets(refreshed);
                    if (failCount > 0) {
                        showToast(`Imported ${count} BOM items, ${failCount} groups failed — see Error Logs`, 'warning');
                    } else {
                        showToast(`Imported ${count} BOM items`, 'success');
                    }
                }}
            />

            {/* FAB for mobile — one-hand asset creation (visible < 768px only) */}
            {canCreate && (
                <FloatingActionButton onClick={() => openAddModal('Asset')} label="New Asset" />
            )}
        </div >
    );
};

function DetailsTab({ asset, assetTypes, contacts, vendors, costCenters, dictionaries, onUpdate, onRefreshContacts, tagEditable = false, onChangeTag }: { asset: Asset, assetTypes: any[], contacts: Contact[], vendors: Vendor[], costCenters: any[], dictionaries: DictionaryEntry[], onUpdate: (a: Asset) => void, onRefreshContacts: () => Promise<void>, tagEditable?: boolean, onChangeTag?: (newTag: string, reason: string) => Promise<void> }) {

    // State for Models
    const [models, setModels] = useState<{ code: string; description: string }[]>([]);
    const [paramsLoading, setParamsLoading] = useState(false);

    // Modal States
    const [isAddMfrOpen, setIsAddMfrOpen] = useState(false);
    const [isAddModelOpen, setIsAddModelOpen] = useState(false);

    // Change Tag Modal State
    const [isChangeTagOpen, setIsChangeTagOpen] = useState(false);
    const [newTag, setNewTag] = useState('');
    const [changeReason, setChangeReason] = useState('');
    const [changingTag, setChangingTag] = useState(false);

    // Derived: Manufacturers List
    // Merge manufacturers from BOTH contacts (legacy) AND the vendors module
    const manufacturers = useMemo(() => {
        const fromContacts = contacts
            .filter(c =>
                c.types.includes('MANUFACTURER') ||
                c.types.includes('VENDOR') ||
                c.flags?.isVendor
            )
            .map(c => c.name);

        const fromVendors = (vendors || [])
            .filter(v => v.active && (v.type === 'MANUFACTURER' || v.type === 'SUPPLIER'))
            .map(v => v.name);

        // De-duplicate by name
        const uniqueNames = [...new Set([...fromContacts, ...fromVendors])];
        return uniqueNames.sort().map(name => ({ code: name, description: name }));
    }, [contacts, vendors]);

    // Derived: Current Manufacturer Contact
    const mfrContact = useMemo(() => {
        return contacts.find(c => c.name === asset.manufacturer);
    }, [asset.manufacturer, contacts]);

    // Effect: Load Models when Manufacturer ID changes
    // We have to look up the ID from the name stored in asset.manufacturer
    useEffect(() => {
        const loadModels = async () => {
            if (!asset.manufacturer) {
                setModels([]);
                return;
            }

            setParamsLoading(true);
            try {
                // Try contact-based models first, then fallback to vendor-based
                const mfrContact = contacts.find(c => c.name === asset.manufacturer);
                let data: any[];
                if (mfrContact) {
                    data = await DatabaseService.getInstance().getContactModels(mfrContact.id);
                } else {
                    // Fallback: search vendors table by name
                    data = await DatabaseService.getInstance().getModelsByManufacturerName(asset.manufacturer);
                }
                setModels(data.map((m: any) => ({
                    code: m.code,
                    description: `${m.code} - ${m.description || ''}`
                })));
            } catch (e) {
                console.error("Failed to load models", e);
            } finally {
                setParamsLoading(false);
            }
        };
        loadModels();
    }, [asset.manufacturer, contacts]);

    // Helper to update a field
    const handleChange = (field: keyof Asset, value: any) => {
        onUpdate({ ...asset, [field]: value });
    };

    const handleMfrCreated = async (newContact: Contact) => {
        // Refresh contacts to pick up the new manufacturer
        await onRefreshContacts();

        // Optimistically update the asset's manufacturer to the new contact
        handleChange('manufacturer', newContact.name);

        // No longer need to alert user about refresh
        setIsAddMfrOpen(false);
    };

    const handleModelCreated = async (model: any) => {
        // Add to local models list immediately
        setModels(prev => [...prev, { code: model.code, description: `${model.code} - ${model.description}` }]);
        handleChange('model', model.code);
        setIsAddModelOpen(false);
    };



    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in duration-300">
            {/* Modals */}
            {isAddMfrOpen && (
                <AddContactModal
                    onClose={() => setIsAddMfrOpen(false)}
                    onSave={handleMfrCreated}
                    contactTypes={dictionaries.filter(d => d.type === 'CONTACT_TYPE')}
                    initialType="MANUFACTURER"
                    costCenters={dictionaries.filter(d => d.type === 'COST_CENTRE')}
                />
            )}
            {isAddModelOpen && mfrContact && (
                <SimpleAddModelModal
                    isOpen={isAddModelOpen}
                    onClose={() => setIsAddModelOpen(false)}
                    onSave={handleModelCreated}
                    manufacturerName={mfrContact.name}
                    contactId={mfrContact.id}
                />
            )}

            <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-4">

                {/* Asset Tag + Status */}
                <div className="mb-4">
                    <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">
                            Asset Tag
                            {!tagEditable && (
                                <span title="Asset tags are locked after creation"><Lock size={11} className="text-slate-400" /></span>
                            )}
                            {!tagEditable && onChangeTag && (
                                <button
                                    type="button"
                                    onClick={() => { setNewTag(asset.tag); setChangeReason(''); setIsChangeTagOpen(true); }}
                                    className="px-2 py-0.5 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded hover:bg-amber-100 transition inline-flex items-center gap-1 whitespace-nowrap normal-case"
                                    title="Administrative tag change with audit trail"
                                >
                                    <Wrench size={9} /> Change
                                </button>
                            )}
                        </label>
                        <div className="flex items-center gap-1.5">
                            <div className="relative">
                                <select
                                    value={asset.status || 'ACTIVE'}
                                    onChange={(e) => handleChange('status', e.target.value as AssetStatus)}
                                    className={`appearance-none pl-5 pr-6 py-1 rounded-full text-[11px] font-bold border transition-all duration-300 whitespace-nowrap cursor-pointer outline-none ${
                                        asset.status === AssetStatus.ACTIVE ? 'bg-green-50 border-green-300 text-green-700' :
                                        asset.status === AssetStatus.MAINTENANCE ? 'bg-amber-50 border-amber-300 text-amber-700' :
                                        asset.status === AssetStatus.STANDBY ? 'bg-blue-50 border-blue-300 text-blue-700' :
                                        asset.status === AssetStatus.DOWN ? 'bg-red-50 border-red-300 text-red-700' :
                                        asset.status === AssetStatus.DECOMMISSIONED ? 'bg-slate-50 border-slate-300 text-slate-500' :
                                        'bg-green-50 border-green-300 text-green-700'
                                    }`}
                                >
                                    <option value={AssetStatus.ACTIVE}>Active</option>
                                    <option value={AssetStatus.MAINTENANCE}>Maint.</option>
                                    <option value={AssetStatus.STANDBY}>Standby</option>
                                    <option value={AssetStatus.DOWN}>Down</option>
                                    <option value={AssetStatus.DECOMMISSIONED}>Decom.</option>
                                </select>
                                <span className={`absolute left-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full pointer-events-none ${
                                    asset.status === AssetStatus.ACTIVE ? 'bg-green-500' :
                                    asset.status === AssetStatus.MAINTENANCE ? 'bg-amber-500' :
                                    asset.status === AssetStatus.STANDBY ? 'bg-blue-500' :
                                    asset.status === AssetStatus.DOWN ? 'bg-red-500' :
                                    asset.status === AssetStatus.DECOMMISSIONED ? 'bg-slate-400' :
                                    'bg-green-500'
                                }`} />
                                <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none opacity-40" />
                            </div>
                        </div>
                    </div>
                    <div className="relative">
                        <input
                            type="text"
                            value={asset.tag}
                            onChange={(e) => tagEditable ? handleChange('tag', e.target.value) : null}
                            readOnly={!tagEditable}
                            className={`w-full text-sm border shadow-sm rounded-md p-2 outline-none transition-colors ${
                                tagEditable
                                    ? 'border-blue-400 bg-blue-50/30 focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
                                    : 'border-slate-200 bg-slate-50 text-slate-700 cursor-not-allowed'
                            }`}
                            title={!tagEditable ? 'Asset tag is locked after creation. Use "Change" for audited changes.' : 'Set the asset tag (one-time — locks on save)'}
                        />
                        {tagEditable && (
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-bold text-blue-500 bg-blue-100 px-1.5 py-0.5 rounded uppercase">
                                Editable — locks on save
                            </span>
                        )}
                    </div>
                </div>

                {/* ── Internal Equipment Number (SAP PM parity) ── */}
                {asset.equipmentNumber && (
                    <div className="flex items-center gap-3 px-3 py-2 bg-blue-50/60 border border-blue-100 rounded-lg">
                        <div className="flex items-center gap-1.5">
                            <Hash size={13} className="text-blue-500" />
                            <span className="text-[10px] font-bold text-blue-400 uppercase">Equipment No.</span>
                        </div>
                        <span className="text-sm font-mono font-bold text-blue-700 tracking-wide">{asset.equipmentNumber}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 font-semibold">Gen {asset.equipmentGeneration || 1}</span>
                        <Lock size={10} className="text-blue-300 ml-auto" />
                        <span className="text-[9px] text-blue-400">Auto-generated · Immutable</span>
                    </div>
                )}

                {/* ── Change Tag Modal (SAP Change Document) ── */}
                {isChangeTagOpen && (
                    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setIsChangeTagOpen(false)}>
                        <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center">
                                    <History size={20} className="text-amber-600" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-slate-800">Change Asset Tag</h3>
                                    <p className="text-xs text-slate-500">This change will be recorded in the audit trail</p>
                                </div>
                            </div>

                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                                <strong>Management of Change:</strong> Changing an asset tag affects all linked work orders, costs, and history. This action is logged per ISO 55000 / NIST compliance.
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Current Tag</label>
                                <div className="text-sm font-mono bg-slate-50 border border-slate-200 rounded-md p-2 text-slate-600">{asset.tag}</div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">New Tag <span className="text-red-500">*</span></label>
                                <input
                                    type="text"
                                    value={newTag}
                                    onChange={e => setNewTag(e.target.value)}
                                    className="w-full text-sm border border-slate-300 rounded-md p-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                                    placeholder="Enter new asset tag..."
                                    autoFocus
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Reason for Change <span className="text-red-500">*</span></label>
                                <textarea
                                    value={changeReason}
                                    onChange={e => setChangeReason(e.target.value)}
                                    className="w-full text-sm border border-slate-300 rounded-md p-2 min-h-[4rem] focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-y"
                                    placeholder="Explain why this tag is being changed (required for audit)..."
                                />
                            </div>

                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    onClick={() => setIsChangeTagOpen(false)}
                                    className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={async () => {
                                        if (!newTag.trim() || newTag.trim() === asset.tag) return;
                                        if (!changeReason.trim()) return;
                                        setChangingTag(true);
                                        await onChangeTag!(newTag.trim(), changeReason.trim());
                                        setChangingTag(false);
                                        setIsChangeTagOpen(false);
                                    }}
                                    disabled={!newTag.trim() || newTag.trim() === asset.tag || !changeReason.trim() || changingTag}
                                    className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                >
                                    {changingTag ? (
                                        <><span className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full" /> Saving...</>
                                    ) : (
                                        <><History size={14} /> Confirm Change</>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                <div className="flex flex-col md:flex-row gap-6 mb-4">
                    <div className="flex-shrink-0 flex justify-center md:block">
                        <ImageCapture
                            bucket="assets"
                            prefix="asset_"
                            currentImage={asset.image}
                            onImageCaptured={(url) => handleChange('image', url)}
                            onRemove={() => handleChange('image', null)}
                            shape="square"
                            size="lg"
                        />
                    </div>

                    <div className="flex-grow flex flex-col">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Description</label>
                        <textarea
                            value={asset.name}
                            onChange={(e) => handleChange('name', e.target.value)}
                            className="w-full flex-1 text-sm border border-slate-300 shadow-sm rounded-md bg-white p-2 min-h-[5rem] resize-y focus:border-blue-500 focus:ring-1 focus:ring-primary-500 outline-none transition-colors"
                            placeholder="Brief description (replaces Asset Name)..."
                        />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Asset Category</label>
                        <SearchableDropdown
                            options={dictionaries.filter(d => d.type === 'ASSET_CATEGORY' && d.active).map(d => ({
                                code: d.code,
                                description: d.description
                            })).sort((a, b) => a.description.localeCompare(b.description))}
                            value={asset.assetCategory || ''}
                            onChange={(code) => {
                                // ISO 14224: Category → Class → Type. Reset children.
                                onUpdate({ ...asset, assetCategory: code, assetClass: '', assetType: '', category: '' });
                            }}
                            placeholder="Select Category..."
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Asset Class</label>
                        <SearchableDropdown
                            options={dictionaries
                                .filter(d => d.type === 'ASSET_CLASS' && d.active)
                                .filter(d => !asset.assetCategory || d.categoryRef === asset.assetCategory)
                                .map(d => ({ code: d.code, description: d.description }))
                                .sort((a, b) => a.description.localeCompare(b.description))}
                            value={asset.assetClass || ''}
                            onChange={(code) => {
                                // ISO 14224: When class changes, reset type
                                onUpdate({ ...asset, assetClass: code, assetType: '', category: '' });
                            }}
                            placeholder={asset.assetCategory ? "Select Class..." : "Select Category first..."}
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Asset Type</label>
                        <SearchableDropdown
                            options={dictionaries
                                .filter(d => d.type === 'ASSET_TYPE' && d.active)
                                .filter(d => !asset.assetClass || d.categoryRef === asset.assetClass)
                                .map(d => ({ code: d.code, description: d.description }))
                                .sort((a, b) => a.description.localeCompare(b.description))}
                            value={asset.assetType || ''}
                            onChange={(code) => {
                                onUpdate({ ...asset, assetType: code, category: code });
                            }}
                            placeholder={asset.assetClass ? "Select Type..." : "Select Class first..."}
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Criticality</label>
                        <select
                            value={asset.criticality}
                            onChange={(e) => handleChange('criticality', e.target.value)}
                            className="w-full text-sm border border-slate-300 shadow-sm rounded-md bg-white p-2 focus:border-blue-500 focus:ring-1 focus:ring-primary-500 outline-none transition-colors"
                        >
                            <option value="">Select Criticality</option>
                            {dictionaries.filter(d => d.type === 'CRITICALITY' && d.active).map(c => (
                                <option key={c.id} value={c.code}>{c.code} — {c.description}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-4">
                <h3 className="font-bold text-slate-800 border-b border-slate-100 pb-2 mb-4">Specification & Location</h3>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Manufacturer</label>
                        <div className="flex items-stretch">
                            <div className="flex-1">
                                <SearchableDropdown
                                    options={manufacturers}
                                    value={asset.manufacturer}
                                    onChange={(val) => {
                                        onUpdate({
                                            ...asset,
                                            manufacturer: val,
                                            model: ''
                                        });
                                    }}
                                    placeholder="Select Manufacturer..."
                                />
                            </div>
                            <button
                                onClick={() => setIsAddMfrOpen(true)}
                                className="ml-2 px-3 border border-slate-300 rounded-md hover:bg-slate-50 text-blue-600 bg-white shadow-sm transition-colors flex items-center justify-center"
                                title="Add New Manufacturer"
                            >
                                <Plus size={16} />
                            </button>
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Model</label>
                        <div className={`flex items-stretch ${!asset.manufacturer ? 'opacity-50 cursor-not-allowed' : ''}`}>
                            <div className="flex-1">
                                <SearchableDropdown
                                    options={models}
                                    value={asset.model}
                                    onChange={(val) => handleChange('model', val)}
                                    placeholder={paramsLoading ? "Loading..." : "Select Model..."}
                                    disabled={!asset.manufacturer || models.length === 0}
                                />
                            </div>
                            <button
                                onClick={() => setIsAddModelOpen(true)}
                                disabled={!mfrContact}
                                className="ml-2 px-3 border border-slate-300 rounded-md hover:bg-slate-50 text-blue-600 bg-white shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                                title="Add New Model"
                            >
                                <Plus size={16} />
                            </button>
                        </div>
                    </div>
                    <div className="col-span-2">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Serial Number</label>
                        <input
                            type="text"
                            value={asset.serialNumber || ''}
                            onChange={(e) => handleChange('serialNumber', e.target.value)}
                            className="w-full text-sm border border-slate-300 shadow-sm rounded-md bg-white p-2 focus:border-blue-500 focus:ring-1 focus:ring-primary-500 outline-none transition-colors"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Department</label>
                        <input
                            type="text"
                            value={asset.department || ''}
                            onChange={(e) => handleChange('department', e.target.value)}
                            className="w-full text-sm border border-slate-300 shadow-sm rounded-md bg-white p-2 focus:border-blue-500 focus:ring-1 focus:ring-primary-500 outline-none transition-colors"
                        />
                    </div>
                    <div className="col-span-1">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Cost Center</label>
                        <select
                            value={asset.costCenter || ''}
                            onChange={(e) => handleChange('costCenter', e.target.value)}
                            className="w-full text-sm border border-slate-300 shadow-sm rounded-md bg-white p-2 focus:border-blue-500 focus:ring-1 focus:ring-primary-500 outline-none transition-colors"
                        >
                            <option value="">(None)</option>
                            {costCenters.map(cc => (
                                <option key={cc.id} value={cc.id}>{cc.name} ({cc.code})</option>
                            ))}
                        </select>
                    </div>
                    <div className="col-span-2">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Location / Area</label>
                        <input
                            type="text"
                            value={asset.location || ''}
                            onChange={(e) => handleChange('location', e.target.value)}
                            className="w-full text-sm border border-slate-300 shadow-sm rounded-md bg-white p-2 focus:border-blue-500 focus:ring-1 focus:ring-primary-500 outline-none transition-colors"
                        />
                    </div>
                </div>
            </div>

            {/* ── QR Code (G5) ── */}
            <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm">
                <h3 className="font-bold text-slate-800 border-b border-slate-100 pb-2 mb-4 flex items-center gap-2">
                    <QrCode size={16} className="text-slate-400" /> Asset QR Code
                </h3>
                <div className="flex flex-col items-center">
                    <AssetQRCode asset={asset} size={140} showActions={true} />
                    <p className="text-xs text-slate-400 mt-3">Scan to access asset details from mobile</p>
                    <p className="text-[10px] text-slate-300 mt-0.5 font-mono">ers://asset/{asset.tag}</p>
                </div>
            </div>

            {/* ── Custom Fields (G7) ── */}
            <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm">
                <h3 className="font-bold text-slate-800 border-b border-slate-100 pb-2 mb-4 flex items-center justify-between">
                    <span className="flex items-center gap-2"><FileText size={16} className="text-slate-400" /> Custom Fields</span>
                    <span className="text-[10px] text-slate-400 font-normal">{(asset.customFields || []).length} fields</span>
                </h3>
                <div className="divide-y divide-slate-100">
                    {(asset.customFields || []).map(cf => (
                        <div key={cf.id} className="py-2 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase ${
                                    cf.type === 'NUMBER' ? 'bg-blue-50 text-blue-600 border-blue-200' :
                                    cf.type === 'DATE' ? 'bg-blue-50 text-blue-600 border-blue-200' :
                                    cf.type === 'BOOLEAN' ? 'bg-amber-50 text-amber-600 border-amber-200' :
                                    cf.type === 'DROPDOWN' ? 'bg-teal-50 text-teal-600 border-teal-200' :
                                    'bg-slate-50 text-slate-600 border-slate-200'
                                }`}>{cf.type}</span>
                                <span className="text-sm font-medium text-slate-700 truncate">{cf.key}</span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                                <span className="text-sm font-semibold text-slate-900">{cf.value}</span>
                                {cf.unit && <span className="text-xs text-slate-400">{cf.unit}</span>}
                            </div>
                        </div>
                    ))}
                    {!(asset.customFields || []).length && (
                        <div className="py-4 text-center text-sm text-slate-400 italic">
                            No custom fields defined yet. Track asset-specific attributes like pressure ratings, flow capacities, etc.
                        </div>
                    )}
                </div>
            </div>
        </div >
    );
};


function HierarchyTab({ asset, assets, onSelect }: { asset: Asset, assets: Asset[], onSelect: (a: Asset) => void }) {
    const parent = assets.find(a => a.id === asset.parentId);
    const children = assets.filter(a => a.parentId === asset.id);
    const siblings = parent ? assets.filter(a => a.parentId === parent.id && a.id !== asset.id) : [];

    // Build full breadcrumb trail from root → current
    const breadcrumbs: Asset[] = [];
    let walk: Asset | undefined = asset;
    while (walk) {
        breadcrumbs.unshift(walk);
        walk = walk.parentId ? assets.find(a => a.id === walk!.parentId) : undefined;
    }

    // ISO 14224 level names by depth
    const ISO_LEVELS: { label: string; tag: string; color: string }[] = [
        { label: 'Enterprise', tag: 'L1', color: 'bg-blue-100 text-blue-700 border-blue-200' },
        { label: 'Site', tag: 'L2', color: 'bg-sky-100 text-sky-700 border-sky-200' },
        { label: 'Plant', tag: 'L3', color: 'bg-cyan-100 text-cyan-700 border-cyan-200' },
        { label: 'Unit', tag: 'L4', color: 'bg-teal-100 text-teal-700 border-teal-200' },
        { label: 'System', tag: 'L5', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
        { label: 'Equipment', tag: 'L6', color: 'bg-amber-100 text-amber-700 border-amber-200' },
        { label: 'Subunit', tag: 'L7', color: 'bg-orange-100 text-orange-700 border-orange-200' },
        { label: 'Component', tag: 'L8', color: 'bg-rose-100 text-rose-700 border-rose-200' },
    ];

    const getLevel = (depth: number) => ISO_LEVELS[Math.min(depth, ISO_LEVELS.length - 1)];
    const currentDepth = breadcrumbs.length - 1;
    const currentLevel = getLevel(currentDepth);

    // Criticality styling
    const critColors: Record<string, { bg: string; text: string; ring: string; label: string }> = {
        A: { bg: 'bg-red-100', text: 'text-red-700', ring: 'ring-red-300', label: 'Safety Critical' },
        B: { bg: 'bg-amber-100', text: 'text-amber-700', ring: 'ring-amber-300', label: 'Production Critical' },
        C: { bg: 'bg-emerald-100', text: 'text-emerald-700', ring: 'ring-emerald-300', label: 'General' },
        D: { bg: 'bg-slate-100', text: 'text-slate-600', ring: 'ring-slate-300', label: 'Low Impact' },
    };
    const getCrit = (c?: string) => critColors[c || 'C'] || critColors.C;

    // Status icon
    const statusIcon = (s: AssetStatus) => {
        switch (s) {
            case AssetStatus.ACTIVE: return <CheckCircle size={12} className="text-emerald-500" />;
            case AssetStatus.MAINTENANCE: return <Wrench size={12} className="text-amber-500" />;
            case AssetStatus.STANDBY: return <Clock size={12} className="text-blue-500" />;
            case AssetStatus.DOWN: return <AlertCircle size={12} className="text-red-500" />;
            case AssetStatus.DECOMMISSIONED: return <XCircle size={12} className="text-slate-400" />;
            default: return <Clock size={12} className="text-slate-400" />;
        }
    };

    const childCount = (a: Asset) => assets.filter(c => c.parentId === a.id).length;

    return (
        <div className="space-y-5 animate-in fade-in duration-300">
            {/* ── Breadcrumb Trail ── */}
            <div className="bg-gradient-to-r from-slate-50 to-white p-3 rounded-lg border border-slate-200">
                <div className="flex items-center gap-1 flex-wrap text-xs">
                    {breadcrumbs.map((bc, i) => {
                        const lvl = getLevel(i);
                        const isCurrent = i === breadcrumbs.length - 1;
                        return (
                            <React.Fragment key={bc.id}>
                                {i > 0 && <ChevronRight size={12} className="text-slate-300 shrink-0" />}
                                <button
                                    onClick={() => !isCurrent && onSelect(bc)}
                                    disabled={isCurrent}
                                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md transition-all ${isCurrent
                                        ? 'bg-slate-800 text-white font-semibold shadow-sm'
                                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800 cursor-pointer'
                                    }`}
                                >
                                    <span className={`text-[9px] font-bold px-1 py-0.5 rounded border ${lvl.color}`}>{lvl.tag}</span>
                                    <span className="truncate max-w-[120px]">{bc.tag || bc.name}</span>
                                </button>
                            </React.Fragment>
                        );
                    })}
                </div>
            </div>

            {/* ── Current Asset Identity ── */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 bg-gradient-to-r from-slate-800 to-slate-700">
                    <div className="flex items-start justify-between">
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${currentLevel.color}`}>{currentLevel.tag}</span>
                                <span className="text-xs text-slate-300 font-medium">{currentLevel.label}</span>
                            </div>
                            <h3 className="text-lg font-bold text-white">{asset.tag}</h3>
                            <p className="text-sm text-slate-300 mt-0.5">{asset.name}</p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                            {asset.criticality && (
                                <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold ring-1 ${getCrit(asset.criticality).bg} ${getCrit(asset.criticality).text} ${getCrit(asset.criticality).ring}`}>
                                    {asset.criticality === 'A' && <AlertCircle size={10} />}
                                    Crit {asset.criticality} — {getCrit(asset.criticality).label}
                                </div>
                            )}
                            <div className="flex items-center gap-1 text-xs text-slate-300">
                                {statusIcon(asset.status)}
                                <span>{asset.status}</span>
                            </div>
                        </div>
                    </div>
                    {/* Health bar */}
                    <div className="mt-3 flex items-center gap-2">
                        <span className="text-[10px] text-slate-400 uppercase font-semibold">Health</span>
                        <div className="flex-1 h-1.5 bg-slate-600 rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all ${asset.healthScore >= 80 ? 'bg-emerald-400' : asset.healthScore >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                                style={{ width: `${asset.healthScore}%` }}
                            />
                        </div>
                        <span className="text-xs text-white font-semibold">{asset.healthScore}%</span>
                    </div>
                </div>

                {/* Hierarchy stats row */}
                <div className="grid grid-cols-3 divide-x divide-slate-100 bg-slate-50/50">
                    <div className="p-3 text-center">
                        <div className="text-lg font-bold text-slate-800">{parent ? 1 : 0}</div>
                        <div className="text-[10px] text-slate-500 uppercase font-semibold">Parent</div>
                    </div>
                    <div className="p-3 text-center">
                        <div className="text-lg font-bold text-slate-800">{children.length}</div>
                        <div className="text-[10px] text-slate-500 uppercase font-semibold">Children</div>
                    </div>
                    <div className="p-3 text-center">
                        <div className="text-lg font-bold text-slate-800">{siblings.length}</div>
                        <div className="text-[10px] text-slate-500 uppercase font-semibold">Siblings</div>
                    </div>
                </div>
            </div>

            {/* ── Parent Card ── */}
            {parent && (
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    <h3 className="text-[10px] font-bold text-slate-500 uppercase mb-2 flex items-center gap-1">
                        <ArrowUpRight size={12} /> Parent
                    </h3>
                    <div
                        onClick={() => onSelect(parent)}
                        className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200 cursor-pointer hover:bg-blue-50 hover:border-blue-300 transition-all group"
                    >
                        <div className="p-2 bg-blue-100 rounded-lg text-blue-600 group-hover:bg-blue-200 transition-colors">
                            <Building size={18} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                                <span className={`text-[9px] font-bold px-1 py-0.5 rounded border ${getLevel(Math.max(0, currentDepth - 1)).color}`}>
                                    {getLevel(Math.max(0, currentDepth - 1)).tag}
                                </span>
                                <span className="font-bold text-sm text-slate-900 truncate">{parent.tag}</span>
                                {parent.criticality && (
                                    <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${getCrit(parent.criticality).bg} ${getCrit(parent.criticality).text}`}>
                                        {parent.criticality}
                                    </span>
                                )}
                            </div>
                            <div className="text-xs text-slate-500 truncate">{parent.name}</div>
                        </div>
                        <ChevronRight size={16} className="text-slate-300 group-hover:text-blue-500 transition-colors" />
                    </div>
                </div>
            )}

            {/* ── Children ── */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <div className="p-4 bg-gradient-to-r from-emerald-50 to-white border-b border-slate-200 flex justify-between items-center">
                    <h3 className="text-[10px] font-bold text-slate-600 uppercase flex items-center gap-1.5">
                        <CornerDownRight size={12} className="text-emerald-500" />
                        Children — {getLevel(currentDepth + 1).tag} {getLevel(currentDepth + 1).label}
                        <span className="ml-1 bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full text-[10px]">{children.length}</span>
                    </h3>
                    <button className="text-xs bg-white border border-slate-300 px-3 py-1.5 rounded-lg hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700 transition-colors font-medium">
                        + Link Child
                    </button>
                </div>
                <div className="relative">
                    {/* Vertical trunk line connecting all children */}
                    {children.length > 0 && (
                        <div
                            className="absolute left-6 top-0 border-l-2 border-emerald-300/60"
                            style={{ height: `calc(100% - ${children.length > 0 ? '28px' : '0px'})` }}
                        />
                    )}
                    {children.map((child, idx) => {
                        const cc = childCount(child);
                        const crit = getCrit(child.criticality);
                        const isLast = idx === children.length - 1;
                        return (
                            <div
                                key={child.id}
                                onClick={() => onSelect(child)}
                                className="p-3 pl-10 flex items-center gap-3 hover:bg-slate-50 cursor-pointer transition-all group relative"
                            >
                                {/* Branch connector: ├ or └ */}
                                <div
                                    className="absolute left-6 border-l-2 border-b-2 border-emerald-300/60 rounded-bl-md"
                                    style={{ top: 0, height: '50%', width: '14px' }}
                                />
                                {!isLast && (
                                    <div
                                        className="absolute left-6 border-l-2 border-emerald-300/60"
                                        style={{ top: '50%', bottom: 0 }}
                                    />
                                )}
                                <div className="relative">
                                    <div className={`p-2 rounded-lg transition-colors ${crit.bg} ${crit.text} group-hover:ring-2 ${crit.ring}`}>
                                        {child.criticality === 'A' ? <AlertCircle size={16} /> :
                                            child.criticality === 'B' ? <Zap size={16} /> :
                                                <Box size={16} />}
                                    </div>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        <span className={`text-[9px] font-bold px-1 py-0.5 rounded border ${getLevel(currentDepth + 1).color}`}>
                                            {getLevel(currentDepth + 1).tag}
                                        </span>
                                        <span className="font-bold text-sm text-slate-900 truncate">{child.tag}</span>
                                        <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${crit.bg} ${crit.text}`}>
                                            {child.criticality || 'C'}
                                        </span>
                                        {statusIcon(child.status)}
                                    </div>
                                    <div className="text-xs text-slate-500 truncate mt-0.5">{child.name}</div>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                    {/* Health score mini */}
                                    <div className="flex items-center gap-1">
                                        <div className="w-12 h-1 bg-slate-200 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full rounded-full ${child.healthScore >= 80 ? 'bg-emerald-400' : child.healthScore >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                                                style={{ width: `${child.healthScore}%` }}
                                            />
                                        </div>
                                        <span className="text-[10px] text-slate-500 font-medium w-7 text-right">{child.healthScore}%</span>
                                    </div>
                                    {/* Sub-child count */}
                                    {cc > 0 && (
                                        <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full font-medium">{cc} sub</span>
                                    )}
                                    <ChevronRight className="text-slate-300 group-hover:text-emerald-500 transition-colors" size={14} />
                                </div>
                            </div>
                        );
                    })}
                    {children.length === 0 && (
                        <div className="p-8 text-center">
                            <Box size={32} className="mx-auto mb-2 text-slate-300" />
                            <div className="text-sm text-slate-400">No child assets at this level.</div>
                            <div className="text-xs text-slate-300 mt-1">This may be a leaf node ({currentLevel.tag} {currentLevel.label})</div>
                        </div>
                    )}
                </div>
            </div>

            {/* ── Siblings ── */}
            {siblings.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                    <div className="p-4 bg-gradient-to-r from-blue-50 to-white border-b border-slate-200">
                        <h3 className="text-[10px] font-bold text-slate-600 uppercase flex items-center gap-1.5">
                            <Network size={12} className="text-blue-500" />
                            Siblings — Same {getLevel(currentDepth).label} Level
                            <span className="ml-1 bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full text-[10px]">{siblings.length}</span>
                        </h3>
                    </div>
                    <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto">
                        {siblings.map(sib => {
                            const crit = getCrit(sib.criticality);
                            return (
                                <div
                                    key={sib.id}
                                    onClick={() => onSelect(sib)}
                                    className="p-2.5 flex items-center gap-2.5 hover:bg-blue-50 cursor-pointer transition-all group"
                                >
                                    <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${crit.bg} ${crit.text}`}>
                                        {sib.criticality || 'C'}
                                    </span>
                                    {statusIcon(sib.status)}
                                    <span className="font-semibold text-xs text-slate-800 truncate">{sib.tag}</span>
                                    <span className="text-xs text-slate-400 truncate flex-1">— {sib.name}</span>
                                    <ChevronRight size={12} className="text-slate-300 group-hover:text-blue-500 transition-colors shrink-0" />
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

function BOMTab({ asset, onUpdate }: { asset: Asset, onUpdate: (a: Asset) => void }) {
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [inventory, setInventory] = useState<any[]>([]);
    const [uomOptions, setUomOptions] = useState<string[]>([]);
    const [bomItems, setBomItems] = useState<BomItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [inventoryTypes, setInventoryTypes] = useState<any[]>([]);
    const [promoteItem, setPromoteItem] = useState<BomItem | null>(null);
    const [promoteType, setPromoteType] = useState('SPARE');

    // Load BOM from asset_bom table + dictionaries
    const loadBom = async () => {
        setLoading(true);
        try {
            const db = DatabaseService.getInstance();
            const [items, dicts, inv] = await Promise.all([
                db.getBomForAsset(asset.id),
                db.getDictionaries(),
                db.getInventory()
            ]);
            setBomItems(items);
            setInventory(inv);
            setUomOptions(dicts.filter(d => d.type === 'UOM' && d.active !== false).map(d => d.code));
            setInventoryTypes(dicts.filter(d => d.type === 'INVENTORY_TYPE' && d.active !== false));
        } catch (e) {
            console.error('Failed to load BOM', e);
        }
        setLoading(false);
    };

    useEffect(() => { loadBom(); }, [asset.id]);

    // Handle adding a linked material (from AddPartModal)
    const handleAddLinkedPart = async (inventoryItemId: string, quantity: number, isCritical: boolean, uom: string) => {
        try {
            await DatabaseService.getInstance().addBomEntry(asset.id, inventoryItemId, quantity, isCritical, uom);
            await loadBom();
        } catch (e) { console.error('Failed to add BOM entry', e); }
    };

    // Handle adding a text BOM component
    const handleAddTextComponent = async (description: string, quantity: number, uom: string, isCritical: boolean, partNumber?: string) => {
        try {
            await DatabaseService.getInstance().addTextBomEntry(asset.id, description, quantity, uom, isCritical, partNumber);
            await loadBom();
        } catch (e) { console.error('Failed to add text BOM entry', e); }
    };

    // Handle creating a new material and linking to BOM (from OEM docs)
    const handleCreateMaterial = async (data: {
        partNumber: string; description: string; materialType: string;
        uom: string; unitCost: number; quantity: number; isCritical: boolean;
    }) => {
        try {
            await DatabaseService.getInstance().createMaterialAndLinkBom(
                asset.id, data.partNumber, data.description, data.materialType,
                data.uom, data.unitCost, data.quantity, data.isCritical
            );
            await loadBom();
        } catch (e) { console.error('Failed to create material and link BOM', e); }
    };

    // Handle updating a BOM entry inline
    const handleUpdateItem = async (bomId: string, field: string, value: any) => {
        // Optimistic UI update
        setBomItems(prev => prev.map(item =>
            item.id === bomId ? { ...item, [field]: value } : item
        ));
        try {
            await DatabaseService.getInstance().updateBomEntry(bomId, { [field]: value });
        } catch (e) { console.error('Failed to update BOM entry', e); }
    };

    // Handle removing a BOM entry
    const handleRemoveItem = async (bomId: string) => {
        setBomItems(prev => prev.filter(item => item.id !== bomId));
        try {
            await DatabaseService.getInstance().removeBomEntry(bomId);
        } catch (e) {
            console.error('Failed to remove BOM entry', e);
            await loadBom(); // Revert on error
        }
    };

    // Handle promoting a Text BOM item to Material
    const handlePromote = async () => {
        if (!promoteItem) return;
        try {
            await DatabaseService.getInstance().promoteBomToMaterial(
                promoteItem.id, promoteType, promoteItem.description,
                promoteItem.uom, promoteItem.partNumber
            );
            setPromoteItem(null);
            await loadBom();
        } catch (e) { console.error('Failed to promote BOM item', e); }
    };

    // Tier badge renderer
    const renderTierBadge = (item: BomItem) => {
        if (!item.isLinked) {
            return (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">
                    ðŸ““ Text Component
                </span>
            );
        }
        const type = item.materialType || '';
        const isStock = inventoryTypes.find(t => t.code === type);
        const stockable = isStock?.is_stockable !== false;
        if (stockable) {
            return (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 border border-blue-200">
                    ðŸ“¦ {item.materialNumber} Â· {type}
                </span>
            );
        }
        return (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 border border-blue-200">
                âš™ï¸ {item.materialNumber} Â· {type}
            </span>
        );
    };

    return (
        <div className="bg-white border border-slate-200 rounded-lg animate-in fade-in duration-300">
            <AddPartModal
                isOpen={isAddOpen}
                onClose={() => setIsAddOpen(false)}
                onAddLinked={handleAddLinkedPart}
                onCreateMaterial={handleCreateMaterial}
                onAddText={handleAddTextComponent}
                inventoryItems={inventory}
                uomOptions={uomOptions}
                inventoryTypes={inventoryTypes}
            />
            {/* Promote to Material Modal â€” portaled to body to escape overflow clipping */}
            {promoteItem && createPortal(
                <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white w-full max-w-sm rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-4 border-b border-slate-200 bg-gradient-to-r from-amber-50 to-blue-50 flex justify-between items-center">
                            <h3 className="font-bold text-slate-800">â¬† Promote to Material</h3>
                            <button onClick={() => setPromoteItem(null)}><X size={20} className="text-slate-400 hover:text-slate-600" /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="text-sm text-slate-600">
                                This will create a Material Master record for <strong>"{promoteItem.description}"</strong> and assign a <code className="bg-blue-50 px-1 rounded text-blue-700 font-mono text-xs">MAT-NNNNNN</code>.
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Material Type</label>
                                <select
                                    value={promoteType}
                                    onChange={e => setPromoteType(e.target.value)}
                                    className="w-full p-2 border border-slate-300 rounded text-sm"
                                >
                                    {inventoryTypes.map(t => (
                                        <option key={t.code} value={t.code}>{t.code} â€” {t.description}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
                            <button onClick={() => setPromoteItem(null)} className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded text-sm font-medium">Cancel</button>
                            <button onClick={handlePromote} className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm font-bold hover:bg-blue-700">
                                Promote & Assign MAT#
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                <div>
                    <h3 className="font-bold text-slate-700">Bill of Materials (BOM)</h3>
                    <span className="text-[10px] text-slate-400">{bomItems.length} component{bomItems.length !== 1 ? 's' : ''}</span>
                </div>
                <button onClick={() => setIsAddOpen(true)} className="text-xs bg-primary-600 text-white px-3 py-1.5 rounded hover:bg-primary-500">+ Add Part</button>
            </div>
            {loading ? (
                <div className="p-8 text-center text-slate-400">Loading BOM...</div>
            ) : (
                <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-white">
                        <tr>
                            <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Material / Part</th>
                            <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Description</th>
                            <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase w-20">Qty</th>
                            <th className="px-4 py-3 text-center text-xs font-bold text-slate-500 uppercase w-16">Critical</th>
                            <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase w-20">UOM</th>
                            <th className="w-20"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                        {bomItems.map(item => (
                            <tr key={item.id} className="hover:bg-slate-50 group">
                                <td className="px-4 py-2.5">
                                    <div className="flex flex-col gap-1">
                                        {renderTierBadge(item)}
                                        {item.partNumber && (
                                            <span className="text-xs font-mono text-slate-500">{item.partNumber}</span>
                                        )}
                                    </div>
                                </td>
                                <td className="px-4 py-2.5">
                                    <input
                                        className="w-full text-sm border-transparent bg-transparent hover:border-slate-300 focus:border-blue-500 rounded px-2 py-1 transition"
                                        value={item.description}
                                        onChange={(e) => handleUpdateItem(item.id, 'description', e.target.value)}
                                    />
                                </td>
                                <td className="px-4 py-2.5">
                                    <input
                                        type="number"
                                        className="w-16 text-right text-sm border-transparent bg-transparent hover:border-slate-300 focus:border-blue-500 rounded px-2 py-1 font-bold transition"
                                        value={item.quantity}
                                        onChange={(e) => handleUpdateItem(item.id, 'quantity', parseFloat(e.target.value))}
                                    />
                                </td>
                                <td className="px-4 py-2.5 text-center">
                                    <input
                                        type="checkbox"
                                        checked={item.critical}
                                        onChange={(e) => handleUpdateItem(item.id, 'isCritical', e.target.checked)}
                                        className="rounded border-slate-300 text-red-600 focus:ring-red-500"
                                    />
                                </td>
                                <td className="px-4 py-2.5">
                                    <select
                                        className="w-full text-sm border-transparent bg-transparent hover:border-slate-300 focus:border-blue-500 rounded px-2 py-1 transition appearance-none"
                                        value={item.uom || ''}
                                        onChange={(e) => handleUpdateItem(item.id, 'uom', e.target.value)}
                                    >
                                        <option value="">-</option>
                                        {uomOptions.map(u => <option key={u} value={u}>{u}</option>)}
                                        {!uomOptions.includes(item.uom) && item.uom && <option value={item.uom}>{item.uom}</option>}
                                    </select>
                                </td>
                                <td className="px-2 py-2.5 opacity-0 group-hover:opacity-100 transition flex items-center gap-1">
                                    {!item.isLinked && (
                                        <button
                                            onClick={() => { setPromoteItem(item); setPromoteType('SPARE'); }}
                                            className="text-amber-500 hover:text-blue-600 p-1 rounded hover:bg-blue-50"
                                            title="Promote to Material"
                                        >
                                            <ArrowUpRight size={14} />
                                        </button>
                                    )}
                                    <button
                                        onClick={() => handleRemoveItem(item.id)}
                                        className="text-slate-400 hover:text-red-500 p-1"
                                        title="Remove Part"
                                    >
                                        <X size={14} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {bomItems.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-6 py-8 text-center text-slate-400 italic bg-slate-50 border-b border-slate-100">
                                    No components yet. Click "+ Add Part" to start building the BOM.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            )}
        </div>
    );
};



interface AddAssetModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (asset: Asset) => void;
    type: 'Asset' | 'Location';
    existingAssets: Asset[];
    initialParentId?: string;
    assetTypes: any[];
    dictionaries: DictionaryEntry[];
    costCenters: any[];
}

function AddAssetModal({ isOpen, onClose, onSave, type, existingAssets, initialParentId, assetTypes, dictionaries, costCenters }: AddAssetModalProps) {

    const [formData, setFormData] = useState<Partial<Asset>>({
        tag: '',
        name: '',
        assetType: type === 'Asset' ? '' : 'AREA',
        status: AssetStatus.ACTIVE,
        criticality: '' as any,
        location: '',
        parentId: initialParentId,
        healthScore: 100,
        priority: 'MEDIUM',
        costCenter: ''
    });

    const handleCriticalityChange = (crit: string) => {
        setFormData({ ...formData, criticality: crit as Asset['criticality'] });
    };

    const isLocation = type === 'Location';

    const handleSubmit = () => {
        if (!formData.tag || !formData.name || (!isLocation && !formData.criticality)) {
            return; // validation handled by required attribute
        }

        const newAsset: Asset = {
            id: `new-${Date.now()}`,
            tag: formData.tag,
            name: formData.name,
            assetType: formData.assetType,
            category: formData.assetType, // Fallback/Sync
            status: formData.status as AssetStatus,
            criticality: formData.criticality,
            location: formData.location || '',
            healthScore: 100,
            priority: formData.priority || 'MEDIUM',
            parentId: formData.parentId,
            costCenter: formData.costCenter, // Use ID
            // Defaults
            trackingLog: [{ eventType: 'Create', description: 'Asset Created', timestamp: new Date().toISOString().split('T')[0], actor: 'User' }],
            ...formData
        } as Asset;

        onSave(newAsset);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-visible animate-in zoom-in-95 duration-200">
                <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                        <Plus size={18} className="text-blue-600" /> Add New {type}
                    </h3>
                    <button onClick={onClose}><X size={20} className="text-slate-400 hover:text-slate-600" /></button>
                </div>

                <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                    {/* Row 1: Tag + Name */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tag ID <span className="text-red-500">*</span></label>
                            <input
                                type="text"
                                required
                                className="w-full p-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-primary-500 outline-none"
                                placeholder="e.g. P-101-A"
                                value={formData.tag}
                                onChange={(e) => setFormData({ ...formData, tag: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Name <span className="text-red-500">*</span></label>
                            <input
                                type="text"
                                required
                                className="w-full p-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                                placeholder="e.g. Crude Feed Pump"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            />
                        </div>
                    </div>

                    {/* Row 2: Criticality + Parent Asset */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Criticality {!isLocation && <span className="text-red-500">*</span>}</label>
                            <select
                                className={`w-full p-2 border rounded-lg text-sm bg-white ${!formData.criticality ? 'border-slate-300 text-slate-400' : 'border-slate-300 text-slate-800'}`}
                                value={formData.criticality || ''}
                                onChange={(e) => handleCriticalityChange(e.target.value)}
                            >
                                <option value="" disabled>Select Criticality...</option>
                                {dictionaries.filter(d => d.type === 'CRITICALITY' && d.active)
                                    .sort((a, b) => (a.sequence || 99) - (b.sequence || 99))
                                    .map(d => (
                                        <option key={d.id} value={d.code}>{d.code} — {d.description}</option>
                                    ))
                                }
                                {dictionaries.filter(d => d.type === 'CRITICALITY' && d.active).length === 0 && (
                                    <>
                                        <option value="A">A — Safety Critical</option>
                                        <option value="B">B — Production Critical</option>
                                        <option value="C">C — General</option>
                                        <option value="D">D — Low / Run-to-Failure</option>
                                    </>
                                )}
                            </select>

                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Parent Asset</label>
                            <SearchableDropdown
                                options={[
                                    { code: '', description: '(None) — Root Level' },
                                    ...existingAssets.map(a => ({ code: a.id, description: `${a.tag} — ${a.name}` }))
                                ]}
                                value={formData.parentId || ''}
                                onChange={(val) => setFormData({ ...formData, parentId: val || undefined })}
                                placeholder="Search parent asset..."
                            />
                        </div>
                    </div>

                    {/* Helper text */}
                    <p className="text-[11px] text-slate-400 italic">
                        Classification, cost center, and other details can be added from the asset detail panel after creation.
                    </p>
                </div>

                <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg">Cancel</button>
                    <button
                        onClick={handleSubmit}
                        disabled={!formData.tag || !formData.name || (!isLocation && !formData.criticality)}
                        className="px-6 py-2 bg-primary-600 text-white font-bold rounded-lg hover:bg-primary-500 shadow-md flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <CheckCircle size={16} /> Create {type}
                    </button>
                </div>
            </div>
        </div>
    );
};

interface ReadingsTabProps {
    asset: Asset;
    definitions: ReadingDefinition[];
    onAdd: (assetId: string, typeCode: string) => void;
}

function ReadingsTab({ asset, definitions, onAdd }: ReadingsTabProps) {
    const [selectedGraphId, setSelectedGraphId] = useState<string | null>(null);
    const [entryValue, setEntryValue] = useState<Record<string, number>>({});
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [selectedType, setSelectedType] = useState('');

    const availableTypes = MOCK_DICTIONARIES.filter(d =>
        d.type === 'READING_TYPE' &&
        d.active &&
        !definitions.some(def => def.readingTypeCode === d.code)
    );

    const toggleGraph = (id: string) => {
        if (selectedGraphId === id) setSelectedGraphId(null);
        else setSelectedGraphId(id);
    };

    const handleAddSubmit = () => {
        if (selectedType) {
            onAdd(asset.id, selectedType);
            setIsAddOpen(false);
            setSelectedType('');
        }
    };

    // Quick Entry Handler (Mock)
    const handleSaveReading = (def: ReadingDefinition) => {
        const val = entryValue[def.id];
        if (val === undefined || isNaN(val)) return;
        console.log(`Saved value ${val} for ${def.name}. (Simulated)`);
        // In real app, this would dispatch to the Readings context/store
        setEntryValue({ ...entryValue, [def.id]: 0 }); // Reset or clear
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-end relative">
                <button
                    onClick={() => setIsAddOpen(!isAddOpen)}
                    className="text-xs bg-primary-600 text-white px-3 py-1.5 rounded hover:bg-primary-500 flex items-center gap-1"
                >
                    <Plus size={14} /> Add Point
                </button>

                {isAddOpen && (
                    <div className="absolute top-8 right-0 w-64 bg-white rounded-lg shadow-xl border border-slate-200 z-10 p-3 animate-in fade-in slide-in-from-top-2">
                        <h4 className="text-xs font-bold text-slate-800 uppercase mb-2">New Reading Point</h4>
                        <select
                            className="w-full p-2 border border-slate-300 rounded text-sm mb-2"
                            value={selectedType}
                            onChange={(e) => setSelectedType(e.target.value)}
                        >
                            <option value="">-- Select Type --</option>
                            {availableTypes.map(t => (
                                <option key={t.id} value={t.code}>{t.description}</option>
                            ))}
                        </select>
                        <button
                            disabled={!selectedType}
                            onClick={handleAddSubmit}
                            className="w-full py-1.5 bg-primary-600 text-white text-xs font-bold rounded hover:bg-primary-500 disabled:opacity-50"
                        >
                            Add
                        </button>
                        {availableTypes.length === 0 && <p className="text-[10px] text-center text-slate-400 mt-2">No more types available.</p>}
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {definitions.map((def) => {
                    const isMeter = def.category === 'METER';
                    const isAlarm = (def.maxCritical && (def.lastReadingValue || 0) > def.maxCritical);
                    const showGraph = selectedGraphId === def.id;

                    return (
                        <div key={def.id} className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm relative group">
                            <div className="flex justify-between items-start mb-2">
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => toggleGraph(def.id)}
                                        className={`p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-blue-600 transition ${showGraph ? 'text-blue-600 bg-blue-50' : ''}`}
                                        title="Toggle Trend Graph"
                                    >
                                        <LineChartIcon size={16} />
                                    </button>
                                    <span className="text-sm font-bold text-slate-700">{def.name}</span>
                                </div>
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${isAlarm ? 'bg-red-100 text-red-700 border-red-200' : 'bg-green-100 text-green-700 border-green-200'
                                    }`}>
                                    {isAlarm ? 'ALARM' : 'NORMAL'}
                                </span>
                            </div>

                            <div className="flex items-baseline gap-1 mb-2">
                                <span className={`text-2xl font-bold ${isAlarm ? 'text-red-600' : 'text-slate-900'}`}>
                                    {def.lastReadingValue ?? '-'}
                                </span>
                                <span className="text-sm text-slate-500">{def.unit}</span>
                            </div>

                            {/* Inline Graph */}
                            {showGraph && (
                                <div className="h-32 -mx-2 mb-2">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={MOCK_READING_LOGS.filter(l => l.definitionId === def.id)}>
                                            <Line type="monotone" dataKey="value" stroke={isAlarm ? "#ef4444" : "#2563eb"} strokeWidth={2} dot={false} />
                                            <Tooltip />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            )}

                            {/* Limits & Meta */}
                            {!showGraph && (
                                <div className="text-xs text-slate-400 mb-3 space-y-1">
                                    <div className="flex justify-between">
                                        <span>Last Reading:</span>
                                        <span>{def.lastReadingDate || 'Never'}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Limits:</span>
                                        <span>{def.minCritical ?? '-'} / {def.maxCritical ?? '-'}</span>
                                    </div>
                                </div>
                            )}

                            {/* Quick Entry */}
                            <div className="flex gap-2 mt-2 pt-2 border-t border-slate-100">
                                <input
                                    type="number"
                                    placeholder="Enter value"
                                    className="w-full text-xs p-1.5 border border-slate-300 rounded"
                                    value={entryValue[def.id] || ''}
                                    onChange={(e) => setEntryValue({ ...entryValue, [def.id]: parseFloat(e.target.value) })}
                                />
                                <button
                                    onClick={() => handleSaveReading(def)}
                                    className="bg-primary-600 hover:bg-primary-500 text-white px-2 rounded text-xs font-medium"
                                >
                                    Save
                                </button>
                            </div>
                        </div>
                    );
                })}
                {!definitions.length && (
                    <div className="col-span-3 text-center py-12 text-slate-400 border border-dashed border-slate-200 rounded-xl">
                        <Activity size={32} className="mx-auto mb-2 opacity-20" />
                        <p>No reading points defined for this asset.</p>
                        <button onClick={() => setIsAddOpen(true)} className="text-xs text-blue-600 hover:underline mt-2">Add Reading Point</button>
                    </div>
                )}
            </div>
        </div>
    );
};

function JobsTab({ asset }: { asset: Asset }) {
    const navigate = useNavigate();
    const [assetWOs, setAssetWOs] = useState<WorkOrder[]>([]);
    const [linkedPMs, setLinkedPMs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [showHistory, setShowHistory] = useState(false);

    const fetchJobs = useCallback(async () => {
        setLoading(true);
        try {
            const db = DatabaseService.getInstance();
            const [rawWOs, rawPMs, allAssets] = await Promise.all([
                db.getWorkOrdersByAssetId(asset.id),
                db.getPMsByAssetId(asset.id),
                db.getAssets(),
            ]);

            // Map DB records to UI work order type
            const mappedWOs = rawWOs.map((wo: any) => DataMapper.toUIWorkOrder(wo, allAssets));
            setAssetWOs(mappedWOs);

            // Map recurring_work DB records to PM display format
            const mappedPMs = rawPMs.map((pm: any) => ({
                id: pm.id,
                code: pm.code || pm.title,
                description: pm.description || pm.title,
                status: pm.active ? 'ACTIVE' : 'INACTIVE',
                frequencyInterval: pm.interval,
                frequencyUnit: pm.frequency_type?.toLowerCase() || 'days',
                jobType: pm.job_type_code || 'PM',
                estDuration: pm.est_duration || 0,
                nextDueDate: pm.next_due_date ? new Date(pm.next_due_date).toLocaleDateString() : '—',
                rcmStrategy: pm.rcm_strategy,
            }));
            setLinkedPMs(mappedPMs);
        } catch (err) {
            console.error('[JobsTab] Failed to fetch jobs:', err);
            // DB fetch failed — show empty state (no mock fallback)
            setAssetWOs([]);
            setLinkedPMs([]);
        } finally {
            setLoading(false);
        }
    }, [asset.id]);

    useEffect(() => {
        fetchJobs();
    }, [fetchJobs]);

    const STATUS_COLORS: Record<string, string> = {
        OPEN: 'bg-blue-100 text-blue-700',
        WIP: 'bg-amber-100 text-amber-700',
        SCHED: 'bg-blue-100 text-blue-700',
        TECO: 'bg-emerald-100 text-emerald-700',
        CLOSED: 'bg-green-100 text-green-700',
        CANCELLED: 'bg-red-100 text-red-600',
    };

    const PRIORITY_COLORS: Record<string, string> = {
        HIGH: 'bg-red-100 text-red-700',
        EMERGENCY: 'bg-red-200 text-red-800',
        MEDIUM: 'bg-amber-100 text-amber-700',
        LOW: 'bg-slate-100 text-slate-600',
    };

    const RCM_LABELS: Record<string, { label: string; color: string }> = {
        TIME_DIRECTED: { label: 'Time-Directed', color: 'bg-blue-100 text-blue-700' },
        CONDITION_DIRECTED: { label: 'Condition-Based', color: 'bg-teal-100 text-teal-700' },
        FAILURE_FINDING: { label: 'Failure-Finding', color: 'bg-blue-100 text-blue-700' },
        RUN_TO_FAILURE: { label: 'Run-to-Failure', color: 'bg-slate-100 text-slate-600' },
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <span className="ml-3 text-sm text-slate-500">Loading jobs...</span>
            </div>
        );
    }

    const activeWOs = assetWOs.filter(wo => !['CLOSED', 'TECO', 'CANCELLED'].includes(wo.status));
    const completedWOs = assetWOs.filter(wo => ['CLOSED', 'TECO', 'CANCELLED'].includes(wo.status));

    return (
        <div className="space-y-6">
            {/* Active Work Orders Section */}
            <div>
                <h3 className="text-sm font-bold text-slate-700 uppercase mb-3 flex items-center gap-2">
                    <Wrench size={14} /> Active Work Orders ({activeWOs.length})
                </h3>
                {activeWOs.map(wo => (
                    <div
                        key={wo.id}
                        onClick={() => navigate(`/work-orders/${wo.id}`)}
                        className="bg-white p-4 rounded border border-slate-200 hover:shadow-md hover:border-blue-200 flex justify-between items-center mb-2 cursor-pointer transition-all group"
                    >
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="font-mono text-xs text-blue-600 font-medium group-hover:underline">{wo.woNumber || wo.id}</span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${STATUS_COLORS[wo.status] || 'bg-slate-100 text-slate-600'
                                    }`}>{wo.status}</span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${PRIORITY_COLORS[wo.priority] || 'bg-slate-100 text-slate-600'
                                    }`}>{wo.priority}</span>
                                {wo.type && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-slate-100 text-slate-600">{wo.type}</span>
                                )}
                            </div>
                            <h4 className="font-medium text-slate-900 text-sm truncate">{wo.title}</h4>
                            {wo.description && wo.description !== wo.title && (
                                <p className="text-xs text-slate-500 truncate mt-0.5">{wo.description}</p>
                            )}
                        </div>
                        <div className="text-right ml-4 shrink-0">
                            <div className="text-xs text-slate-500">{wo.dueDate ? `Due: ${new Date(wo.dueDate).toLocaleDateString()}` : ''}</div>
                            {wo.assignedTo && (
                                <div className="text-[10px] text-slate-400 mt-1">Assigned</div>
                            )}
                            <ArrowUpRight size={14} className="text-slate-300 group-hover:text-blue-500 ml-auto mt-1 transition-colors" />
                        </div>
                    </div>
                ))}
                {!activeWOs.length && (
                    <div className="text-center py-8 text-slate-400 text-sm border border-dashed border-slate-200 rounded-lg">
                        <Wrench size={24} className="mx-auto mb-2 opacity-20" />
                        No active work orders for this asset.
                    </div>
                )}
            </div>

            {/* Recurring PMs Section */}
            <div>
                <h3 className="text-sm font-bold text-slate-700 uppercase mb-3 flex items-center gap-2">
                    <Repeat size={14} /> Recurring PMs ({linkedPMs.length})
                </h3>
                {linkedPMs.map(pm => {
                    const rcm = pm.rcmStrategy ? RCM_LABELS[pm.rcmStrategy] : null;

                    return (
                        <div key={pm.id} className="bg-white p-4 rounded-lg border border-slate-200 hover:shadow-sm mb-2 transition-shadow">
                            <div className="flex justify-between items-start">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                                        <span className="font-mono text-xs text-slate-500">{pm.code}</span>
                                        <span className={`text-[10px] px-1.5 rounded font-bold uppercase ${pm.status === 'ACTIVE' ? 'bg-green-100 text-green-700' :
                                            pm.status === 'PAUSED' ? 'bg-amber-100 text-amber-700' :
                                                pm.status === 'DRAFT' ? 'bg-slate-100 text-slate-600' :
                                                    'bg-red-100 text-red-700'
                                            }`}>{pm.status}</span>
                                        {rcm && (
                                            <span className={`text-[10px] px-1.5 rounded font-bold ${rcm.color}`}>
                                                {rcm.label}
                                            </span>
                                        )}
                                        <span className={`text-[10px] px-1.5 rounded-full font-bold ${asset.criticality === 'A' ? 'bg-red-100 text-red-700' :
                                            asset.criticality === 'B' ? 'bg-amber-100 text-amber-700' :
                                                'bg-green-100 text-green-700'
                                            }`}>
                                            Crit {asset.criticality}
                                        </span>
                                    </div>
                                    <h4 className="font-medium text-slate-900 text-sm">{pm.description}</h4>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        Every {pm.frequencyInterval} {pm.frequencyUnit} · {pm.jobType}{pm.estDuration ? ` · Est. ${pm.estDuration}h` : ''}
                                    </p>
                                </div>
                                <div className="text-right ml-4 shrink-0">
                                    <div className="text-xs text-slate-500">Next Due</div>
                                    <div className="text-sm font-medium text-slate-800">{pm.nextDueDate || '—'}</div>
                                </div>
                            </div>
                        </div>
                    );
                })}
                {!linkedPMs.length && (
                    <div className="text-center py-8 text-slate-400 text-sm border border-dashed border-slate-200 rounded-lg">
                        <Repeat size={24} className="mx-auto mb-2 opacity-20" />
                        No recurring PMs linked to this asset.
                    </div>
                )}
            </div>

            {/* Completed Work Order History */}
            <div>
                <button
                    onClick={() => setShowHistory(!showHistory)}
                    className="text-sm font-bold text-slate-700 uppercase mb-3 flex items-center gap-2 hover:text-blue-600 transition-colors w-full"
                >
                    <History size={14} />
                    <span>Work Order History ({completedWOs.length})</span>
                    <ChevronRight size={14} className={`ml-auto transition-transform ${showHistory ? 'rotate-90' : ''}`} />
                </button>
                {showHistory && (
                    <>
                        {completedWOs.map(wo => (
                            <div
                                key={wo.id}
                                onClick={() => navigate(`/work-orders/${wo.id}`)}
                                className="bg-slate-50 p-4 rounded border border-slate-200 hover:bg-white hover:shadow-sm flex justify-between items-center mb-2 cursor-pointer transition-all group"
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                                        <span className="font-mono text-xs text-slate-500 font-medium group-hover:text-blue-600 group-hover:underline">{wo.woNumber || wo.id}</span>
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${STATUS_COLORS[wo.status] || 'bg-slate-100 text-slate-600'}`}>{wo.status}</span>
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${PRIORITY_COLORS[wo.priority] || 'bg-slate-100 text-slate-600'}`}>{wo.priority}</span>
                                        {wo.type && <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-slate-100 text-slate-600">{wo.type}</span>}
                                    </div>
                                    <h4 className="font-medium text-slate-700 text-sm truncate">{wo.title}</h4>
                                </div>
                                <div className="text-right ml-4 shrink-0">
                                    <div className="text-xs text-slate-400">{wo.dueDate ? new Date(wo.dueDate).toLocaleDateString() : ''}</div>
                                    <ArrowUpRight size={14} className="text-slate-300 group-hover:text-blue-500 ml-auto mt-1 transition-colors" />
                                </div>
                            </div>
                        ))}
                        {!completedWOs.length && (
                            <div className="text-center py-6 text-slate-400 text-sm border border-dashed border-slate-200 rounded-lg">
                                <History size={24} className="mx-auto mb-2 opacity-20" />
                                No completed work orders in history.
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};



function TrackingTab({ asset }: { asset: Asset }) {
    const [trackingSubTab, setTrackingSubTab] = useState<'audit' | 'install' | 'downtime'>('audit');

    const totalDowntimeHours = (asset.downtimeEvents || []).reduce((sum, d) => sum + (d.durationHours || 0), 0);
    const subTabs = [
        { id: 'audit' as const, label: 'Audit Trail', icon: History },
        { id: 'install' as const, label: 'Install/Dismantle', icon: Repeat },
        { id: 'downtime' as const, label: 'Downtime', icon: Clock },
    ];

    return (
        <div className="space-y-4">
            {/* Sub-tab navigation */}
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1 overflow-x-auto">
                {subTabs.map(st => (
                    <button
                        key={st.id}
                        onClick={() => setTrackingSubTab(st.id)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition whitespace-nowrap
                            ${trackingSubTab === st.id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        <st.icon size={13} />
                        {st.label}
                    </button>
                ))}
            </div>

            {/* ── Audit Trail ── */}
            {trackingSubTab === 'audit' && (
                <div className="flow-root">
                    <ul role="list" className="-mb-8">
                        {asset.trackingLog?.map((event, eventIdx) => (
                            <li key={eventIdx}>
                                <div className="relative pb-8">
                                    {eventIdx !== asset.trackingLog!.length - 1 ? (
                                        <span className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-slate-200" aria-hidden="true" />
                                    ) : null}
                                    <div className="relative flex space-x-3">
                                        <div>
                                            <span className="h-8 w-8 rounded-full bg-blue-500 flex items-center justify-center ring-8 ring-white">
                                                <History className="h-4 w-4 text-white" aria-hidden="true" />
                                            </span>
                                        </div>
                                        <div className="flex min-w-0 flex-1 justify-between space-x-4 pt-1.5">
                                            <div>
                                                <p className="text-sm text-slate-500">
                                                    {event.description} <span className="font-medium text-slate-900">({event.eventType})</span>
                                                </p>
                                            </div>
                                            <div className="whitespace-nowrap text-right text-sm text-slate-500">
                                                <time dateTime={event.timestamp}>{event.timestamp}</time>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </li>
                        ))}
                        {!asset.trackingLog?.length && (
                            <li className="text-center py-4 text-slate-400 italic">No tracking history found.</li>
                        )}
                    </ul>
                </div>
            )}

            {/* ── Install / Dismantle (G6) ── */}
            {trackingSubTab === 'install' && (
                <div className="space-y-3">
                    {/* Current installation status */}
                    <div className="bg-white border border-slate-200 rounded-xl p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-[10px] font-bold text-slate-500 uppercase">Current Installation</div>
                                <div className="text-sm font-semibold text-slate-800 mt-1">
                                    {asset.installedAt ? (
                                        <span className="flex items-center gap-1.5">
                                            <MapPin size={14} className="text-emerald-500" />
                                            {asset.installedAt}
                                            {asset.installedDate && <span className="text-xs text-slate-400 ml-2">since {asset.installedDate}</span>}
                                        </span>
                                    ) : (
                                        <span className="text-slate-400 italic">Not currently installed at a functional location</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Installation history timeline */}
                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                            <h4 className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1.5">
                                <Repeat size={12} className="text-blue-500" /> Movement History
                                <span className="ml-1 bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full text-[10px]">
                                    {(asset.installationHistory || []).length}
                                </span>
                            </h4>
                        </div>
                        <div className="divide-y divide-slate-100">
                            {(asset.installationHistory || []).map((evt, i) => (
                                <div key={evt.id || i} className="p-3 flex items-center gap-3">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                                        evt.action === 'INSTALL' ? 'bg-emerald-500' :
                                        evt.action === 'DISMANTLE' ? 'bg-red-500' : 'bg-blue-500'
                                    }`}>
                                        {evt.action === 'INSTALL' ? '⬆' : evt.action === 'DISMANTLE' ? '⬇' : '⇄'}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium text-slate-800">{evt.action}</div>
                                        <div className="text-xs text-slate-500">
                                            {evt.fromLocationId && <span>From: {evt.fromLocationId}</span>}
                                            {evt.fromLocationId && evt.toLocationId && <span> → </span>}
                                            {evt.toLocationId && <span>To: {evt.toLocationId}</span>}
                                        </div>
                                    </div>
                                    <div className="text-xs text-slate-400 text-right shrink-0">
                                        <div>{evt.date}</div>
                                        <div className="text-[10px]">{evt.performedBy}</div>
                                    </div>
                                </div>
                            ))}
                            {!(asset.installationHistory || []).length && (
                                <div className="p-6 text-center text-sm text-slate-400 italic">
                                    No installation movements recorded.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Downtime Log (G8) ── */}
            {trackingSubTab === 'downtime' && (
                <div className="space-y-3">
                    {/* KPI cards */}
                    <div className="grid grid-cols-3 gap-3">
                        <div className="bg-white border border-slate-200 rounded-xl p-3 text-center">
                            <div className="text-xl font-bold text-slate-800">{(asset.downtimeEvents || []).length}</div>
                            <div className="text-[10px] text-slate-500 uppercase font-semibold">Events</div>
                        </div>
                        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
                            <div className="text-xl font-bold text-red-700">{totalDowntimeHours.toFixed(1)}</div>
                            <div className="text-[10px] text-red-600 uppercase font-semibold">Total Hours</div>
                        </div>
                        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
                            <div className="text-xl font-bold text-emerald-700">
                                {totalDowntimeHours > 0 ? ((1 - totalDowntimeHours / (365 * 24)) * 100).toFixed(1) : '100.0'}%
                            </div>
                            <div className="text-[10px] text-emerald-600 uppercase font-semibold">Availability</div>
                        </div>
                    </div>

                    {/* Downtime events list */}
                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                        <div className="divide-y divide-slate-100">
                            {(asset.downtimeEvents || []).map(evt => (
                                <div key={evt.id} className="p-3 flex items-center gap-3">
                                    <div className={`w-2 h-10 rounded-full ${
                                        evt.category === 'UNPLANNED' ? 'bg-red-500' :
                                        evt.category === 'PLANNED' ? 'bg-amber-500' : 'bg-slate-400'
                                    }`} />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                                                evt.category === 'UNPLANNED' ? 'bg-red-100 text-red-700' :
                                                evt.category === 'PLANNED' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'
                                            }`}>{evt.category}</span>
                                            <span className="text-sm font-medium text-slate-800 truncate">{evt.reason}</span>
                                        </div>
                                        <div className="text-xs text-slate-400 mt-0.5">
                                            {evt.startTime} → {evt.endTime || 'Ongoing'}
                                            {evt.workOrderRef && <span className="ml-2 text-blue-500">WO: {evt.workOrderRef}</span>}
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <div className="text-sm font-bold text-slate-700">{evt.durationHours?.toFixed(1) || '—'}h</div>
                                        <div className="text-[10px] text-slate-400">{evt.loggedBy}</div>
                                    </div>
                                </div>
                            ))}
                            {!(asset.downtimeEvents || []).length && (
                                <div className="p-6 text-center text-sm text-slate-400 italic">
                                    No downtime events recorded. Downtime tracking helps identify reliability issues and calculate asset availability.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

interface SimpleAddModelModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (model: any) => void;
    manufacturerName: string;
    contactId: string;
}

function SimpleAddModelModal({ isOpen, onClose, onSave, manufacturerName, contactId }: SimpleAddModelModalProps) {
    const [modelCode, setModelCode] = useState('');
    const [description, setDescription] = useState('');
    const [loading, setLoading] = useState(false);
    const { showToast } = useToast();

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const db = DatabaseService.getInstance();
            const newModel = { code: modelCode, description: description, active: true };
            await db.addContactModel(contactId, newModel);
            onSave(newModel);
        } catch (err: any) {
            showToast("Error adding model: " + err.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <div>
                        <h3 className="font-bold text-slate-900">Add Model Number</h3>
                        <p className="text-xs text-slate-500">For {manufacturerName}</p>
                    </div>
                    <button onClick={onClose}><X size={18} className="text-slate-400 hover:text-slate-600" /></button>
                </div>
                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Model Code <span className="text-red-500">*</span></label>
                        <input
                            required
                            className="w-full text-sm border-slate-300 rounded-md p-2 focus:ring-primary-500 focus:border-blue-500"
                            value={modelCode}
                            onChange={e => setModelCode(e.target.value)}
                            placeholder="e.g. 3500-XL"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Description</label>
                        <input
                            className="w-full text-sm border-slate-300 rounded-md p-2"
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="e.g. High Pressure Probe"
                        />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded">Cancel</button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="px-3 py-1.5 bg-primary-600 text-white rounded text-xs font-medium hover:bg-primary-500 disabled:opacity-50"
                        >
                            {loading ? 'Saving...' : 'Add Model'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

interface AddPartModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAddLinked: (inventoryItemId: string, quantity: number, isCritical: boolean, uom: string) => void;
    onCreateMaterial: (data: {
        partNumber: string; description: string; materialType: string;
        uom: string; unitCost: number; quantity: number; isCritical: boolean;
    }) => void;
    onAddText: (description: string, quantity: number, uom: string, isCritical: boolean, partNumber?: string) => void;
    inventoryItems: any[];
    uomOptions: string[];
    inventoryTypes: any[];
}

function AddPartModal({ isOpen, onClose, onAddLinked, onCreateMaterial, onAddText, inventoryItems, uomOptions, inventoryTypes }: AddPartModalProps) {
    type TabMode = 'link' | 'create';
    const [mode, setMode] = useState<TabMode>('create');

    // --- Link Existing Material state ---
    const [selectedItemId, setSelectedItemId] = useState('');
    const [linkQty, setLinkQty] = useState(1);
    const [linkCritical, setLinkCritical] = useState(false);
    const [linkUOM, setLinkUOM] = useState('');

    // --- Create New / Text state (unified) ---
    const [textOnly, setTextOnly] = useState(false);
    const [newPartNo, setNewPartNo] = useState('');
    const [newDesc, setNewDesc] = useState('');
    const [newType, setNewType] = useState('SPARE');
    const [newUOM, setNewUOM] = useState('EA');
    const [newQty, setNewQty] = useState(1);
    const [newCritical, setNewCritical] = useState(false);

    // Reset all on open
    useEffect(() => {
        if (isOpen) {
            setMode('create'); setTextOnly(false);
            setSelectedItemId(''); setLinkQty(1); setLinkCritical(false); setLinkUOM('');
            setNewPartNo(''); setNewDesc(''); setNewType('SPARE'); setNewUOM('EA');
            setNewQty(1); setNewCritical(false);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleLinkSubmit = () => {
        if (!selectedItemId || linkQty <= 0) return;
        const part = inventoryItems.find(i => i.id === selectedItemId);
        const uom = linkUOM || part?.uom || 'EA';
        onAddLinked(selectedItemId, linkQty, linkCritical, uom);
        onClose();
    };

    const handleCreateSubmit = () => {
        if (!newDesc || newQty <= 0) return;
        if (textOnly) {
            // Submit as text BOM — no material record
            onAddText(newDesc, newQty, newUOM, newCritical, newPartNo || undefined);
        } else {
            // Submit as full material creation
            if (!newPartNo) return;
            onCreateMaterial({
                partNumber: newPartNo, description: newDesc, materialType: newType,
                uom: newUOM, unitCost: 0, quantity: newQty, isCritical: newCritical
            });
        }
        onClose();
    };

    const options = inventoryItems.map(item => ({
        code: item.id,
        description: `${item.materialNumber ? item.materialNumber + ' \u00b7 ' : ''}${item.code} \u2014 ${item.description}${item.totalQtyOnHand ? ` (${item.totalQtyOnHand} on hand)` : ''}`
    }));

    // Filter inventory types for the Material Type dropdown
    const matTypes = inventoryTypes.length > 0
        ? inventoryTypes.map(t => ({ code: t.code, label: `${t.code} \u2014 ${t.description}` }))
        : [
            { code: 'SPARE', label: 'SPARE \u2014 Spare Part (Stocked)' },
            { code: 'CONSUMABLE', label: 'CONSUMABLE \u2014 Consumable (Stocked)' },
            { code: 'SERVICE', label: 'SERVICE \u2014 Service Item (Non-Stock)' },
            { code: 'NLAG', label: 'NLAG \u2014 Non-Valuated (Non-Stock)' },
        ];

    const tabClass = (t: TabMode) =>
        `flex-1 py-2.5 text-center text-[10px] font-bold uppercase tracking-wide border-b-2 transition cursor-pointer ${
            mode === t
                ? t === 'link' ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                : 'border-emerald-600 text-emerald-600 bg-emerald-50/50'
                : 'border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50'
        }`;

    // Validation for create tab
    const createValid = textOnly
        ? (newDesc && newQty > 0)
        : (newPartNo && newDesc && newQty > 0);

    return createPortal(
        <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-lg rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                    <h3 className="font-bold text-slate-800">Add BOM Component</h3>
                    <button onClick={onClose}><X size={20} className="text-slate-400 hover:text-slate-600" /></button>
                </div>

                {/* Mode Tabs */}
                <div className="flex border-b border-slate-100">
                    <button className={tabClass('create')} onClick={() => setMode('create')}>
                        Create New
                    </button>
                    <button className={tabClass('link')} onClick={() => setMode('link')}>
                        Link Existing Material
                    </button>
                </div>

                <div className="p-5 space-y-3 max-h-[60vh] overflow-y-auto">
                    {/* ========== TAB 1: Link Existing Material ========== */}
                    {mode === 'link' && (
                        <>
                            <div className="text-[11px] text-slate-500 bg-blue-50 border border-blue-100 rounded p-2">
                                Search and link an existing material from your Material Master.
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Select Material</label>
                                <SearchableDropdown
                                    options={options}
                                    value={selectedItemId}
                                    onChange={setSelectedItemId}
                                    placeholder="Search by MAT#, Part#, or Description..."
                                />
                            </div>
                            <div className="flex gap-3">
                                <div className="flex-1">
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Qty Required</label>
                                    <input type="number" min="1" className="w-full p-2 border border-slate-300 rounded text-sm"
                                        value={linkQty} onChange={e => setLinkQty(parseInt(e.target.value) || 0)} />
                                </div>
                                <div className="flex-1">
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">UOM Override</label>
                                    <select className="w-full p-2 border border-slate-300 rounded text-sm" value={linkUOM} onChange={e => setLinkUOM(e.target.value)}>
                                        <option value="">Default</option>
                                        {uomOptions.map(u => <option key={u} value={u}>{u}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <input type="checkbox" checked={linkCritical} onChange={e => setLinkCritical(e.target.checked)}
                                    id="crit-link" className="rounded border-slate-300 text-red-600 focus:ring-red-500" />
                                <label htmlFor="crit-link" className="text-sm text-slate-700">Critical Spare</label>
                            </div>
                        </>
                    )}

                    {/* ========== TAB 2: Create New (Material or Text) ========== */}
                    {mode === 'create' && (
                        <>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                                    {textOnly ? 'Ref / Part Number (optional)' : 'OEM Part Number *'}
                                </label>
                                <input type="text" className="w-full p-2 border border-slate-300 rounded text-sm font-mono"
                                    value={newPartNo} onChange={e => setNewPartNo(e.target.value)}
                                    placeholder={textOnly ? 'e.g. ORG-200V' : 'e.g. 6205-2RS'} />
                                {!textOnly && (
                                    <p className="mt-1 text-[10px] text-emerald-600 italic">A Material Number will be auto-assigned on creation.</p>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                <input type="checkbox" checked={textOnly} onChange={e => setTextOnly(e.target.checked)}
                                    id="text-only-toggle" className="rounded border-slate-300 text-amber-500 focus:ring-amber-400" />
                                <label htmlFor="text-only-toggle" className="text-xs text-slate-500 cursor-pointer">
                                    Skip &mdash; don't create a material record
                                </label>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Description *</label>
                                <input type="text" className="w-full p-2 border border-slate-300 rounded text-sm"
                                    value={newDesc} onChange={e => setNewDesc(e.target.value)}
                                    placeholder={textOnly ? 'e.g. O-Ring, 2" Viton' : 'e.g. Deep Groove Ball Bearing, 25mm ID'} />
                            </div>

                            <div className="flex gap-3">
                                <div className="flex-1">
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">BOM Qty *</label>
                                    <input type="number" min="1" className="w-full p-2 border border-slate-300 rounded text-sm"
                                        value={newQty} onChange={e => setNewQty(parseInt(e.target.value) || 0)} />
                                </div>
                                <div className="flex-1">
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">UOM</label>
                                    <select className="w-full p-2 border border-slate-300 rounded text-sm" value={newUOM} onChange={e => setNewUOM(e.target.value)}>
                                        {uomOptions.length > 0
                                            ? uomOptions.map(u => <option key={u} value={u}>{u}</option>)
                                            : ['EA', 'SET', 'KG', 'LTR', 'MTR', 'BOX', 'PAIR'].map(u => <option key={u} value={u}>{u}</option>)
                                        }
                                    </select>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <input type="checkbox" checked={newCritical} onChange={e => setNewCritical(e.target.checked)}
                                    id="crit-create" className="rounded border-slate-300 text-red-600 focus:ring-red-500" />
                                <label htmlFor="crit-create" className="text-sm text-slate-700">Critical Spare (Stop Work if missing)</label>
                            </div>
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
                    <button onClick={onClose} className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded text-sm font-medium">Cancel</button>
                    {mode === 'link' && (
                        <button onClick={handleLinkSubmit} disabled={!selectedItemId || linkQty <= 0}
                            className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
                            Add to BOM
                        </button>
                    )}
                    {mode === 'create' && (
                        <button onClick={handleCreateSubmit} disabled={!createValid}
                            className={`px-4 py-1.5 text-white rounded text-sm font-bold disabled:opacity-50 ${textOnly ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                            {textOnly ? 'Add as Text' : 'Create & Add to BOM'}
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}


