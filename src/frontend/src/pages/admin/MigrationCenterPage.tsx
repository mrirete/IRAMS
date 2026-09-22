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
import { Link, useLocation, useNavigate } from 'react-router-dom';
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
import { phaseTemplatesFor } from './migrationTemplates';
import { useToast } from '../../eam/contexts/ToastContext';
import { useConfirm } from '../../eam/contexts/ConfirmContext';
import { assessmentService } from '../../eam/services/AssessmentService';
import type { IntakeDimensionKey } from '../../eam/services/IntakeQuickAnalysis';
import { studyReadiness, type Ingredient } from '../../lib/migration/studyReadiness';
import { ErpExportService } from '../../eam/services/ErpExportService';

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

const SOURCE_LABELS: Record<string, string> = {
    sap_pm: 'SAP PM', maximo: 'IBM Maximo', maintainx: 'MaintainX', emaint: 'eMaint', limble: 'Limble', fiix: 'Fiix', upkeep: 'UpKeep',
};

const PHASES: Phase[] = [
    {
        n: 1, title: 'Assets & hierarchy', icon: <Wrench size={18} />,
        blurb: 'Your functional locations and equipment, as one tree. Everything else hangs off this — do it first.',
        importType: 'asset', count: c => c.assets, unit: 'assets',
        note: 'Use hierarchyLevel + parentTag in the template so sites, systems and equipment land at the right level. SAP migration sheets (TPLNR/PLTXT functional locations, EQUNR/EQKTX equipment) import directly — the SAP field names auto-translate. Drop the whole Migration Cockpit workbook: the right sheet is picked for each step and description rows are skipped.',
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
    information: 'your quick win is work-order history and the failure-code catalogue — they are what turn the analytics on',
    decisions: 'export the cost columns with your work-order history — money-ranked findings depend on them',
    people: 'the people register is where your gap closes first',
    lifecycle: 'get PM schedules and job plans in so the planned-work engine can carry the load',
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
    const confirm = useConfirm();
    const { state } = useLocation();
    const navigate = useNavigate();
    const origin = (state ?? {}) as MigrationOrigin;
    // Door D: what the financial-document lane is holding for SAP, from the
    // queue-shaped views the FinOps export reads. Optional — a tenant without
    // the finance tables simply shows no figure.
    const [finance, setFinance] = useState<{ unsettled: number; unpostedMovements: number } | null>(null);
    // The page lives under Admin (Sidebar › Admin › Migration Center), so with
    // no origin in the navigation state it returns to Admin — not to the
    // Reliability Specialist workspace. Callers that come from elsewhere
    // (Dashboard, Import wizard, Specialist) pass their own { to, label }.
    const backTo = origin.to ?? '/eam-admin';
    const backLabel = origin.label ?? 'Admin';
    const [counts, setCounts] = useState<Counts | null>(null);
    const [openType, setOpenType] = useState<ImportType | null>(null);
    const [pidOpen, setPidOpen] = useState(false);
    const [batches, setBatches] = useState<Awaited<ReturnType<typeof importService.listBatches>>>([]);
    // import_batches.source_system vocabulary. Threaded into importAssets so a
    // foreign CMMS's own ids are kept (erp_object_map) rather than discarded.
    const [sourceSystem, setSourceSystem] = useState('spreadsheet');
    const sourceLabel = SOURCE_LABELS[sourceSystem] ?? 'your system';
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
        ErpExportService.getReconciliationQueues()
            .then(q => setFinance({ unsettled: q.unsettled.length, unpostedMovements: q.unpostedMovements }))
            .catch(() => setFinance(null));
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

    const handleImportAssets = async (rows: Record<string, string>[], meta?: { fileName?: string }): Promise<ImportResult> => {
        // withBatch: this route is admin-gated, so provenance always records.
        // sourceSystem: names the batch honestly AND keeps the source system's
        // own record ids for a later ERP integration (0275).
        const res = await importAssets(rows, { withBatch: true, sourceSystem, fileName: meta?.fileName });
        void refresh();
        return res;
    };

    /** "ers_rca_investigations" → "RCA investigations" */
    const COLLATERAL_LABELS: Record<string, string> = {
        asset_bom: 'BOM lines', warranties: 'warranties',
        asset_financials: 'financial records', asset_insurance: 'insurance records',
        ers_criticality_assessments: 'criticality assessments',
        ers_rca_investigations: 'RCA investigations',
        ers_fmea_worksheets: 'FMEA worksheets', ers_smea_worksheets: 'SMEA worksheets',
        ers_rbi_assessments: 'RBI assessments', ers_ffs_assessments: 'fitness-for-service assessments',
        ers_inspections: 'inspections', ers_cmls: 'condition monitoring locations',
        loto_permits: 'isolation permits',
    };

    /**
     * Ask the database what would happen, tell the operator, then do it.
     *
     * The dry run is not politeness. Rolling an import back cascades into about
     * thirty tables, so it can delete an RCA investigation or a criticality
     * assessment somebody spent a week on. Naming those before the click is the
     * difference between undo and data loss.
     */
    const rollback = async (id: string, fileName: string) => {
        let plan;
        try {
            plan = await importService.rollbackBatch(id, { dryRun: true });
        } catch (e: unknown) {
            showToast(errMessage(e), 'error');
            return;
        }

        if (!plan.ok) {
            const named = plan.blockers.slice(0, 4).map(b => `${b.tag} (${b.reason})`).join('; ');
            const more = plan.blockers.length > 4 ? `, and ${plan.blockers.length - 4} more` : '';
            showToast(
                `"${fileName}" cannot be rolled back yet — ${plan.blockers.length} asset(s) are in use: ${named}${more}. Nothing was changed. Clear those references and try again.`,
                'warning',
            );
            return;
        }

        const damage = Object.entries(plan.collateral)
            .map(([t, n]) => `${n} ${COLLATERAL_LABELS[t] ?? t.replace(/^ers_/, '').replace(/_/g, ' ')}`)
            .join(', ');

        const ok = await confirm({
            title: 'Roll this import back?',
            message:
                `This removes ${plan.assetsToDelete} asset(s) and ${plan.workOrdersToDelete} work order(s) created by "${fileName}".`
                + (damage
                    ? `\n\nIt will also permanently delete work recorded against those assets: ${damage}. That cannot be undone.`
                    : '')
                + '\n\nEither everything goes or nothing does.',
            variant: 'danger',
            confirmLabel: damage ? 'Delete anyway' : 'Roll back',
        });
        if (!ok) return;

        try {
            const out = await importService.rollbackBatch(id);
            showToast(
                `Import rolled back. Removed ${out.assetsDeleted} asset(s) and ${out.workOrdersDeleted} work order(s).`,
                'success',
            );
        } catch (e: unknown) {
            showToast(errMessage(e), 'error');
        }
        void refresh();
    };

    const done = (p: Phase) => !!counts && p.count(counts) > 0;

    // ── Study readiness: the purpose of the page ─────────────────────────────
    // Where each ingredient is fetched from depends on where the files come
    // from: SAP shops have the cockpit's own files; everyone else has the
    // wizard and the templates.
    const isSap = sourceSystem === 'sap_pm';
    const readiness = counts ? studyReadiness({
        assets: counts.assets, workOrders: counts.workOrders, workOrdersWithCost: counts.workOrdersWithCost,
        breakdowns: counts.breakdowns, readings: counts.readings, readingPoints: counts.readingPoints,
        pms: counts.pms, codes: counts.codes,
    }, {
        register: '#import:asset',
        failures: '/specialist/import',
        cost: '/specialist/import',
        condition: isSap ? '/admin/migration/cockpit' : '#import:readings',
        schedules: isSap ? '/admin/migration/cockpit' : '/recurring-work?action=import',
        codes: '#import:failurecodes',
    }) : null;
    const follow = (i: Ingredient) => {
        if (i.action.to.startsWith('#import:')) setOpenType(i.action.to.slice('#import:'.length) as ImportType);
        else navigate(i.action.to, { state: { to: '/admin/migration', label: 'Migration Center' } });
    };
    const STATUS_DOT: Record<Ingredient['status'], string> = {
        ready: 'bg-emerald-500', partial: 'bg-amber-400', missing: 'bg-slate-300',
    };
    const SOURCE_KINDS: { id: string; label: string; systems: string[] }[] = [
        { id: 'sap', label: 'SAP PM', systems: ['sap_pm'] },
        { id: 'cmms', label: 'Another CMMS', systems: ['maximo', 'maintainx', 'emaint', 'limble', 'fiix', 'upkeep', 'other'] },
        { id: 'sheets', label: 'Spreadsheets', systems: ['spreadsheet'] },
    ];
    const sourceKind = SOURCE_KINDS.find(k => k.systems.includes(sourceSystem))?.id ?? 'sheets';
    const wizardState = { state: { to: '/admin/migration', label: 'Migration Center' } };

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
                    Bring your plant’s data into IREAMS, see what a reliability study can run on, and send the
                    results back to SAP. Four doors; the register comes first through every one of them.
                </p>
                <MaturityEmphasisHint />
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

            {/* ── Door B first: ready for a study? — the reason to import anything ── */}
            <section className="rounded-2xl border border-primary-200 bg-primary-50/40 p-5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                        <h2 className="font-semibold text-slate-800 flex items-center gap-2"><BarChart2 size={17} className="text-primary-600" /> Ready for a reliability study?</h2>
                        <p className="text-sm text-slate-600 mt-1">{readiness ? readiness.verdict : 'Reading the register…'}</p>
                    </div>
                    {readiness && readiness.canRun.length > 0 && (
                        <Link to="/specialist/assessment" state={wizardState.state}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold px-4 py-2">
                            Run the assessment <ArrowRight size={14} />
                        </Link>
                    )}
                </div>

                {readiness && (
                    <>
                        <ul className="mt-4 divide-y divide-primary-100 rounded-xl border border-primary-100 bg-white">
                            {readiness.ingredients.map(i => (
                                <li key={i.key} className="px-4 py-3 flex flex-wrap items-start gap-x-4 gap-y-1">
                                    <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${STATUS_DOT[i.status]}`} aria-label={i.status} />
                                    <div className="min-w-[12rem] flex-1">
                                        <div className="text-sm text-slate-800"><span className="font-semibold">{i.label}</span> <span className="text-slate-500">— {i.have}</span></div>
                                        <div className="text-xs text-slate-500 mt-0.5">{i.unlocks}</div>
                                        {i.because && <div className={`text-xs mt-0.5 ${i.status === 'missing' ? 'text-slate-600' : 'text-amber-700'}`}>{i.because}</div>}
                                    </div>
                                    {i.status !== 'ready' && (
                                        <button onClick={() => follow(i)}
                                            className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold px-2.5 py-1.5">
                                            {i.action.label} <ArrowRight size={12} />
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
                        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                            {readiness.canRun.map(x => <span key={x} className="text-emerald-700"><CheckCircle2 size={12} className="inline mr-1 -mt-0.5" />{x}</span>)}
                            {readiness.blocked.map(x => <span key={x.study} className="text-slate-500"><Lock size={11} className="inline mr-1 -mt-0.5" />{x.study} — needs {x.needs}</span>)}
                        </div>
                    </>
                )}
            </section>

            {/* ── Door A: bring data in — by what you have ── */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                        <h2 className="font-semibold text-slate-800 flex items-center gap-2"><FileUp size={17} className="text-slate-400" /> Bring data in</h2>
                        <p className="text-sm text-slate-500 mt-1">Start from what you have. Naming the source keeps its record ids, so a later integration starts already mapped.</p>
                    </div>
                    <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
                        {SOURCE_KINDS.map(k => (
                            <button key={k.id} onClick={() => setSourceSystem(k.systems[0])}
                                className={`px-3 py-1.5 text-xs font-semibold rounded-md ${sourceKind === k.id ? 'bg-white text-slate-800 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-800'}`}>
                                {k.label}
                            </button>
                        ))}
                    </div>
                </div>

                {sourceKind === 'cmms' && (
                    <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                        <span>Which one?</span>
                        <select value={sourceSystem} onChange={e => setSourceSystem(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-sm bg-white">
                            <option value="maximo">IBM Maximo</option><option value="maintainx">MaintainX</option><option value="emaint">eMaint</option>
                            <option value="limble">Limble</option><option value="fiix">Fiix</option><option value="upkeep">UpKeep</option><option value="other">Another system</option>
                        </select>
                    </label>
                )}

                <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                    {sourceKind === 'sap' && (
                        <>
                            <Link to="/admin/migration/cockpit" className="rounded-xl border border-slate-200 hover:border-primary-300 p-4 block">
                                <div className="text-sm font-semibold text-slate-800">Migration Cockpit source data</div>
                                <div className="text-xs text-slate-500 mt-1">The ZIPs SAP’s cockpit downloads: measuring points, readings, task lists, maintenance items and plans. Drop the folders — no reshaping.</div>
                                <div className="text-[11px] text-primary-700 mt-2">Gives a study: condition history and the current PM programme →</div>
                            </Link>
                            <Link to="/specialist/import" state={wizardState.state} className="rounded-xl border border-slate-200 hover:border-primary-300 p-4 block">
                                <div className="text-sm font-semibold text-slate-800">Order history (IW38 / IW39 export)</div>
                                <div className="text-xs text-slate-500 mt-1">Orders and notifications as a spreadsheet export. Columns are mapped for you, quality-checked, and the batch can be rolled back.</div>
                                <div className="text-[11px] text-primary-700 mt-2">Gives a study: failure history and cost — export the cost columns →</div>
                            </Link>
                            <div className="rounded-xl border border-slate-200 p-4">
                                <div className="text-sm font-semibold text-slate-800">Consultant workbook (E82 layout)</div>
                                <div className="text-xs text-slate-500 mt-1">Functional locations, equipment, materials, BOMs, stock and source lists, one sheet per object. Drop the whole workbook on the matching step below.</div>
                                <div className="text-[11px] text-slate-500 mt-2">Gives a study: the register, and the finance master data (materials, valuation, cost centres).</div>
                            </div>
                        </>
                    )}
                    {sourceKind === 'cmms' && (
                        <>
                            <Link to="/specialist/import" state={wizardState.state} className="rounded-xl border border-slate-200 hover:border-primary-300 p-4 block md:col-span-2">
                                <div className="text-sm font-semibold text-slate-800">{sourceLabel} exports — register and work-order history</div>
                                <div className="text-xs text-slate-500 mt-1">Upload the export as it comes out of {sourceLabel}; the wizard proposes the column mapping, you confirm it, and the batch can be rolled back.</div>
                                <div className="text-[11px] text-primary-700 mt-2">Gives a study: the register, failure history and cost →</div>
                            </Link>
                            <div className="rounded-xl border border-slate-200 p-4">
                                <div className="text-sm font-semibold text-slate-800">Everything else</div>
                                <div className="text-xs text-slate-500 mt-1">Readings, schedules, parts, people: IREAMS’s own templates, on the steps below.</div>
                            </div>
                        </>
                    )}
                    {sourceKind === 'sheets' && (
                        <div className="rounded-xl border border-slate-200 p-4 md:col-span-3">
                            <div className="text-sm font-semibold text-slate-800">IREAMS’s own templates</div>
                            <div className="text-xs text-slate-500 mt-1">One template per step below, with a Read-me sheet and example rows. The register first; everything else names an asset tag from it.</div>
                        </div>
                    )}
                </div>

                <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60">
                    <summary className="cursor-pointer select-none px-4 py-3 text-sm">
                        <span className="font-semibold text-slate-800">All import steps, in order</span>
                        <span className="text-xs text-slate-500 ml-2">assets · people · inventory · BOMs · vendors · schedules · history · codes · readings · sensors · assess</span>
                    </summary>
                    <div className="px-4 pb-4">
            <div className="space-y-3">
                {PHASES.map((p) => {
                    const complete = done(p);
                    const n = counts ? p.count(counts) : 0;
                    // The mechanism behind "work down this list in order": a phase
                    // whose prerequisites hold no data yet is locked — its importer
                    // will not open. Until counts load, treat as locked (fail safe).
                    const blockers = complete ? [] : (p.requires ?? []).filter((r) => !counts || !r.met(counts));
                    const locked = blockers.length > 0;
                    const phaseTemplates = phaseTemplatesFor(sourceSystem, p.n);
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
                                    {/* The source system decides which files a user is handed for
                                        this step — a SAP shop gets the cockpit workbook and the PM
                                        load files, in the layouts the importers read as they arrive. */}
                                    {phaseTemplates.length > 0 && (
                                        <div className="mt-2.5 flex flex-wrap items-start gap-2">
                                            <span className="text-xs text-slate-500 py-1.5">Templates for {sourceLabel}:</span>
                                            {phaseTemplates.map(t => (
                                                <button
                                                    key={t.id}
                                                    onClick={t.download}
                                                    title={t.hint}
                                                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:border-primary-300 hover:text-primary-700 transition-colors"
                                                >
                                                    <Download size={12} /> {t.label}
                                                </button>
                                            ))}
                                            <span className="basis-full text-[11px] text-slate-400">
                                                {phaseTemplates.map(t => t.hint).join(' ')}
                                            </span>
                                        </div>
                                    )}
                                    {p.n === 7 && sourceSystem !== 'spreadsheet' && sourceSystem !== 'other' && (
                                        <p className="mt-2 text-[11px] text-slate-400">
                                            The wizard offers the {sourceLabel} history and register templates in your system's own export layout.
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
                    </div>
                </details>
            </section>

            {/* ── Doors C and D: the way back to SAP ── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Link to="/admin/migration/sap" className="rounded-2xl border border-slate-200 bg-white hover:border-primary-300 p-5 block">
                    <h2 className="font-semibold text-slate-800 flex items-center gap-2"><Send size={16} className="text-slate-400" /> Send strategy back to SAP</h2>
                    <p className="text-sm text-slate-500 mt-1">After a study: new plans, task lists and points go out in the cockpit’s own files; changes to plans SAP already has go to the planner with what SAP holds and what IREAMS now says.</p>
                    <span className="text-[11px] text-primary-700 mt-2 inline-block">Send to SAP →</span>
                </Link>
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                    <h2 className="font-semibold text-slate-800 flex items-center gap-2"><Building2 size={16} className="text-slate-400" /> Finance &amp; materials with SAP</h2>
                    <ul className="mt-2 space-y-2 text-sm">
                        <li>
                            <Link to="/admin/migration/sap" className="text-slate-800 hover:text-primary-700 font-medium">Master data and opening balances →</Link>
                            <div className="text-xs text-slate-500">Materials with valuation class and price control, source lists, opening stock as a 561 movement, cost centres — through the cockpit. Works today.</div>
                        </li>
                        <li>
                            <Link to="/finops" className="text-slate-800 hover:text-primary-700 font-medium">Financial documents →</Link>
                            <div className="text-xs text-slate-500">
                                Cost postings, goods movements, receipts, PO lines and invoices as a hand-over file, exactly once.
                                {finance ? ` Waiting now: ${finance.unsettled} unsettled order(s), ${finance.unpostedMovements} unposted movement(s).` : ''}
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5">IREAMS does not post to SAP FI today. The live link carries these when a client system is connected.</div>
                        </li>
                    </ul>
                </div>
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
