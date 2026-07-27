/**
 * MigrationCenterPage — one ordered path from another CMMS into ERS.
 *
 * The pieces existed but were scattered across five pages with an undocumented
 * ordering constraint: import work-order history before the asset register and
 * the history's asset tags create flat, level-less rows that the hierarchy can
 * never absorb. This page makes the order explicit, shows what has landed, and
 * opens the right importer for each phase.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    Database, Wrench, Users, Package, Building2, CalendarClock, Gauge,
    FileSpreadsheet, Radio, BarChart2, CheckCircle2, ArrowRight, Loader2,
    Send, RotateCcw, AlertTriangle,
} from 'lucide-react';
import BulkImportModal from '../../eam/components/modals/BulkImportModal';
import { DatabaseService } from '../../eam/services/DatabaseService';
import { importAssets, importReadings } from '../../eam/services/bulkImportService';
import { importService } from '../../eam/services/ImportService';
import { supabase } from '../../eam/lib/supabase';
import { emptyResult, tally, errMessage, type ImportResult } from '../../eam/services/importTypes';
import type { ImportType } from '../../eam/services/assetTemplates';
import { useToast } from '../../eam/contexts/ToastContext';

type Counts = Awaited<ReturnType<DatabaseService['getOnboardingCounts']>>;

interface Phase {
    n: number;
    title: string;
    blurb: string;
    icon: React.ReactNode;
    /** Opens an importer inline. */
    importType?: ImportType;
    /** Or sends the user somewhere that owns the step. */
    to?: string;
    toLabel?: string;
    count: (c: Counts) => number;
    unit: string;
    /** Shown when the phase has landed nothing yet and order matters. */
    note?: string;
}

const PHASES: Phase[] = [
    {
        n: 1, title: 'Assets & hierarchy', icon: <Wrench size={18} />,
        blurb: 'Your functional locations and equipment, as one tree. Everything else hangs off this — do it first.',
        importType: 'asset', count: c => c.assets, unit: 'assets',
        note: 'Use hierarchyLevel + parentTag in the template so sites, systems and equipment land at the right level.',
    },
    {
        n: 2, title: 'People', icon: <Users size={18} />,
        blurb: 'Technicians, planners and supervisors. Import the register, then invite them to log in.',
        to: '/contacts?action=import', toLabel: 'Import people', count: c => c.people, unit: 'people',
    },
    {
        n: 3, title: 'Inventory & storerooms', icon: <Package size={18} />,
        blurb: 'Spare parts, unit costs and opening stock. Storerooms are created from the storeName column.',
        to: '/inventory?action=import', toLabel: 'Import inventory', count: c => c.inventory, unit: 'items',
    },
    {
        n: 4, title: 'Vendors', icon: <Building2 size={18} />,
        blurb: 'Suppliers and contractors your purchase orders and warranties refer to.',
        to: '/vendors?action=import', toLabel: 'Import vendors', count: c => c.vendors, unit: 'vendors',
    },
    {
        n: 5, title: 'PM schedules', icon: <CalendarClock size={18} />,
        blurb: 'Recurring preventive and predictive jobs. Needs the asset register in place first.',
        to: '/recurring-work?action=import', toLabel: 'Import PM schedules', count: c => c.pms, unit: 'schedules',
    },
    {
        n: 6, title: 'Work-order history', icon: <FileSpreadsheet size={18} />,
        blurb: 'Your maintenance history from SAP PM, Maximo or MaintainX — column-mapped, quality-checked and reversible.',
        to: '/specialist/import', toLabel: 'Open the CMMS Import Wizard',
        count: c => c.workOrders, unit: 'work orders',
    },
    {
        n: 7, title: 'Meter & condition history', icon: <Gauge size={18} />,
        blurb: 'Runtime hours, vibration and temperature logs. Reading points are created automatically.',
        importType: 'readings', count: c => c.readings, unit: 'readings',
    },
    {
        n: 8, title: 'Live sensor feeds', icon: <Radio size={18} />,
        blurb: 'Optional — connect a live telemetry source so Predict keeps learning after the migration.',
        to: '/admin/connectors', toLabel: 'Open the Connector Hub',
        count: c => c.connectors, unit: 'connectors',
    },
    {
        n: 9, title: 'Verify & assess', icon: <BarChart2 size={18} />,
        blurb: 'Put the Specialist to work on what you just loaded — reliability baseline, bad actors, quick wins.',
        to: '/specialist/assessment', toLabel: 'Run the assessment',
        count: c => c.batches, unit: 'import batches',
    },
];

