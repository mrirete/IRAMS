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
    Send, RotateCcw, AlertTriangle, Tags, Download, FileUp, Lock, ChevronRight,
} from 'lucide-react';
import { Drawer } from '../../eam/components/ui';
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
import { studyReadiness, type Ingredient, type IngredientKey } from '../../lib/migration/studyReadiness';
import { LookingFor } from '../../components/admin/DataDoors';
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

/** "1 readings" → "1 reading": the phase units are plural nouns. */
const unitFor = (n: number, unit: string) =>
    n !== 1 ? unit : unit === 'people' ? 'person' : unit.replace(/batches$/, 'batch').replace(/s$/, '');

/**
 * The readiness ingredient each import feeds. A step can hold data and still be
 * too thin for a study (one reading on 35 points) — its row then says so in
 * amber instead of a plain green count that step 2 contradicts.
 */
const PHASE_INGREDIENT: Partial<Record<number, IngredientKey>> = { 1: 'register', 6: 'schedules', 7: 'failures', 8: 'codes', 9: 'condition' };

const NEEDS_REGISTER = { phase: 1, needs: 'the asset register', met: (c: Counts) => c.assets > 0 };

const SOURCE_LABELS: Record<string, string> = {
    sap_pm: 'SAP PM', maximo: 'IBM Maximo', maintainx: 'MaintainX', emaint: 'eMaint', limble: 'Limble', fiix: 'Fiix', upkeep: 'UpKeep',
};
const KNOWN_SOURCES = new Set([...Object.keys(SOURCE_LABELS), 'spreadsheet', 'other']);

/**
 * The source is a per-person convenience, remembered in this browser: an SAP
 * shop should not have to pick "SAP PM" on every visit to see the SAP doors.
 * Storage can be unavailable (private window) — the page works without it.
 */
const SOURCE_KEY = 'ireams.migration.source';
const readStoredSource = (): string | null => {
    try { const v = window.localStorage.getItem(SOURCE_KEY); return v && KNOWN_SOURCES.has(v) ? v : null; } catch { return null; }
};
const storeSource = (v: string) => { try { window.localStorage.setItem(SOURCE_KEY, v); } catch { /* convenience only */ } };

