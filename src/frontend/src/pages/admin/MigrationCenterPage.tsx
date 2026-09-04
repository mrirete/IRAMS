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
import { Link, useLocation } from 'react-router-dom';
import {
    Database, Wrench, Users, Package, Building2, CalendarClock, Gauge,
    FileSpreadsheet, Radio, BarChart2, Boxes, CheckCircle2, ArrowRight, ArrowLeft, Loader2,
    Send, RotateCcw, AlertTriangle, Tags, Download, FileUp, Lock,
} from 'lucide-react';
import BulkImportModal from '../../eam/components/modals/BulkImportModal';
import PidRegisterModal from '../../components/migration/PidRegisterModal';
import { DatabaseService } from '../../eam/services/DatabaseService';
import { importAssets, importBoms, importReadings, importFailureCodes, findUnresolvedFailureCodes } from '../../eam/services/bulkImportService';
import { importService } from '../../eam/services/ImportService';
import { supabase } from '../../eam/lib/supabase';
import { emptyResult, tally, errMessage, type ImportResult } from '../../eam/services/importTypes';
import { downloadUnresolvedCodes, type ImportType } from '../../eam/services/assetTemplates';
import { useToast } from '../../eam/contexts/ToastContext';
import { assessmentService } from '../../eam/services/AssessmentService';
import type { IntakeDimensionKey } from '../../eam/services/IntakeQuickAnalysis';

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
    /**
     * The ordering constraint, enforced: prerequisites that must hold data
     * before this phase's importer opens. Data-driven (counts, not checkmarks) —
     * a register loaded by any route unlocks everything that hangs off it.
     */
    requires?: { phase: number; needs: string; met: (c: Counts) => boolean }[];
}

const NEEDS_REGISTER = { phase: 1, needs: 'the asset register', met: (c: Counts) => c.assets > 0 };

