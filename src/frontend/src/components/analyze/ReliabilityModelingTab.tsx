/**
 * ReliabilityModelingTab — Orchestrator for RBD + P&ID sub-views
 *
 * Manages state (with undo/redo) for blocks/groups/equipment,
 * wires drag-and-drop & keyboard handlers.
 *
 * P1.3: Reports system metrics (Ao, MTBF) via onStateChange callback
 * P2.1: Exposes "Send to RAM" action via onSendToRAM callback
 * P2.3: Links RBD blocks to Asset Register with WO-based MTBF/MTTR auto-populate
 */
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Cpu, Wrench, Download, FileText, RotateCcw, Undo2, Redo2, Upload, Loader2, Activity, Send, Plus, ArrowLeft, Trash2, Copy, Clock, LayoutGrid, Edit3, ChevronRight, Search, Check, X as XIcon, Link2, Users } from 'lucide-react';
import { TeamPanel, AvatarStack } from './CollaboratorPicker';
import type { StudyCollaborator } from '../../eam/services/AnalyzeService';
import type { RBDBlock, RBDGroup } from './ReliabilityBlockDiagram';
import type { PIDEquipment, PIDConnection } from './PIDViewer';
import ReliabilityBlockDiagram from './ReliabilityBlockDiagram';
import PIDViewer from './PIDViewer';
import { useHistory } from '../../hooks/useHistory';
import analyzeService from '../../eam/services/AnalyzeService';
import { DatabaseService } from '../../eam/services/DatabaseService';
import { pdfToImageBlob } from '../../utils/pdfToImage';
import { supabase } from '../../eam/lib/supabase';

// ── Composite state for undo/redo ────────────────────────────
interface RBDState { blocks: RBDBlock[]; groups: RBDGroup[] }
interface PIDState { equipment: PIDEquipment[]; connections: PIDConnection[]; backgroundImage: string | null }

// ── Study type for the master list ──
interface RBDStudy {
    id: string;
    title: string;
    description?: string;
    blocks: RBDBlock[];
    groups: RBDGroup[];
    system_availability: number | null;
    collaborators?: StudyCollaborator[];
    created_at: string;
    updated_at: string;
}

const EMPTY_RBD: RBDState = { blocks: [], groups: [] };

const DEMO_RBD: RBDState = {
    blocks: [
        { id: 'b1', name: 'Pump P-101', failureRate: 0.5, mtbf: 8760, mttr: 24, config: 'series', groupId: 'g1' },
        { id: 'b2', name: 'Compressor K-201', failureRate: 0.8, mtbf: 6000, mttr: 48, config: 'series', groupId: 'g1' },
        { id: 'b3', name: 'Heat Exchanger E-301', failureRate: 0.2, mtbf: 15000, mttr: 12, config: 'parallel', groupId: 'g2' },
        { id: 'b4', name: 'Heat Exchanger E-302', failureRate: 0.2, mtbf: 15000, mttr: 12, config: 'parallel', groupId: 'g2' },
    ],
    groups: [
        { id: 'g1', type: 'series', label: 'Main Train', blocks: ['b1', 'b2'] },
        { id: 'g2', type: 'parallel', label: 'Cooling (Redundant)', blocks: ['b3', 'b4'] },
    ],
};

const DEFAULT_PID: PIDState = {
    equipment: [
        { id: 'eq1', type: 'pump', label: 'P-101', x: 120, y: 250, criticality: 'A', woCount: 8 },
        { id: 'eq2', type: 'compressor', label: 'K-201', x: 300, y: 250, criticality: 'A', woCount: 12 },
        { id: 'eq3', type: 'heat_exchanger', label: 'E-301', x: 480, y: 180, criticality: 'B', woCount: 3 },
        { id: 'eq4', type: 'heat_exchanger', label: 'E-302', x: 480, y: 320, criticality: 'B', woCount: 2 },
        { id: 'eq5', type: 'separator', label: 'V-401', x: 660, y: 250, criticality: 'B', woCount: 1 },
        { id: 'eq6', type: 'transmitter', label: 'PT-101', x: 120, y: 150, criticality: 'C' },
        { id: 'eq7', type: 'valve', label: 'XV-201', x: 210, y: 250, criticality: 'B', woCount: 5 },
    ],
    connections: [
        { id: 'c1', fromId: 'eq1', toId: 'eq7', type: 'process' },
        { id: 'c2', fromId: 'eq7', toId: 'eq2', type: 'process' },
        { id: 'c3', fromId: 'eq2', toId: 'eq3', type: 'process' },
        { id: 'c4', fromId: 'eq2', toId: 'eq4', type: 'process' },
        { id: 'c5', fromId: 'eq3', toId: 'eq5', type: 'process' },
        { id: 'c6', fromId: 'eq4', toId: 'eq5', type: 'process' },
        { id: 'c7', fromId: 'eq6', toId: 'eq1', type: 'instrument' },
    ],
    backgroundImage: null,
};

// ── Component Props ─────────────────────────────────────────
interface ModelingTabProps {
    /** P1.3: Report system metrics for cross-module navigation (Analyze & Investigate) */
    onStateChange?: (inputs: Record<string, any>, results: Record<string, any>, asset?: { id: string; tag: string; name: string } | null) => void;
    /** P2.1: Bridge to RAM Dashboard — parent handles tab switch + data load */
    onSendToRAM?: (systemMtbf: number, systemMttr: number, systemAo: number) => void;
    /** Loaded data from saved analysis */
    loadedData?: { inputs: Record<string, any>; results: Record<string, any> } | null;
}

