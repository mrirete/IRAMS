/**
 * SapLoadCenterPage — the Migration Center's outbound side: IREAMS → SAP.
 *
 * A plant leaving IREAMS for SAP PM/MM (or running both) needs Migration
 * Cockpit load files. This page fills the consultant's workbook (eight cockpit objects, plus open work as notifications and closed history as a hand-over)
 * from the live register, shows what is ready and what will break a load, and
 * hands over one workbook — or one sheet at a time in load order.
 *
 * Target-system values (company code, plants, valuation classes, storage
 * location codes…) are SAP configuration, not IREAMS data, so they are entered
 * here and remembered in this browser. They are also written into the
 * workbook's Read-me so the file states what it was built against.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    ArrowLeft, Download, FileSpreadsheet, Loader2, RefreshCw, AlertTriangle, AlertOctagon, Info,
    CheckCircle2, Settings2, Database,
} from 'lucide-react';
import { downloadWorkbook } from '../../eam/services/assetTemplates';
import { useToast } from '../../eam/contexts/ToastContext';
import { errMessage } from '../../eam/services/importTypes';
import { SAP_OBJECTS, type SapObjectKey } from '../../lib/sapLoad/spec';
import {
    buildSapLoad, buildSapWorkbook, defaultParams, suggestStorageLocations,
    type SapLoadResult, type SapLoadSource, type SapTargetParams, type MaterialBucket,
} from '../../lib/sapLoad/build';
import { loadSapSource } from '../../lib/sapLoad/source';
import { saveAs } from 'file-saver';
import { buildCockpitExport, exportZipEntries, type CockpitExportParams } from '../../lib/sapCockpit/outbound';
import { buildZip } from '../../lib/sapCockpit/zip';
import { readinessView, type ViewItem, type ReadinessView } from '../../lib/sapCockpit/readinessView';

const STORAGE_KEY = 'ireams.sapLoad.params.v1';

function loadParams(): SapTargetParams {
    const base = defaultParams();
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return base;
        const saved = JSON.parse(raw) as Partial<SapTargetParams>;
        return {
            ...base, ...saved,
            materialGroup: { ...base.materialGroup, ...(saved.materialGroup ?? {}) },
            valuationClass: { ...base.valuationClass, ...(saved.valuationClass ?? {}) },
            storageLocations: { ...(saved.storageLocations ?? {}) },
            orderTypes: { ...base.orderTypes, ...(saved.orderTypes ?? {}) },
            notificationTypes: { ...base.notificationTypes, ...(saved.notificationTypes ?? {}) },
            codeGroups: { ...base.codeGroups, ...(saved.codeGroups ?? {}) },
        };
    } catch { return base; }
}

const BUCKETS: { key: MaterialBucket; label: string; mtart: string }[] = [
    { key: 'SPARE', label: 'Spares', mtart: 'ERSA' },
    { key: 'CONSUMABLE', label: 'Consumables', mtart: 'VERB' },
    { key: 'TOOL', label: 'Tools', mtart: 'HIBE' },
    { key: 'MATERIAL', label: 'Materials', mtart: 'ROH' },
];

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
    <label className="block">
        <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
        {children}
        {hint && <span className="block text-[11px] text-slate-400 mt-0.5">{hint}</span>}
    </label>
);

const inputCls = 'mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-200';

/** One readiness item: plain name first, SAP code as a tag, what to do underneath. */
const IssueLine: React.FC<{ item: ViewItem }> = ({ item }) => {
    const icon = item.level === 'error'
        ? <AlertOctagon size={15} className="text-rose-600 mt-0.5 shrink-0" />
        : item.level === 'warn' ? <AlertTriangle size={15} className="text-amber-600 mt-0.5 shrink-0" /> : <Info size={15} className="text-slate-400 mt-0.5 shrink-0" />;
    return (
        <li className="flex items-start gap-2.5 py-2.5">
            {icon}
            <div className="min-w-0 flex-1">
                <div className="text-sm text-slate-800 flex items-start gap-2 flex-wrap">
                    <span>{item.title}</span>
                    {item.code && <span className="text-[10px] font-mono text-slate-500 bg-slate-100 rounded px-1.5 py-0.5 mt-0.5">{item.code}</span>}
                    {item.rows && item.rows > 1 && <span className="text-xs text-slate-400 mt-0.5">{item.rows.toLocaleString()} rows</span>}
                </div>
                {item.action && <div className="text-xs text-slate-500 mt-0.5">{item.action}</div>}
                {item.details && item.details.length > 0 && (
                    <details className="mt-1">
                        <summary className="text-xs text-primary-700 cursor-pointer select-none">Which fields ({item.details.length})</summary>
                        <ul className="mt-1 text-xs text-slate-500 list-disc pl-4 space-y-0.5">{item.details.map((d, i) => <li key={i}>{d}</li>)}</ul>
                    </details>
                )}
            </div>
        </li>
    );
};

