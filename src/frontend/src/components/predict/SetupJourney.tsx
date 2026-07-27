/**
 * SetupJourney — the Predict front page for first-timers.
 *
 * When no equipment has any condition data yet, this journey IS the page:
 * every click performs a real setup action (register-first — assets created
 * here go through the same DatabaseService path as the Assets page, imports
 * go through the same BulkImportModal as the register). Progress is derived
 * from the database, so the journey resumes where any teammate left off.
 *
 * Steps: 1 Equipment (upload register / pick / quick-add) → 2 Measurements
 * (class templates → real reading_definitions with alarm bands) → 3 Data
 * source (hand-log now / CSV import / live feed — honestly labelled) →
 * 4 First reading lands → auto twin snapshot → dashboard.
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
    Upload, Search, Plus, ChevronLeft, ChevronRight, CheckCircle2, Circle,
    Gauge, PencilLine, FileSpreadsheet, Radio, Loader2, Sparkles, Trash2,
    ClipboardCopy, Wrench, ArrowRight, HeartPulse
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import BulkImportModal from '../../eam/components/modals/BulkImportModal';
import { importAssets } from '../../eam/services/bulkImportService';
import { ImportReadingsModal } from '../connectors/ImportReadingsModal';
import { DatabaseService } from '../../eam/services/DatabaseService';
import predictionService from '../../eam/services/PredictionService';
import { useAssetContext } from '../../contexts/AssetContext';
import { useAuth } from '../../eam/contexts/AuthContext';
import { useToast } from '../../eam/contexts/ToastContext';
import { evaluateReading } from '../../lib/readingAlarm';
import { resolveMachineClass, vibrationBands, ISO20816_ZONES } from '../../lib/predict/limitLibrary';
import type { Asset } from '../../eam/types';

// ─────────────────────────────────────────────────────────
//  Measurement-point templates by equipment class — plain
//  language, sensible units, editable alarm bands.
// ─────────────────────────────────────────────────────────

interface PointDraft {
    name: string;
    unit: string;
    category: 'CONDITION' | 'METER';
    /** "Alert below" — maps to minCritical (blank = no low alarm) */
    low: string;
    /** "Warn above" — maps to maxWarning (blank = no warning band) */
    highWarn: string;
    /** "Alert above" — maps to maxCritical (blank = no high alarm) */
    high: string;
    /** band provenance — 'iso20816' rows are (re)resolved from the machine class */
    source?: string;
}

// Vibration rows carry source 'iso20816' with EMPTY values — applyTemplate
// resolves them from the chosen ISO 20816-3 machine class (size × mounting).
// A single universal number here would be wrong: the old blanket 7.1 mm/s is
// the LARGE-machine boundary, ~60% above what a medium machine should alarm at.
const TEMPLATES: { key: string; label: string; hint: string; points: PointDraft[] }[] = [
    {
        key: 'pump', label: 'Pump', hint: 'vibration · pressure · temperature',
        points: [
            { name: 'Bearing Vibration', unit: 'mm/s', category: 'CONDITION', low: '', highWarn: '', high: '', source: 'iso20816' },
            { name: 'Discharge Pressure', unit: 'bar', category: 'CONDITION', low: '', highWarn: '', high: '' },
            { name: 'Bearing Temperature', unit: '°C', category: 'CONDITION', low: '', highWarn: '80', high: '95', source: 'template' },
        ],
    },
    {
        key: 'motor', label: 'Motor', hint: 'winding temp · vibration · current',
        points: [
            { name: 'Winding Temperature', unit: '°C', category: 'CONDITION', low: '', highWarn: '95', high: '120', source: 'template' },
            { name: 'Vibration', unit: 'mm/s', category: 'CONDITION', low: '', highWarn: '', high: '', source: 'iso20816' },
            { name: 'Running Current', unit: 'A', category: 'CONDITION', low: '', highWarn: '', high: '' },
        ],
    },
    {
        key: 'vehicle', label: 'Truck / Vehicle', hint: 'engine temps · hours · odometer',
        points: [
            { name: 'Engine Oil Temperature', unit: '°C', category: 'CONDITION', low: '', highWarn: '105', high: '115', source: 'template' },
            { name: 'Coolant Temperature', unit: '°C', category: 'CONDITION', low: '', highWarn: '100', high: '108', source: 'template' },
            { name: 'Engine Hours', unit: 'h', category: 'METER', low: '', highWarn: '', high: '' },
            { name: 'Odometer', unit: 'km', category: 'METER', low: '', highWarn: '', high: '' },
        ],
    },
    {
        key: 'compressor', label: 'Compressor', hint: 'pressures · discharge temp · vibration',
        points: [
            { name: 'Suction Pressure', unit: 'bar', category: 'CONDITION', low: '', highWarn: '', high: '' },
            { name: 'Discharge Temperature', unit: '°C', category: 'CONDITION', low: '', highWarn: '120', high: '135', source: 'template' },
            { name: 'Vibration', unit: 'mm/s', category: 'CONDITION', low: '', highWarn: '', high: '', source: 'iso20816' },
        ],
    },
    {
        // Static equipment (Phase 2.4): integrity-led — wall thickness drives the
        // API 570 corrosion-rate / remaining-life math on the Digital Twin tab.
        // "Alert below" on Wall Thickness = minimum required thickness (t-min).
        key: 'exchanger', label: 'Heat exchanger / cooler', hint: 'wall thickness · in/out temps · ΔP',
        points: [
            { name: 'Wall Thickness', unit: 'mm', category: 'CONDITION', low: '', highWarn: '', high: '' },
            { name: 'Process Inlet Temperature', unit: '°C', category: 'CONDITION', low: '', highWarn: '', high: '' },
            { name: 'Process Outlet Temperature', unit: '°C', category: 'CONDITION', low: '', highWarn: '', high: '' },
            { name: 'Differential Pressure', unit: 'bar', category: 'CONDITION', low: '', highWarn: '', high: '' },
        ],
    },
    {
        key: 'vessel', label: 'Vessel / tank / piping', hint: 'wall thickness · pressure · temperature',
        points: [
            { name: 'Wall Thickness', unit: 'mm', category: 'CONDITION', low: '', highWarn: '', high: '' },
            { name: 'Operating Pressure', unit: 'bar', category: 'CONDITION', low: '', highWarn: '', high: '' },
            { name: 'Temperature', unit: '°C', category: 'CONDITION', low: '', highWarn: '', high: '' },
        ],
    },
    {
        key: 'generic', label: 'Other equipment', hint: 'temperature · vibration · pressure',
        points: [
            { name: 'Temperature', unit: '°C', category: 'CONDITION', low: '', highWarn: '', high: '' },
            { name: 'Vibration', unit: 'mm/s', category: 'CONDITION', low: '', highWarn: '', high: '', source: 'iso20816' },
            { name: 'Pressure', unit: 'bar', category: 'CONDITION', low: '', highWarn: '', high: '' },
        ],
    },
];

