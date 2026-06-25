
import React, { useState, useMemo, useEffect } from 'react';
import {
    Search, Filter, Plus, Activity, Zap, Check, AlertTriangle,
    BarChart2, Clock, Calendar, RefreshCcw, Save, Trash2, LineChart as LineChartIcon,
    AlertCircle, CheckCircle, XCircle, X, ChevronLeft
} from 'lucide-react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, AreaChart, Area
} from 'recharts';
import { Asset, ReadingDefinition, ReadingLogEntry, DictionaryRecord } from '../types';

type TabId = 'entry' | 'history' | 'definitions';

import { DatabaseService } from '../services/DatabaseService';
import { NotificationService } from '../services/NotificationService';
import { AskRelanternButton } from '../components/AskRelanternButton';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Button } from '../components/ui';
import { offlineQueue } from '../services/offlineQueue';
import { ConfirmationModal } from '../components/modals/ConfirmationModal';

export const Readings: React.FC = () => {
    const { profile, permissions, dataScope } = useAuth();
    // ═══ RBAC Permission Extraction (ISO 27001 / NIST CSF) ═══
    const canCreate = permissions?.readings?.create === true;
    const canEdit = permissions?.readings?.edit === true;
    const canDelete = permissions?.readings?.delete === true;
    const { showToast } = useToast();
    // Local State simulating Database
    const [assets, setAssets] = useState<Asset[]>([]);
    const [definitions, setDefinitions] = useState<ReadingDefinition[]>([]);
    const [logs, setLogs] = useState<ReadingLogEntry[]>([]);
    const [readingTypes, setReadingTypes] = useState<DictionaryRecord[]>([]);

    // UI State
    const [activeTab, setActiveTab] = useState<TabId>('entry');
    const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
    const [filterText, setFilterText] = useState('');
    // Confirm modal state
    const [meterChangeDefId, setMeterChangeDefId] = useState<string | null>(null);
    const [deleteDefId, setDeleteDefId] = useState<string | null>(null);

    useEffect(() => {
        loadReadings();
    }, [dataScope]); // Re-run when user's data scope changes

    const loadReadings = async () => {
        try {
            const dbInstance = DatabaseService.getInstance();
            const [dbAssets, dbDefs, dbLogs, dbDicts] = await Promise.all([
                dbInstance.getAssets(),
                dbInstance.getReadingDefinitions(),
                dbInstance.getReadingLogs(),
                dbInstance.getDictionaries()
            ]);

            // ═══ Site Scope Filtering (ISO 55000 Data Boundary Enforcement) ═══
            const scopedAssets = DatabaseService.filterAssetsBySiteScope(dbAssets, dataScope?.siteIds);
            const scopedAssetIds = new Set(scopedAssets.map(a => a.id));
            setAssets(scopedAssets);
            // Only show reading definitions for in-scope assets
            setDefinitions(dbDefs.filter(d => scopedAssetIds.has(d.assetId)));

            // Filter dictionaries for Reading Types
            const types = dbDicts.filter(d => d.type === 'READING_TYPE' && d.active);
            setReadingTypes(types);

            if (dbLogs.length > 0) {
                // Map DB keys to UI keys if needed (DatabaseService usually handles this now, let's trust it maps snake -> camel)
                // But wait, getReadingLogs in Service returns: definitionId, readingTypeCode, ... (camelCase)
                // So we can set directly?
                // Let's ensure types match.
                setLogs(dbLogs);
            } else {
                setLogs([]);
            }
        } catch (e) {
            console.error("Failed to load readings data", e);
            showToast('Failed to load readings data. See console.', 'error');
        }
    };

    // --- Derived Data ---

    // Only assets that have definitions show up in the list, unless searching specifically to add
    const filteredAssets = useMemo(() => {
        return assets.filter(a => {
            const hasDefs = definitions.some(d => d.assetId === a.id && d.isActive);
            const matchesSearch = a.name.toLowerCase().includes(filterText.toLowerCase()) ||
                a.tag.toLowerCase().includes(filterText.toLowerCase());
            // Show if it has definitions OR if we are in search mode (to potentially add definitions)
            return (hasDefs || filterText.length > 0) && matchesSearch;
        });
    }, [assets, definitions, filterText]);

    const selectedAsset = assets.find(a => a.id === selectedAssetId);

    // Debug
    console.log("Readings Render: AssetId:", selectedAssetId);
    console.log("Definitions Total:", definitions.length);
    if (selectedAssetId) {
        const filtered = definitions.filter(d => d.assetId === selectedAssetId);
        console.log("Filtered for Asset:", filtered.length);
        console.log("Sample Def AssetId:", definitions[0]?.assetId, "Selected:", selectedAssetId);
        console.log("Match check:", definitions[0]?.assetId === selectedAssetId);
    }

    // --- Core Logic Handlers ---

    // Add New Definition
    const handleAddDefinition = async (assetId: string, typeCode: string) => {
        // ═══ RBAC Layer 2: Submit-level guard (ISO 27001 / NIST CSF) ═══
        if (!canCreate) {
            console.warn('[RBAC-AUDIT] BLOCKED: readings.addDefinition attempt by unauthorized user', profile?.username);
            showToast('Access Denied: You do not have permission to add reading definitions.', 'error');
            return;
        }
        const dictEntry = readingTypes.find(d => d.code === typeCode);
        if (!dictEntry) return;

        const newDefPayload = {
            assetId: assetId,
            readingTypeCode: dictEntry.code,
            name: dictEntry.description,
            unit: 'Unit', // TODO: Add unit to Dictionary extended properties
            category: dictEntry.categoryCode === 'Meter Reading' ? 'METER' : 'CONDITION',
            minCritical: 0,
            maxCritical: 100,
            active: true
        };

        try {
            const savedDef = await DatabaseService.getInstance().addReadingDefinition(newDefPayload);
            setDefinitions([...definitions, savedDef]);
        } catch (e: any) {
            showToast('Failed to add definition: ' + e.message, 'error');
        }
    };

    // 3.2 Reading Entry (Batch or Single)
    const handleSaveReadings = async (newReadings: Partial<ReadingLogEntry>[]) => {
        // ═══ RBAC Layer 2: Submit-level guard (ISO 27001 / NIST CSF) ═══
        if (!canCreate) {
            console.warn('[RBAC-AUDIT] BLOCKED: readings.saveReadings attempt by unauthorized user', profile?.username);
            showToast('Access Denied: You do not have permission to enter readings.', 'error');
            return;
        }
        const timestamp = new Date();
        const dateStr = timestamp.toISOString().split('T')[0];
        const timeStr = timestamp.toTimeString().split(' ')[0].substring(0, 5);

        const updatedLogs = [...logs];
        const updatedDefs = [...definitions];
        let queuedAny = false;

        for (const reading of newReadings) {
            if (reading.value === undefined || !reading.definitionId) continue;

            const def = definitions.find(d => d.id === reading.definitionId);
            if (!def) continue;

            // Rule: "THE EAM only needs one meter reading in a 24hour period"
            if (def.category === 'METER') {
                const duplicate = logs.find(l =>
                    l.definitionId === def.id && l.date === (reading.date || dateStr) && l.isActive
                );
                if (duplicate) {
                    showToast(`A valid meter reading for '${def.name}' already exists for ${reading.date || dateStr}. Deactivate the existing reading first.`, 'warning');
                    continue;
                }
            }

            // Delta Calculation for Meters
            let delta = 0;
            if (def.category === 'METER' && def.lastReadingValue !== undefined) {
                // If value is lower, assume meter rollover or replacement if not explicitly handled?
                // For this strict implementation, we warn.
                if (reading.value < def.lastReadingValue) {
                    showToast(`Meter rollover detected for '${def.name}': New value (${reading.value}) < Previous (${def.lastReadingValue}). Treating as meter replacement.`, 'warning');
                    delta = reading.value; // Treat as new start
                } else {
                    delta = reading.value - def.lastReadingValue;
                }
            }

            // Create Log Entry
            // Map UI -> DB keys
            const dbLog = {
                id: crypto.randomUUID(),
                definition_id: def.id,
                asset_id: def.assetId,
                reading_type_code: def.readingTypeCode,
                reading_date: reading.date || dateStr,
                reading_time: def.category === 'METER' ? '00:00' : (reading.time || timeStr),
                value: reading.value,
                delta: def.category === 'METER' ? delta : undefined,
                entered_by: profile?.username || profile?.fullName || 'Unknown User',
                is_active: true,
                is_alarm: (def.maxCritical && reading.value > def.maxCritical) || (def.minCritical && reading.value < def.minCritical) ? true : false,
                comments: reading.comments
            };

            const newLog: ReadingLogEntry = {
                id: dbLog.id,
                definitionId: dbLog.definition_id,
                assetId: dbLog.asset_id,
                readingTypeCode: dbLog.reading_type_code,
                date: dbLog.reading_date,
                time: dbLog.reading_time,
                value: dbLog.value,
                delta: dbLog.delta,
                enteredBy: dbLog.entered_by,
                isActive: dbLog.is_active,
                isAlarm: dbLog.is_alarm,
                comments: dbLog.comments
            };

            try {
                // Save Reading — route through the offline queue so field readings
                // logged without signal are saved locally and synced on reconnect.
                const { queued } = await offlineQueue.run('logReading', dbLog, `Reading: ${def.name}`);
                if (queued) queuedAny = true;
                updatedLogs.push(newLog); // optimistic — dbLog.id is client-generated, so it's stable online or offline

                // Update Definition Cache if needed (e.g. last reading)
                // For now, we rely on logs reload or local optimistic?
                // Local optimistic for speed:
                const defIndex = updatedDefs.findIndex(d => d.id === def.id);
                if (defIndex >= 0) {
                    updatedDefs[defIndex] = {
                        ...updatedDefs[defIndex],
                        lastReadingValue: reading.value,
                        lastReadingDate: dateStr
                    };
                }

                // PARENT READINGS PROPAGATION
                if (def.category === 'METER' && delta > 0) {
                    // (Omitted parent propagation DB save for brevity in this step, but would follow similar pattern)
                    // Ideally we iterate and save child logs too.
                }

                // Notification hook-in: Reading Alarm
                if (dbLog.is_alarm) {
                    NotificationService.checkRules('readings', 'READING_ALARM', {
                        ...newLog,
                        assetId: def.assetId,
                        definitionName: def.name,
                        readingValue: reading.value,
                        maxCritical: def.maxCritical,
                        minCritical: def.minCritical
                    }, { currentUserId: profile?.id || 'SYSTEM' });
                }
            } catch (e: any) {
                console.error("Failed to save reading", e);
                showToast('Failed to save reading: ' + e.message, 'error');
            }
        }

        setLogs(updatedLogs);
        setDefinitions(updatedDefs);
        showToast(
            queuedAny
                ? 'Saved offline — readings will sync when you reconnect.'
                : 'Readings saved successfully.',
            queuedAny ? 'info' : 'success',
        );
    };

    // Meter Change logic
    const handleMeterChange = (defId: string) => {
        // ═══ RBAC Layer 2: Submit-level guard (ISO 27001 / NIST CSF) ═══
        if (!canEdit) {
            console.warn('[RBAC-AUDIT] BLOCKED: readings.meterChange attempt by unauthorized user', profile?.username);
            showToast('Access Denied: You do not have permission to reset meters.', 'error');
            return;
        }
        setMeterChangeDefId(defId);
    };

    // Toggle Active Logic
    const handleToggleActive = (logId: string, currentStatus: boolean) => {
        // ═══ RBAC Layer 2: Submit-level guard (ISO 27001 / NIST CSF) ═══
        if (!canEdit) {
            console.warn('[RBAC-AUDIT] BLOCKED: readings.toggleActive attempt by unauthorized user', profile?.username);
            showToast('Access Denied: You do not have permission to modify reading status.', 'error');
            return;
        }
        const targetLog = logs.find(l => l.id === logId);
        if (!targetLog) return;

        // Get all logs for this definition, sorted by date ASC
        const defLogs = logs
            .filter(l => l.definitionId === targetLog.definitionId)
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        const targetIndex = defLogs.findIndex(l => l.id === logId);
        if (targetIndex === -1) return;

        let updatedLogs = [...logs];

        if (currentStatus === true) {
            // DEACTIVATING: Deactivate this AND all subsequent readings
            for (let i = targetIndex; i < defLogs.length; i++) {
                const logToUpdate = defLogs[i];
                updatedLogs = updatedLogs.map(l => l.id === logToUpdate.id ? { ...l, isActive: false } : l);
            }
        } else {
            // ACTIVATING: Activate this AND all prior readings back to the last active one
            for (let i = 0; i <= targetIndex; i++) {
                const logToUpdate = defLogs[i];
                updatedLogs = updatedLogs.map(l => l.id === logToUpdate.id ? { ...l, isActive: true } : l);
            }
        }

        setLogs(updatedLogs);
    };

    const handleDeleteDefinition = async (id: string) => {
        // ═══ RBAC Layer 2: Submit-level guard (ISO 27001 / NIST CSF) ═══
        if (!canDelete) {
            console.warn('[RBAC-AUDIT] BLOCKED: readings.deleteDefinition attempt by unauthorized user', profile?.username);
            showToast('Access Denied: You do not have permission to delete reading definitions.', 'error');
            return;
        }
        setDeleteDefId(id);
    };

    return (
        <div className="flex h-[calc(100vh-6rem)] gap-4 sm:gap-6">
            {/* Sidebar List */}
            <div className={`flex flex-col bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden transition-all duration-300 ${selectedAssetId ? 'hidden sm:flex sm:w-1/3' : 'w-full sm:w-1/3'}`}>
                <div className="p-4 border-b border-slate-200 flex justify-between items-center">
                    <h2 className="font-bold text-slate-900">Assets</h2>
                    <button
                        onClick={() => setSelectedAssetId(null)} // Go to Batch Entry
                        className="text-xs bg-primary-600 text-white px-3 py-1.5 rounded hover:bg-primary-500 font-medium"
                    >
                        Entry Sheet
                    </button>
                </div>
                <div className="p-4 bg-slate-50 border-b border-slate-200">
                    <div className="relative">
                        <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                        <input
                            type="text"
                            placeholder="Search asset..."
                            value={filterText}
                            onChange={(e) => setFilterText(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm"
                        />
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {filteredAssets.map(asset => {
                        const assetDefs = definitions.filter(d => d.assetId === asset.id);
                        return (
                            <div
                                key={asset.id}
                                onClick={() => { setSelectedAssetId(asset.id); setActiveTab('entry'); }}
                                className={`mobile-card ${selectedAssetId === asset.id ? 'bg-blue-50 border-l-4 border-l-blue-600' : ''}`}
                            >
                                <div className="flex justify-between items-start mb-1">
                                    <span className="font-bold text-slate-900 text-sm">{asset.tag}</span>
                                    {assetDefs.length > 0 && <span className="text-[10px] bg-slate-200 px-1.5 py-0.5 rounded text-slate-600 font-bold">{assetDefs.length} Points</span>}
                                </div>
                                <p className="text-xs text-slate-500 truncate mb-2">{asset.name}</p>
                                <div className="flex flex-wrap gap-1">
                                    {assetDefs.map(d => (
                                        <span key={d.id} className={`text-[10px] px-1.5 rounded border flex items-center gap-1 ${d.category === 'METER' ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-blue-50 text-blue-700 border-blue-100'}`}>
                                            {d.category === 'METER' ? <Clock size={10} /> : <Activity size={10} />}
                                            {d.name}
                                        </span>
                                    ))}
                                    {assetDefs.length === 0 && <span className="text-[10px] text-slate-400 italic">No readings configured</span>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Main Content */}
            <div className={`flex-1 bg-white rounded-xl shadow-lg border border-slate-200 flex flex-col overflow-hidden ${!selectedAssetId ? 'hidden sm:flex' : ''}`}>
                {selectedAsset ? (
                    <>
                    {/* Mobile back button */}
                    <button
                        onClick={() => setSelectedAssetId(null)}
                        className="sm:hidden flex items-center gap-2 px-4 py-3 border-b border-slate-200 text-sm font-medium text-blue-600 hover:bg-blue-50 transition"
                    >
                        <ChevronLeft size={16} /> Back to Assets
                    </button>
                        <div className="p-6 border-b border-slate-200 bg-white">
                            <div className="flex justify-between items-center mb-4">
                                <div>
                                    <h1 className="text-xl font-bold text-slate-900">{selectedAsset.tag} - {selectedAsset.name}</h1>
                                    <p className="text-sm text-slate-500">{selectedAsset.category} • {selectedAsset.location}</p>
                                </div>
                                <div className="flex gap-2 items-center">
                                    <AskRelanternButton
                                        contextType="readings"
                                        contextSummary={`Readings for ${selectedAsset.tag} (${selectedAsset.name}): ${definitions.filter(d => d.assetId === selectedAsset.id).length} reading points configured. Categories: ${[...new Set(definitions.filter(d => d.assetId === selectedAsset.id).map(d => d.category))].join(', ')}. ${logs.filter(l => l.assetId === selectedAsset.id && l.isAlarm).length} alarms triggered. Ask about trend analysis, predictive maintenance triggers, condition exceedances, or meter reading optimization.`}
                                        compact
                                    />
                                    <button
                                        className={`px-4 py-2 text-sm font-medium rounded-lg transition ${activeTab === 'entry' ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                        onClick={() => setActiveTab('entry')}
                                    >
                                        Entry Sheet
                                    </button>
                                    <button
                                        className={`px-4 py-2 text-sm font-medium rounded-lg transition ${activeTab === 'history' ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                        onClick={() => setActiveTab('history')}
                                    >
                                        History & Analysis
                                    </button>
                                    <button
                                        className={`px-4 py-2 text-sm font-medium rounded-lg transition ${activeTab === 'definitions' ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                        onClick={() => setActiveTab('definitions')}
                                    >
                                        Definitions
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
                            {activeTab === 'entry' && (
                                <SingleAssetEntry
                                    asset={selectedAsset}
                                    definitions={definitions.filter(d => d.assetId === selectedAsset.id)}
                                    onSave={handleSaveReadings}
                                    onAddDefinition={handleAddDefinition}
                                    onDeleteDefinition={handleDeleteDefinition}
                                    readingTypes={readingTypes} // Pass it down
                                />
                            )}
                            {activeTab === 'history' && (
                                <TrendAnalysis
                                    definitions={definitions.filter(d => d.assetId === selectedAsset.id)}
                                    logs={logs}
                                    onToggleActive={handleToggleActive}
                                />
                            )}
                            {activeTab === 'definitions' && (
                                <DefinitionsManager
                                    definitions={definitions.filter(d => d.assetId === selectedAsset.id)}
                                    assetId={selectedAsset.id}
                                    onAdd={handleAddDefinition}
                                    onMeterChange={handleMeterChange}
                                    onDelete={handleDeleteDefinition}
                                    readingTypes={readingTypes}
                                />
                            )}
                        </div>
                    </>
                ) : (
                    <BatchEntryView
                        allAssets={filteredAssets}
                        allDefinitions={definitions}
                        onSave={handleSaveReadings}
                        readingTypes={readingTypes}
                        onAddDefinition={handleAddDefinition} // Allow adding from Batch View too if needed
                        onDeleteDefinition={handleDeleteDefinition}
                    />
                )}
            </div>

            {/* GAP-14/21: Meter Change Confirmation Modal */}
            <ConfirmationModal
                isOpen={!!meterChangeDefId}
                onClose={() => setMeterChangeDefId(null)}
                onConfirm={() => {
                    if (meterChangeDefId) {
                        setLogs(prev => prev.map(l => l.definitionId === meterChangeDefId ? { ...l, isActive: false } : l));
                        setDefinitions(prev => prev.map(d => d.id === meterChangeDefId ? { ...d, lastReadingValue: 0 } : d));
                        showToast('Meter reset. Previous readings archived.', 'success');
                        setMeterChangeDefId(null);
                    }
                }}
                title="Replace/Reset Meter?"
                message="This will deactivate previous reading history for averaging. Are you sure you want to proceed?"
                type="warning"
                confirmText="Reset Meter"
            />

            {/* GAP-14/21: Delete Definition Confirmation Modal */}
            <ConfirmationModal
                isOpen={!!deleteDefId}
                onClose={() => setDeleteDefId(null)}
                onConfirm={async () => {
                    if (deleteDefId) {
                        try {
                            await DatabaseService.getInstance().deleteReadingDefinition(deleteDefId);
                            setDefinitions(prev => prev.filter(d => d.id !== deleteDefId));
                            showToast('Reading point removed. History preserved.', 'success');
                        } catch (e: any) {
                            showToast('Failed to delete definition: ' + e.message, 'error');
                        }
                        setDeleteDefId(null);
                    }
                }}
                title="Delete Reading Point?"
                message="History will be kept but this reading point will be removed from future entry sheets."
                type="danger"
                confirmText="Delete Point"
            />
        </div>
    );
};

// --- Sub-Components ---

const TrendAnalysis: React.FC<{
    definitions: ReadingDefinition[];
    logs: ReadingLogEntry[];
    onToggleActive: (id: string, currentStatus: boolean) => void;
}> = ({ definitions, logs, onToggleActive }) => {
    const [selectedDefId, setSelectedDefId] = useState<string>(definitions[0]?.id || '');
    const selectedDef = definitions.find(d => d.id === selectedDefId);

    // Prepare Graph Data - Sorted Ascending for Line Chart
    const graphData = useMemo(() => {
        if (!selectedDefId) return [];
        return logs
            .filter(l => l.definitionId === selectedDefId) // Show all, visually distinguish inactive
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
            .map(l => ({
                id: l.id,
                date: l.date,
                value: l.value,
                delta: l.delta || 0,
                active: l.isActive,
                comment: l.comments
            }));
    }, [logs, selectedDefId]);

    // Average Calculations
    const averages = useMemo(() => {
        const activeData = graphData.filter(d => d.active);
        if (activeData.length < 2) return { daily: 0, weekly: 0, monthly: 0, yearly: 0, overall: 0 };

        if (selectedDef?.category === 'METER') {
            const first = activeData[0];
            const last = activeData[activeData.length - 1];
            // Calculate Days Span
            const msDiff = new Date(last.date).getTime() - new Date(first.date).getTime();
            const daysDiff = Math.max(1, msDiff / (1000 * 3600 * 24));

            // Usage is delta between last and first VALUE (assuming cumulative meter)
            const totalUsage = last.value - first.value;

            const daily = totalUsage / daysDiff;
            return {
                daily: daily,
                weekly: daily * 7,
                monthly: daily * 30.4,
                yearly: daily * 365,
                overall: totalUsage // Cumulative for meters
            };
        } else {
            // Condition Monitoring - Simple Average
            const sum = activeData.reduce((acc, curr) => acc + curr.value, 0);
            const avg = sum / activeData.length;
            return { daily: avg, weekly: avg, monthly: avg, yearly: avg, overall: avg };
        }
    }, [graphData, selectedDef]);

    if (!selectedDef) return <div className="text-center p-8 text-slate-400">No reading definitions found for this asset.</div>;

    return (
        <div className="space-y-6">
            {/* Toolbar */}
            <div className="flex gap-4 items-center bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div className="flex-1">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Select Reading Type</label>
                    <div className="flex gap-2 flex-wrap">
                        {definitions.map(def => (
                            <button
                                key={def.id}
                                onClick={() => setSelectedDefId(def.id)}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${selectedDefId === def.id ? 'bg-primary-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'}`}
                            >
                                {def.category === 'METER' ? <Clock size={14} className="inline mr-1" /> : <Activity size={14} className="inline mr-1" />}
                                {def.name}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Averages Header */}
            <div className="bg-slate-800 text-white p-4 rounded-xl shadow-md grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="p-2 border-r border-slate-600 last:border-0">
                    <div className="text-[10px] uppercase opacity-70 mb-1">Average (Daily)</div>
                    <div className="text-xl font-bold">{averages.daily.toFixed(2)}</div>
                </div>
                <div className="p-2 border-r border-slate-600 last:border-0">
                    <div className="text-[10px] uppercase opacity-70 mb-1">Average (Weekly)</div>
                    <div className="text-xl font-bold">{averages.weekly.toFixed(2)}</div>
                </div>
                <div className="p-2 border-r border-slate-600 last:border-0">
                    <div className="text-[10px] uppercase opacity-70 mb-1">Average (Monthly)</div>
                    <div className="text-xl font-bold">{averages.monthly.toFixed(2)}</div>
                </div>
                <div className="p-2 border-r border-slate-600 last:border-0">
                    <div className="text-[10px] uppercase opacity-70 mb-1">Average (Yearly)</div>
                    <div className="text-xl font-bold">{averages.yearly.toFixed(2)}</div>
                </div>
                <div className="p-2">
                    <div className="text-[10px] uppercase opacity-70 mb-1">{selectedDef.category === 'METER' ? 'Cumulative (Total)' : 'Overall Avg'}</div>
                    <div className="text-xl font-bold">{averages.overall.toFixed(2)} <span className="text-sm font-normal opacity-70">{selectedDef.unit}</span></div>
                </div>
            </div>

            {/* Graph */}
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm h-80">
                <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
                    <LineChartIcon size={16} className="text-blue-600" /> Trend Analysis
                </h3>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={graphData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                        <defs>
                            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1} />
                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 12 }} />
                        <YAxis stroke="#64748b" tick={{ fontSize: 12 }} domain={['auto', 'auto']} />
                        <Tooltip
                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        />
                        {selectedDef.maxCritical && <ReferenceLine y={selectedDef.maxCritical} stroke="red" strokeDasharray="3 3" label="Crit High" />}
                        {selectedDef.minCritical && <ReferenceLine y={selectedDef.minCritical} stroke="red" strokeDasharray="3 3" label="Crit Low" />}
                        <Area
                            type="monotone"
                            dataKey="value"
                            stroke="#2563eb"
                            strokeWidth={2}
                            fillOpacity={1}
                            fill="url(#colorValue)"
                            connectNulls
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            {/* History Table */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
                <div className="p-4 bg-slate-50 border-b border-slate-200 font-bold text-slate-700 text-sm flex justify-between items-center">
                    <span>Reading History</span>
                    <button className="text-xs bg-white border border-slate-300 px-3 py-1 rounded hover:bg-slate-100 flex items-center gap-1">
                        <RefreshCcw size={12} /> Meter Replaced?
                    </button>
                </div>
                <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-white">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase">Date</th>
                            <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase">Time</th>
                            <th className="px-6 py-3 text-right text-xs font-bold text-slate-500 uppercase">Value ({selectedDef.unit})</th>
                            {selectedDef.category === 'METER' && <th className="px-6 py-3 text-right text-xs font-bold text-slate-500 uppercase">Delta</th>}
                            <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase">Source</th>
                            <th className="px-6 py-3 text-center text-xs font-bold text-slate-500 uppercase">Active</th>
                            <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase">Comment</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                        {graphData.slice().reverse().map((row, idx) => ( // Show newest first
                            <tr key={row.id} className={`hover:bg-slate-50 ${!row.active ? 'opacity-50 bg-slate-50' : ''}`}>
                                <td className="px-6 py-3 text-sm text-slate-900">{row.date}</td>
                                <td className="px-6 py-3 text-sm text-slate-500">-</td>
                                <td className="px-6 py-3 text-sm text-right font-bold text-slate-900">{row.value}</td>
                                {selectedDef.category === 'METER' && <td className="px-6 py-3 text-sm text-right text-blue-600">{row.active ? `+${row.delta}` : '-'}</td>}
                                <td className="px-6 py-3 text-sm text-slate-500">System</td>
                                <td className="px-6 py-3 text-center">
                                    <input
                                        type="checkbox"
                                        checked={row.active}
                                        onChange={(e) => onToggleActive(row.id, row.active)}
                                        className="rounded text-blue-600 focus:ring-primary-500 h-4 w-4 cursor-pointer"
                                        title={row.active ? "Click to Deactivate (will cascade)" : "Click to Activate (will restore chain)"}
                                    />
                                </td>
                                <td className="px-6 py-3 text-sm text-slate-500 italic">{row.comment}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

// --- Entry Components ---

const SingleAssetEntry: React.FC<{
    asset: Asset;
    definitions: ReadingDefinition[];
    readingTypes: DictionaryRecord[];
    onSave: (data: Partial<ReadingLogEntry>[]) => void;
    onAddDefinition: (assetId: string, typeCode: string) => void;
    onDeleteDefinition: (id: string) => void;
}> = ({ asset, definitions, readingTypes, onSave, onAddDefinition, onDeleteDefinition }) => {
    return (
        <BatchEntryView
            allAssets={[asset]}
            allDefinitions={definitions}
            onSave={onSave}
            onAddDefinition={onAddDefinition}
            onDeleteDefinition={onDeleteDefinition}
            titleOverride="Reading Entry Sheet"
            readingTypes={readingTypes}
        />
    );
};

const BatchEntryView: React.FC<{
    allAssets: Asset[];
    allDefinitions: ReadingDefinition[];
    onSave: (data: Partial<ReadingLogEntry>[]) => void;
    onAddDefinition?: (assetId: string, typeCode: string) => void;
    onDeleteDefinition?: (id: string) => void;
    titleOverride?: string;
    readingTypes?: DictionaryRecord[]; // Added prop
}> = ({ allAssets, allDefinitions, onSave, onAddDefinition, onDeleteDefinition, titleOverride, readingTypes = [] }) => {
    const [inputValues, setInputValues] = useState<Record<string, { value: number | string, date: string, time: string, comment: string }>>({});

    // Add New Reading State
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [selectedType, setSelectedType] = useState('');

    const rows = useMemo(() => {
        const result: { asset: Asset, def: ReadingDefinition }[] = [];
        allAssets.forEach(asset => {
            const defs = allDefinitions.filter(d => d.assetId === asset.id && d.isActive);
            defs.forEach(def => {
                result.push({ asset, def });
            });
        });
        return result;
    }, [allAssets, allDefinitions]);

    // Available Types for Add Modal (If single asset)
    const singleAsset = allAssets.length === 1 ? allAssets[0] : null;

    // Filter from PASSED readingTypes prop, not MOCK
    const availableTypes = singleAsset ? readingTypes.filter(d =>
        d.type === 'READING_TYPE' &&
        // d.active && // Managed when passing prop
        !allDefinitions.some(def => def.assetId === singleAsset.id && def.readingTypeCode === d.code)
    ) : [];

    const handleInputChange = (defId: string, field: string, val: any) => {
        setInputValues(prev => ({
            ...prev,
            [defId]: {
                ...prev[defId],
                [field]: val
            }
        }));
    };

    const handleSaveBatch = () => {
        const payload: Partial<ReadingLogEntry>[] = [];
        Object.keys(inputValues).forEach(defId => {
            const entry = inputValues[defId];
            if (entry.value !== undefined && entry.value !== '') {
                payload.push({
                    definitionId: defId,
                    value: Number(entry.value),
                    date: entry.date || new Date().toISOString().split('T')[0],
                    time: entry.time || new Date().toTimeString().split(' ')[0].substring(0, 5),
                    comments: entry.comment
                });
            }
        });
        if (payload.length === 0) return;
        onSave(payload);
        setInputValues({});
    };

    const handleAdd = () => {
        if (selectedType && singleAsset && onAddDefinition) {
            onAddDefinition(singleAsset.id, selectedType);
            setIsAddOpen(false);
            setSelectedType('');
        }
    };

    return (
        <div className="flex flex-col h-full relative">
            <div className="p-6 border-b border-slate-200 bg-white flex justify-between items-center">
                <div>
                    <h1 className="text-xl font-bold text-slate-900">{titleOverride || 'Batch Readings Entry'}</h1>
                    <p className="text-sm text-slate-500">Record data for {rows.length} points.</p>
                </div>
                <div className="flex gap-2">
                    {singleAsset && onAddDefinition && (
                        <Button
                            onClick={() => setIsAddOpen(true)}
                            variant="secondary"
                            leftIcon={<Plus size={16} />}
                        >
                            Add Reading
                        </Button>
                    )}
                    <button
                        onClick={handleSaveBatch}
                        className="bg-primary-600 hover:bg-primary-500 text-white px-6 py-2 rounded-lg font-bold shadow-sm flex items-center gap-2"
                    >
                        <Save size={16} /> Save All
                    </button>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto bg-slate-50/50">
                <table className="min-w-full divide-y divide-slate-200 border-b border-slate-200">
                    <thead className="bg-slate-100 sticky top-0 z-10 shadow-sm">
                        <tr>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-40">Asset</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-28">Type</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-20">Last</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-auto">Date</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Value</th>
                            <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider w-10"></th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-200">
                        {rows.map(({ asset, def }) => {
                            const currentInput = inputValues[def.id] || { value: '', date: '', time: '', comment: '' };
                            return (
                                <tr key={def.id} className="hover:bg-blue-50 transition-colors group">
                                    <td className="px-4 py-3">
                                        <div className="font-bold text-sm text-slate-900">{asset.tag}</div>
                                        <div className="text-xs text-slate-500 truncate max-w-[150px]">{asset.name}</div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-2">
                                            {def.category === 'METER' ? <Clock size={14} className="text-blue-500" /> : <Activity size={14} className="text-blue-500" />}
                                            <span className="text-sm font-medium text-slate-700 truncate max-w-[120px]">{def.name}</span>
                                        </div>
                                        <div className="text-[10px] text-slate-400 mt-0.5">{def.unit}</div>
                                    </td>
                                    <td className="px-4 py-3 bg-slate-50">
                                        <div className="text-sm font-bold text-slate-700">{def.lastReadingValue ?? '-'} <span className="text-xs font-normal text-slate-500">{def.unit}</span></div>
                                        <div className="text-xs text-slate-400">{def.lastReadingDate || 'Never'}</div>
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap">
                                        <div className="flex flex-nowrap gap-2 items-center">
                                            <input
                                                type="date"
                                                className="w-24 p-2 border border-slate-200 rounded text-xs focus:ring-2 focus:ring-primary-500 focus:border-blue-500 outline-none transition-all shadow-sm bg-white"
                                                value={currentInput.date}
                                                onChange={(e) => handleInputChange(def.id, 'date', e.target.value)}
                                            />
                                            {def.category !== 'METER' && (
                                                <input
                                                    type="time"
                                                    className="w-16 p-2 border border-slate-200 rounded text-xs focus:ring-2 focus:ring-primary-500 focus:border-blue-500 outline-none transition-all shadow-sm bg-white"
                                                    value={currentInput.time}
                                                    onChange={(e) => handleInputChange(def.id, 'time', e.target.value)}
                                                />
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap">
                                        <div className="flex gap-2 items-center">
                                            <input
                                                type="number"
                                                placeholder="0.00"
                                                className="w-24 p-2 border border-slate-200 rounded text-sm font-bold text-right focus:ring-2 focus:ring-primary-500 focus:border-blue-500 outline-none transition-all shadow-sm bg-white"
                                                value={currentInput.value}
                                                onChange={(e) => handleInputChange(def.id, 'value', e.target.value)}
                                            />
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        {onDeleteDefinition && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onDeleteDefinition(def.id); }}
                                                className="text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors p-2 rounded-lg"
                                                title="Delete Reading Point"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                        {rows.length === 0 && (
                            <tr><td colSpan={4} className="p-8 text-center text-slate-400">No reading points configured. Click "Add Reading" to start.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Inline Modal for adding readings */}
            {isAddOpen && (
                <div className="absolute top-20 right-4 w-96 bg-white rounded-xl shadow-2xl border border-slate-200 z-50 animate-in fade-in slide-in-from-top-4">
                    <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                        <h4 className="text-sm font-bold text-slate-900">Add New Reading Point</h4>
                        <button onClick={() => setIsAddOpen(false)}><X size={16} className="text-slate-400 hover:text-slate-600" /></button>
                    </div>
                    <div className="p-4">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Reading Type</label>
                        <select
                            className="w-full p-2 border border-slate-300 rounded-lg text-sm mb-4"
                            value={selectedType}
                            onChange={(e) => setSelectedType(e.target.value)}
                        >
                            <option value="">-- Select --</option>
                            {availableTypes.map(t => (
                                <option key={t.id} value={t.code}>{t.description} ({t.categoryCode})</option>
                            ))}
                        </select>
                        <Button
                            disabled={!selectedType}
                            onClick={handleAdd}
                            fullWidth
                        >
                            Add to Entry Sheet
                        </Button>
                        {availableTypes.length === 0 && <p className="text-xs text-blue-600 mt-2 text-center">All dictionary types are already added.</p>}
                    </div>
                </div>
            )}
        </div>
    );
};

const DefinitionsManager: React.FC<{
    definitions: ReadingDefinition[];
    assetId: string;
    readingTypes: DictionaryRecord[];
    onAdd: (assetId: string, typeCode: string) => void;
    onMeterChange: (id: string) => void;
    onDelete: (id: string) => void;
}> = ({ definitions, assetId, readingTypes, onAdd, onMeterChange, onDelete }) => {
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [selectedType, setSelectedType] = useState('');

    const availableTypes = readingTypes.filter(d =>
        d.type === 'READING_TYPE' &&
        // d.active && // Handled upstream
        !definitions.some(def => def.readingTypeCode === d.code)
    );

    const handleAdd = () => {
        if (selectedType) {
            onAdd(assetId, selectedType);
            setIsAddOpen(false);
            setSelectedType('');
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                <button
                    onClick={() => setIsAddOpen(true)}
                    className="text-xs bg-primary-600 text-white px-3 py-1.5 rounded hover:bg-primary-500 flex items-center gap-1"
                >
                    <Plus size={14} /> Add Point
                </button>
            </div>

            {isAddOpen && (
                <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg animate-in fade-in slide-in-from-top-2">
                    <div className="flex justify-between items-center mb-2">
                        <h4 className="text-sm font-bold text-blue-900">Add New Reading Point</h4>
                        <button onClick={() => setIsAddOpen(false)}><X size={16} className="text-blue-400 hover:text-blue-600" /></button>
                    </div>
                    <div className="flex gap-2">
                        <select
                            className="flex-1 p-2 border border-blue-300 rounded text-sm"
                            value={selectedType}
                            onChange={(e) => setSelectedType(e.target.value)}
                        >
                            <option value="">-- Select Reading Type --</option>
                            {availableTypes.map(t => (
                                <option key={t.id} value={t.code}>{t.description} ({t.categoryCode})</option>
                            ))}
                        </select>
                        <button
                            disabled={!selectedType}
                            onClick={handleAdd}
                            className="bg-primary-600 text-white px-4 py-2 rounded text-sm font-bold hover:bg-primary-500 disabled:opacity-50"
                        >
                            Add
                        </button>
                    </div>
                    {availableTypes.length === 0 && <p className="text-xs text-blue-600 mt-2">No more reading types available in dictionary.</p>}
                </div>
            )}

            {definitions.map(def => (
                <div key={def.id} className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex justify-between items-center">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-bold text-slate-900">{def.name}</h4>
                            {def.category === 'METER' ? <Clock size={14} className="text-blue-500" /> : <Activity size={14} className="text-blue-500" />}
                        </div>
                        <div className="text-xs text-slate-500">
                            Unit: {def.unit} | Limits: {def.minCritical || '-'} / {def.maxCritical || '-'}
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="text-right mr-4">
                            <div className="text-xs text-slate-400 uppercase">Current</div>
                            <div className="font-bold text-slate-900">{def.lastReadingValue ?? '-'} {def.unit}</div>
                        </div>
                        {def.category === 'METER' && (
                            <button
                                onClick={() => onMeterChange(def.id)}
                                className="px-3 py-1.5 border border-slate-300 rounded text-xs font-medium hover:bg-slate-50 flex items-center gap-1 text-slate-700"
                                title="Reset meter or replace component"
                            >
                                <RefreshCcw size={12} /> Meter Change
                            </button>
                        )}
                        <button className="text-slate-400 hover:text-blue-600"><Save size={16} /></button>
                        <button onClick={() => onDelete(def.id)} className="text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>
                    </div>
                </div>
            ))}
            {definitions.length === 0 && !isAddOpen && (
                <div className="text-center py-8 text-slate-400 border border-dashed border-slate-200 rounded-lg">
                    No reading points defined for this asset. Add one to start tracking.
                </div>
            )}
        </div>
    );
};