/** The three groups a person acts on, in order. Empty groups are not shown. */
const ReadinessGroups: React.FC<{ view: ReadinessView }> = ({ view }) => {
    const group = (title: string, hint: string, items: ViewItem[], tone: string, open: boolean) => items.length === 0 ? null : (
        <details open={open} className="rounded-xl border border-slate-200 bg-white">
            <summary className="cursor-pointer select-none px-4 py-3 flex items-center gap-2 text-sm">
                <span className={`font-semibold ${tone}`}>{title}</span>
                <span className="text-slate-400">·</span>
                <span className="text-slate-500">{items.length} item{items.length === 1 ? '' : 's'}</span>
                <span className="text-xs text-slate-400 ml-1 hidden md:inline">— {hint}</span>
            </summary>
            <ul className="px-4 pb-2 divide-y divide-slate-100 border-t border-slate-100">{items.map((it, i) => <IssueLine key={i} item={it} />)}</ul>
        </details>
    );
    return (
        <div className="space-y-2">
            {group('Must fix before loading', 'SAP will reject these rows', view.mustFix, 'text-rose-700', true)}
            {group('Worth a look', 'loads, but something was changed or left out', view.check, 'text-amber-700', view.mustFix.length === 0)}
            {group('Good to know', 'how the file was built', view.notes, 'text-slate-700', false)}
        </div>
    );
};

const Step: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-3 mb-3">
            <span className="w-7 h-7 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center shrink-0">{n}</span>
            <h3 className="font-semibold text-slate-800">{title}</h3>
        </div>
        {children}
    </section>
);