const MAINTAINABLE = new Set(['equipment', 'subunit', 'component']);

const STEP_LABELS = ['Equipment', 'Measurements', 'Data source', 'First reading'];

// The copy-paste brief for the live-feed route — honest about what exists.
const IT_BRIEF = `Request: connect our plant sensor data to IRAMS (Predict module)

What we need today (works now):
- A recurring CSV export from the historian/SCADA with columns:
  asset, tag, value, unit, timestamp, alarm_high, alarm_low
- We upload it in IRAMS → Predict → Setup guide → "Upload from my existing system"

What we want next (needs IT/vendor setup):
- A live feed (REST push or MQTT) into IRAMS' sensor ingestion
- Contact the IRAMS administrator to schedule this — streaming
  connectors are on the roadmap and not yet live in this deployment.`;

interface SetupJourneyProps {
    /** Exit the journey; when an asset id is passed, the dashboard focuses it. */
    onExit: (focusAssetId?: string) => void;
    /** Enter with an asset already chosen (per-asset setup from the dashboard). */
    initialAssetId?: string;
}

export const SetupJourney: React.FC<SetupJourneyProps> = ({ onExit, initialAssetId }) => {
    const navigate = useNavigate();
    const { showToast } = useToast();
    const { profile } = useAuth();
    const { assets: registerAssets, refresh: refreshAssets, loading: registerLoading } = useAssetContext();

    const [step, setStep] = useState(initialAssetId ? 2 : 1);
    const [assetId, setAssetId] = useState(initialAssetId || '');

    // Step 1 sub-view: choose intake path
    const [intake, setIntake] = useState<'choose' | 'pick' | 'add'>('choose');
    const [pickSearch, setPickSearch] = useState('');
    const [uploadOpen, setUploadOpen] = useState(false);
    const [quickAdd, setQuickAdd] = useState({ name: '', tag: '', criticality: 'B' });
    const [saving, setSaving] = useState(false);

    // Step 2: measurement points
    const [templateKey, setTemplateKey] = useState<string | null>(null);
    const [drafts, setDrafts] = useState<PointDraft[]>([]);
    const [existingPoints, setExistingPoints] = useState<any[]>([]);
    const [pointsLoading, setPointsLoading] = useState(false);
    // ISO 20816-3 machine classification for vibration limits (1.5.1):
    // two plain questions resolve the group instead of a wrong universal number.
    const [over300kW, setOver300kW] = useState(false);
    const [flexMount, setFlexMount] = useState(false);
    const machineClass = resolveMachineClass(over300kW, flexMount);

    // Step 3: data route
    const [route, setRoute] = useState<'manual' | 'csv' | 'live' | null>(null);
    const [firstValues, setFirstValues] = useState<Record<string, string>>({});
    const [csvOpen, setCsvOpen] = useState(false);
    const [briefCopied, setBriefCopied] = useState(false);

    // Step 4: verify
    const [snapshotState, setSnapshotState] = useState<'running' | 'done' | 'failed' | null>(null);
    const [snapshotHealth, setSnapshotHealth] = useState<number | null>(null);
    const [snapshotMsg, setSnapshotMsg] = useState('');

    const maintainable = useMemo(
        () => registerAssets.filter(a => MAINTAINABLE.has((a.taxonomy_level || '').toLowerCase())),
        [registerAssets],
    );
    const chosen = registerAssets.find(a => a.id === assetId) || null;

    // Guard the EXTERNALLY-supplied asset id only: the dashboard's lookup falls
    // back to demo assets when the register is empty, and a demo id can't take
    // measurement points (foreign key). Ids chosen inside the journey come from
    // the register itself and are always valid.
    useEffect(() => {
        if (!assetId || assetId !== initialAssetId || registerLoading) return;
        if (!registerAssets.some(a => a.id === assetId)) {
            setAssetId('');
            setStep(1);
        }
    }, [assetId, initialAssetId, registerAssets, registerLoading]);

    const picked = useMemo(() => {
        const q = pickSearch.trim().toLowerCase();
        return maintainable
            .filter(a => !q || a.name.toLowerCase().includes(q) || (a.tag || '').toLowerCase().includes(q))
            .slice(0, 12);
    }, [maintainable, pickSearch]);

    // Load existing measurement points whenever the chosen asset changes.
    useEffect(() => {
        if (!assetId) { setExistingPoints([]); return; }
        let active = true;
        setPointsLoading(true);
        DatabaseService.getInstance().getReadingDefinitions(assetId)
            .then(defs => { if (active) setExistingPoints((defs || []).filter((d: any) => d.isActive !== false)); })
            .catch(() => { if (active) setExistingPoints([]); })
            .finally(() => { if (active) setPointsLoading(false); });
        return () => { active = false; };
    }, [assetId]);

    // ── Step 1 actions ────────────────────────────────────

    const handleQuickAdd = async () => {
        if (!quickAdd.name.trim()) { showToast('Give the machine a name first.', 'warning'); return; }
        setSaving(true);
        try {
            const created = await DatabaseService.getInstance().addAsset({
                id: `new-${Date.now()}`,
                name: quickAdd.name.trim(),
                tag: quickAdd.tag.trim(), // blank → DB auto-generates
                criticality: quickAdd.criticality,
                status: 'ACTIVE',
                hierarchyLevel: 'EQUIPMENT',
            });
            await refreshAssets();
            setAssetId(created.id);
            showToast(`${quickAdd.name.trim()} added to your asset register.`, 'success');
            setStep(2);
        } catch (e: any) {
            showToast('Could not add equipment: ' + (e?.message || 'unknown error'), 'error');
        } finally { setSaving(false); }
    };

    const handleImportAssets = async (rows: Record<string, string>[]) => {
        // Same hierarchy-aware engine the Asset Register uses — Predict's setup
        // must not produce a flatter register than the main import path.
        const result = await importAssets(rows);
        await refreshAssets();
        const { inserted: ok, failed: fail } = result;
        if (ok > 0) showToast(`${ok} asset${ok > 1 ? 's' : ''} imported into your register${fail ? ` (${fail} failed)` : ''}.`, fail ? 'warning' : 'success');
        else if (fail > 0) showToast(`Import failed for ${fail} row${fail > 1 ? 's' : ''} — check the failure list.`, 'error');
        return result;
    };

    // ── Step 2 actions ────────────────────────────────────

    // Resolve an 'iso20816'-sourced draft's bands from the current machine class.
    const resolveIsoDraft = (p: PointDraft): PointDraft => {
        if (p.source !== 'iso20816' && !p.source?.startsWith('iso20816-')) return p;
        const b = vibrationBands(machineClass);
        return { ...p, highWarn: String(b.maxWarning), high: String(b.maxCritical), source: b.source };
    };

    const applyTemplate = (key: string) => {
        const t = TEMPLATES.find(x => x.key === key);
        if (!t) return;
        setTemplateKey(key);
        setDrafts(t.points.map(p => resolveIsoDraft({ ...p })));
    };

    // Machine-class change re-resolves ISO-sourced vibration drafts in place
    // (names/units the user edited are preserved — only the cited bands move).
    useEffect(() => {
        setDrafts(prev => prev.some(d => d.source?.startsWith('iso20816'))
            ? prev.map(resolveIsoDraft)
            : prev);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [machineClass]);

    const updateDraft = (i: number, patch: Partial<PointDraft>) =>
        setDrafts(prev => prev.map((d, j) => {
            if (j !== i) return d;
            // Hand-editing a band voids its citation — provenance becomes manual.
            const touchesBands = 'low' in patch || 'highWarn' in patch || 'high' in patch;
            return { ...d, ...patch, ...(touchesBands && d.source ? { source: 'manual' } : {}) };
        }));

    const createPoints = async () => {
        const valid = drafts.filter(d => d.name.trim());
        if (valid.length === 0) { showToast('Add at least one measurement.', 'warning'); return; }
        setSaving(true);
        let created = 0;
        const createdDefs: any[] = [];
        for (const d of valid) {
            try {
                const slug = d.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'READING';
                const def = await DatabaseService.getInstance().addReadingDefinition({
                    assetId,
                    readingTypeCode: `${slug}_${Date.now().toString(36).toUpperCase()}${created}`,
                    name: d.name.trim(),
                    unit: d.unit.trim() || '—',
                    category: d.category,
                    minCritical: d.low.trim() === '' ? null : Number(d.low),
                    maxCritical: d.high.trim() === '' ? null : Number(d.high),
                    minWarning: null,
                    maxWarning: d.highWarn.trim() === '' ? null : Number(d.highWarn),
                    // Provenance: cited source from the template/ISO resolution,
                    // 'manual' when the user typed bands with no citation.
                    limitSource: d.source ?? ((d.low.trim() || d.highWarn.trim() || d.high.trim()) ? 'manual' : null),
                    active: true,
                });
                createdDefs.push(def);
                created++;
            } catch (e: any) {
                showToast(`Could not create "${d.name}": ${e?.message || 'unknown error'}`, 'error');
            }
        }
        setSaving(false);
        if (created > 0) {
            setExistingPoints(prev => [...prev, ...createdDefs]);
            setDrafts([]);
            setTemplateKey(null);
            showToast(`${created} measurement point${created > 1 ? 's' : ''} created.`, 'success');
            setStep(3);
        }
    };

    // ── Step 3 actions ────────────────────────────────────

    const saveFirstReadings = async () => {
        const entries = existingPoints
            .map(def => ({ def, raw: firstValues[def.id] }))
            .filter(e => e.raw !== undefined && e.raw.trim() !== '' && !Number.isNaN(Number(e.raw)));
        if (entries.length === 0) { showToast('Type at least one reading value first.', 'warning'); return; }
        setSaving(true);
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toTimeString().slice(0, 5);
        let ok = 0;
        for (const { def, raw } of entries) {
            try {
                const value = Number(raw);
                const alarm = evaluateReading(value, def);
                await DatabaseService.getInstance().logReading({
                    definitionId: def.id,
                    assetId,
                    readingTypeCode: def.readingTypeCode,
                    date: dateStr,
                    time: def.category === 'METER' ? '00:00' : timeStr,
                    value,
                    enteredBy: profile?.username || profile?.fullName || 'setup-guide',
                    isAlarm: alarm.level !== 'OK',
                });
                ok++;
            } catch (e: any) {
                showToast(`Could not save ${def.name}: ${e?.message || 'unknown error'}`, 'error');
            }
        }
        setSaving(false);
        if (ok > 0) {
            showToast(`${ok} reading${ok > 1 ? 's' : ''} saved — computing first health snapshot…`, 'success');
            goVerify();
        }
    };

    const copyBrief = async () => {
        try {
            await navigator.clipboard.writeText(IT_BRIEF);
            setBriefCopied(true);
            setTimeout(() => setBriefCopied(false), 2500);
        } catch { showToast('Could not copy — select and copy the text manually.', 'warning'); }
    };

    // Esc leaves the guide — unless a modal is open (those own Esc themselves).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !uploadOpen && !csvOpen) onExit();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [uploadOpen, csvOpen, onExit]);

    // ── Step 4: auto twin snapshot ────────────────────────
    // Fired from the event handlers (save / CSV import), NOT an effect — an
    // effect keyed on the state it sets cancels its own async completion.

    const goVerify = () => {
        setStep(4);
        setSnapshotState('running');
        (async () => {
            const res = await predictionService.runPrediction(
                'digital_twin', assetId, 'First health snapshot', 'Created by the Predict setup guide',
            );
            if (res.success) {
                try {
                    const twin = await predictionService.getTwinState(assetId);
                    setSnapshotHealth(twin ? Number(twin.health_index) : null);
                } catch { /* health stays null; still a success */ }
                setSnapshotState('done');
            } else {
                setSnapshotMsg(res.message);
                setSnapshotState('failed');
            }
        })();
    };

    // ─────────────────────────────────────────────────────
    //  Render
    // ─────────────────────────────────────────────────────

    const stepDone = (n: number) =>
        (n === 1 && !!assetId) ||
        (n === 2 && existingPoints.length > 0) ||
        (n === 3 && route !== null && step > 3) ||
        (n === 4 && snapshotState === 'done');

    return (
        <div className="max-w-3xl mx-auto animate-in fade-in duration-300">
            {/* Escape hatch — always visible, top-left (Esc works too) */}
            <button
                onClick={() => onExit()}
                className="flex items-center gap-1.5 mb-4 px-3 py-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800 bg-white border border-slate-200 hover:border-slate-300 rounded-lg transition-colors"
                title="Leave the guide (Esc)"
            >
                <ChevronLeft size={15} /> Back to Predict
            </button>

            {/* Welcome header */}
            <div className="text-center mb-8">
                <div className="inline-flex p-3 bg-primary-50 border border-primary-100 rounded-2xl text-primary-600 mb-3">
                    <HeartPulse size={28} />
                </div>
                <h1 className="text-2xl font-bold text-slate-800">Set up equipment health monitoring</h1>
                <p className="text-sm text-slate-500 mt-1.5 max-w-lg mx-auto">
                    Four short steps. Everything you do here is real setup — the equipment goes into your
                    asset register, and your first reading turns into a live health index.
                </p>
            </div>

            {/* Stepper */}
            <div className="flex items-center justify-center gap-1 sm:gap-2 mb-8">
                {STEP_LABELS.map((label, i) => {
                    const n = i + 1;
                    const isActive = step === n;
                    const isDone = stepDone(n) && step > n;
                    return (
                        <React.Fragment key={label}>
                            {i > 0 && <div className={`h-0.5 w-6 sm:w-10 rounded ${step > i ? 'bg-primary-400' : 'bg-slate-200'}`} />}
                            <button
                                onClick={() => { if (n < step) setStep(n); }}
                                disabled={n > step}
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-semibold transition-all ${isActive ? 'bg-primary-600 text-white shadow-sm' : isDone ? 'bg-primary-50 text-primary-700 hover:bg-primary-100' : 'bg-slate-100 text-slate-400'}`}
                            >
                                {isDone ? <CheckCircle2 size={14} /> : <Circle size={14} className={isActive ? 'opacity-80' : 'opacity-40'} />}
                                <span className="hidden sm:inline">{label}</span>
                                <span className="sm:hidden">{n}</span>
                            </button>
                        </React.Fragment>
                    );
                })}
            </div>

            {/* ═══ STEP 1: EQUIPMENT ═══ */}
            {step === 1 && (
                <div className="space-y-4">
                    {intake === 'choose' && (
                        <>
                            <p className="text-sm font-semibold text-slate-700 text-center">Which equipment do you want to watch?</p>
                            <div className="grid sm:grid-cols-3 gap-3">
                                <button onClick={() => setUploadOpen(true)}
                                    className="group bg-white border-2 border-primary-200 rounded-xl p-5 text-left hover:border-primary-400 hover:shadow-md transition-all">
                                    <div className="p-2.5 bg-primary-50 rounded-lg text-primary-600 w-fit mb-3 group-hover:bg-primary-100 transition-colors"><Upload size={20} /></div>
                                    <p className="text-sm font-bold text-slate-800">Upload your equipment list</p>
                                    <p className="text-xs text-slate-500 mt-1">Have it in Excel or a CMMS export? Import it once — everything in IRAMS builds on it.</p>
                                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-primary-600 mt-2">Recommended <ArrowRight size={11} /></span>
                                </button>
                                <button onClick={() => setIntake('pick')}
                                    className="group bg-white border border-slate-200 rounded-xl p-5 text-left hover:border-slate-300 hover:shadow-md transition-all">
                                    <div className="p-2.5 bg-slate-50 rounded-lg text-slate-500 w-fit mb-3"><Search size={20} /></div>
                                    <p className="text-sm font-bold text-slate-800">Pick from your register</p>
                                    <p className="text-xs text-slate-500 mt-1">{maintainable.length > 0 ? `${maintainable.length} maintainable item${maintainable.length > 1 ? 's' : ''} already registered.` : 'Your register is empty so far.'}</p>
                                </button>
                                <button onClick={() => setIntake('add')}
                                    className="group bg-white border border-slate-200 rounded-xl p-5 text-left hover:border-slate-300 hover:shadow-md transition-all">
                                    <div className="p-2.5 bg-slate-50 rounded-lg text-slate-500 w-fit mb-3"><Plus size={20} /></div>
                                    <p className="text-sm font-bold text-slate-800">Add one machine</p>
                                    <p className="text-xs text-slate-500 mt-1">Just trying it out? Add a single machine now, complete the details later.</p>
                                </button>
                            </div>
                        </>
                    )}

                    {intake === 'pick' && (
                        <div className="bg-white border border-slate-200 rounded-xl p-5">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-sm font-semibold text-slate-700">Pick the equipment to start with</p>
                                <button onClick={() => setIntake('choose')} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"><ChevronLeft size={13} /> Back</button>
                            </div>
                            <div className="relative mb-3">
                                <Search className="absolute left-3 top-2.5 text-slate-400" size={15} />
                                <input value={pickSearch} onChange={e => setPickSearch(e.target.value)} placeholder="Search by name or tag…"
                                    className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm" autoFocus />
                            </div>
                            {picked.length === 0 ? (
                                <div className="text-center py-6 text-sm text-slate-400">
                                    {maintainable.length === 0 ? (
                                        <>Nothing in the register yet — <button onClick={() => setUploadOpen(true)} className="text-primary-600 font-semibold hover:underline">upload your list</button> or <button onClick={() => setIntake('add')} className="text-primary-600 font-semibold hover:underline">add one machine</button>.</>
                                    ) : 'No match — try a different search.'}
                                </div>
                            ) : (
                                <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                                    {picked.map(a => (
                                        <button key={a.id} onClick={() => { setAssetId(a.id); setStep(2); }}
                                            className="w-full flex items-center gap-3 px-2 py-2.5 text-left hover:bg-slate-50 rounded-lg transition">
                                            <Wrench size={15} className="text-slate-300 shrink-0" />
                                            <span className="flex-1 min-w-0">
                                                <span className="block text-sm font-semibold text-slate-800 truncate">{a.tag ? `${a.tag} — ` : ''}{a.name}</span>
                                                <span className="block text-[11px] text-slate-400 truncate">{a.system || a.site || ''}</span>
                                            </span>
                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${a.criticality === 'A' ? 'bg-red-50 text-red-600 border-red-200' : a.criticality === 'B' ? 'bg-amber-50 text-amber-600 border-amber-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>{a.criticality || 'C'}</span>
                                            <ChevronRight size={15} className="text-slate-300" />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {intake === 'add' && (
                        <div className="bg-white border border-slate-200 rounded-xl p-5 max-w-md mx-auto">
                            <div className="flex items-center justify-between mb-4">
                                <p className="text-sm font-semibold text-slate-700">Add one machine</p>
                                <button onClick={() => setIntake('choose')} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"><ChevronLeft size={13} /> Back</button>
                            </div>
                            <label className="block text-xs font-semibold text-slate-500 mb-1">What is it called? *</label>
                            <input value={quickAdd.name} onChange={e => setQuickAdd(q => ({ ...q, name: e.target.value }))}
                                placeholder="e.g. 789 CAT Truck 002, Feed Pump A"
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-3" autoFocus />
                            <label className="block text-xs font-semibold text-slate-500 mb-1">Tag / number <span className="font-normal text-slate-400">(optional — we generate one if blank)</span></label>
                            <input value={quickAdd.tag} onChange={e => setQuickAdd(q => ({ ...q, tag: e.target.value }))}
                                placeholder="e.g. TRK-002" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-3" />
                            <label className="block text-xs font-semibold text-slate-500 mb-1.5">If it fails, how bad is it?</label>
                            <div className="space-y-1.5 mb-4">
                                {[
                                    { v: 'A', l: 'Critical', d: 'Stops production or creates a safety risk' },
                                    { v: 'B', l: 'Important', d: 'Hurts output, but we can work around it for a while' },
                                    { v: 'C', l: 'Low impact', d: 'Inconvenient — fix when convenient' },
                                ].map(o => (
                                    <button key={o.v} onClick={() => setQuickAdd(q => ({ ...q, criticality: o.v }))}
                                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition ${quickAdd.criticality === o.v ? 'border-primary-400 bg-primary-50' : 'border-slate-200 hover:border-slate-300'}`}>
                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${o.v === 'A' ? 'bg-red-50 text-red-600 border-red-200' : o.v === 'B' ? 'bg-amber-50 text-amber-600 border-amber-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>{o.v}</span>
                                        <span className="min-w-0"><span className="block text-sm font-semibold text-slate-700">{o.l}</span><span className="block text-[11px] text-slate-400">{o.d}</span></span>
                                    </button>
                                ))}
                            </div>
                            <button onClick={handleQuickAdd} disabled={saving || !quickAdd.name.trim()}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors">
                                {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Add to register & continue
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* ═══ STEP 2: MEASUREMENTS ═══ */}
            {step === 2 && (
                <div className="space-y-4">
                    <div className="text-center">
                        <p className="text-sm font-semibold text-slate-700">What do you measure on {chosen ? chosen.name : 'this equipment'}?</p>
                        <p className="text-xs text-slate-400 mt-0.5">Pick a template — you can rename anything and adjust the alert levels.</p>
                    </div>

                    {existingPoints.length > 0 && (
                        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                            <p className="text-xs text-emerald-800">
                                <CheckCircle2 size={13} className="inline mr-1 -mt-0.5" />
                                {existingPoints.length} measurement point{existingPoints.length > 1 ? 's' : ''} already set up: {existingPoints.slice(0, 3).map((d: any) => d.name).join(', ')}{existingPoints.length > 3 ? '…' : ''}
                            </p>
                            <button onClick={() => setStep(3)} className="text-xs font-bold text-emerald-700 hover:underline whitespace-nowrap">Use these →</button>
                        </div>
                    )}

                    <div className="flex flex-wrap justify-center gap-2">
                        {TEMPLATES.map(t => (
                            <button key={t.key} onClick={() => applyTemplate(t.key)}
                                className={`px-3.5 py-2 rounded-lg border text-left transition ${templateKey === t.key ? 'border-primary-400 bg-primary-50' : 'bg-white border-slate-200 hover:border-slate-300'}`}>
                                <span className="block text-sm font-semibold text-slate-700">{t.label}</span>
                                <span className="block text-[10px] text-slate-400">{t.hint}</span>
                            </button>
                        ))}
                    </div>

                    {/* ISO 20816-3 machine class — two plain questions set the vibration limits */}
                    <div className="flex flex-wrap items-center justify-center gap-3 text-xs">
                        <span className="text-slate-400">Vibration limits:</span>
                        <div className="flex border border-slate-200 rounded-lg overflow-hidden">
                            <button onClick={() => setOver300kW(false)} className={`px-2.5 py-1.5 font-semibold transition ${!over300kW ? 'bg-primary-50 text-primary-700' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>≤ 300 kW</button>
                            <button onClick={() => setOver300kW(true)} className={`px-2.5 py-1.5 font-semibold transition ${over300kW ? 'bg-primary-50 text-primary-700' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>&gt; 300 kW</button>
                        </div>
                        <div className="flex border border-slate-200 rounded-lg overflow-hidden">
                            <button onClick={() => setFlexMount(false)} className={`px-2.5 py-1.5 font-semibold transition ${!flexMount ? 'bg-primary-50 text-primary-700' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>Rigid mount</button>
                            <button onClick={() => setFlexMount(true)} className={`px-2.5 py-1.5 font-semibold transition ${flexMount ? 'bg-primary-50 text-primary-700' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>Flexible mount</button>
                        </div>
                        <span className="text-[10px] text-slate-400">
                            → warn {vibrationBands(machineClass).maxWarning} · critical {vibrationBands(machineClass).maxCritical} mm/s
                        </span>
                    </div>

                    {drafts.length > 0 && (
                        <div className="bg-white border border-slate-200 rounded-xl p-4">
                            <div className="grid grid-cols-[1fr_60px_78px_78px_78px_28px] gap-2 items-center text-[10px] font-bold text-slate-400 uppercase tracking-wide px-1 mb-1.5">
                                <span>Measurement</span><span>Unit</span><span>Alert below</span><span className="text-amber-500">Warn above</span><span className="text-red-400">Alert above</span><span />
                            </div>
                            {drafts.map((d, i) => (
                                <div key={i} className="grid grid-cols-[1fr_60px_78px_78px_78px_28px] gap-2 items-center mb-1.5">
                                    <input value={d.name} onChange={e => updateDraft(i, { name: e.target.value })} className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm" />
                                    <input value={d.unit} onChange={e => updateDraft(i, { unit: e.target.value })} className="px-2 py-1.5 border border-slate-200 rounded-lg text-sm" />
                                    <input value={d.low} onChange={e => updateDraft(i, { low: e.target.value })} placeholder="—" inputMode="decimal" className="px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-center" />
                                    <input value={d.highWarn} onChange={e => updateDraft(i, { highWarn: e.target.value })} placeholder="—" inputMode="decimal" className="px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-center" />
                                    <input value={d.high} onChange={e => updateDraft(i, { high: e.target.value })} placeholder="—" inputMode="decimal" className="px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-center" />
                                    <button onClick={() => setDrafts(prev => prev.filter((_, j) => j !== i))} className="text-slate-300 hover:text-red-400 transition"><Trash2 size={14} /></button>
                                </div>
                            ))}
                            {drafts.some(d => d.source?.startsWith('iso20816')) && (
                                <p className="text-[10px] text-slate-400 mt-1 px-1">
                                    Vibration bands: {ISO20816_ZONES[machineClass].describe} — warn at zone B/C, critical at C/D. Editing a value marks it manual.
                                </p>
                            )}
                            <div className="flex items-center justify-between mt-3">
                                <button onClick={() => setDrafts(prev => [...prev, { name: '', unit: '', category: 'CONDITION', low: '', highWarn: '', high: '' }])}
                                    className="text-xs font-semibold text-primary-600 hover:underline flex items-center gap-1"><Plus size={13} /> Add another</button>
                                <button onClick={createPoints} disabled={saving}
                                    className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors">
                                    {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Create measurement points
                                </button>
                            </div>
                        </div>
                    )}

                    {pointsLoading && <p className="text-center text-xs text-slate-400"><Loader2 size={13} className="inline animate-spin mr-1" /> Checking this equipment…</p>}

                    <div className="text-center">
                        <button onClick={() => { setStep(1); setIntake('choose'); }} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 mx-auto"><ChevronLeft size={13} /> Choose different equipment</button>
                    </div>
                </div>
            )}

            {/* ═══ STEP 3: DATA SOURCE ═══ */}
            {step === 3 && (
                <div className="space-y-4">
                    <div className="text-center">
                        <p className="text-sm font-semibold text-slate-700">How will readings arrive?</p>
                        <p className="text-xs text-slate-400 mt-0.5">Start simple — you can add a better source any time.</p>
                    </div>
                    <div className="grid sm:grid-cols-3 gap-3">
                        <button onClick={() => setRoute('manual')}
                            className={`bg-white border rounded-xl p-4 text-left transition-all ${route === 'manual' ? 'border-primary-400 ring-2 ring-primary-100' : 'border-slate-200 hover:border-slate-300'}`}>
                            <div className="p-2 bg-slate-50 rounded-lg text-slate-500 w-fit mb-2"><PencilLine size={18} /></div>
                            <p className="text-sm font-bold text-slate-800">I'll log them by hand</p>
                            <p className="text-[11px] text-slate-500 mt-1">Works right now — type your first readings below.</p>
                        </button>
                        <button onClick={() => { setRoute('csv'); setCsvOpen(true); }}
                            className={`bg-white border rounded-xl p-4 text-left transition-all ${route === 'csv' ? 'border-primary-400 ring-2 ring-primary-100' : 'border-slate-200 hover:border-slate-300'}`}>
                            <div className="p-2 bg-slate-50 rounded-lg text-slate-500 w-fit mb-2"><FileSpreadsheet size={18} /></div>
                            <p className="text-sm font-bold text-slate-800">Upload from my existing system</p>
                            <p className="text-[11px] text-slate-500 mt-1">Historian / SCADA / Excel export — CSV upload, works right now.</p>
                        </button>
                        <button onClick={() => setRoute('live')}
                            className={`bg-white border rounded-xl p-4 text-left transition-all ${route === 'live' ? 'border-primary-400 ring-2 ring-primary-100' : 'border-slate-200 hover:border-slate-300'}`}>
                            <div className="p-2 bg-slate-50 rounded-lg text-slate-500 w-fit mb-2"><Radio size={18} /></div>
                            <p className="text-sm font-bold text-slate-800">Automatic live feed</p>
                            <p className="text-[11px] text-slate-500 mt-1">Needs IT setup — we'll give you exactly what to ask for.</p>
                        </button>
                    </div>

                    {route === 'manual' && (
                        <div className="bg-white border border-slate-200 rounded-xl p-4">
                            <p className="text-xs font-semibold text-slate-600 mb-3">Type what the gauges show right now — that's your first reading:</p>
                            {existingPoints.length === 0 ? (
                                <p className="text-xs text-slate-400">No measurement points yet — go back one step to create them.</p>
                            ) : (
                                <>
                                    {existingPoints.map((def: any) => (
                                        <div key={def.id} className="flex items-center gap-3 mb-2">
                                            <Gauge size={14} className="text-slate-300 shrink-0" />
                                            <span className="flex-1 text-sm text-slate-700 truncate">{def.name}</span>
                                            <input
                                                value={firstValues[def.id] || ''}
                                                onChange={e => setFirstValues(prev => ({ ...prev, [def.id]: e.target.value }))}
                                                placeholder="value" inputMode="decimal"
                                                className="w-28 px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm text-right tabular-nums"
                                            />
                                            <span className="text-xs text-slate-400 w-12">{def.unit}</span>
                                        </div>
                                    ))}
                                    <div className="flex items-center justify-between mt-3">
                                        <button onClick={() => navigate(`/readings?asset=${assetId}`)} className="text-[11px] text-slate-400 hover:text-slate-600 hover:underline">
                                            For daily rounds, use the Condition Data page →
                                        </button>
                                        <button onClick={saveFirstReadings} disabled={saving}
                                            className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors">
                                            {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Save first readings
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {route === 'live' && (
                        <div className="bg-white border border-slate-200 rounded-xl p-4">
                            <p className="text-xs text-slate-600 leading-relaxed mb-3">
                                <strong>Honest status:</strong> streaming connectors (MQTT / OPC-UA) are not live in this
                                deployment yet. Today the reliable route is a recurring CSV export from your historian —
                                most sites start there. Copy this brief and send it to whoever manages your plant systems:
                            </p>
                            <pre className="text-[11px] bg-slate-50 border border-slate-200 rounded-lg p-3 whitespace-pre-wrap text-slate-600 mb-3">{IT_BRIEF}</pre>
                            <div className="flex items-center justify-between">
                                <button onClick={copyBrief} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs transition-colors">
                                    <ClipboardCopy size={13} /> {briefCopied ? 'Copied ✓' : 'Copy brief'}
                                </button>
                                <button onClick={() => setRoute('manual')} className="text-xs font-semibold text-primary-600 hover:underline">
                                    Meanwhile, log readings by hand →
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="text-center">
                        <button onClick={() => setStep(2)} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 mx-auto"><ChevronLeft size={13} /> Back to measurements</button>
                    </div>
                </div>
            )}

            {/* ═══ STEP 4: FIRST READING / SNAPSHOT ═══ */}
            {step === 4 && (
                <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
                    {snapshotState === 'running' && (
                        <>
                            <Loader2 size={36} className="animate-spin text-primary-500 mx-auto mb-4" />
                            <p className="text-sm font-semibold text-slate-700">Computing the first health snapshot…</p>
                            <p className="text-xs text-slate-400 mt-1">Reading your data and scoring it against the alert levels you set.</p>
                        </>
                    )}
                    {snapshotState === 'done' && (
                        <>
                            <div className="inline-flex p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-600 mb-3"><Sparkles size={28} /></div>
                            <p className="text-lg font-bold text-slate-800">{chosen ? chosen.name : 'Your equipment'} is being monitored</p>
                            {snapshotHealth != null && (
                                <div className="flex items-baseline justify-center gap-1 mt-3">
                                    <span className={`text-5xl font-bold tabular-nums ${snapshotHealth >= 80 ? 'text-emerald-600' : snapshotHealth >= 60 ? 'text-amber-500' : 'text-red-500'}`}>{snapshotHealth.toFixed(1)}</span>
                                    <span className="text-sm text-slate-400">/ 100 health</span>
                                </div>
                            )}
                            <p className="text-xs text-slate-400 mt-3 max-w-sm mx-auto">
                                This is a real number computed from your readings — it sharpens as more readings arrive.
                            </p>
                            <div className="flex items-center justify-center gap-3 mt-6">
                                <button onClick={() => { setStep(1); setIntake('pick'); setAssetId(''); setRoute(null); setFirstValues({}); setSnapshotState(null); setSnapshotHealth(null); }}
                                    className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-sm transition-colors">
                                    Set up another asset
                                </button>
                                <button onClick={() => onExit(assetId)}
                                    className="flex items-center gap-2 px-5 py-2.5 bg-primary-600 hover:bg-primary-500 text-white font-bold rounded-lg text-sm transition-colors">
                                    Open my dashboard <ArrowRight size={15} />
                                </button>
                            </div>
                        </>
                    )}
                    {snapshotState === 'failed' && (
                        <>
                            <p className="text-sm font-semibold text-slate-700 mb-1">Almost there</p>
                            <p className="text-xs text-slate-500 max-w-sm mx-auto">{snapshotMsg || 'No readings found yet.'}</p>
                            <button onClick={() => setStep(3)} className="mt-4 px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white font-semibold rounded-lg text-sm transition-colors">
                                <ChevronLeft size={14} className="inline -mt-0.5" /> Back to data source
                            </button>
                        </>
                    )}
                </div>
            )}

            {/* Escape hatch */}
            <div className="text-center mt-8">
                <button onClick={() => onExit()} className="text-xs text-slate-400 hover:text-slate-600 hover:underline">
                    Skip the guide — show me the dashboard
                </button>
            </div>

            {/* Register upload — the same importer the Assets page uses */}
            <BulkImportModal
                isOpen={uploadOpen}
                onClose={() => { setUploadOpen(false); setIntake('pick'); }}
                preSelectedType="asset"
                allowedTypes={['asset']}
                onImportData={async () => { /* handled via onImportAssets */ }}
                onImportAssets={handleImportAssets}
            />

            {/* Sensor CSV import — the live connector */}
            {csvOpen && (
                <ImportReadingsModal
                    onClose={() => setCsvOpen(false)}
                    onImported={(count) => {
                        setCsvOpen(false);
                        if (count > 0) goVerify();
                    }}
                />
            )}
        </div>
    );
};