const PHASES: Phase[] = [
    {
        n: 1, title: 'Assets & hierarchy', icon: <Wrench size={18} />,
        blurb: 'Your functional locations and equipment, as one tree. Everything else hangs off this — do it first.',
        importType: 'asset', count: c => c.assets, unit: 'assets',
        note: 'Use hierarchyLevel + parentTag in the template so sites, systems and equipment land at the right level. SAP migration sheets (TPLNR/PLTXT functional locations, EQUNR/EQKTX equipment) import directly — the SAP field names auto-translate.',
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
        note: 'SAP material-master sheets (MATNR/MAKTX headers) import directly — material types, ABC flags and price control auto-translate. Source-list sheets (MATNR/LIFNR) set preferred suppliers; inventory-balance sheets (MATNR/BUDAT) post opening stock as 561 movements.',
    },
    {
        n: 4, title: 'Bills of materials', icon: <Boxes size={18} />,
        blurb: 'Which spares belong to which equipment. Codes that match inventory link to the material; unknown codes become text BOM lines, promotable later.',
        importType: 'bom', count: c => c.bom, unit: 'BOM items',
        note: 'Rows name an asset tag and an inventory code, so both registers must exist. SAP BOM sheets (EQUNR/IDNRK headers) import directly, and EQUNR references resolve by equipment number.',
        requires: [NEEDS_REGISTER, { phase: 3, needs: 'inventory', met: c => c.inventory > 0 }],
    },
    {
        n: 5, title: 'Vendors', icon: <Building2 size={18} />,
        blurb: 'Suppliers and contractors your purchase orders and warranties refer to.',
        to: '/vendors?action=import', toLabel: 'Import vendors', count: c => c.vendors, unit: 'vendors',
    },
    {
        n: 6, title: 'PM schedules & job plans', icon: <CalendarClock size={18} />,
        blurb: 'Recurring jobs, then the task lists that tell a technician what to actually do. Schedules first — job plans attach to them by PM code.',
        to: '/recurring-work?action=import', toLabel: 'Import schedules & job plans', count: c => c.pms, unit: 'schedules',
        note: 'A schedule without a job plan tells a technician when, but not what. Import both.',
        requires: [NEEDS_REGISTER],
    },
    {
        n: 7, title: 'Work-order history', icon: <FileSpreadsheet size={18} />,
        blurb: 'Your maintenance history from SAP PM, Maximo or MaintainX — column-mapped, quality-checked and reversible.',
        to: '/specialist/import', toLabel: 'Open the CMMS Import Wizard',
        count: c => c.workOrders, unit: 'work orders',
        note: 'History imported without a register creates flat, unlevelled assets the hierarchy can never absorb.',
        requires: [NEEDS_REGISTER],
    },
    {
        n: 8, title: 'Failure-code catalogs', icon: <Tags size={18} />,
        blurb: 'Your own failure modes, causes and remedies. Imported history stores codes as written — without the catalog they decode to blank while still counting as "coded".',
        importType: 'failurecodes', count: c => c.codes, unit: 'codes',
        note: 'Import history first, then export the codes it actually used — the button below fills the template for you.',
    },
    {
        n: 9, title: 'Meter & condition history', icon: <Gauge size={18} />,
        blurb: 'Runtime hours, vibration and temperature logs. Reading points are created automatically.',
        importType: 'readings', count: c => c.readings, unit: 'readings',
        note: 'Every reading row names an asset tag — without the register, every row fails. SAP measuring-point sheets (MPOBJ/ATNAM) create the points with alarm limits; measurement-document sheets (MPOBJ/IDATE) load the history, counters included.',
        requires: [NEEDS_REGISTER],
    },
    {
        n: 10, title: 'Live sensor feeds', icon: <Radio size={18} />,
        blurb: 'Optional — connect a live telemetry source so Predict keeps learning after the migration.',
        to: '/admin/connectors', toLabel: 'Open the Connector Hub',
        count: c => c.connectors, unit: 'connectors',
    },
    {
        n: 11, title: 'Verify & assess', icon: <BarChart2 size={18} />,
        blurb: 'Put the Specialist to work on what you just loaded — reliability baseline, bad actors, quick wins.',
        to: '/specialist/assessment', toLabel: 'Run the assessment',
        count: c => c.batches, unit: 'import batches',
        note: 'The assessment reads the maintenance history — with nothing loaded it has nothing to say.',
        requires: [{ phase: 7, needs: 'work-order history', met: c => c.workOrders > 0 }],
    },
];

/**
 * Where "back" goes. The page sits under Admin in the sidebar but is reached
 * from three places — the Specialist workspace, the dashboard's getting-started
 * card, and the Admin nav — so each entry point states its own origin rather
 * than the page guessing. The workspace is the fallback: it is the flow this
 * page was built for, and on a cold URL it is the most useful place to land.
 */
export interface MigrationOrigin { to?: string; label?: string }

/**
 * RF-01/AU: the audit intake's weakest dimension points at the migration
 * phase that closes it — the system reading the plant's context and shaping
 * its guidance. One line, honestly labelled self-reported; silent when no
 * intake exists (the Getting Started checklist sends people to run one).
 */
const DIMENSION_PHASE_HINT: Partial<Record<IntakeDimensionKey, string>> = {
    information: 'your quick win here is phases 7–8 — work-order history and failure-code catalogs are what turn the analytics on',
    decisions: 'export cost columns with your work-order history (phase 7) — money-ranked findings depend on them',
    people: 'phase 2 (people & crafts) is where your gap closes first',
    lifecycle: 'get PM schedules & job plans in (phase 6) so the planned-work engine can carry the load',
};

const MaturityEmphasisHint: React.FC = () => {
    const [hint, setHint] = useState<string | null>(null);
    useEffect(() => {
        let active = true;
        assessmentService.getLatestIntakeAnalysis().then(latest => {
            if (!active || !latest) return;
            const weakest = [...latest.analysis.dimensions]
                .filter(d => d.score != null)
                .sort((a, b) => (a.score! - b.score!))[0];
            if (!weakest || weakest.score == null || weakest.score >= 3.5) return;
            const phase = DIMENSION_PHASE_HINT[weakest.key];
            if (phase) setHint(`Your maturity intake (self-reported) rated ${weakest.label.toLowerCase()} lowest — ${phase}.`);
        }).catch(() => { /* hint only */ });
        return () => { active = false; };
    }, []);
    if (!hint) return null;
    return (
        <p className="mt-2 text-[12.5px] text-primary-700 bg-primary-50 border border-primary-100 rounded-lg px-3 py-2 max-w-2xl">
            {hint}
        </p>
    );
};

