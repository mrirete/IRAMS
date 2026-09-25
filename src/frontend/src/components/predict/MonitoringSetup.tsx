/**
 * MonitoringSetup — the asset's monitoring configuration, set once and saved
 * explicitly (ISO 17359: define what is monitored and how it is judged before
 * analysing). Lives at the top of the Model tab as a one-line summary; Edit
 * opens a fixed-layout pop-up with Save / Cancel.
 *
 * Before 2026-09-24 these fields sat inside the vibration-capture form and
 * saved themselves: the load tag on blur (free text, silently ignored when it
 * was not a live tag), rated speed only when a bearing was added or removed.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Settings2, Pencil, AlertTriangle, X, Gauge, Cog, Activity, Database, Check } from 'lucide-react';
import { Modal, Field, Input, Select } from '../../eam/components/ui';
import { useAuth } from '../../eam/contexts/AuthContext';
import { predictionService, type AssetPredictConfig } from '../../eam/services/PredictionService';
import { faultFrequencies, type BearingSpec } from '../../lib/predict/bearingFaults';
import { BEARING_CATALOG } from '../../lib/predict/bearingCatalog';
import { registerBearingSuggestions, type BearingSuggestion } from '../../lib/predict/registerBearings';

interface Props {
    assetId: string;
    assetName: string;
    /** Rotating equipment gets machine speed + bearings; static equipment only the regime. */
    rotating: boolean;
    config: AssetPredictConfig | null;
    onSave: (patch: Partial<AssetPredictConfig>) => Promise<boolean>;
}

interface Draft {
    rpm: string;
    bearings: BearingSpec[];
    loadTag: string;
    baselineDays: string;
}

const draftFrom = (cfg: AssetPredictConfig | null): Draft => ({
    rpm: cfg?.rated_rpm ? String(cfg.rated_rpm) : '',
    bearings: cfg?.bearings ?? [],
    loadTag: cfg?.regime?.loadTag ?? '',
    baselineDays: String(cfg?.regime?.baselineDays ?? 30),
});

const sameDraft = (a: Draft, b: Draft) =>
    a.rpm.trim() === b.rpm.trim() && a.loadTag === b.loadTag && a.baselineDays.trim() === b.baselineDays.trim()
    && JSON.stringify(a.bearings) === JSON.stringify(b.bearings);

const SECTION = 'text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-2';