// ═════════════════════════════════════════════════════════════
export const ReliabilityModelingTab: React.FC<ModelingTabProps> = ({ onStateChange, onSendToRAM, loadedData }) => {
    const [reliabilityTab, setReliabilityTab] = useState<'rbd' | 'pid'>('rbd');
    const importRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [linkToast, setLinkToast] = useState<string | null>(null);

    // ── RBD Study Management (master-detail) ──
    const [studies, setStudies] = useState<RBDStudy[]>([]);
    const [activeStudy, setActiveStudy] = useState<RBDStudy | null>(null);
    const [studiesLoading, setStudiesLoading] = useState(true);
    const [showNewModal, setShowNewModal] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newDesc, setNewDesc] = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    // ── RBD Search / Sort / Rename ──
    const [studySearch, setStudySearch] = useState('');
    const [studySort, setStudySort] = useState<'newest' | 'oldest' | 'name_az' | 'name_za' | 'ao_high' | 'ao_low'>('newest');
    const [renamingStudyId, setRenamingStudyId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');

    // ── P&ID Study Management (mirror RBD pattern) ──
    const [pidStudies, setPidStudies] = useState<{ id: string; title: string; description?: string; equipment: PIDEquipment[]; connections: PIDConnection[]; show_heat_map: boolean; background_image?: string | null; created_at: string; updated_at: string }[]>([]);
    const [activePidStudy, setActivePidStudy] = useState<{ id: string; title: string; description?: string; equipment: PIDEquipment[]; connections: PIDConnection[]; show_heat_map: boolean; background_image?: string | null; created_at: string; updated_at: string } | null>(null);
    const [pidStudiesLoading, setPidStudiesLoading] = useState(true);
    const [showNewPidModal, setShowNewPidModal] = useState(false);
    const [newPidTitle, setNewPidTitle] = useState('');
    const [newPidDesc, setNewPidDesc] = useState('');
    const [deletePidConfirm, setDeletePidConfirm] = useState<string | null>(null);
    const [pidSearch, setPidSearch] = useState('');

    // ── Team Panel State ──
    const [showRbdTeam, setShowRbdTeam] = useState(false);
    const [showPidTeam, setShowPidTeam] = useState(false);

    // Fetch saved studies on mount
    useEffect(() => {
        (async () => {
            setStudiesLoading(true);
            try {
                const models = await analyzeService.getRBDModels();
                setStudies(models.map(m => ({
                    id: m.id, title: m.title,
                    description: (m as any).description || '',
                    blocks: (m.blocks || []) as RBDBlock[],
                    groups: (m.groups || []) as RBDGroup[],
                    system_availability: m.system_availability,
                    created_at: m.created_at, updated_at: m.updated_at,
                })));
            } catch { /* fail soft */ }
            setStudiesLoading(false);
        })();
    }, []);

    // Fetch P&ID studies on mount
    useEffect(() => {
        (async () => {
            setPidStudiesLoading(true);
            try {
                const configs = await analyzeService.getPIDConfigs();
                setPidStudies(configs.map(c => ({
                    id: c.id, title: c.title,
                    description: '',
                    equipment: (c.equipment || []) as PIDEquipment[],
                    connections: (c.connections || []) as PIDConnection[],
                    show_heat_map: c.show_heat_map,
                    background_image: null,
                    created_at: c.created_at, updated_at: c.updated_at,
                })));
            } catch { /* fail soft */ }
            setPidStudiesLoading(false);
        })();
    }, []);

    // Create a new study
    const handleCreateStudy = useCallback(async (title: string, description: string, seed?: RBDState) => {
        const initial = seed || EMPTY_RBD;
        const saved = await analyzeService.saveRBDModel({
            title, asset_id: null,
            blocks: initial.blocks as unknown[], groups: initial.groups as unknown[],
            system_availability: null, created_by: null,
        });
        if (saved) {
            const study: RBDStudy = {
                id: saved.id, title: saved.title, description,
                blocks: initial.blocks, groups: initial.groups,
                system_availability: null,
                created_at: saved.created_at, updated_at: saved.updated_at,
            };
            setStudies(prev => [study, ...prev]);
            setActiveStudy(study);
        }
        setShowNewModal(false); setNewTitle(''); setNewDesc('');
    }, []);

    // Delete a study
    const handleDeleteStudy = useCallback(async (id: string) => {
        await analyzeService.deleteRBDModel(id);
        setStudies(prev => prev.filter(s => s.id !== id));
        if (activeStudy?.id === id) setActiveStudy(null);
        setDeleteConfirm(null);
    }, [activeStudy]);

    // Duplicate a study
    const handleDuplicateStudy = useCallback(async (study: RBDStudy) => {
        await handleCreateStudy(`${study.title} (Copy)`, study.description || '', { blocks: study.blocks, groups: study.groups });
    }, [handleCreateStudy]);

    // Rename a study
    const handleRenameStudy = useCallback(async (studyId: string, newName: string) => {
        if (!newName.trim()) return;
        await analyzeService.updateRBDModel(studyId, { title: newName });
        setStudies(prev => prev.map(s => s.id === studyId ? { ...s, title: newName } : s));
        setRenamingStudyId(null);
    }, []);

    // Open a study for editing
    const handleOpenStudy = useCallback((study: RBDStudy) => {
        setActiveStudy(study);
    }, []);

    // ── P&ID CRUD handlers (mirror RBD pattern) ──
    const handleCreatePidStudy = useCallback(async (title: string, description: string) => {
        const saved = await analyzeService.savePIDConfig({
            title, asset_id: null,
            equipment: DEFAULT_PID.equipment as unknown[], connections: DEFAULT_PID.connections as unknown[],
            show_heat_map: true, created_by: null,
        });
        if (saved) {
            const study = {
                id: saved.id, title: saved.title, description,
                equipment: DEFAULT_PID.equipment, connections: DEFAULT_PID.connections,
                show_heat_map: true, background_image: null as string | null,
                created_at: saved.created_at, updated_at: saved.updated_at,
            };
            setPidStudies(prev => [study, ...prev]);
            setActivePidStudy(study);
        }
        setShowNewPidModal(false); setNewPidTitle(''); setNewPidDesc('');
    }, []);

    const handleDeletePidStudy = useCallback(async (id: string) => {
        await analyzeService.deletePIDConfig(id);
        setPidStudies(prev => prev.filter(s => s.id !== id));
        if (activePidStudy?.id === id) setActivePidStudy(null);
        setDeletePidConfirm(null);
    }, [activePidStudy]);

    const handleDuplicatePidStudy = useCallback(async (study: typeof pidStudies[0]) => {
        const saved = await analyzeService.savePIDConfig({
            title: `${study.title} (Copy)`, asset_id: null,
            equipment: study.equipment as unknown[], connections: study.connections as unknown[],
            show_heat_map: study.show_heat_map, created_by: null,
        });
        if (saved) {
            setPidStudies(prev => [{
                id: saved.id, title: saved.title, description: study.description,
                equipment: study.equipment, connections: study.connections,
                show_heat_map: study.show_heat_map, background_image: study.background_image,
                created_at: saved.created_at, updated_at: saved.updated_at,
            }, ...prev]);
        }
    }, []);

    const handleOpenPidStudy = useCallback((study: typeof pidStudies[0]) => {
        setActivePidStudy(study);
    }, []);

    // ── History-managed state ──
    const rbd = useHistory<RBDState>(activeStudy ? { blocks: activeStudy.blocks, groups: activeStudy.groups } : DEMO_RBD);
    const pid = useHistory<PIDState>(DEFAULT_PID);

    // Reset RBD history when active study changes
    useEffect(() => {
        if (activeStudy) {
            rbd.reset({ blocks: activeStudy.blocks, groups: activeStudy.groups });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeStudy?.id]);

    // Convenience destructures
    const { blocks: rbdBlocks, groups: rbdGroups } = rbd.state;
    const { equipment: pidEquipment, connections: pidConnections, backgroundImage: pidBg } = pid.state;

    // ═══════════════════════════════════════════════════════
    //  Keyboard shortcuts  (Ctrl+Z / Ctrl+Y / Delete)
    // ═══════════════════════════════════════════════════════
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            // Ignore when typing in inputs
            if ((e.target as HTMLElement).tagName === 'INPUT' ||
                (e.target as HTMLElement).tagName === 'TEXTAREA' ||
                (e.target as HTMLElement).tagName === 'SELECT') return;

            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                if (reliabilityTab === 'rbd') rbd.undo();
                else pid.undo();
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
                e.preventDefault();
                if (reliabilityTab === 'rbd') rbd.redo();
                else pid.redo();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [reliabilityTab, rbd, pid]);

    // ═══════════════════════════════════════════════════════
    //  RBD Handlers (all go through history)
    // ═══════════════════════════════════════════════════════

    const rbdAddBlock = useCallback((groupId?: string) => {
        rbd.set(prev => {
            const id = `b${Date.now()}`;
            const num = prev.blocks.length + 1;
            const block: RBDBlock = {
                id, name: `Equipment-${String(num).padStart(3, '0')}`,
                failureRate: 0.5, mtbf: 8760, mttr: 24, config: groupId ? 'series' : 'series', groupId,
            };
            const groups = groupId
                ? prev.groups.map(g => g.id === groupId ? { ...g, blocks: [...g.blocks, id] } : g)
                : prev.groups;
            return { blocks: [...prev.blocks, block], groups };
        });
    }, [rbd]);

    const rbdRemoveBlock = useCallback((blockId: string) => {
        rbd.set(prev => ({
            blocks: prev.blocks.filter(b => b.id !== blockId),
            groups: prev.groups.map(g => ({ ...g, blocks: g.blocks.filter(b => b !== blockId) })),
        }));
    }, [rbd]);

    const rbdUpdateBlock = useCallback((blockId: string, updates: Partial<RBDBlock>) => {
        rbd.set(prev => {
            const updatedBlocks = prev.blocks.map(b => b.id === blockId ? { ...b, ...updates } : b);
            let newGroups = prev.groups;

            // ★ GAP 1/5 FIX: If config changed to parallel/standby, auto-create a group if needed
            if (updates.config && (updates.config === 'parallel' || updates.config === 'standby')) {
                const block = updatedBlocks.find(b => b.id === blockId);
                if (block && !block.groupId) {
                    // Check if there's already a group of that type the block can join
                    const existingGroup = prev.groups.find(g => g.type === updates.config);
                    if (existingGroup) {
                        // Auto-assign to existing matching group
                        const bIdx = updatedBlocks.findIndex(b => b.id === blockId);
                        if (bIdx >= 0) updatedBlocks[bIdx] = { ...updatedBlocks[bIdx], groupId: existingGroup.id };
                        newGroups = newGroups.map(g =>
                            g.id === existingGroup.id && !g.blocks.includes(blockId)
                                ? { ...g, blocks: [...g.blocks, blockId] }
                                : g
                        );
                    } else {
                        // Auto-create a new group of that type
                        const newGroupId = `g${Date.now()}`;
                        const bIdx = updatedBlocks.findIndex(b => b.id === blockId);
                        if (bIdx >= 0) updatedBlocks[bIdx] = { ...updatedBlocks[bIdx], groupId: newGroupId };
                        newGroups = [...newGroups, {
                            id: newGroupId,
                            type: updates.config as RBDGroup['type'],
                            label: `${updates.config === 'parallel' ? 'Parallel' : 'Standby'} — ${block.name}`,
                            blocks: [blockId],
                        }];
                    }
                }
            }

            return { blocks: updatedBlocks, groups: newGroups };
        });
    }, [rbd]);

    const rbdMoveBlock = useCallback((blockId: string, x: number, y: number) => {
        // Drag moves skip history to avoid spamming; commit on mouse-up
        rbd.set(prev => ({
            ...prev,
            blocks: prev.blocks.map(b => b.id === blockId ? { ...b, x, y } : b),
        }));
    }, [rbd]);

    const rbdAddGroup = useCallback((type: RBDGroup['type'], label: string, k?: number) => {
        rbd.set(prev => ({
            ...prev,
            groups: [...prev.groups, { id: `g${Date.now()}`, type, label, blocks: [], k }],
        }));
    }, [rbd]);

    const rbdRemoveGroup = useCallback((groupId: string) => {
        rbd.set(prev => ({
            blocks: prev.blocks.map(b => b.groupId === groupId ? { ...b, groupId: undefined, config: 'series' as const } : b),
            groups: prev.groups.filter(g => g.id !== groupId),
        }));
    }, [rbd]);

    const rbdAssignBlockToGroup = useCallback((blockId: string, groupId: string | undefined) => {
        rbd.set(prev => {
            // ★ GAP 3/8 FIX: Auto-sync config to match group type
            const targetGroup = groupId ? prev.groups.find(g => g.id === groupId) : null;
            const newConfig = targetGroup
                ? (targetGroup.type === 'parallel' || targetGroup.type === 'standby' || targetGroup.type === 'series'
                    ? targetGroup.type as RBDBlock['config']
                    : 'series' as const)
                : 'series' as const;

            return {
                blocks: prev.blocks.map(b => b.id === blockId ? { ...b, groupId, config: newConfig } : b),
                groups: prev.groups.map(g => ({
                    ...g,
                    blocks: g.blocks.filter(b => b !== blockId).concat(g.id === groupId ? [blockId] : []),
                })),
            };
        });
    }, [rbd]);

    // ★ INSERT BLOCK relative to an existing block (series after, or parallel)
    const rbdInsertBlock = useCallback((referenceBlockId: string, placement: 'series' | 'parallel') => {
        rbd.set(prev => {
            const refBlock = prev.blocks.find(b => b.id === referenceBlockId);
            if (!refBlock) return prev;

            const id = `b${Date.now()}`;
            const num = prev.blocks.length + 1;
            const newBlock: RBDBlock = {
                id,
                name: `Equipment-${String(num).padStart(3, '0')}`,
                failureRate: 0.5, mtbf: 8760, mttr: 24,
                config: placement,
                groupId: refBlock.groupId,
                // Position: to the right for series, below for parallel
                x: placement === 'series' ? (refBlock.x ?? 200) + 200 : (refBlock.x ?? 200),
                y: placement === 'parallel' ? (refBlock.y ?? 80) + 120 : (refBlock.y ?? 80),
            };

            let newGroups = prev.groups;

            if (placement === 'parallel') {
                // If reference block is in a parallel group, add to that group
                const existingParallelGroup = prev.groups.find(
                    g => (g.type === 'parallel' || g.type === 'standby') && g.blocks.includes(referenceBlockId)
                );
                if (existingParallelGroup) {
                    newBlock.groupId = existingParallelGroup.id;
                    newGroups = newGroups.map(g =>
                        g.id === existingParallelGroup.id
                            ? { ...g, blocks: [...g.blocks, id] }
                            : g
                    );
                } else {
                    // Create a new parallel group containing both the reference and new block
                    const newGroupId = `g${Date.now()}`;
                    newBlock.groupId = newGroupId;
                    // Remove ref block from any existing group
                    newGroups = newGroups.map(g => ({
                        ...g,
                        blocks: g.blocks.filter(b => b !== referenceBlockId),
                    }));
                    // Update ref block's groupId
                    const updatedBlocks = prev.blocks.map(b =>
                        b.id === referenceBlockId ? { ...b, groupId: newGroupId } : b
                    );
                    newGroups = [...newGroups, {
                        id: newGroupId,
                        type: 'parallel' as const,
                        label: `Parallel (${refBlock.name})`,
                        blocks: [referenceBlockId, id],
                    }];
                    return { blocks: [...updatedBlocks, newBlock], groups: newGroups };
                }
            } else {
                // Series: add to the same group as reference
                if (refBlock.groupId) {
                    newBlock.groupId = refBlock.groupId;
                    newGroups = newGroups.map(g =>
                        g.id === refBlock.groupId
                            ? { ...g, blocks: [...g.blocks, id] }
                            : g
                    );
                }
            }

            return { blocks: [...prev.blocks, newBlock], groups: newGroups };
        });
    }, [rbd]);

    // ★ TOPOLOGY-AWARE REORDER: Move a block to a different group/position
    const rbdReorderBlock = useCallback((blockId: string, targetGroupId: string | null, position: number) => {
        rbd.set(prev => {
            const block = prev.blocks.find(b => b.id === blockId);
            if (!block) return prev;

            // Remove the block from all groups first
            let newGroups = prev.groups.map(g => ({
                ...g,
                blocks: g.blocks.filter(b => b !== blockId),
            }));

            // Update the block's groupId
            const newBlocks = prev.blocks.map(b =>
                b.id === blockId
                    ? { ...b, groupId: targetGroupId ?? undefined, config: targetGroupId ? (prev.groups.find(g => g.id === targetGroupId)?.type === 'parallel' ? 'parallel' as const : 'series' as const) : 'series' as const }
                    : b
            );

            // Add block to target group at the specified position
            if (targetGroupId) {
                newGroups = newGroups.map(g => {
                    if (g.id !== targetGroupId) return g;
                    const blocks = [...g.blocks];
                    const insertAt = position >= 0 ? Math.min(position, blocks.length) : blocks.length;
                    blocks.splice(insertAt, 0, blockId);
                    return { ...g, blocks };
                });
            }

            return { blocks: newBlocks, groups: newGroups };
        });
    }, [rbd]);

    // ★ P2.3: LINK BLOCK TO ASSET REGISTER — auto-populate MTBF/MTTR from WO history
    const rbdLinkAsset = useCallback(async (blockId: string, asset: { id: string; tag: string; name: string } | null) => {
        if (!asset) {
            // Unlink: clear asset fields
            rbd.set(prev => ({
                ...prev,
                blocks: prev.blocks.map(b =>
                    b.id === blockId ? { ...b, assetId: undefined, assetTag: undefined } : b
                ),
            }));
            setLinkToast('Asset unlinked');
            setTimeout(() => setLinkToast(null), 3000);
            return;
        }

        // Link: query WO history for actual MTBF/MTTR
        const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString();
        const { data: wos } = await supabase.from('work_orders')
            .select('id, actual_hours')
            .eq('asset_id', asset.id)
            .in('type', ['Corrective', 'CORRECTIVE', 'CM', 'Breakdown', 'Emergency'])
            .gte('created_at', yearAgo);

        let autoMtbf: number | undefined;
        let autoMttr: number | undefined;
        let woCount = 0;

        if (wos && wos.length > 0) {
            woCount = wos.length;
            autoMtbf = Math.round(8760 / wos.length);
            const repairs = wos.map(w => parseFloat(w.actual_hours) || 0).filter(h => h > 0);
            if (repairs.length > 0) {
                autoMttr = Math.round(repairs.reduce((a, b) => a + b, 0) / repairs.length);
            }
        }

        rbd.set(prev => ({
            ...prev,
            blocks: prev.blocks.map(b =>
                b.id === blockId
                    ? {
                        ...b,
                        assetId: asset.id,
                        assetTag: asset.tag || asset.name,
                        ...(autoMtbf !== undefined ? { mtbf: autoMtbf, failureRate: +(8760 / autoMtbf).toFixed(2) } : {}),
                        ...(autoMttr !== undefined ? { mttr: autoMttr } : {}),
                    }
                    : b
            ),
        }));

        const msg = autoMtbf
            ? `Linked to ${asset.tag || asset.name} — MTBF: ${autoMtbf.toLocaleString()}h, MTTR: ${autoMttr || '—'}h (from ${woCount} WOs)`
            : `Linked to ${asset.tag || asset.name} — No corrective WOs found (using manual values)`;
        setLinkToast(msg);
        setTimeout(() => setLinkToast(null), 5000);
    }, [rbd]);

    // ★ P1.3: Compute system-level metrics from RBD topology
    const systemMetrics = useMemo(() => {
        const { blocks, groups } = rbd.state;
        if (blocks.length === 0) return { ao: 0, mtbf: 0, mttr: 0 };

        // Compute per-block availability
        const blockAo = (b: RBDBlock) => b.mtbf / (b.mtbf + b.mttr);

        // Group availability computation
        const groupAo = (g: RBDGroup): number => {
            const gBlocks = g.blocks.map(bid => blocks.find(b => b.id === bid)).filter(Boolean) as RBDBlock[];
            if (gBlocks.length === 0) return 1;
            if (g.type === 'series') {
                return gBlocks.reduce((acc, b) => acc * blockAo(b), 1);
            } else if (g.type === 'parallel') {
                return 1 - gBlocks.reduce((acc, b) => acc * (1 - blockAo(b)), 1);
            } else if (g.type === 'standby') {
                return 1 - gBlocks.reduce((acc, b) => acc * (1 - blockAo(b)), 1);
            }
            return gBlocks.reduce((acc, b) => acc * blockAo(b), 1);
        };

        // System Ao = product of all group Ao values (groups in series)
        const assignedBlockIds = new Set(groups.flatMap(g => g.blocks));
        const ungroupedBlocks = blocks.filter(b => !assignedBlockIds.has(b.id));

        let sysAo = groups.reduce((acc, g) => acc * groupAo(g), 1);
        sysAo = ungroupedBlocks.reduce((acc, b) => acc * blockAo(b), sysAo);

        // System MTBF/MTTR approximation
        const avgMtbf = blocks.reduce((s, b) => s + b.mtbf, 0) / blocks.length;
        const avgMttr = blocks.reduce((s, b) => s + b.mttr, 0) / blocks.length;

        return { ao: sysAo, mtbf: avgMtbf, mttr: avgMttr };
    }, [rbd.state]);

    // ★ P1.3: Report metrics to parent for "Analyze & Investigate" context
    useEffect(() => {
        onStateChange?.(
            { blockCount: rbd.state.blocks.length, groupCount: rbd.state.groups.length },
            { ao: systemMetrics.ao, mtbf: systemMetrics.mtbf, mttr: systemMetrics.mttr },
        );
    }, [systemMetrics, onStateChange, rbd.state.blocks.length, rbd.state.groups.length]);

    // ═══════════════════════════════════════════════════════
    //  P&ID Handlers (all go through history)
    // ═══════════════════════════════════════════════════════

    const pidAddEquipment = useCallback((type: PIDEquipment['type'], label: string, x: number, y: number) => {
        pid.set(prev => ({
            ...prev,
            equipment: [...prev.equipment, { id: `eq${Date.now()}`, type, label, x, y }],
        }));
    }, [pid]);

    const pidRemoveEquipment = useCallback((eqId: string) => {
        pid.set(prev => ({
            ...prev,
            equipment: prev.equipment.filter(e => e.id !== eqId),
            connections: prev.connections.filter(c => c.fromId !== eqId && c.toId !== eqId),
        }));
    }, [pid]);

    const pidUpdateEquipment = useCallback((eqId: string, updates: Partial<PIDEquipment>) => {
        pid.set(prev => ({
            ...prev,
            equipment: prev.equipment.map(e => e.id === eqId ? { ...e, ...updates } : e),
        }));
    }, [pid]);

    const pidMoveEquipment = useCallback((eqId: string, x: number, y: number) => {
        pid.set(prev => ({
            ...prev,
            equipment: prev.equipment.map(e => e.id === eqId ? { ...e, x, y } : e),
        }));
    }, [pid]);

    const pidAddConnection = useCallback((fromId: string, toId: string, type: PIDConnection['type']) => {
        pid.set(prev => ({
            ...prev,
            connections: [...prev.connections, { id: `c${Date.now()}`, fromId, toId, type }],
        }));
    }, [pid]);

    const pidRemoveConnection = useCallback((connId: string) => {
        pid.set(prev => ({
            ...prev,
            connections: prev.connections.filter(c => c.id !== connId),
        }));
    }, [pid]);

    const pidUploadImage = useCallback(async (file: File) => {
        setUploading(true);
        try {
            const db = DatabaseService.getInstance();
            let uploadFile = file;

            // If PDF, convert page 1 to PNG blob first
            if (file.name.toLowerCase().endsWith('.pdf')) {
                const pngBlob = await pdfToImageBlob(file);
                uploadFile = new File([pngBlob], file.name.replace(/\.pdf$/i, '.png'), { type: 'image/png' });
            }

            const publicUrl = await db.uploadPIDImage(uploadFile);
            pid.set(prev => ({ ...prev, backgroundImage: publicUrl }));
        } catch (err) {
            console.error('P&ID image upload failed:', err);
            // Fallback: read as dataURL so the user isn't blocked
            const reader = new FileReader();
            reader.onload = (e) => {
                pid.set(prev => ({ ...prev, backgroundImage: e.target?.result as string }));
            };
            reader.readAsDataURL(file);
        } finally {
            setUploading(false);
        }
    }, [pid]);

    // ═══════════════════════════════════════════════════════
    //  Import JSON
    // ═══════════════════════════════════════════════════════

    const processImportedFile = useCallback((file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target?.result as string);
                if (data.blocks && Array.isArray(data.blocks)) {
                    rbd.set({
                        blocks: data.blocks as RBDBlock[],
                        groups: (data.groups || []) as RBDGroup[],
                    });
                }
            } catch (err) {
                console.error('Invalid JSON file:', err);
            }
        };
        reader.readAsText(file);
    }, [rbd]);

    const handleImportJSON = useCallback(() => {
        importRef.current?.click();
    }, []);

    // Helper: compute Ao for a study's block/group data
    const studyAo = (s: RBDStudy): number => {
        if (!s.blocks?.length) return 0;
        const bAo = (b: RBDBlock) => b.mtbf / (b.mtbf + b.mttr);
        const gAo = (g: RBDGroup): number => {
            const gB = g.blocks.map(bid => s.blocks.find(b => b.id === bid)).filter(Boolean) as RBDBlock[];
            if (!gB.length) return 1;
            if (g.type === 'series') return gB.reduce((a, b) => a * bAo(b), 1);
            return 1 - gB.reduce((a, b) => a * (1 - bAo(b)), 1);
        };
        const assigned = new Set(s.groups.flatMap(g => g.blocks));
        const ungrouped = s.blocks.filter(b => !assigned.has(b.id));
        let ao = s.groups.reduce((a, g) => a * gAo(g), 1);
        return ungrouped.reduce((a, b) => a * bAo(b), ao);
    };

    // Auto-save to active study on RBD changes (debounced)
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (!activeStudy) return;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(async () => {
            await analyzeService.updateRBDModel(activeStudy.id, {
                blocks: rbd.state.blocks as unknown[],
                groups: rbd.state.groups as unknown[],
                system_availability: systemMetrics.ao,
            });
            setStudies(prev => prev.map(s => s.id === activeStudy.id
                ? { ...s, blocks: rbd.state.blocks, groups: rbd.state.groups, system_availability: systemMetrics.ao, updated_at: new Date().toISOString() }
                : s));
        }, 2000);
        return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rbd.state, activeStudy?.id]);

    // Reset P&ID history when active P&ID study changes
    useEffect(() => {
        if (activePidStudy) {
            pid.reset({ equipment: activePidStudy.equipment, connections: activePidStudy.connections, backgroundImage: activePidStudy.background_image || null });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activePidStudy?.id]);

    // Auto-save P&ID to active study on changes (debounced)
    const pidSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (!activePidStudy) return;
        if (pidSaveTimer.current) clearTimeout(pidSaveTimer.current);
        pidSaveTimer.current = setTimeout(async () => {
            await analyzeService.updatePIDConfig(activePidStudy.id, {
                equipment: pid.state.equipment as unknown[],
                connections: pid.state.connections as unknown[],
            });
            setPidStudies(prev => prev.map(s => s.id === activePidStudy.id
                ? { ...s, equipment: pid.state.equipment, connections: pid.state.connections, updated_at: new Date().toISOString() }
                : s));
        }, 2000);
        return () => { if (pidSaveTimer.current) clearTimeout(pidSaveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pid.state, activePidStudy?.id]);

    // ── Filtered/sorted RBD studies ──
    const filteredStudies = useMemo(() => {
        let result = studies;
        if (studySearch.trim()) {
            const q = studySearch.toLowerCase();
            result = result.filter(s => s.title.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q));
        }
        result = [...result].sort((a, b) => {
            switch (studySort) {
                case 'oldest': return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
                case 'name_az': return a.title.localeCompare(b.title);
                case 'name_za': return b.title.localeCompare(a.title);
                case 'ao_high': return studyAo(b) - studyAo(a);
                case 'ao_low': return studyAo(a) - studyAo(b);
                default: return new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime();
            }
        });
        return result;
    }, [studies, studySearch, studySort]);

    // ── Filtered P&ID studies ──
    const filteredPidStudies = useMemo(() => {
        if (!pidSearch.trim()) return pidStudies;
        const q = pidSearch.toLowerCase();
        return pidStudies.filter(s => s.title.toLowerCase().includes(q));
    }, [pidStudies, pidSearch]);

    return (
        <div className="space-y-4">
            {/* Sub-tab toggle */}
            <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => { setReliabilityTab('rbd'); setActiveStudy(null); }}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${reliabilityTab === 'rbd'
                        ? 'bg-cyan-50 text-cyan-700 border border-cyan-200 shadow-sm'
                        : 'bg-white text-slate-500 border border-slate-200 hover:text-slate-700 hover:bg-slate-50'
                        }`}>
                    <Cpu size={14} /> Reliability Block Diagram
                </button>
                <button onClick={() => { setReliabilityTab('pid'); setActivePidStudy(null); }}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${reliabilityTab === 'pid'
                        ? 'bg-cyan-50 text-cyan-700 border border-cyan-200 shadow-sm'
                        : 'bg-white text-slate-500 border border-slate-200 hover:text-slate-700 hover:bg-slate-50'
                        }`}>
                    <Wrench size={14} /> P&ID Viewer
                </button>
            </div>

            {/* Hidden import input */}
            <input ref={importRef} type="file" accept=".json" className="hidden"
                onChange={e => { if (e.target.files?.[0]) processImportedFile(e.target.files[0]); e.target.value = ''; }} />

            {reliabilityTab === 'rbd' && !activeStudy && (
                <div className="space-y-4">
                    {/* ═══ STUDIES LIST (Landing Page) ═══ */}
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-base font-semibold text-slate-800 flex items-center gap-2"><LayoutGrid size={16} className="text-cyan-600" /> RBD Studies</h3>
                            <p className="text-xs text-slate-500 mt-0.5">Create and manage reliability block diagram studies for different systems and scenarios</p>
                        </div>
                        <button onClick={() => setShowNewModal(true)}
                            className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-cyan-600 to-teal-600 text-white text-sm font-medium rounded-lg shadow-sm hover:shadow-md transition-all">
                            <Plus size={14} /> New Study
                        </button>
                    </div>

                    {/* Search & Sort bar */}
                    {studies.length > 0 && (
                        <div className="flex items-center gap-2">
                            <div className="flex-1 flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2">
                                <Search size={14} className="text-slate-400 shrink-0" />
                                <input value={studySearch} onChange={e => setStudySearch(e.target.value)}
                                    placeholder="Search studies by title or description…"
                                    className="flex-1 text-sm outline-none bg-transparent text-slate-700 placeholder-slate-400" />
                                {studySearch && <button onClick={() => setStudySearch('')} className="text-slate-400 hover:text-slate-600"><XIcon size={14} /></button>}
                            </div>
                            <select value={studySort} onChange={e => setStudySort(e.target.value as typeof studySort)}
                                className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-600 outline-none cursor-pointer">
                                <option value="newest">Newest First</option>
                                <option value="oldest">Oldest First</option>
                                <option value="name_az">Name A→Z</option>
                                <option value="name_za">Name Z→A</option>
                                <option value="ao_high">Highest Ao</option>
                                <option value="ao_low">Lowest Ao</option>
                            </select>
                        </div>
                    )}

                    {studiesLoading ? (
                        <div className="flex items-center justify-center py-16">
                            <Loader2 size={24} className="animate-spin text-cyan-600" />
                            <span className="ml-2 text-sm text-slate-500">Loading studies…</span>
                        </div>
                    ) : studies.length === 0 ? (
                        <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                            <Cpu size={40} className="mx-auto text-slate-300 mb-3" />
                            <p className="text-sm font-medium text-slate-600">No RBD studies yet</p>
                            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">Create your first study to model system reliability with block diagrams, link assets, and calculate availability.</p>
                            <div className="flex items-center justify-center gap-2 mt-4">
                                <button onClick={() => setShowNewModal(true)}
                                    className="flex items-center gap-1.5 px-4 py-2 bg-cyan-600 text-white text-xs font-medium rounded-lg hover:bg-cyan-700 transition-colors">
                                    <Plus size={12} /> Create New Study
                                </button>
                                <button onClick={() => handleCreateStudy('Demo — Gas Compression Train', 'Sample RBD with series & parallel blocks for demonstration', DEMO_RBD)}
                                    className="flex items-center gap-1.5 px-4 py-2 bg-white text-slate-600 text-xs font-medium rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
                                    <RotateCcw size={12} /> Load Demo
                                </button>
                            </div>
                        </div>
                    ) : filteredStudies.length === 0 ? (
                        <div className="text-center py-12 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                            <Search size={24} className="mx-auto text-slate-300 mb-2" />
                            <p className="text-sm text-slate-500">No studies match "{studySearch}"</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {filteredStudies.map(study => {
                                const ao = studyAo(study);
                                const linkedAssets = (study.blocks || []).filter((b: any) => b.assetTag).map((b: any) => b.assetTag as string);
                                const uniqueAssets = [...new Set(linkedAssets)];
                                return (
                                    <div key={study.id} onClick={() => handleOpenStudy(study)}
                                        className="group relative bg-white rounded-xl border border-slate-200 p-4 cursor-pointer hover:border-cyan-300 hover:shadow-md transition-all">
                                        {/* Delete confirm overlay */}
                                        {deleteConfirm === study.id && (
                                            <div className="absolute inset-0 bg-white/95 rounded-xl z-10 flex flex-col items-center justify-center gap-2 p-4" onClick={e => e.stopPropagation()}>
                                                <p className="text-xs font-medium text-red-600 text-center">Delete "{study.title}"?</p>
                                                <div className="flex gap-2">
                                                    <button onClick={() => handleDeleteStudy(study.id)} className="px-3 py-1 bg-red-600 text-white text-xs rounded-md hover:bg-red-700">Delete</button>
                                                    <button onClick={() => setDeleteConfirm(null)} className="px-3 py-1 bg-slate-100 text-slate-600 text-xs rounded-md hover:bg-slate-200">Cancel</button>
                                                </div>
                                            </div>
                                        )}
                                        {/* Card header with inline rename */}
                                        <div className="flex items-start justify-between mb-2">
                                            <div className="flex-1 min-w-0">
                                                {renamingStudyId === study.id ? (
                                                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                                        <input value={renameValue} onChange={e => setRenameValue(e.target.value)} autoFocus
                                                            onKeyDown={e => { if (e.key === 'Enter') handleRenameStudy(study.id, renameValue); if (e.key === 'Escape') setRenamingStudyId(null); }}
                                                            className="text-sm font-semibold text-slate-800 bg-cyan-50 border border-cyan-300 rounded px-1.5 py-0.5 w-full outline-none" />
                                                        <button onClick={() => handleRenameStudy(study.id, renameValue)} className="p-0.5 text-emerald-500 hover:bg-emerald-50 rounded"><Check size={12} /></button>
                                                        <button onClick={() => setRenamingStudyId(null)} className="p-0.5 text-slate-400 hover:bg-slate-100 rounded"><XIcon size={12} /></button>
                                                    </div>
                                                ) : (
                                                    <h4 className="text-sm font-semibold text-slate-800 truncate group-hover:text-cyan-700 transition-colors">{study.title}</h4>
                                                )}
                                                {study.description && <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">{study.description}</p>}
                                            </div>
                                            <ChevronRight size={14} className="text-slate-300 group-hover:text-cyan-500 transition-colors mt-0.5 shrink-0 ml-2" />
                                        </div>
                                        {/* Metrics row */}
                                        <div className="flex items-center gap-3 mb-2 text-[10px]">
                                            <span className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-500 font-mono">{study.blocks?.length || 0} blocks</span>
                                            <span className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-500 font-mono">{study.groups?.length || 0} groups</span>
                                            {study.blocks?.length > 0 && (
                                                <span className={`px-1.5 py-0.5 rounded font-bold font-mono ${ao >= 0.95 ? 'bg-emerald-50 text-emerald-600' : ao >= 0.90 ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'}`}>
                                                    Ao: {(ao * 100).toFixed(1)}%
                                                </span>
                                            )}
                                        </div>
                                        {/* Linked assets */}
                                        {uniqueAssets.length > 0 && (
                                            <div className="flex items-center gap-1 mb-2 flex-wrap">
                                                <Link2 size={9} className="text-slate-400 shrink-0" />
                                                {uniqueAssets.slice(0, 3).map(tag => (
                                                    <span key={tag} className="px-1.5 py-0.5 bg-cyan-50 text-cyan-600 rounded text-[9px] font-mono font-medium">{tag}</span>
                                                ))}
                                                {uniqueAssets.length > 3 && <span className="text-[9px] text-slate-400">+{uniqueAssets.length - 3} more</span>}
                                            </div>
                                        )}
                                        {/* Footer */}
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] text-slate-400 flex items-center gap-1"><Clock size={10} /> {new Date(study.updated_at || study.created_at).toLocaleDateString()}</span>
                                                <AvatarStack collaborators={(study as any).collaborators || []} max={3} />
                                            </div>
                                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                                                <button onClick={() => { setRenamingStudyId(study.id); setRenameValue(study.title); }} title="Rename" className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-blue-600"><Edit3 size={12} /></button>
                                                <button onClick={() => handleDuplicateStudy(study)} title="Duplicate" className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-cyan-600"><Copy size={12} /></button>
                                                <button onClick={() => setDeleteConfirm(study.id)} title="Delete" className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 size={12} /></button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* New Study Modal */}
                    {showNewModal && (
                        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowNewModal(false)}>
                            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
                                <h3 className="text-base font-semibold text-slate-800">New RBD Study</h3>
                                <div>
                                    <label className="text-xs font-medium text-slate-600">Study Title *</label>
                                    <input value={newTitle} onChange={e => setNewTitle(e.target.value)} autoFocus placeholder="e.g. Gas Compression System A"
                                        className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-cyan-400 focus:ring-1 focus:ring-cyan-200 outline-none" />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-slate-600">Description</label>
                                    <textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} rows={2} placeholder="Brief description of the system being modeled…"
                                        className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-cyan-400 focus:ring-1 focus:ring-cyan-200 outline-none resize-none" />
                                </div>
                                <div className="flex justify-end gap-2 pt-2">
                                    <button onClick={() => setShowNewModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg">Cancel</button>
                                    <button onClick={() => handleCreateStudy(newTitle || 'Untitled Study', newDesc)} disabled={!newTitle.trim()}
                                        className="px-4 py-2 bg-cyan-600 text-white text-sm font-medium rounded-lg hover:bg-cyan-700 disabled:opacity-40 transition-colors">
                                        Create Study
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {reliabilityTab === 'rbd' && activeStudy && (
                <div className="space-y-3">
                    {/* Back + Study title header */}
                    <div className="flex items-center gap-3 flex-wrap">
                        <button onClick={() => setActiveStudy(null)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-slate-600 text-xs font-medium rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
                            <ArrowLeft size={12} /> All Studies
                        </button>
                        <div className="flex-1 min-w-0">
                            <h3 className="text-sm font-semibold text-slate-800 truncate">{activeStudy.title}</h3>
                            {activeStudy.description && <p className="text-[10px] text-slate-400 truncate">{activeStudy.description}</p>}
                        </div>
                        <AvatarStack collaborators={(activeStudy as any).collaborators || []} size="md" />
                        <button onClick={() => setShowRbdTeam(true)}
                            className="relative flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-600 hover:to-teal-600 text-white font-semibold rounded-xl text-xs transition-all shadow-lg shadow-cyan-500/25 hover:shadow-xl hover:shadow-cyan-500/30 hover:scale-[1.02]"
                            title="Invite people, teams, or departments to collaborate on this study">
                            {!((activeStudy as any).collaborators?.length) && (
                              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-400"></span>
                              </span>
                            )}
                            <Users size={14} />
                            {(activeStudy as any).collaborators?.length ? `Team (${(activeStudy as any).collaborators.length})` : 'Invite Team'}
                        </button>
                        <span className="text-[10px] text-emerald-500 font-medium flex items-center gap-1"><Activity size={10} /> Auto-saving</span>
                    </div>
                    {/* RBD Team Panel */}
                    {showRbdTeam && (
                        <TeamPanel
                            collaborators={(activeStudy as any).collaborators || []}
                            onAdd={(c) => {
                                const updated = [...((activeStudy as any).collaborators || []), c];
                                setActiveStudy(prev => prev ? { ...prev, collaborators: updated } as any : null);
                                setStudies(prev => prev.map(s => s.id === activeStudy.id ? { ...s, collaborators: updated } as any : s));
                                analyzeService.updateRBDModel(activeStudy.id, { collaborators: updated } as any);
                            }}
                            onRemove={(id) => {
                                const updated = ((activeStudy as any).collaborators || []).filter((c: any) => c.id !== id);
                                setActiveStudy(prev => prev ? { ...prev, collaborators: updated } as any : null);
                                setStudies(prev => prev.map(s => s.id === activeStudy.id ? { ...s, collaborators: updated } as any : s));
                                analyzeService.updateRBDModel(activeStudy.id, { collaborators: updated } as any);
                            }}
                            onUpdateRole={(id, role) => {
                                const updated = ((activeStudy as any).collaborators || []).map((c: any) => c.id === id ? { ...c, role } : c);
                                setActiveStudy(prev => prev ? { ...prev, collaborators: updated } as any : null);
                                setStudies(prev => prev.map(s => s.id === activeStudy.id ? { ...s, collaborators: updated } as any : s));
                                analyzeService.updateRBDModel(activeStudy.id, { collaborators: updated } as any);
                            }}
                            onClose={() => setShowRbdTeam(false)}
                            accentColor="cyan"
                        />
                    )}

                    {/* Toolbar */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => rbd.reset(EMPTY_RBD)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-slate-600 text-xs font-medium rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
                            <FileText size={12} /> Clear
                        </button>
                        <button onClick={() => rbd.reset(DEMO_RBD)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-slate-600 text-xs font-medium rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
                            <RotateCcw size={12} /> Demo Data
                        </button>
                        <div className="w-px h-5 bg-slate-200"></div>
                        <button onClick={rbd.undo} disabled={!rbd.canUndo}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-white text-slate-600 text-xs font-medium rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            title="Undo (Ctrl+Z)">
                            <Undo2 size={13} /> Undo
                        </button>
                        <button onClick={rbd.redo} disabled={!rbd.canRedo}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-white text-slate-600 text-xs font-medium rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            title="Redo (Ctrl+Y)">
                            <Redo2 size={13} /> Redo
                        </button>
                        <div className="w-px h-5 bg-slate-200"></div>
                        <button onClick={handleImportJSON}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-slate-600 text-xs font-medium rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
                            <Upload size={12} /> Import JSON
                        </button>
                    </div>

                    {/* P2.1: System Summary + Send to RAM */}
                    {rbdBlocks.length > 0 && (
                        <div className="flex items-center gap-3 flex-wrap">
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-lg border border-slate-200 text-[11px]">
                                <span className="text-slate-500">System Ao:</span>
                                <span className={`font-bold font-mono ${systemMetrics.ao >= 0.95 ? 'text-emerald-600' : systemMetrics.ao >= 0.90 ? 'text-amber-600' : 'text-red-600'}`}>{(systemMetrics.ao * 100).toFixed(2)}%</span>
                                <span className="text-slate-300">|</span>
                                <span className="text-slate-500">MTBF:</span>
                                <span className="font-semibold text-slate-700 font-mono">{Math.round(systemMetrics.mtbf).toLocaleString()}h</span>
                                <span className="text-slate-300">|</span>
                                <span className="text-slate-500">MTTR:</span>
                                <span className="font-semibold text-slate-700 font-mono">{Math.round(systemMetrics.mttr)}h</span>
                            </div>
                            {onSendToRAM && (
                                <button onClick={() => onSendToRAM(systemMetrics.mtbf, systemMetrics.mttr, systemMetrics.ao)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-teal-500 to-cyan-500 text-white text-xs font-medium rounded-lg shadow-sm hover:shadow-md transition-all">
                                    <Send size={12} /> Send to RAM Dashboard
                                </button>
                            )}
                        </div>
                    )}

                    {linkToast && (
                        <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-[11px] text-emerald-700 font-medium">
                            <span>&#10003;</span> {linkToast}
                        </div>
                    )}

                    <ReliabilityBlockDiagram
                        blocks={rbdBlocks}
                        groups={rbdGroups}
                        onAddBlock={rbdAddBlock}
                        onRemoveBlock={rbdRemoveBlock}
                        onUpdateBlock={rbdUpdateBlock}
                        onMoveBlock={rbdMoveBlock}
                        onAddGroup={rbdAddGroup}
                        onRemoveGroup={rbdRemoveGroup}
                        onAssignBlockToGroup={rbdAssignBlockToGroup}
                        onInsertBlock={rbdInsertBlock}
                        onReorderBlock={rbdReorderBlock}
                        onLinkAsset={rbdLinkAsset}
                    />
                </div>
            )}

            {/* ═══ P&ID LANDING (study list) ═══ */}
            {reliabilityTab === 'pid' && !activePidStudy && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-base font-semibold text-slate-800 flex items-center gap-2"><LayoutGrid size={16} className="text-blue-600" /> P&ID Configurations</h3>
                            <p className="text-xs text-slate-500 mt-0.5">Create and manage piping & instrumentation diagrams for process visualization and equipment health overlays</p>
                        </div>
                        <button onClick={() => setShowNewPidModal(true)}
                            className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-600 text-white text-sm font-medium rounded-lg shadow-sm hover:shadow-md transition-all">
                            <Plus size={14} /> New P&ID
                        </button>
                    </div>

                    {/* Search bar */}
                    {pidStudies.length > 0 && (
                        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2">
                            <Search size={14} className="text-slate-400 shrink-0" />
                            <input value={pidSearch} onChange={e => setPidSearch(e.target.value)}
                                placeholder="Search P&ID configurations…"
                                className="flex-1 text-sm outline-none bg-transparent text-slate-700 placeholder-slate-400" />
                            {pidSearch && <button onClick={() => setPidSearch('')} className="text-slate-400 hover:text-slate-600"><XIcon size={14} /></button>}
                        </div>
                    )}

                    {pidStudiesLoading ? (
                        <div className="flex items-center justify-center py-16">
                            <Loader2 size={24} className="animate-spin text-blue-600" />
                            <span className="ml-2 text-sm text-slate-500">Loading P&ID configurations…</span>
                        </div>
                    ) : pidStudies.length === 0 ? (
                        <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                            <Wrench size={40} className="mx-auto text-slate-300 mb-3" />
                            <p className="text-sm font-medium text-slate-600">No P&ID configurations yet</p>
                            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">Create your first P&ID to visualize process equipment, upload background drawings, and overlay live asset health data.</p>
                            <div className="flex items-center justify-center gap-2 mt-4">
                                <button onClick={() => setShowNewPidModal(true)}
                                    className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors">
                                    <Plus size={12} /> Create New P&ID
                                </button>
                                <button onClick={() => handleCreatePidStudy('Demo — Process Unit', 'Sample P&ID with ISA 5.1 symbols')}
                                    className="flex items-center gap-1.5 px-4 py-2 bg-white text-slate-600 text-xs font-medium rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
                                    <RotateCcw size={12} /> Load Demo
                                </button>
                            </div>
                        </div>
                    ) : filteredPidStudies.length === 0 ? (
                        <div className="text-center py-12 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                            <Search size={24} className="mx-auto text-slate-300 mb-2" />
                            <p className="text-sm text-slate-500">No P&ID configurations match "{pidSearch}"</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {filteredPidStudies.map(study => (
                                <div key={study.id} onClick={() => handleOpenPidStudy(study)}
                                    className="group relative bg-white rounded-xl border border-slate-200 p-4 cursor-pointer hover:border-blue-300 hover:shadow-md transition-all">
                                    {/* Delete confirm overlay */}
                                    {deletePidConfirm === study.id && (
                                        <div className="absolute inset-0 bg-white/95 rounded-xl z-10 flex flex-col items-center justify-center gap-2 p-4" onClick={e => e.stopPropagation()}>
                                            <p className="text-xs font-medium text-red-600 text-center">Delete "{study.title}"?</p>
                                            <div className="flex gap-2">
                                                <button onClick={() => handleDeletePidStudy(study.id)} className="px-3 py-1 bg-red-600 text-white text-xs rounded-md hover:bg-red-700">Delete</button>
                                                <button onClick={() => setDeletePidConfirm(null)} className="px-3 py-1 bg-slate-100 text-slate-600 text-xs rounded-md hover:bg-slate-200">Cancel</button>
                                            </div>
                                        </div>
                                    )}
                                    <div className="flex items-start justify-between mb-2">
                                        <div className="flex-1 min-w-0">
                                            <h4 className="text-sm font-semibold text-slate-800 truncate group-hover:text-blue-700 transition-colors">{study.title}</h4>
                                            {study.description && <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">{study.description}</p>}
                                        </div>
                                        <ChevronRight size={14} className="text-slate-300 group-hover:text-blue-500 transition-colors mt-0.5 shrink-0 ml-2" />
                                    </div>
                                    <div className="flex items-center gap-3 mb-3 text-[10px]">
                                        <span className="px-1.5 py-0.5 bg-blue-50 rounded text-blue-500 font-mono">{study.equipment?.length || 0} equipment</span>
                                        <span className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-500 font-mono">{study.connections?.length || 0} connections</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-slate-400 flex items-center gap-1"><Clock size={10} /> {new Date(study.updated_at || study.created_at).toLocaleDateString()}</span>
                                            <AvatarStack collaborators={(study as any).collaborators || []} max={3} />
                                        </div>
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                                            <button onClick={() => handleDuplicatePidStudy(study)} title="Duplicate" className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-blue-600"><Copy size={12} /></button>
                                            <button onClick={() => setDeletePidConfirm(study.id)} title="Delete" className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 size={12} /></button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* New P&ID Modal */}
                    {showNewPidModal && (
                        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowNewPidModal(false)}>
                            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
                                <h3 className="text-base font-semibold text-slate-800">New P&ID Configuration</h3>
                                <div>
                                    <label className="text-xs font-medium text-slate-600">Title *</label>
                                    <input value={newPidTitle} onChange={e => setNewPidTitle(e.target.value)} autoFocus placeholder="e.g. Gas Treatment Unit — Level 2"
                                        className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none" />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-slate-600">Description</label>
                                    <textarea value={newPidDesc} onChange={e => setNewPidDesc(e.target.value)} rows={2} placeholder="Brief description of the process being depicted…"
                                        className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none resize-none" />
                                </div>
                                <div className="flex justify-end gap-2 pt-2">
                                    <button onClick={() => setShowNewPidModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg">Cancel</button>
                                    <button onClick={() => handleCreatePidStudy(newPidTitle || 'Untitled P&ID', newPidDesc)} disabled={!newPidTitle.trim()}
                                        className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors">
                                        Create P&ID
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ═══ P&ID DETAIL VIEW ═══ */}
            {reliabilityTab === 'pid' && activePidStudy && (
                <div className="space-y-3">
                    {/* Back + title header */}
                    <div className="flex items-center gap-3 flex-wrap">
                        <button onClick={() => setActivePidStudy(null)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-slate-600 text-xs font-medium rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
                            <ArrowLeft size={12} /> All P&IDs
                        </button>
                        <div className="flex-1 min-w-0">
                            <h3 className="text-sm font-semibold text-slate-800 truncate">{activePidStudy.title}</h3>
                            {activePidStudy.description && <p className="text-[10px] text-slate-400 truncate">{activePidStudy.description}</p>}
                        </div>
                        <AvatarStack collaborators={(activePidStudy as any).collaborators || []} size="md" />
                        <button onClick={() => setShowPidTeam(true)}
                            className="relative flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-500 hover:from-blue-600 hover:to-blue-600 text-white font-semibold rounded-xl text-xs transition-all shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 hover:scale-[1.02]"
                            title="Invite people, teams, or departments to collaborate on this P&ID">
                            {!((activePidStudy as any).collaborators?.length) && (
                              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-400"></span>
                              </span>
                            )}
                            <Users size={14} />
                            {(activePidStudy as any).collaborators?.length ? `Team (${(activePidStudy as any).collaborators.length})` : 'Invite Team'}
                        </button>
                        <span className="text-[10px] text-emerald-500 font-medium flex items-center gap-1"><Activity size={10} /> Auto-saving</span>
                    </div>
                    {/* P&ID Team Panel */}
                    {showPidTeam && (
                        <TeamPanel
                            collaborators={(activePidStudy as any).collaborators || []}
                            onAdd={(c) => {
                                const updated = [...((activePidStudy as any).collaborators || []), c];
                                setActivePidStudy(prev => prev ? { ...prev, collaborators: updated } as any : null);
                                setPidStudies(prev => prev.map(s => s.id === activePidStudy.id ? { ...s, collaborators: updated } as any : s));
                                analyzeService.updatePIDConfig(activePidStudy.id, { collaborators: updated } as any);
                            }}
                            onRemove={(id) => {
                                const updated = ((activePidStudy as any).collaborators || []).filter((c: any) => c.id !== id);
                                setActivePidStudy(prev => prev ? { ...prev, collaborators: updated } as any : null);
                                setPidStudies(prev => prev.map(s => s.id === activePidStudy.id ? { ...s, collaborators: updated } as any : s));
                                analyzeService.updatePIDConfig(activePidStudy.id, { collaborators: updated } as any);
                            }}
                            onUpdateRole={(id, role) => {
                                const updated = ((activePidStudy as any).collaborators || []).map((c: any) => c.id === id ? { ...c, role } : c);
                                setActivePidStudy(prev => prev ? { ...prev, collaborators: updated } as any : null);
                                setPidStudies(prev => prev.map(s => s.id === activePidStudy.id ? { ...s, collaborators: updated } as any : s));
                                analyzeService.updatePIDConfig(activePidStudy.id, { collaborators: updated } as any);
                            }}
                            onClose={() => setShowPidTeam(false)}
                            accentColor="violet"
                        />
                    )}

                    {/* Toolbar */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={pid.undo} disabled={!pid.canUndo}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-white text-slate-600 text-xs font-medium rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            title="Undo (Ctrl+Z)">
                            <Undo2 size={13} /> Undo
                        </button>
                        <button onClick={pid.redo} disabled={!pid.canRedo}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-white text-slate-600 text-xs font-medium rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            title="Redo (Ctrl+Y)">
                            <Redo2 size={13} /> Redo
                        </button>
                        <div className="w-px h-5 bg-slate-200"></div>
                        <button onClick={handleImportJSON}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-slate-600 text-xs font-medium rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
                            <Upload size={12} /> Import JSON
                        </button>
                    </div>

                    {uploading && (
                        <div className="absolute inset-0 z-50 bg-white/70 flex items-center justify-center rounded-xl">
                            <div className="flex items-center gap-2 px-4 py-2 bg-cyan-50 border border-cyan-200 rounded-lg shadow-lg">
                                <Loader2 size={16} className="animate-spin text-cyan-600" />
                                <span className="text-sm font-medium text-cyan-700">Uploading P&ID image…</span>
                            </div>
                        </div>
                    )}

                    <PIDViewer
                        equipment={pidEquipment}
                        connections={pidConnections}
                        showHeatMap
                        backgroundImage={pidBg}
                        onUploadImage={pidUploadImage}
                        onAddEquipment={pidAddEquipment}
                        onRemoveEquipment={pidRemoveEquipment}
                        onUpdateEquipment={pidUpdateEquipment}
                        onMoveEquipment={pidMoveEquipment}
                        onAddConnection={pidAddConnection}
                        onRemoveConnection={pidRemoveConnection}
                    />
                </div>
            )}
        </div>
    );
};

export default ReliabilityModelingTab;
