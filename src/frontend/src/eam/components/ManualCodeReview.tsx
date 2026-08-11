import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowUpRight, RefreshCw, Search, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';

/**
 * Admin review surface for technician-entered manual failure codes.
 *
 * Technicians without a matching catalog entry store free-text codes as
 * "MANUAL:CODE — Description" (WorkOrders SearchableSelect, em-dash) or
 * "MANUAL:CODE - Description" (hyphen) in wo_failure_data.failure_mode_code /
 * failure_cause_code. Each distinct string pollutes reliability math as its
 * own failure mode, so this panel lets an admin promote them into the
 * reference_codes catalog or remap them onto an existing code.
 *
 * NOTE: FunctionalFailureSelector is a second MANUAL: writer, but its value
 * lands in service_requests.functional_failure_id (a UUID FK field, via
 * functionalFailureType) rather than a work_orders/wo_failure_data column, so
 * that source is intentionally NOT scanned here.
 */

type ManualField = 'FAILURE_MODE' | 'FAILURE_CAUSE';
type ManualColumn = 'failure_mode_code' | 'failure_cause_code';

interface ManualGroup {
    key: string;
    field: ManualField;
    column: ManualColumn;
    code: string;
    description: string;
    count: number;
    woIds: string[];
    rawValues: string[];
}

interface CatalogOption {
    code: string;
    description: string;
    category: ManualField;
}

const FIELD_LABELS: Record<ManualField, string> = {
    FAILURE_MODE: 'Failure Mode',
    FAILURE_CAUSE: 'Failure Cause',
};

const COLUMNS: { column: ManualColumn; field: ManualField }[] = [
    { column: 'failure_mode_code', field: 'FAILURE_MODE' },
    { column: 'failure_cause_code', field: 'FAILURE_CAUSE' },
];

/** Strip "MANUAL:" then split on the first em-dash or hyphen into code + description. */
const parseManual = (raw: string): { code: string; description: string } => {
    const body = raw.slice('MANUAL:'.length).trim();
    const m = body.match(/^(.*?)\s*(?:—|-)\s*(.*)$/s);
    if (m && m[1].trim()) return { code: m[1].trim(), description: m[2].trim() };
    return { code: body, description: '' };
};