export const MonitoringSetup: React.FC<Props> = ({ assetId, assetName, rotating, config, onSave }) => {
    const { profile } = useAuth();
    const [open, setOpen] = useState(false);
    const [liveTags, setLiveTags] = useState<{ tag: string; unit: string }[] | null>(null);

    const [registerBearings, setRegisterBearings] = useState<BearingSuggestion[]>([]);

    useEffect(() => {
        let alive = true;
        setLiveTags(null);
        setRegisterBearings([]);
        predictionService.getLiveTags(assetId).then(t => { if (alive) setLiveTags(t); });
        if (rotating) {
            predictionService.getRegisterBearingRows(assetId)
                .then(rows => { if (alive) setRegisterBearings(registerBearingSuggestions(rows)); });
        }
        return () => { alive = false; };
    }, [assetId, rotating]);

    const savedLoad = config?.regime?.loadTag?.trim() || '';
    const loadIsLive = !savedLoad || !liveTags || liveTags.some(t => t.tag.toLowerCase() === savedLoad.toLowerCase());

    const chip = 'text-[11px] px-2 py-0.5 rounded-md border bg-slate-50 border-slate-200 text-slate-600 whitespace-nowrap';
    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2.5 shrink-0">
                <div className="p-1.5 bg-slate-50 rounded-lg text-slate-500 border border-slate-100"><Settings2 size={16} /></div>
                <p className="text-sm font-semibold text-slate-800">Monitoring setup</p>
            </div>
            {config === null ? (
                <p className="flex-1 text-xs text-slate-400">Loading…</p>
            ) : (
                <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5">
                    {rotating && <span className={chip}>Speed {config.rated_rpm ? `${config.rated_rpm.toLocaleString()} rpm` : 'not set'}</span>}
                    {rotating && <span className={chip}>Bearings {config.bearings?.length ?? 0}</span>}
                    <span className={chip}>
                        {savedLoad ? `Load tag ${savedLoad} · ${config.regime?.baselineDays ?? 30}-day baseline` : 'Load check off'}
                    </span>
                    {!loadIsLive && (
                        <span className="text-[11px] px-2 py-0.5 rounded-md border bg-amber-50 border-amber-200 text-amber-700 flex items-center gap-1">
                            <AlertTriangle size={11} /> {savedLoad} is not a live tag — load check is off
                        </span>
                    )}
                    <span className="text-[10px] text-slate-400 ml-1">
                        {config.saved_at
                            ? `Saved ${new Date(config.saved_at).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}${config.saved_by ? ` by ${config.saved_by}` : ''}`
                            : 'Not confirmed yet'}
                    </span>
                </div>
            )}
            <button
                onClick={() => setOpen(true)}
                disabled={config === null}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:border-primary-300 hover:text-primary-700 disabled:opacity-50 text-slate-600 text-xs font-semibold rounded-lg transition-colors shrink-0"
            >
                <Pencil size={12} /> Edit
            </button>
            {open && config && (
                <SetupDialog
                    assetName={assetName}
                    rotating={rotating}
                    config={config}
                    liveTags={liveTags ?? []}
                    registerBearings={registerBearings}
                    onClose={() => setOpen(false)}
                    onSave={async (patch) => {
                        const ok = await onSave({ ...patch, saved_at: new Date().toISOString(), saved_by: profile?.fullName || profile?.username || null });
                        if (ok) setOpen(false);
                        return ok;
                    }}
                />
            )}
        </div>
    );
};