export const SapLoadCenterPage: React.FC = () => {
    const { showToast } = useToast();
    const [params, setParams] = useState<SapTargetParams>(loadParams);
    const [source, setSource] = useState<SapLoadSource | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [showParams, setShowParams] = useState(false);

    const refresh = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const src = await loadSapSource();
            setSource(src);
            // Stores get a storage-location code the first time they are seen.
            setParams(prev => ({ ...prev, storageLocations: suggestStorageLocations(src.stores, prev.storageLocations) }));
        } catch (e: unknown) {
            setLoadError(errMessage(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void refresh(); }, [refresh]);

    useEffect(() => {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(params)); } catch { /* remembered only when storage allows */ }
    }, [params]);

    const result: SapLoadResult | null = useMemo(
        () => (source ? buildSapLoad(source, params) : null),
        [source, params],
    );

    const set = <K extends keyof SapTargetParams>(k: K, v: SapTargetParams[K]) => setParams(p => ({ ...p, [k]: v }));

    const readmeExtra = useCallback((): string[][] => {
        if (!result) return [];
        return [
            ['Filled from IREAMS', `${new Date().toLocaleString()} — ${SAP_OBJECTS.map(o => `${o.label}: ${result.objects[o.key].length}`).join(', ')}.`],
            ['Readiness', `${result.issues.filter(i => i.level === 'error').length} error(s), ${result.issues.filter(i => i.level === 'warn').length} warning(s) — see sheet "Readiness".`],
        ];
    }, [result]);

    const downloadAll = () => {
        if (!result) return;
        downloadWorkbook(buildSapWorkbook(result, params, { mode: 'filled', readmeExtra: readmeExtra() }), `IREAMS_SAP_Load_${params.systemLabel ? params.systemLabel.replace(/[^A-Za-z0-9]+/g, '_') + '_' : ''}${new Date().toISOString().slice(0, 10)}.xlsx`);
        showToast('SAP load workbook downloaded — check the Readiness sheet before loading.', 'success');
    };

    const downloadOne = (key: SapObjectKey) => {
        if (!result) return;
        const spec = SAP_OBJECTS.find(o => o.key === key)!;
        downloadWorkbook(buildSapWorkbook(result, params, { mode: 'filled', objects: [key], readmeExtra: readmeExtra() }), `IREAMS_SAP_${spec.sheet.replace(/\s+/g, '_')}.xlsx`);
    };

    const downloadBlank = () => {
        downloadWorkbook(buildSapWorkbook(null, params, { mode: 'template' }), 'SAP_Load_Templates.xlsx');
        showToast('Blank SAP load templates downloaded (with example rows).', 'success');
    };

    const errors = result?.issues.filter(i => i.level === 'error') ?? [];
    const totalRows = result ? SAP_OBJECTS.reduce((n, o) => n + result.objects[o.key].length, 0) : 0;

    // ── Migration Cockpit source data: the cockpit's own shape ───────────────
    // Delta by identity: what came from SAP is not loaded again; what IREAMS
    // changed on a SAP schedule goes to the hand-over sheet. Full mode is for
    // a plant moving to a NEW SAP system.
    const [cockpitMode, setCockpitMode] = useState<CockpitExportParams['mode']>('delta');
    const cockpitParams = useMemo<CockpitExportParams>(() => ({
        mode: cockpitMode,
        planningPlant: params.planningPlant || params.maintenancePlant,
        plant: params.maintenancePlant || params.planningPlant,
        // Maintenance plans generate preventive orders — the target's preventive order type.
        orderType: params.orderTypes?.preventive || 'PM02',
        numbering: params.numbering,
        sourceSystem: 'sap_pm',
    }), [cockpitMode, params]);
    const cockpit = useMemo(() => (source ? buildCockpitExport(source, cockpitParams) : null), [source, cockpitParams]);
    const cockpitRows = cockpit ? cockpit.files.reduce((n, f) => n + f.rows, 0) : 0;
    const cockpitView = cockpit ? readinessView(cockpit.issues, cockpitRows) : null;

    const downloadCockpit = () => {
        if (!cockpit) return;
        const entries = exportZipEntries(cockpit);
        if (entries.length === 0) { showToast('Nothing to export — SAP already has everything IREAMS holds.', 'info'); return; }
        const bytes = buildZip(entries);
        saveAs(new Blob([bytes as BlobPart], { type: 'application/zip' }), `IREAMS_cockpit_source_data_${new Date().toISOString().slice(0, 10)}.zip`);
        showToast(`${entries.length} file(s) zipped in the cockpit’s own layout — upload in Migrate Your Data.`, 'success');
    };

    return (
        <div className="ers-page-form space-y-6 pb-24 animate-in fade-in duration-300">
            <div>
                <Link to="/admin/migration" className="inline-flex items-center gap-1.5 mb-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors w-fit py-0.5">
                    <ArrowLeft size={14} strokeWidth={2.5} /> Back to Migration Center
                </Link>
                <h1 className="text-xl md:text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
                    <Database size={22} className="text-primary-600" /> Send to SAP
                </h1>
                <p className="text-slate-500 text-sm mt-1 max-w-2xl">
                    Move what IREAMS knows — measuring points, readings, task lists and PM schedules — into SAP Plant Maintenance.
                    Nothing is written to SAP from here: you download one file and load it in SAP's own tool,
                    <em> Migrate Your Data</em>, which simulates the load before it commits anything.
                </p>
                <ol className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                    <li><b className="text-slate-700">1</b> Choose what to send</li>
                    <li><b className="text-slate-700">2</b> Fix anything SAP would reject</li>
                    <li><b className="text-slate-700">3</b> Download the file</li>
                    <li><b className="text-slate-700">4</b> Upload it in SAP and simulate</li>
                </ol>
            </div>

            {/* Step 1 — what goes */}
            <Step n={1} title="Choose what to send">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                    <label className="flex items-center gap-2 text-slate-700">
                        <span>Send</span>
                        <select value={cockpitMode} onChange={e => setCockpitMode(e.target.value as CockpitExportParams['mode'])} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white">
                            <option value="delta">only what SAP does not have yet (recommended)</option>
                            <option value="full">everything — this is a new SAP system</option>
                        </select>
                    </label>
                </div>
                {loading && <p className="text-sm text-slate-500 mt-3 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Reading the register…</p>}
                {loadError && <p className="text-sm text-rose-700 mt-3">{loadError}</p>}
                {cockpit && (
                    <>
                        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                            {([
                                ['measuringPoint', 'Measuring points'], ['measurementDocument', 'Readings'],
                                ['generalTaskList', 'Task-list steps'], ['maintenancePlan', 'PM schedules'],
                            ] as const).map(([key, name]) => (
                                <div key={key} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                                    <div className="text-2xl font-bold text-slate-800">{cockpit.counts[key].toLocaleString()}</div>
                                    <div className="text-xs text-slate-500">{name}</div>
                                </div>
                            ))}
                        </div>
                        {(cockpit.handover || cockpit.alreadyInSap.points > 0 || cockpit.alreadyInSap.readings > 0) && cockpitMode === 'delta' && (
                            <p className="text-xs text-slate-500 mt-3">
                                Not sent because SAP already has them: {cockpit.alreadyInSap.points} point(s), {cockpit.alreadyInSap.readings} reading(s)
                                {cockpit.handover ? `, ${cockpit.handover.rows} schedule(s)` : ''}.
                                {cockpit.handover ? ' The schedules IREAMS changed are listed on a hand-over sheet in the file, with their SAP numbers, for the planner to update in SAP.' : ''}
                            </p>
                        )}
                    </>
                )}
            </Step>

            {/* Step 2 — readiness, grouped by what to do */}
            {cockpit && cockpitView && (
                <Step n={2} title="Fix anything SAP would reject">
                    {cockpitView.verdict === 'empty' && <p className="text-sm text-slate-500">Nothing to send: SAP already has everything IREAMS holds.</p>}
                    {cockpitView.verdict === 'ready' && <p className="text-sm text-emerald-700 flex items-center gap-2"><CheckCircle2 size={16} /> Ready to load — nothing SAP would reject.</p>}
                    {cockpitView.verdict === 'attention' && <p className="text-sm text-amber-700 mb-3">Loads as it is. A few things are worth a look first.</p>}
                    {cockpitView.verdict === 'blocked' && <p className="text-sm text-rose-700 mb-3">SAP will reject some rows until the items under <b>Must fix</b> are dealt with — in IREAMS, or in the cockpit’s value mapping.</p>}
                    <ReadinessGroups view={cockpitView} />
                </Step>
            )}

            {/* Step 3 — the file */}
            {cockpit && (
                <Step n={3} title="Download, then upload in SAP">
                    <div className="flex items-center gap-3 flex-wrap">
                        <button onClick={downloadCockpit} disabled={cockpitRows === 0 && !cockpit.handover}
                            className="flex items-center gap-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold px-4 py-2.5 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed">
                            <Download size={15} /> Download for SAP (.zip)
                        </button>
                        <span className="text-xs text-slate-500">One ZIP, one folder per object, exactly as SAP’s Migration Cockpit lays its own files out.</span>
                    </div>
                    <ol className="mt-4 text-sm text-slate-600 space-y-1 list-decimal pl-5">
                        <li>In SAP, open <em>Migrate Your Data</em> and your migration project (staging tables).</li>
                        <li>Unzip the download and upload each <em>Source data for …</em> folder to its object, in this order: measuring points, measurement documents, task lists, then maintenance plans.</li>
                        <li>Run <em>Simulate</em>. The items under <b>Must fix</b> above are what it will report; the cockpit’s value mapping resolves IREAMS ids to SAP numbers.</li>
                        <li>Migrate ten rows end to end before the full file.</li>
                    </ol>
                </Step>
            )}

            {/* Everything below is for consultants: SAP configuration values and
                the consultant's E82 workbook (one sheet per object, SAP field
                names on row 4) with its own readiness and per-sheet downloads.
                A planner sending a strategy back never needs it. */}
            <details className="rounded-2xl border border-slate-200 bg-slate-50/60">
            <summary className="cursor-pointer select-none px-5 py-4 text-sm">
                <span className="font-semibold text-slate-800">Advanced — SAP configuration values and the consultant workbook</span>
                <span className="block text-xs text-slate-500 mt-0.5">Company code, plants, valuation classes; and the alternative E82 workbook format (functional locations, equipment, materials, BOMs, stock, open work) for consultants who load with LTMC sheets.</span>
            </summary>
            <div className="px-5 pb-5 space-y-6">
            {/* Target system */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Settings2 size={16} className="text-slate-400" /> Target system</h3>
                        <p className="text-sm text-slate-500 mt-1">
                            SAP configuration the files are built against. Company code <b>{params.companyCode}</b>, plant <b>{params.maintenancePlant}</b>,
                            controlling area <b>{params.controllingArea}</b>, valuation classes <b>{params.valuationClass.SPARE}</b> spares / <b>{params.valuationClass.CONSUMABLE}</b> operating supplies,
                            price control <b>{params.priceControl}</b>, equipment numbering <b>{params.numbering === 'legacy' ? 'IREAMS numbers kept (external)' : 'SAP assigns (internal)'}</b>.
                            Remembered in this browser and written into the workbook's Read-me.
                        </p>
                    </div>
                    <button onClick={() => setShowParams(v => !v)} className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3 py-2">
                        {showParams ? 'Hide values' : 'Edit values'}
                    </button>
                </div>

                {showParams && (
                    <div className="mt-5 space-y-5">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <Field label="System / client" hint="Read-me title, e.g. E82 / Client 250">
                                <input className={inputCls} value={params.systemLabel} onChange={e => set('systemLabel', e.target.value)} placeholder="E82 / Client 250" />
                            </Field>
                            <Field label="Company code (BUKRS)"><input className={inputCls} value={params.companyCode} onChange={e => set('companyCode', e.target.value)} /></Field>
                            <Field label="Controlling area (KOKRS)"><input className={inputCls} value={params.controllingArea} onChange={e => set('controllingArea', e.target.value)} /></Field>
                            <Field label="Purchasing org (EKORG)"><input className={inputCls} value={params.purchasingOrg} onChange={e => set('purchasingOrg', e.target.value)} /></Field>
                            <Field label="Maintenance plant (SWERK / WERKS)"><input className={inputCls} value={params.maintenancePlant} onChange={e => set('maintenancePlant', e.target.value)} /></Field>
                            <Field label="Planning plant (IWERK)"><input className={inputCls} value={params.planningPlant} onChange={e => set('planningPlant', e.target.value)} /></Field>
                            <Field label="Planner group (INGRP)"><input className={inputCls} value={params.plannerGroup} onChange={e => set('plannerGroup', e.target.value)} /></Field>
                            <Field label="Equipment numbering" hint="Legacy keeps EQ-NNNNNN as EQUNR; internal leaves it blank">
                                <select className={inputCls} value={params.numbering} onChange={e => set('numbering', e.target.value as SapTargetParams['numbering'])}>
                                    <option value="legacy">Keep IREAMS equipment numbers</option>
                                    <option value="internal">Let SAP assign (internal)</option>
                                </select>
                            </Field>
                            <Field label="FL category (FLTYP)"><input className={inputCls} value={params.flCategory} onChange={e => set('flCategory', e.target.value)} /></Field>
                            <Field label="Structure indicator (TPLKZ)" hint="Must permit your tag format"><input className={inputCls} value={params.structureIndicator} onChange={e => set('structureIndicator', e.target.value)} /></Field>
                            <Field label="Equipment category (EQTYP)"><input className={inputCls} value={params.equipmentCategory} onChange={e => set('equipmentCategory', e.target.value)} /></Field>
                            <Field label="Characteristic prefix (ATNAM)" hint="Create the characteristics in CT04 first"><input className={inputCls} value={params.characteristicPrefix} onChange={e => set('characteristicPrefix', e.target.value)} /></Field>
                            <Field label="MRP type (DISMM)" hint="Used where a reorder point exists; ND otherwise"><input className={inputCls} value={params.mrpType} onChange={e => set('mrpType', e.target.value)} /></Field>
                            <Field label="MRP controller (DISPO)"><input className={inputCls} value={params.mrpController} onChange={e => set('mrpController', e.target.value)} /></Field>
                            <Field label="Purchasing group (EKGRP)"><input className={inputCls} value={params.purchasingGroup} onChange={e => set('purchasingGroup', e.target.value)} /></Field>
                            <Field label="Price control (VPRSV)">
                                <select className={inputCls} value={params.priceControl} onChange={e => set('priceControl', e.target.value as 'S' | 'V')}>
                                    <option value="V">V — moving average (VERPR)</option>
                                    <option value="S">S — standard price (STPRS)</option>
                                </select>
                            </Field>
                            <Field label="BOM usage (STLAN)"><input className={inputCls} value={params.bomUsage} onChange={e => set('bomUsage', e.target.value)} /></Field>
                            <Field label="BOM alternative (STLAL)"><input className={inputCls} value={params.bomAlternative} onChange={e => set('bomAlternative', e.target.value)} /></Field>
                            <Field label="Opening-stock posting date (BUDAT)" hint="DD.MM.YYYY"><input className={inputCls} value={params.postingDate} onChange={e => set('postingDate', e.target.value)} /></Field>
                            <Field label="Source list valid from (VDATU)" hint="DD.MM.YYYY"><input className={inputCls} value={params.sourceListValidFrom} onChange={e => set('sourceListValidFrom', e.target.value)} /></Field>
                        </div>

                        <div>
                            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Material types → material group and valuation class</h4>
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                {BUCKETS.map(b => (
                                    <div key={b.key} className="rounded-xl border border-slate-200 p-3">
                                        <div className="text-sm font-semibold text-slate-700">{b.label} <span className="text-xs text-slate-400 font-normal">→ MTART {b.mtart}</span></div>
                                        <label className="block mt-2 text-[11px] text-slate-500">Material group (MATKL)
                                            <input className={inputCls} value={params.materialGroup[b.key]} onChange={e => set('materialGroup', { ...params.materialGroup, [b.key]: e.target.value })} />
                                        </label>
                                        <label className="block mt-2 text-[11px] text-slate-500">Valuation class (BKLAS)
                                            <input className={inputCls} value={params.valuationClass[b.key]} onChange={e => set('valuationClass', { ...params.valuationClass, [b.key]: e.target.value })} />
                                        </label>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div>
                            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Work orders → order types, notification types and catalog code groups</h4>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <Field label="Corrective order type (AUART)"><input className={inputCls} value={params.orderTypes.corrective} onChange={e => set('orderTypes', { ...params.orderTypes, corrective: e.target.value })} /></Field>
                                <Field label="Preventive order type"><input className={inputCls} value={params.orderTypes.preventive} onChange={e => set('orderTypes', { ...params.orderTypes, preventive: e.target.value })} /></Field>
                                <Field label="Predictive order type"><input className={inputCls} value={params.orderTypes.predictive} onChange={e => set('orderTypes', { ...params.orderTypes, predictive: e.target.value })} /></Field>
                                <Field label="Notification types" hint="corrective / preventive">
                                    <div className="flex gap-2">
                                        <input className={inputCls} value={params.notificationTypes.corrective} onChange={e => set('notificationTypes', { ...params.notificationTypes, corrective: e.target.value })} />
                                        <input className={inputCls} value={params.notificationTypes.preventive} onChange={e => set('notificationTypes', { ...params.notificationTypes, preventive: e.target.value })} />
                                    </div>
                                </Field>
                                <Field label="Damage code group (QPGR)"><input className={inputCls} value={params.codeGroups.damage} onChange={e => set('codeGroups', { ...params.codeGroups, damage: e.target.value })} /></Field>
                                <Field label="Object part code group"><input className={inputCls} value={params.codeGroups.objectPart} onChange={e => set('codeGroups', { ...params.codeGroups, objectPart: e.target.value })} /></Field>
                                <Field label="Cause code group"><input className={inputCls} value={params.codeGroups.cause} onChange={e => set('codeGroups', { ...params.codeGroups, cause: e.target.value })} /></Field>
                                <Field label="Activity code group" hint="Create the catalog codes in QS41 first"><input className={inputCls} value={params.codeGroups.activity} onChange={e => set('codeGroups', { ...params.codeGroups, activity: e.target.value })} /></Field>
                            </div>
                        </div>

                        {source && source.stores.length > 0 && (
                            <div>
                                <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Stores → SAP storage locations (LGORT, 4 characters)</h4>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    {source.stores.map(st => (
                                        <label key={st.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                                            <span className="flex-1 text-sm text-slate-700 truncate">{st.name}</span>
                                            <input
                                                className="w-20 border border-slate-300 rounded-lg px-2 py-1 text-sm text-center uppercase"
                                                maxLength={4}
                                                value={params.storageLocations[st.id] ?? ''}
                                                onChange={e => set('storageLocations', { ...params.storageLocations, [st.id]: e.target.value.toUpperCase() })}
                                            />
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Readiness */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                    <div>
                        <h3 className="font-semibold text-slate-800">Readiness — consultant workbook</h3>
                        {result && <p className="text-xs text-slate-500 mt-0.5">{totalRows.toLocaleString()} rows across {SAP_OBJECTS.filter(o => result.objects[o.key].length > 0).length} sheets</p>}
                    </div>
                    <button onClick={() => void refresh()} disabled={loading} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3 py-2 disabled:opacity-50">
                        {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Re-read the register
                    </button>
                </div>
                {loadError && <p className="text-sm text-rose-700">{loadError}</p>}
                {result && <ReadinessGroups view={readinessView(result.issues, totalRows)} />}
            </div>

            {/* Downloads */}
            <div className="flex items-center gap-2 flex-wrap">
                <button onClick={downloadAll} disabled={!result || totalRows === 0}
                    className="flex items-center gap-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold px-4 py-2.5 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed">
                    <Download size={15} /> Download the full SAP load workbook
                </button>
                <button onClick={downloadBlank} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-sm font-medium px-3 py-2.5">
                    <FileSpreadsheet size={15} /> Blank templates with examples
                </button>
                {errors.length > 0 && <span className="text-xs text-rose-700">Errors listed above will be in the Readiness sheet — fix them, or accept them knowingly.</span>}
            </div>

            {/* Objects, in load order */}
            <div className="space-y-3">
                {SAP_OBJECTS.map(o => {
                    const n = result?.objects[o.key].length ?? 0;
                    const skipped = result?.skipped[o.key] ?? 0;
                    const mine = result?.issues.filter(i => i.object === o.key) ?? [];
                    const hasError = mine.some(i => i.level === 'error');
                    return (
                        <div key={o.key} className={`rounded-2xl border bg-white p-5 ${n > 0 && !hasError ? 'border-emerald-200' : 'border-slate-200'}`}>
                            <div className="flex items-start gap-4">
                                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-bold text-sm border
                                    ${hasError ? 'bg-rose-50 text-rose-600 border-rose-200' : n > 0 ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>
                                    {o.order}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h3 className="font-semibold text-slate-800">{o.label}</h3>
                                        <span className="text-[10px] text-slate-400 font-mono">{o.sheet}</span>
                                        {o.kind === 'handover' && (
                                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-500" title="A reference extract in SAP field names. It is not a Migration Cockpit object and is not loaded.">
                                                Reference extract — not loaded
                                            </span>
                                        )}
                                        {result && (
                                            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${n > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                                                {n > 0 ? `${n.toLocaleString()} rows` : 'Nothing to load'}
                                            </span>
                                        )}
                                        {skipped > 0 && <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">{skipped} skipped</span>}
                                    </div>
                                    <p className="text-sm text-slate-500 mt-1">{o.hint}</p>
                                    <p className="text-xs text-slate-400 mt-1.5 font-mono truncate" title={o.fields.map(f => f.name).join(' · ')}>
                                        {o.fields.map(f => f.name).join(' · ')}
                                    </p>
                                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                                        <button onClick={() => downloadOne(o.key)} disabled={!result || n === 0}
                                            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed">
                                            <Download size={13} /> Download this sheet
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
                <h3 className="font-semibold text-slate-800 mb-1">Work orders: what moves and what stays</h3>
                <p>
                    Open work{result ? ` (${result.objects.openNotification.length.toLocaleString()} order${result.objects.openNotification.length === 1 ? '' : 's'})` : ''} goes to SAP as
                    maintenance notifications on sheet 10, using the standard <em>PM - Maintenance notification</em> object, so the backlog is owned by SAP from day one.
                    Closed and cancelled orders{result ? ` (${result.objects.orderHistory.length.toLocaleString()})` : ''} are handed over on sheet 9 as a reference extract in SAP field names.
                    They are not loaded: S/4HANA's Maintenance order object carries estimated cost and settlement rules only, and recreating closed orders with actual cost
                    distorts cost and status reporting. The reliability history, and everything computed from it, stays in IREAMS.
                </p>
            </div>
            </div>
            </details>
        </div>
    );
};

export default SapLoadCenterPage;