export const MigrationCenterPage: React.FC = () => {
    const { showToast } = useToast();
    const { state } = useLocation();
    const origin = (state ?? {}) as MigrationOrigin;
    const backTo = origin.to ?? '/specialist';
    const backLabel = origin.label ?? 'Workspace';
    const [counts, setCounts] = useState<Counts | null>(null);
    const [openType, setOpenType] = useState<ImportType | null>(null);
    const [pidOpen, setPidOpen] = useState(false);
    const [batches, setBatches] = useState<Awaited<ReturnType<typeof importService.listBatches>>>([]);
    // import_batches.source_system vocabulary. Threaded into importAssets so a
    // foreign CMMS's own ids are kept (erp_object_map) rather than discarded.
    const [sourceSystem, setSourceSystem] = useState('spreadsheet');
    const [inviting, setInviting] = useState(false);
    const [harvesting, setHarvesting] = useState(false);

    /**
     * Turn "which codes do I even need?" into a filled-in spreadsheet: read the
     * codes the imported history actually uses, minus the ones already
     * catalogued, and hand them back in the import template's own shape.
     */
    const exportUnresolvedCodes = async () => {
        setHarvesting(true);
        try {
            const unresolved = await findUnresolvedFailureCodes();
            if (unresolved.length === 0) {
                showToast('Every failure code in your history already resolves — nothing to export.', 'success');
                return;
            }
            downloadUnresolvedCodes(unresolved);
            showToast(`Exported ${unresolved.length} unresolved code(s). Fill in the descriptions and import it back.`, 'success');
        } catch (e: unknown) {
            showToast(`Could not read the failure codes: ${errMessage(e)}`, 'error');
        } finally {
            setHarvesting(false);
        }
    };

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
        if (type === 'bom') {
            const res = await importBoms(rows);
            void refresh();
            return res;
        }
        if (type === 'failurecodes') {
            const res = await importFailureCodes(rows);
            void refresh();
            return res;
        }
        const res = emptyResult();
        tally(res, { row: 0, status: 'failed', reason: `No handler for ${type} on this page` });
        return res;
    };

    const handleImportAssets = async (rows: Record<string, string>[]): Promise<ImportResult> => {
        // withBatch: this route is admin-gated, so provenance always records.
        // sourceSystem: names the batch honestly AND keeps the source system's
        // own record ids for a later ERP integration (0275).
        const res = await importAssets(rows, { withBatch: true, sourceSystem });
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
        <div className="ers-page-form space-y-6 pb-24 animate-in fade-in duration-300">
            <div>
                <Link
                    to={backTo}
                    className="inline-flex items-center gap-1.5 mb-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors w-fit py-0.5"
                >
                    <ArrowLeft size={14} strokeWidth={2.5} /> Back to {backLabel}
                </Link>
                <h1 className="text-xl md:text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
                    <Database size={22} className="text-primary-600" /> Migration Center
                </h1>
                <p className="text-slate-500 text-sm mt-1 max-w-2xl">
                    Moving from SAP PM, Maximo, MaintainX or spreadsheets? Work down this list in order.
                    Each step feeds the next — the register has to exist before history, schedules or readings can attach to it.
                </p>
                <MaturityEmphasisHint />
                {/* Which system the files come out of. More than provenance: a
                    foreign CMMS export carries the ids THEIR system knows these
                    records by, and naming the source is what lets the import
                    keep them (erp_object_map) — so a later ERP integration
                    starts already mapped instead of rediscovering identities
                    by name. A spreadsheet has no other side, so it maps nothing. */}
                <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                    <span className="font-semibold text-slate-700">These files come from:</span>
                    <select
                        value={sourceSystem}
                        onChange={(e) => setSourceSystem(e.target.value)}
                        className="border border-slate-300 rounded-lg px-2 py-1 text-sm bg-white"
                    >
                        <option value="spreadsheet">Spreadsheets / hand-built files</option>
                        <option value="sap_pm">SAP PM</option>
                        <option value="maximo">IBM Maximo</option>
                        <option value="maintainx">MaintainX</option>
                        <option value="emaint">eMaint</option>
                        <option value="limble">Limble</option>
                        <option value="fiix">Fiix</option>
                        <option value="upkeep">UpKeep</option>
                        <option value="other">Another system</option>
                    </select>
                    {sourceSystem !== 'spreadsheet' && sourceSystem !== 'other' && (
                        <span className="text-[11px] text-emerald-700">
                            their record ids will be kept for a future integration
                        </span>
                    )}
                </label>
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
                    // The mechanism behind "work down this list in order": a phase
                    // whose prerequisites hold no data yet is locked — its importer
                    // will not open. Until counts load, treat as locked (fail safe).
                    const blockers = complete ? [] : (p.requires ?? []).filter((r) => !counts || !r.met(counts));
                    const locked = blockers.length > 0;
                    return (
                        <div key={p.n}
                            className={`rounded-2xl border bg-white p-5 transition-colors ${complete ? 'border-emerald-200' : 'border-slate-200'}`}>
                            <div className="flex items-start gap-4">
                                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-bold text-sm
                                    ${complete ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                                        : 'bg-slate-50 text-slate-400 border border-slate-200'}`}>
                                    {complete ? <CheckCircle2 size={18} /> : locked ? <Lock size={15} /> : p.n}
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

                                    {locked && (
                                        <p className="flex items-start gap-1.5 text-xs font-medium text-amber-700 mt-1.5">
                                            <Lock size={12} className="mt-0.5 shrink-0" />
                                            <span>
                                                Locked — import {blockers.map((b, i) => (
                                                    <React.Fragment key={b.phase}>
                                                        {i > 0 && ' and '}{b.needs} (phase {b.phase})
                                                    </React.Fragment>
                                                ))} first.
                                            </span>
                                        </p>
                                    )}
                                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                                        {p.importType && (
                                            <button
                                                onClick={() => setOpenType(p.importType!)}
                                                disabled={locked}
                                                className="flex items-center gap-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold px-3 py-2 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
                                            >
                                                {locked && <Lock size={12} />} Import {p.title.toLowerCase()} <ArrowRight size={13} />
                                            </button>
                                        )}
                                        {p.to && (locked ? (
                                            <button
                                                disabled
                                                className="flex items-center gap-1.5 rounded-lg bg-slate-200 text-slate-400 text-xs font-semibold px-3 py-2 cursor-not-allowed"
                                            >
                                                <Lock size={12} /> {p.toLabel} <ArrowRight size={13} />
                                            </button>
                                        ) : (
                                            <Link
                                                to={p.to}
                                                className="flex items-center gap-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold px-3 py-2"
                                            >
                                                {p.toLabel} <ArrowRight size={13} />
                                            </Link>
                                        ))}
                                        {p.n === 7 && (
                                            <button
                                                onClick={() => void exportUnresolvedCodes()}
                                                disabled={harvesting}
                                                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-medium px-3 py-2 disabled:opacity-50"
                                            >
                                                {harvesting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                                                Export unresolved codes from history
                                            </button>
                                        )}
                                        {p.n === 1 && (
                                            <button
                                                onClick={() => setPidOpen(true)}
                                                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-medium px-3 py-2"
                                            >
                                                <FileUp size={13} />
                                                No spreadsheet? Build it from a P&ID
                                            </button>
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

            {pidOpen && (
                <PidRegisterModal
                    onClose={() => { setPidOpen(false); void refresh(); }}
                    onImported={() => void refresh()}
                />
            )}
        </div>
    );
};

export default MigrationCenterPage;