const SetupDialog: React.FC<{
    assetName: string;
    rotating: boolean;
    config: AssetPredictConfig;
    liveTags: { tag: string; unit: string }[];
    registerBearings: BearingSuggestion[];
    onClose: () => void;
    onSave: (patch: Partial<AssetPredictConfig>) => Promise<boolean>;
}> = ({ assetName, rotating, config, liveTags, registerBearings, onClose, onSave }) => {
    const initial = useMemo(() => draftFrom(config), [config]);
    const [draft, setDraft] = useState<Draft>(initial);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirmDiscard, setConfirmDiscard] = useState(false);
    const dirty = !sameDraft(draft, initial);
    const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setDraft(d => ({ ...d, [k]: v })); setConfirmDiscard(false); };

    const rpmNum = Number(draft.rpm);
    const rpmError = draft.rpm.trim() && !(Number.isFinite(rpmNum) && rpmNum > 0 && rpmNum <= 60000) ? 'Enter 1–60 000 rpm, or leave blank' : undefined;
    const daysNum = Number(draft.baselineDays);
    const daysError = !(Number.isInteger(daysNum) && daysNum >= 7 && daysNum <= 90) ? 'Whole days, 7–90' : undefined;
    const valid = !rpmError && (!draft.loadTag || !daysError);

    // A saved tag that is no longer live stays selectable, marked, so opening
    // the pop-up never silently changes it.
    const tagOptions = useMemo(() => {
        const opts = liveTags.map(t => ({ value: t.tag, label: t.unit && !t.tag.includes(t.unit) ? `${t.tag} (${t.unit})` : t.tag }));
        if (initial.loadTag && !opts.some(o => o.value.toLowerCase() === initial.loadTag.toLowerCase())) {
            opts.unshift({ value: initial.loadTag, label: `${initial.loadTag} — not a live tag` });
        }
        return opts;
    }, [liveTags, initial.loadTag]);

    const requestClose = () => {
        if (dirty && !confirmDiscard) { setConfirmDiscard(true); return; }
        onClose();
    };

    const handleSave = async () => {
        if (!valid || !dirty) return;
        setSaving(true);
        setError(null);
        const tag = draft.loadTag.trim();
        const ok = await onSave({
            ...(rotating ? { rated_rpm: draft.rpm.trim() ? rpmNum : null, bearings: draft.bearings } : {}),
            regime: tag ? { ...(config.regime ?? { loadTag: tag }), loadTag: tag, baselineDays: daysNum } : undefined,
        });
        setSaving(false);
        if (!ok) setError('Could not save — check your connection and permissions, then try again.');
    };

    return (
        <Modal
            open
            onClose={requestClose}
            size="lg"
            title={<span className="flex items-center gap-2"><Settings2 size={16} className="text-slate-500" /> Monitoring setup — {assetName}</span>}
            footer={
                <>
                    <span className="mr-auto text-[11px]">
                        {confirmDiscard
                            ? <span className="text-amber-700 font-semibold">Unsaved changes — Discard to throw them away, or Save.</span>
                            : dirty ? <span className="text-slate-500">Unsaved changes</span> : <span className="text-slate-400">No changes</span>}
                    </span>
                    <button onClick={requestClose} className="px-4 py-2 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg text-sm font-medium">
                        {confirmDiscard ? 'Discard' : 'Cancel'}
                    </button>
                    <button onClick={handleSave} disabled={!dirty || !valid || saving}
                        className="px-5 py-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-40 text-white rounded-lg text-sm font-bold">
                        {saving ? 'Saving…' : 'Save setup'}
                    </button>
                </>
            }
        >
            <div className="space-y-6">
                {rotating && (
                    <section>
                        <p className={SECTION}><Gauge size={11} /> Machine</p>
                        <Field label="Rated running speed (rpm)" error={rpmError}
                            hint="Default speed for vibration captures.">
                            <div className="w-40">
                                <Input type="number" inputMode="decimal" value={draft.rpm} onChange={e => set('rpm', e.target.value)} placeholder="e.g. 1480" />
                            </div>
                        </Field>
                    </section>
                )}

                {rotating && (
                    <section>
                        <p className={SECTION}><Cog size={11} /> Bearings</p>
                        <BearingEditor bearings={draft.bearings} onChange={b => set('bearings', b)} suggestions={registerBearings} />
                    </section>
                )}

                <section>
                    <p className={SECTION}><Activity size={11} /> Operating load</p>
                    <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">
                        Pick the live tag that sets the duty, like steam flow or motor load. Other points are then
                        judged at the current load, not only against fixed bands.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_8rem] gap-3 items-start">
                        <Field label="Load tag">
                            <Select value={draft.loadTag} onChange={e => set('loadTag', e.target.value)} disabled={tagOptions.length === 0}>
                                <option value="">None — judge points on their bands only</option>
                                {tagOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </Select>
                        </Field>
                        <Field label="Baseline (days)" error={draft.loadTag ? daysError : undefined}>
                            <Input type="number" min={7} max={90} value={draft.baselineDays} onChange={e => set('baselineDays', e.target.value)} disabled={!draft.loadTag} />
                        </Field>
                    </div>
                    {liveTags.length === 0 && (
                        <p className="text-[11px] text-amber-700 mt-2">No live series on this asset yet — the load check needs an online or file-loaded feed. Manual readings are judged on their bands.</p>
                    )}
                </section>

                {error && <p className="text-xs text-red-600">{error}</p>}
            </div>
        </Modal>
    );
};

/**
 * Bearing list. Three ways in, in order of preference: the asset's own
 * bearings from the register (one click when the model is in the catalog;
 * the datasheet row pre-filled when it is not), the seed catalog, or BPFO/BPFI
 * typed from the maker's datasheet. Fluid-film bearings are named as such —
 * defect frequencies do not apply to them. Edits the pop-up's draft; nothing
 * is stored until Save setup.
 */