export const MigrationCenterPage: React.FC = () => {
    const { showToast } = useToast();
    const [counts, setCounts] = useState<Counts | null>(null);
    const [openType, setOpenType] = useState<ImportType | null>(null);
    const [batches, setBatches] = useState<Awaited<ReturnType<typeof importService.listBatches>>>([]);
    const [inviting, setInviting] = useState(false);

    const refresh = useCallback(async () => {
        const [c, b] = await Promise.all([
            DatabaseService.getInstance().getOnboardingCounts(),
            importService.listBatches().catch(() => []),
        ]);
        setCounts(c);
        setBatches(b);
    }, []);

    useEffect(() => { void refresh(); }, [refresh]);

    /**
     * Bulk invites — imported contacts have an email but no login, and inviting
     * them one at a time is the difference between a migration finishing and
     * stalling. accept_invite adopts the existing contact (migration 0226), so
     * this does not fork the person record.
     */
    const inviteImportedPeople = async () => {
        setInviting(true);
        try {
            const { data: contacts, error } = await supabase
                .from('contacts')
                .select('id, name, email, can_login')
                .not('email', 'is', null);
            if (error) throw new Error(error.message);

            const { data: invites } = await supabase.from('user_invites').select('email, status');
            const alreadyInvited = new Set(
                (invites ?? [])
                    .filter(i => i.status === 'pending' || i.status === 'accepted')
                    .map(i => String(i.email || '').toLowerCase())
            );
            const { data: users } = await supabase.from('users').select('email');
            const hasLogin = new Set((users ?? []).map(u => String(u.email || '').toLowerCase()));

            const targets = (contacts ?? []).filter(c => {
                const e = String(c.email || '').toLowerCase();
                return e && !alreadyInvited.has(e) && !hasLogin.has(e);
            });

            if (targets.length === 0) {
                showToast('Everyone with an email address already has a login or a pending invite.', 'info');
                return;
            }

            let sent = 0;
            const failures: string[] = [];
            for (const c of targets) {
                const { error: rpcErr } = await supabase.rpc('create_user_invite', {
                    p_email: c.email, p_name: c.name, p_role: 'TECHNICIAN',
                });
                if (rpcErr) failures.push(`${c.name}: ${rpcErr.message}`);
                else sent += 1;
            }

            if (failures.length > 0) {
                showToast(`Created ${sent} invite links, ${failures.length} failed — ${failures[0]}`, 'warning');
            } else {
                showToast(`Created ${sent} invite link${sent === 1 ? '' : 's'} — copy them from Admin › Invitations.`, 'success');
            }
        } catch (e: unknown) {
            showToast(`Could not create invites: ${errMessage(e)}`, 'error');
        } finally {
            setInviting(false);
            void refresh();
        }
    };

    /**
     * Assets and readings are pure engine calls with no page state, so they run
     * here. People / inventory / vendors / PM keep their handlers on the pages
     * that own that data — this page deep-links to them rather than forking the
     * logic into a second copy that would drift.
     */
    const handleImportData = async (type: ImportType, rows: Record<string, string>[]): Promise<ImportResult | void> => {
        if (type === 'readings') {
            const res = await importReadings(rows);
            void refresh();
            return res;
        }
        const res = emptyResult();
        tally(res, { row: 0, status: 'failed', reason: `No handler for ${type} on this page` });
        return res;
    };

    const handleImportAssets = async (rows: Record<string, string>[]): Promise<ImportResult> => {
        // withBatch: this route is admin-gated, so provenance always records.
        const res = await importAssets(rows, { withBatch: true });
        void refresh();
        return res;
    };

    const rollback = async (id: string, fileName: string) => {
        if (!window.confirm(`Remove everything the import "${fileName}" created?`)) return;
        try {
            await importService.rollbackBatch(id);
            showToast('Import rolled back.', 'success');
        } catch (e: unknown) {
            showToast(`Rollback failed: ${errMessage(e)}`, 'error');
        }
        void refresh();
    };

    const done = (p: Phase) => !!counts && p.count(counts) > 0;

    return (
        <div className="max-w-4xl mx-auto space-y-6 pb-24 animate-in fade-in duration-300">
            <div>
                <h1 className="text-xl md:text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
                    <Database size={22} className="text-violet-600" /> Migration Center
                </h1>
                <p className="text-slate-500 text-sm mt-1 max-w-2xl">
                    Moving from SAP PM, Maximo, MaintainX or spreadsheets? Work down this list in order.
                    Each step feeds the next — the register has to exist before history, schedules or readings can attach to it.
                </p>
            </div>

            {/* Order warning — the failure mode this page exists to prevent */}
            {counts && counts.assets === 0 && counts.workOrders > 0 && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                    <span>
                        Work-order history was imported before the asset register. The assets it created are flat and
                        unlevelled — roll that batch back below, import the register first, then re-import the history
                        so it links to properly structured assets.
                    </span>
                </div>
            )}

            <div className="space-y-3">
                {PHASES.map((p) => {
                    const complete = done(p);
                    const n = counts ? p.count(counts) : 0;
                    return (
                        <div key={p.n}
                            className={`rounded-2xl border bg-white p-5 transition-colors ${complete ? 'border-emerald-200' : 'border-slate-200'}`}>
                            <div className="flex items-start gap-4">
                                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-bold text-sm
                                    ${complete ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                                        : 'bg-slate-50 text-slate-400 border border-slate-200'}`}>
                                    {complete ? <CheckCircle2 size={18} /> : p.n}
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-slate-400">{p.icon}</span>
                                        <h3 className="font-semibold text-slate-800">{p.title}</h3>
                                        {counts && (
                                            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full
                                                ${complete ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                                                {complete ? `${n.toLocaleString()} ${p.unit}` : 'Not started'}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-sm text-slate-500 mt-1">{p.blurb}</p>
                                    {p.note && !complete && (
                                        <p className="text-xs text-slate-400 mt-1.5">{p.note}</p>
                                    )}

                                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                                        {p.importType && (
                                            <button
                                                onClick={() => setOpenType(p.importType!)}
                                                className="flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold px-3 py-2"
                                            >
                                                Import {p.title.toLowerCase()} <ArrowRight size={13} />
                                            </button>
                                        )}
                                        {p.to && (
                                            <Link
                                                to={p.to}
                                                className="flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold px-3 py-2"
                                            >
                                                {p.toLabel} <ArrowRight size={13} />
                                            </Link>
                                        )}
                                        {p.n === 2 && (
                                            <button
                                                onClick={() => void inviteImportedPeople()}
                                                disabled={inviting || !counts || counts.people === 0}
                                                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-medium px-3 py-2 disabled:opacity-50"
                                            >
                                                {inviting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                                                Invite imported people
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Provenance — what came in, and the way back out */}
            {batches.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Import history</h3>
                    <div className="divide-y divide-slate-100">
                        {batches.slice(0, 8).map(b => (
                            <div key={b.id} className="py-2.5 flex items-center gap-3 text-sm">
                                <span className="font-medium text-slate-700 truncate max-w-[14rem]">{b.file_name ?? '(no file name)'}</span>
                                <span className="text-xs text-slate-400">{b.source_system}</span>
                                <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full
                                    ${b.status === 'committed' ? 'bg-emerald-50 text-emerald-600'
                                        : b.status === 'rolled_back' ? 'bg-slate-100 text-slate-500'
                                            : 'bg-amber-50 text-amber-600'}`}>{b.status}</span>
                                <span className="text-xs text-slate-400 ml-auto">
                                    {new Date(b.created_at).toLocaleDateString()}
                                </span>
                                {b.status === 'committed' && (
                                    <button onClick={() => void rollback(b.id, b.file_name ?? 'this import')}
                                        className="flex items-center gap-1 text-xs text-rose-500 hover:text-rose-700 font-medium">
                                        <RotateCcw size={12} /> Roll back
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {openType && (
                <BulkImportModal
                    isOpen
                    onClose={() => { setOpenType(null); void refresh(); }}
                    preSelectedType={openType}
                    allowedTypes={[openType]}
                    onImportData={handleImportData}
                    onImportAssets={handleImportAssets}
                />
            )}
        </div>
    );
};

export default MigrationCenterPage;