export const ManualCodeReview: React.FC = () => {
    const { showToast } = useToast();
    const [groups, setGroups] = useState<ManualGroup[]>([]);
    const [catalog, setCatalog] = useState<CatalogOption[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [busyKey, setBusyKey] = useState<string | null>(null);
    const [remapKey, setRemapKey] = useState<string | null>(null);
    const [remapSearch, setRemapSearch] = useState('');

    const load = React.useCallback(async () => {
        setIsLoading(true);
        try {
            const [modeRes, causeRes, refRes] = await Promise.all([
                supabase.from('wo_failure_data')
                    .select('wo_id, failure_mode_code, failure_cause_code')
                    .like('failure_mode_code', 'MANUAL:%'),
                supabase.from('wo_failure_data')
                    .select('wo_id, failure_mode_code, failure_cause_code')
                    .like('failure_cause_code', 'MANUAL:%'),
                supabase.from('reference_codes_effective')
                    .select('code, description, category')
                    .in('category', ['FAILURE_MODE', 'FAILURE_CAUSE'])
                    .eq('active', true),
            ]);
            const err = modeRes.error || causeRes.error || refRes.error;
            if (err) throw err;

            // Merge the two scans (a row can carry a MANUAL mode AND cause).
            const rows = new Map<string, any>();
            [...(modeRes.data || []), ...(causeRes.data || [])].forEach(r => rows.set(r.wo_id, r));

            const grouped = new Map<string, ManualGroup>();
            rows.forEach(row => {
                COLUMNS.forEach(({ column, field }) => {
                    const raw: string | null = row[column];
                    if (!raw || !raw.startsWith('MANUAL:')) return;
                    const { code, description } = parseManual(raw);
                    if (!code) return;
                    const key = `${field}|${code}`;
                    let g = grouped.get(key);
                    if (!g) {
                        g = { key, field, column, code, description, count: 0, woIds: [], rawValues: [] };
                        grouped.set(key, g);
                    }
                    g.count += 1;
                    g.woIds.push(row.wo_id);
                    if (!g.rawValues.includes(raw)) g.rawValues.push(raw);
                    if (!g.description && description) g.description = description;
                });
            });

            setGroups(Array.from(grouped.values()).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)));
            setCatalog((refRes.data || []) as CatalogOption[]);
        } catch (e: any) {
            showToast('Failed to load manual codes: ' + (e.message || e), 'error');
        } finally {
            setIsLoading(false);
        }
    }, [showToast]);

    useEffect(() => { load(); }, [load]);

    /** Replace every raw MANUAL: variant in the group's column with the bare catalog code. */
    const remapRows = async (group: ManualGroup, targetCode: string) => {
        const { error } = await supabase
            .from('wo_failure_data')
            .update({ [group.column]: targetCode, updated_at: new Date().toISOString() })
            .in(group.column, group.rawValues);
        if (error) throw error;
    };

    const handlePromote = async (group: ManualGroup) => {
        setBusyKey(group.key);
        try {
            // Skip the insert when the code already exists in the catalog (any scope, active or not).
            const { data: existing, error: exErr } = await supabase
                .from('reference_codes')
                .select('id')
                .eq('category', group.field)
                .eq('code', group.code)
                .limit(1);
            if (exErr) throw exErr;

            if (!existing || existing.length === 0) {
                // Mirrors DictionaryManager's addDictionary shape for reference_codes.
                const { error: insErr } = await supabase.from('reference_codes').insert({
                    category: group.field,
                    code: group.code,
                    description: group.description || group.code,
                    is_locked: false,
                    active: true,
                    properties: {},
                });
                if (insErr) throw insErr;
            }

            await remapRows(group, group.code);
            showToast(`Promoted "${group.code}" to the ${FIELD_LABELS[group.field]} catalog and remapped ${group.count} work order(s).`, 'success');
            await load();
        } catch (e: any) {
            showToast('Promote failed: ' + (e.message || e), 'error');
        } finally {
            setBusyKey(null);
        }
    };

    const handleRemap = async (group: ManualGroup, targetCode: string) => {
        setBusyKey(group.key);
        try {
            await remapRows(group, targetCode);
            showToast(`Remapped ${group.count} work order(s) from "${group.code}" to "${targetCode}".`, 'success');
            setRemapKey(null);
            setRemapSearch('');
            await load();
        } catch (e: any) {
            showToast('Remap failed: ' + (e.message || e), 'error');
        } finally {
            setBusyKey(null);
        }
    };

    const remapOptions = useMemo(() => {
        const group = groups.find(g => g.key === remapKey);
        if (!group) return [];
        const q = remapSearch.toLowerCase();
        return catalog
            .filter(o => o.category === group.field)
            .filter(o => !q || o.code.toLowerCase().includes(q) || (o.description || '').toLowerCase().includes(q))
            .slice(0, 30);
    }, [groups, catalog, remapKey, remapSearch]);

    return (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm shrink-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <div>
                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                        <AlertTriangle size={15} className="text-amber-500" />
                        Manual Codes Awaiting Review
                        {groups.length > 0 && (
                            <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">{groups.length}</span>
                        )}
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                        Free-text failure codes entered by technicians. Promote them into the catalog or remap them to an existing code so reliability analysis stays clean.
                    </p>
                </div>
                <button
                    onClick={load}
                    disabled={isLoading}
                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                    title="Refresh"
                >
                    <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                </button>
            </div>

            {isLoading ? (
                <div className="px-4 py-6 text-xs text-slate-400 flex items-center gap-2">
                    <Activity size={14} className="animate-spin" /> Scanning work order failure data...
                </div>
            ) : groups.length === 0 ? (
                <div className="px-4 py-6 text-xs text-slate-400 italic">No manual codes awaiting review.</div>
            ) : (
                <ul className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                    {groups.map(group => {
                        const isBusy = busyKey === group.key;
                        const isRemapping = remapKey === group.key;
                        return (
                            <li key={group.key} className="px-4 py-3">
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                                    <div className="flex-1 min-w-[180px]">
                                        <div className="flex items-center gap-2">
                                            <span className="font-mono text-xs font-bold text-slate-800">{group.code}</span>
                                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${group.field === 'FAILURE_MODE' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                                                {FIELD_LABELS[group.field]}
                                            </span>
                                            <span className="text-[10px] text-slate-400">{group.count} work order{group.count === 1 ? '' : 's'}</span>
                                        </div>
                                        <div className="text-xs text-slate-500 mt-0.5">{group.description || <span className="italic text-slate-400">No description</span>}</div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => handlePromote(group)}
                                            disabled={isBusy}
                                            className="px-2.5 py-1.5 text-xs font-medium text-white bg-primary-600 hover:bg-primary-500 rounded-lg flex items-center gap-1 disabled:opacity-50"
                                        >
                                            {isBusy ? <Activity size={12} className="animate-spin" /> : <ArrowUpRight size={12} />}
                                            Promote to catalog
                                        </button>
                                        <button
                                            onClick={() => {
                                                setRemapKey(isRemapping ? null : group.key);
                                                setRemapSearch('');
                                            }}
                                            disabled={isBusy}
                                            className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border flex items-center gap-1 disabled:opacity-50 ${isRemapping ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
                                        >
                                            {isRemapping ? <X size={12} /> : <Search size={12} />}
                                            {isRemapping ? 'Cancel' : 'Remap to existing'}
                                        </button>
                                    </div>
                                </div>

                                {isRemapping && (
                                    <div className="mt-2 border border-slate-200 rounded-lg overflow-hidden">
                                        <div className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-50 border-b border-slate-200">
                                            <Search size={12} className="text-slate-400" />
                                            <input
                                                value={remapSearch}
                                                onChange={e => setRemapSearch(e.target.value)}
                                                placeholder={`Search active ${FIELD_LABELS[group.field].toLowerCase()} codes...`}
                                                className="flex-1 bg-transparent outline-none text-xs"
                                                autoFocus
                                            />
                                        </div>
                                        <ul className="max-h-40 overflow-y-auto divide-y divide-slate-50">
                                            {remapOptions.length === 0 ? (
                                                <li className="px-3 py-2 text-xs text-slate-400 italic">No matching codes.</li>
                                            ) : (
                                                remapOptions.map(opt => (
                                                    <li
                                                        key={opt.code}
                                                        onClick={() => !isBusy && handleRemap(group, opt.code)}
                                                        className="px-3 py-1.5 text-xs cursor-pointer hover:bg-blue-50 flex items-center gap-2"
                                                    >
                                                        <span className="font-mono font-medium text-slate-700">{opt.code}</span>
                                                        <span className="text-slate-500 truncate">{opt.description}</span>
                                                    </li>
                                                ))
                                            )}
                                        </ul>
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
};