const BearingEditor: React.FC<{ bearings: BearingSpec[]; onChange: (next: BearingSpec[]) => void; suggestions: BearingSuggestion[] }> = ({ bearings, onChange, suggestions }) => {
    const [catalogSel, setCatalogSel] = useState(BEARING_CATALOG[0].designation);
    const [position, setPosition] = useState('DE');
    const [dsName, setDsName] = useState('');
    const [dsBpfo, setDsBpfo] = useState('');
    const [dsBpfi, setDsBpfi] = useState('');
    const bpfoRef = React.useRef<HTMLInputElement>(null);

    const addFromCatalog = (designation = catalogSel, pos = position) => {
        const entry = BEARING_CATALOG.find(e => e.designation === designation);
        if (!entry) return;
        onChange([...bearings, { ...entry.spec, position: pos.trim() || undefined }]);
    };
    const addFromDatasheet = () => {
        const bpfo = Number(dsBpfo), bpfi = Number(dsBpfi);
        if (!dsName.trim() || !(bpfo > 0) || !(bpfi > 0)) return;
        onChange([...bearings, { designation: dsName.trim(), position: position.trim() || undefined, orders: { bpfo, bpfi }, source: 'datasheet' }]);
        setDsName(''); setDsBpfo(''); setDsBpfi('');
    };
    const fillDatasheet = (sug: BearingSuggestion) => {
        setDsName(sug.designation ?? sug.model ?? '');
        if (sug.position) setPosition(sug.position);
        setTimeout(() => bpfoRef.current?.focus(), 0);
    };
    const isAdded = (sug: BearingSuggestion) => bearings.some(b =>
        (b.designation ?? '') === (sug.designation ?? '') && (b.position ?? '') === (sug.position ?? ''));

    const rolling = suggestions.filter(x => x.kind !== 'fluid-film');
    const fluid = suggestions.filter(x => x.kind === 'fluid-film');
    const allFluid = suggestions.length > 0 && rolling.length === 0;

    const ctl = 'w-full h-10 px-2.5 border border-slate-300 rounded-lg text-sm bg-white focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-400';
    const lbl = 'block text-[11px] font-semibold text-slate-500 mb-1';
    const addBtn = 'h-10 px-4 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white text-sm font-bold rounded-lg shrink-0';

    return (
        <div className="space-y-4">
            {/* What is on the list now */}
            {bearings.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                    {bearings.map((b, i) => {
                        const f = faultFrequencies(b, 1);
                        return (
                            <span key={i} className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 border border-slate-200 rounded-md text-[11px]">
                                <span className="font-semibold text-slate-700">{b.designation || 'bearing'}</span>
                                {b.position && <span className="text-slate-400">{b.position}</span>}
                                {f && <span className="font-mono text-slate-500">BPFO {f.orders.bpfo}× · BPFI {f.orders.bpfi}×</span>}
                                {(b.source === 'approximate' || f?.basis === 'approximate') && (
                                    <span className="px-1 py-0.5 bg-amber-50 border border-amber-200 text-amber-700 rounded text-[9px] font-bold">APPROX</span>
                                )}
                                <button onClick={() => onChange(bearings.filter((_, j) => j !== i))} className="text-slate-300 hover:text-red-500" title="Remove" aria-label={`Remove ${b.designation}`}>
                                    <X size={11} />
                                </button>
                            </span>
                        );
                    })}
                </div>
            ) : allFluid ? (
                <p className="text-[12px] text-slate-600 leading-relaxed bg-slate-50 border border-slate-200 rounded-lg p-3">
                    This machine runs on <b>fluid-film bearings</b> (tilting-pad or journal). Rolling-element defect
                    frequencies don't apply to them. Watch them with shaft-orbit (proximity-probe) monitoring instead.
                </p>
            ) : (
                <p className="text-[12px] text-slate-500">
                    Optional. Bearings let the vibration check name defect tones (outer race, inner race, ball, cage).
                </p>
            )}

            {/* From the register — the asset's own bearing components */}
            {suggestions.length > 0 && (
                <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-1.5"><Database size={11} /> From the asset register</p>
                    <ul className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                        {[...rolling, ...fluid].map(sug => (
                            <li key={sug.id} className="flex items-center gap-3 px-3 py-2">
                                <div className="flex-1 min-w-0">
                                    <p className="text-[12px] font-semibold text-slate-700 truncate">{sug.name}</p>
                                    <p className="text-[11px] text-slate-400 truncate">{[sug.maker, sug.model].filter(Boolean).join(' ') || 'No model in the register'}{sug.position ? ` · ${sug.position}` : ''}</p>
                                </div>
                                {sug.kind === 'fluid-film' ? (
                                    <span className="text-[10px] font-semibold text-slate-500 bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 shrink-0" title="Tilting-pad / journal bearings have no BPFO/BPFI">Fluid-film · n/a</span>
                                ) : isAdded(sug) ? (
                                    <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 shrink-0"><Check size={12} /> Added</span>
                                ) : sug.kind === 'catalog' ? (
                                    <button onClick={() => addFromCatalog(sug.designation!, sug.position ?? '')} className="text-[12px] font-bold text-primary-600 hover:text-primary-500 shrink-0">Add</button>
                                ) : sug.kind === 'datasheet' ? (
                                    <button onClick={() => fillDatasheet(sug)} className="text-[12px] font-bold text-primary-600 hover:text-primary-500 shrink-0" title="Pre-fills the datasheet row below — add BPFO/BPFI from the maker">Fill below</button>
                                ) : (
                                    <span className="text-[10px] text-slate-400 shrink-0">Add model in register</span>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Manual entry — hidden behind nothing, but quiet when the machine is all fluid-film */}
            {!allFluid && (
                <>
                    <div className="space-y-2">
                        <div>
                            <label className={lbl} htmlFor="brg-catalog">From catalog</label>
                            <select id="brg-catalog" value={catalogSel} onChange={e => setCatalogSel(e.target.value)} className={ctl}>
                                {BEARING_CATALOG.map(e => <option key={e.designation} value={e.designation}>{e.label}</option>)}
                            </select>
                        </div>
                        <div className="flex items-end gap-2">
                            <div className="w-28">
                                <label className={lbl} htmlFor="brg-position">Position</label>
                                <input id="brg-position" value={position} onChange={e => setPosition(e.target.value)} placeholder="DE" className={ctl} />
                            </div>
                            <button onClick={() => addFromCatalog()} className={addBtn}>Add</button>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <p className="text-[11px] text-slate-400">or from the manufacturer's datasheet (orders × running speed)</p>
                        <div>
                            <label className={lbl} htmlFor="brg-ds">Designation</label>
                            <input id="brg-ds" value={dsName} onChange={e => setDsName(e.target.value)} placeholder="e.g. 6309" className={ctl} />
                        </div>
                        <div className="flex items-end gap-2">
                            <div className="w-24"><label className={lbl} htmlFor="brg-bpfo">BPFO ×</label><input id="brg-bpfo" ref={bpfoRef} type="number" value={dsBpfo} onChange={e => setDsBpfo(e.target.value)} placeholder="3.05" className={ctl} /></div>
                            <div className="w-24"><label className={lbl} htmlFor="brg-bpfi">BPFI ×</label><input id="brg-bpfi" type="number" value={dsBpfi} onChange={e => setDsBpfi(e.target.value)} placeholder="4.95" className={ctl} /></div>
                            <button onClick={addFromDatasheet} disabled={!dsName.trim() || !Number(dsBpfo) || !Number(dsBpfi)} className={addBtn}>Add</button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