/** One numbered step — the page reads top-down as the three things it does. */
const Step: React.FC<{ n: number; title: string; lead?: React.ReactNode; right?: React.ReactNode; tone?: 'plain' | 'primary'; children: React.ReactNode }> = ({ n, title, lead, right, tone = 'plain', children }) => (
    <section className={`rounded-2xl border p-5 ${tone === 'primary' ? 'border-primary-200 bg-primary-50/40' : 'border-slate-200 bg-white'}`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-3 min-w-0">
                <span className="w-7 h-7 rounded-full bg-primary-600 text-white text-sm font-bold flex items-center justify-center shrink-0">{n}</span>
                <div className="min-w-0">
                    <h2 className="font-semibold text-slate-800 leading-7">{title}</h2>
                    {lead && <div className="text-sm text-slate-500 mt-0.5">{lead}</div>}
                </div>
            </div>
            {right}
        </div>
        <div className="mt-4">{children}</div>
    </section>
);

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
        to: '/specialist/import', toLabel: 'Open Import Work History',
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
        to: '/admin/connectors', toLabel: 'Open Sensor & Data Feeds',
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
    const [sourceSystem, setSourceSystemState] = useState<string>(() => readStoredSource() ?? 'spreadsheet');
    const setSourceSystem = (v: string) => { setSourceSystemState(v); storeSource(v); };
    // The import step whose details sheet is open.
    const [sheetPhase, setSheetPhase] = useState<number | null>(null);
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

    // Nothing chosen in this browser yet: the most recent import names the source.
    useEffect(() => {
        if (readStoredSource()) return;
        const last = batches.find(b => b.source_system && KNOWN_SOURCES.has(b.source_system));
        if (last?.source_system) setSourceSystemState(last.source_system);
    }, [batches]);

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
    const blockersOf = (p: Phase) => (done(p) ? [] : (p.requires ?? []).filter((r) => !counts || !r.met(counts)));

    // ── Study readiness: what a study can run on ─────────────────────────────
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
    // A ready ingredient that still carries a caveat (failures inferred from the
    // work type) is amber, not green — the dot never contradicts the words under it.
    const dotFor = (i: Ingredient) =>
        i.status === 'ready' ? (i.because ? 'bg-amber-400' : 'bg-emerald-500') : i.status === 'partial' ? 'bg-amber-400' : 'bg-slate-300';
    const SOURCE_KINDS: { id: string; label: string; systems: string[] }[] = [
        { id: 'sap', label: 'SAP PM', systems: ['sap_pm'] },
        { id: 'cmms', label: 'Another CMMS', systems: ['maximo', 'maintainx', 'emaint', 'limble', 'fiix', 'upkeep', 'other'] },
        { id: 'sheets', label: 'Spreadsheets', systems: ['spreadsheet'] },
    ];
    const sourceKind = SOURCE_KINDS.find(k => k.systems.includes(sourceSystem))?.id ?? 'sheets';
    const wizardState = { state: { to: '/admin/migration', label: 'Migration Center' } };

    // The first step that can be done now and is not — the list points at it.
    // Sensor feeds (10) and the assessment (11) are not loads, so never "next".
    const nextPhase = counts ? PHASES.find(p => !done(p) && blockersOf(p).length === 0 && p.n <= 9) : undefined;
    const sheet = PHASES.find(p => p.n === sheetPhase) ?? null;
    const sheetTemplates = sheet ? phaseTemplatesFor(sourceSystem, sheet.n) : [];

    /** A step's own action — the importer, or the page that owns the step. */
    const phaseAction = (p: Phase, size: 'sm' | 'md' = 'sm') => {
        const locked = blockersOf(p).length > 0;
        const cls = size === 'sm'
            ? 'inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold px-3 py-1.5'
            : 'inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold px-4 py-2';
        // In the list, a step that already has data gets a quiet button — the
        // blue ones are what is left to do. The drawer's footer stays primary.
        const on = size === 'sm' && done(p)
            ? 'border border-slate-300 bg-white hover:bg-slate-50 text-slate-700'
            : 'bg-primary-600 hover:bg-primary-700 text-white';
        const off = 'bg-slate-200 text-slate-400 cursor-not-allowed';
        if (p.importType) {
            return (
                <button onClick={() => { setSheetPhase(null); setOpenType(p.importType!); }} disabled={locked} className={`${cls} ${locked ? off : on}`}>
                    {locked && <Lock size={12} />} {done(p) ? 'Import more' : 'Import'} <ArrowRight size={13} />
                </button>
            );
        }
        if (!p.to) return null;
        return locked ? (
            <button disabled className={`${cls} ${off}`}><Lock size={12} /> {p.toLabel}</button>
        ) : (
            <Link to={p.to} state={wizardState.state} className={`${cls} ${on}`}>{p.toLabel} <ArrowRight size={13} /></Link>
        );
    };

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
                    Three steps: bring your plant’s data in, check what a reliability study can run on, then send
                    the finished strategy back to your maintenance system.
                </p>
                <div className="mt-2"><LookingFor here="migration" /></div>
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

            {/* ── Step 1: bring data in — by what you have ── */}
            <Step
                n={1}
                title="Bring data in"
                lead="Start from what you have. Naming the source keeps its record ids, so a later integration starts already mapped."
                right={(
                    <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1" role="group" aria-label="Where your data comes from">
                        {SOURCE_KINDS.map(k => (
                            <button key={k.id} onClick={() => setSourceSystem(k.systems[0])} aria-pressed={sourceKind === k.id}
                                className={`px-3 py-1.5 text-xs font-semibold rounded-md ${sourceKind === k.id ? 'bg-white text-slate-800 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-800'}`}>
                                {k.label}
                            </button>
                        ))}
                    </div>
                )}
            >
                {sourceKind === 'cmms' && (
                    <label className="mb-3 flex items-center gap-2 text-sm text-slate-600">
                        <span>Which one?</span>
                        <select value={sourceSystem} onChange={e => setSourceSystem(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-sm bg-white">
                            <option value="maximo">IBM Maximo</option><option value="maintainx">MaintainX</option><option value="emaint">eMaint</option>
                            <option value="limble">Limble</option><option value="fiix">Fiix</option><option value="upkeep">UpKeep</option><option value="other">Another system</option>
                        </select>
                    </label>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
                            <button onClick={() => setOpenType('asset')} className="rounded-xl border border-slate-200 hover:border-primary-300 p-4 block text-left">
                                <div className="text-sm font-semibold text-slate-800">Consultant workbook (E82 layout)</div>
                                <div className="text-xs text-slate-500 mt-1">Functional locations, equipment, materials, BOMs, stock and source lists, one sheet per object. Drop the whole workbook — the right sheet is picked for each step.</div>
                                <div className="text-[11px] text-primary-700 mt-2">Gives a study: the register, and the finance master data →</div>
                            </button>
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
                                <div className="text-xs text-slate-500 mt-1">Readings, schedules, parts, people: IREAMS’s own templates, in the list below.</div>
                            </div>
                        </>
                    )}
                    {sourceKind === 'sheets' && (
                        <div className="rounded-xl border border-slate-200 p-4 md:col-span-3">
                            <div className="text-sm font-semibold text-slate-800">IREAMS’s own templates</div>
                            <div className="text-xs text-slate-500 mt-1">One template per import below (open Details), with a Read-me sheet and example rows. The register first; everything else names an asset tag from it.</div>
                        </div>
                    )}
                </div>

                {/* Every import, in order — one line each; notes, templates and
                    the extra tools open in a side sheet so the list stays calm. */}
                <div className="mt-5">
                    <div className="flex items-baseline justify-between gap-2 mb-2">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Every import, in order</h3>
                        {counts && <span className="text-xs text-slate-500">{PHASES.filter(done).length} of {PHASES.length} have data</span>}
                    </div>
                    <ol className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
                        {PHASES.map(p => {
                            const complete = done(p);
                            const n = counts ? p.count(counts) : 0;
                            const blockers = blockersOf(p);
                            const locked = blockers.length > 0;
                            const isNext = nextPhase?.n === p.n;
                            const ing = PHASE_INGREDIENT[p.n] && readiness?.ingredients.find(i => i.key === PHASE_INGREDIENT[p.n]);
                            const thin = complete && !!ing && ing.status !== 'ready';
                            return (
                                <li key={p.n} className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4 py-2.5 ${isNext ? 'bg-primary-50/60' : 'bg-white'}`}>
                                    <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold border
                                        ${complete ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : isNext ? 'bg-primary-600 text-white border-primary-600' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>
                                        {complete ? <CheckCircle2 size={15} /> : locked ? <Lock size={12} /> : p.n}
                                    </span>
                                    <button onClick={() => setSheetPhase(p.n)} className="flex-1 min-w-[10rem] text-left group">
                                        <span className="flex items-center gap-2 flex-wrap">
                                            <span className="text-sm font-semibold text-slate-800 group-hover:text-primary-700">{p.title}</span>
                                            {isNext && <span className="text-[10px] font-bold uppercase tracking-wider text-primary-700">Next</span>}
                                            {counts && (
                                                <span className={`text-[11px] ${thin ? 'text-amber-700' : complete ? 'text-emerald-700' : 'text-slate-400'}`}>
                                                    {complete ? `${n.toLocaleString()} ${unitFor(n, p.unit)}${thin ? ' — too few for a study yet (step 2)' : ''}`
                                                        : locked ? `needs ${blockers.map(b => b.needs).join(' and ')}` : 'not started'}
                                                </span>
                                            )}
                                        </span>
                                    </button>
                                    <div className="flex items-center gap-2 ml-10 sm:ml-0">
                                        {phaseAction(p)}
                                        <button onClick={() => setSheetPhase(p.n)} className="inline-flex items-center gap-0.5 text-xs font-medium text-slate-500 hover:text-slate-800 px-1.5 py-1.5" aria-label={`Details and templates for ${p.title}`}>
                                            Details <ChevronRight size={13} />
                                        </button>
                                    </div>
                                </li>
                            );
                        })}
                    </ol>
                </div>
            </Step>

            {/* ── Step 2: ready for a study? — the reason to import anything ── */}
            <Step
                n={2}
                tone="primary"
                title="Ready for a reliability study?"
                lead={readiness ? readiness.verdict : 'Reading the register…'}
                right={readiness && readiness.canRun.length > 0 ? (
                    <Link to="/specialist/assessment" state={wizardState.state}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold px-4 py-2">
                        Run the assessment <ArrowRight size={14} />
                    </Link>
                ) : undefined}
            >
                {readiness && (
                    <>
                        <MaturityEmphasisHint />
                        <ul className="mt-3 divide-y divide-primary-100 rounded-xl border border-primary-100 bg-white">
                            {readiness.ingredients.map(i => (
                                <li key={i.key} className="px-4 py-3 flex flex-wrap items-start gap-x-4 gap-y-1">
                                    <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${dotFor(i)}`} aria-label={i.status === 'ready' && i.because ? 'ready, with a caveat' : i.status} />
                                    <div className="min-w-[12rem] flex-1">
                                        <div className="text-sm text-slate-800"><span className="font-semibold">{i.label}</span> <span className="text-slate-500">— {i.have}</span></div>
                                        <div className="text-xs text-slate-500 mt-0.5">{i.unlocks}</div>
                                        {i.because && <div className={`text-xs mt-0.5 ${i.status === 'missing' ? 'text-slate-600' : 'text-amber-700'}`}>{i.because}</div>}
                                    </div>
                                    {(i.status !== 'ready' || i.because) && (
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
            </Step>

            {/* ── Step 3: the way back to the maintenance system ── */}
            <Step
                n={3}
                title={isSap ? 'Send it back to SAP' : 'Send it back to your maintenance system'}
                lead="After a study: the new plans, task lists and points go back to the system your planners work in."
            >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {isSap ? (
                        <Link to="/admin/migration/sap" className="rounded-xl border border-slate-200 hover:border-primary-300 p-4 block">
                            <div className="text-sm font-semibold text-slate-800 flex items-center gap-2"><Send size={15} className="text-slate-400" /> Send to SAP</div>
                            <p className="text-xs text-slate-500 mt-1">New plans, task lists and points go out in the cockpit’s own files; changes to plans SAP already has go to the planner with what SAP holds and what IREAMS now says.</p>
                            <span className="text-[11px] text-primary-700 mt-2 inline-block">Open Send to SAP →</span>
                        </Link>
                    ) : (
                        <Link to="/specialist/deliver" state={wizardState.state} className="rounded-xl border border-slate-200 hover:border-primary-300 p-4 block">
                            <div className="text-sm font-semibold text-slate-800 flex items-center gap-2"><Send size={15} className="text-slate-400" /> Deliver work to {sourceKind === 'cmms' ? sourceLabel : 'your CMMS'}</div>
                            <p className="text-xs text-slate-500 mt-1">A study’s PM changes and new work, as a file your CMMS imports. Using SAP? Pick SAP PM in step 1 for the cockpit files.</p>
                            <span className="text-[11px] text-primary-700 mt-2 inline-block">Open Deliver Work →</span>
                        </Link>
                    )}
                    <div className="rounded-xl border border-slate-200 p-4">
                        <div className="text-sm font-semibold text-slate-800 flex items-center gap-2"><Building2 size={15} className="text-slate-400" /> Finance &amp; materials</div>
                        <ul className="mt-2 space-y-2 text-sm">
                            {isSap && (
                                <li>
                                    <Link to="/admin/migration/sap#master-data" className="text-slate-800 hover:text-primary-700 font-medium">Master data and opening balances →</Link>
                                    <div className="text-xs text-slate-500">Materials with valuation class and price control, source lists, opening stock as a 561 movement, cost centres — through the cockpit.</div>
                                </li>
                            )}
                            <li>
                                <Link to="/finops" state={wizardState.state} className="text-slate-800 hover:text-primary-700 font-medium">Financial documents →</Link>
                                <div className="text-xs text-slate-500">
                                    Cost postings, goods movements, receipts, PO lines and invoices as a hand-over file, exactly once.
                                    {finance ? ` Waiting now: ${finance.unsettled} unsettled order(s), ${finance.unpostedMovements} unposted movement(s).` : ''}
                                </div>
                                {isSap && <div className="text-[11px] text-slate-500 mt-0.5">Sent automatically once SAP is connected under ERP Systems (proven against the simulator; a real SAP FI is a client-connect step). This file remains the fallback.</div>}
                            </li>
                        </ul>
                    </div>
                </div>
            </Step>

            {/* One import's details — notes, templates and its extra tools. */}
            <Drawer
                open={!!sheet}
                onClose={() => setSheetPhase(null)}
                title={sheet ? `${sheet.n}. ${sheet.title}` : undefined}
                subtitle={sheet && counts ? (done(sheet) ? `${sheet.count(counts).toLocaleString()} ${unitFor(sheet.count(counts), sheet.unit)} in IREAMS` : 'Not started') : undefined}
                footer={sheet ? <div className="flex w-full justify-end">{phaseAction(sheet, 'md')}</div> : undefined}
            >
                {sheet && (
                    <div className="p-4 md:p-5 space-y-4">
                        <p className="text-sm text-slate-600">{sheet.blurb}</p>
                        {blockersOf(sheet).length > 0 && (
                            <p className="flex items-start gap-1.5 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                <Lock size={14} className="mt-0.5 shrink-0" />
                                <span>Locked — import {blockersOf(sheet).map(b => `${b.needs} (step ${b.phase})`).join(' and ')} first.</span>
                            </p>
                        )}
                        {sheet.note && <p className="text-xs text-slate-500 bg-white border border-slate-200 rounded-lg px-3 py-2">{sheet.note}</p>}

                        {(sheet.n === 1 || sheet.n === 2 || sheet.n === 7) && (
                            <div className="flex flex-wrap gap-2">
                                {sheet.n === 1 && (
                                    <button onClick={() => { setSheetPhase(null); setPidOpen(true); }}
                                        className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-medium px-3 py-2">
                                        <FileUp size={13} /> No spreadsheet? Build it from a P&amp;ID
                                    </button>
                                )}
                                {sheet.n === 2 && (
                                    <button onClick={() => void inviteImportedPeople()} disabled={inviting || !counts || counts.people === 0}
                                        className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-medium px-3 py-2 disabled:opacity-50">
                                        {inviting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Invite imported people
                                    </button>
                                )}
                                {sheet.n === 7 && (
                                    <button onClick={() => void exportUnresolvedCodes()} disabled={harvesting}
                                        className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-medium px-3 py-2 disabled:opacity-50">
                                        {harvesting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Export unresolved codes from history
                                    </button>
                                )}
                            </div>
                        )}

                        {/* The source system decides which files a user is handed for
                            this step — a SAP shop gets the cockpit workbook and the PM
                            load files, in the layouts the importers read as they arrive. */}
                        {sheetTemplates.length > 0 && (
                            <div>
                                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Templates for {sourceLabel}</h3>
                                <ul className="space-y-2">
                                    {sheetTemplates.map(t => (
                                        <li key={t.id} className="rounded-lg border border-slate-200 bg-white p-3">
                                            <button onClick={t.download} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-700 hover:underline">
                                                <Download size={13} /> {t.label}
                                            </button>
                                            {t.hint && <p className="text-xs text-slate-500 mt-1">{t.hint}</p>}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {sheet.n === 7 && sourceSystem !== 'spreadsheet' && sourceSystem !== 'other' && (
                            <p className="text-xs text-slate-500">The wizard offers the {sourceLabel} history and register templates in your system’s own export layout.</p>
                        )}
                    </div>
                )}
            </Drawer>

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
