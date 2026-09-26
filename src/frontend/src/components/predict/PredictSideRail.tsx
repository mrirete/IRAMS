/**
 * PredictSideRail — the context column beside Predict's reading column.
 *
 * Shown only when the page is wide enough for both (a container query on the
 * page wrapper, not a viewport breakpoint — the sidebar eats 256 px). Below
 * that, the same facts stay inline in the main column, so nothing here is the
 * only place a fact lives. It holds "context at a glance": what the asset is,
 * what is breaching, how its parents roll up, and where it is drawn — the
 * things that were wide cards but are really one line each.
 *
 * Reads nothing the page has not already loaded, except the newest reading
 * timestamp (one indexed row) so "last reading" is the data's age, not the
 * twin's.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CircleDot, FileWarning, Wrench, ArrowRight, HeartPulse, Gauge, Activity, CheckCircle } from 'lucide-react';
import predictionService from '../../eam/services/PredictionService';
import { DrawingsCard } from '../../eam/components/DrawingsCard';
import type { FleetAssetHealth, PredictionAlert, TwinState } from '../../types/intelligence';
import type { RollupNode } from '../../lib/predict/rollup';
import type { ClassResolution } from '../../lib/predict/equipmentClass';
import { healthModelFor } from '../../lib/predict/healthModels';
import { STALE_DAYS } from '../../config/predict';
import { isAtRisk } from './FleetHealthMap';
import { WhereItSits, type LineageNode } from './WhereItSits';
import { drawingHref, newDrawingTitle } from '../../lib/predict/links';
import { VerdictLine } from './VerdictLine';
import type { Verdict } from '../../lib/predict/verdict';
import type { NeededBy } from '../../lib/predict/healthTrend';
import { MIN_FIT_POINTS } from '../../lib/predict/healthTrend';
import { useAssetPredictConfig } from './useAssetPredictConfig';
import { isOpenAlert } from '../../lib/predict/vibrationCaptures';

type Breach = { name: string; unit?: string; value: number; level: 'WARNING' | 'CRITICAL'; detail: string; date?: string };

interface AssetMode {
    mode: 'asset';
    asset: { id: string; tag: string; name: string; system?: string; criticality?: string | null };
    twinHealth: TwinState | null;
    rulDays: number | null;
    fitted: boolean;
    equipmentClass: ClassResolution | null;
    breaches: Breach[];
    alerts: PredictionAlert[];
    onInvestigate: () => void;
    onCreateWR: () => void;
    /** The asset's own chain in the register (WhereItSits). */
    lineage: LineageNode[];
    /** Which tab is open — the rail's middle section follows the question that tab answers. */
    tab?: 'overview' | 'twin' | 'rul';
    verdict?: Verdict | null;
    onVerdictAction?: () => void;
    readingAgeDays?: number | null;
    /** Saved health points that stand on a reading, and those left out (Model). */
    healthPoints?: number;
    ignoredHealthPoints?: number;
    /** Suggested needed-by date for work raised from an alert (Forecast). */
    neededBy?: NeededBy | null;
    onOpenTab?: (tab: 'overview' | 'twin' | 'rul') => void;
}
interface ChooserMode {
    mode: 'chooser';
    fleet: FleetAssetHealth[];
    onSetup: () => void;
}
type Props = (AssetMode | ChooserMode) & {
    rollups: RollupNode[];
    onSelectAsset: (id: string) => void;
    /** The Update-twin result line, when there is one. */
    statusSlot?: React.ReactNode;
};

const card = 'bg-white border border-slate-200 rounded-xl shadow-sm p-4';
const heading = 'text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5';

const hiTone = (hi: number) => (hi >= 80 ? 'text-emerald-600' : hi >= 60 ? 'text-amber-600' : 'text-red-600');
const hiDot = (hi: number) => (hi >= 80 ? 'bg-emerald-400' : hi >= 60 ? 'bg-amber-400' : 'bg-red-400');
const critTone: Record<string, string> = {
    A: 'bg-red-50 text-red-700 border-red-200',
    B: 'bg-amber-50 text-amber-700 border-amber-200',
    C: 'bg-slate-50 text-slate-600 border-slate-200',
};
const sevTone: Record<string, string> = {
    emergency: 'text-red-700', high: 'text-red-600', medium: 'text-amber-600', low: 'text-slate-500', info: 'text-slate-400',
};

const age = (iso: string | null | undefined): { days: number; label: string } | null => {
    if (!iso) return null;
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms)) return null;
    const min = Math.max(0, Math.floor(ms / 60000));
    const label = min < 1 ? 'just now' : min < 60 ? `${min}m ago` : min < 1440 ? `${Math.floor(min / 60)}h ago` : `${Math.floor(min / 1440)}d ago`;
    return { days: Math.floor(min / 1440), label };
};

const Row: React.FC<{ k: string; children: React.ReactNode }> = ({ k, children }) => (
    <div className="flex items-baseline justify-between gap-3 py-1 border-b border-slate-50 last:border-b-0">
        <span className="text-[11px] text-slate-400 shrink-0">{k}</span>
        <span className="text-[12px] text-slate-700 font-medium text-right min-w-0 truncate">{children}</span>
    </div>
);

const RollupList: React.FC<{ rollups: RollupNode[]; onSelectAsset: (id: string) => void }> = ({ rollups, onSelectAsset }) => {
    if (!rollups.length) return null;
    return (
        <div className={card}>
            <p className={heading}><CircleDot size={11} /> Weakest systems</p>
            <ul className="space-y-1.5">
                {rollups.slice(0, 6).map((r) => (
                    <li key={r.id} className="flex items-center gap-2" title={r.offenders.map((o) => `${o.name}: ${Math.round(o.health)}`).join('\n')}>
                        <span className={`w-2 h-2 rounded-full shrink-0 ${hiDot(r.health)}`} />
                        <span className={`text-[12px] truncate flex-1 min-w-0 ${r.name ? 'text-slate-700' : 'text-slate-400 italic'}`}>{r.name || `Unnamed ${r.level.toLowerCase()}`}</span>
                        <span className="text-[9px] font-bold text-slate-400 uppercase">{r.level}</span>
                        <span className={`text-[12px] font-bold tabular-nums w-7 text-right ${hiTone(r.health)}`}>{Math.round(r.health)}</span>
                    </li>
                ))}
            </ul>
            {rollups[0]?.worst && (
                <button onClick={() => onSelectAsset(rollups[0].worst!.id)} className="mt-2 text-[11px] font-semibold text-primary-600 hover:text-primary-500">
                    Weakest link: {rollups[0].worst.name} →
                </button>
            )}
            <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">Criticality-weighted, dragged toward the weakest link; redundant pairs from saved block diagrams count once.</p>
        </div>
    );
};

/** Model tab: is the asset set up to be modelled, and how far along is the fitted trend. */
const ModelSection: React.FC<{ assetId: string; rotating: boolean; fitted: boolean; healthPoints: number; ignored: number; onOpenTab?: (t: 'overview' | 'twin' | 'rul') => void }> = ({ assetId, rotating, fitted, healthPoints, ignored }) => {
    const { config } = useAssetPredictConfig(assetId);
    const Item: React.FC<{ ok: boolean; label: string; hint: string }> = ({ ok, label, hint }) => (
        <li className="flex items-start gap-2 text-[12px] leading-snug">
            <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${ok ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <span className="min-w-0"><span className="text-slate-700">{label}</span><span className="block text-[10px] text-slate-400">{hint}</span></span>
        </li>
    );
    const bearings = config?.bearings?.length ?? 0;
    return (
        <div className={card}>
            <p className={heading}><Activity size={11} /> Model readiness</p>
            <ul className="space-y-1.5">
                {rotating && <Item ok={!!config?.rated_rpm} label={config?.rated_rpm ? `Speed ${config.rated_rpm} rpm` : 'Speed not set'} hint="Names 1× / 2× lines in a vibration capture." />}
                {rotating && <Item ok={bearings > 0} label={bearings > 0 ? `${bearings} bearing${bearings > 1 ? 's' : ''} named` : 'No bearings named'} hint="Lets a capture name BPFO / BPFI defect tones." />}
                <Item ok={healthPoints >= MIN_FIT_POINTS} label={`Health trend: ${healthPoints} of ${MIN_FIT_POINTS} points`} hint={ignored > 0 ? `${ignored} left out — saved with no new reading behind them.` : 'Fitted once there are enough points over 2 days.'} />
                <Item ok={fitted} label={fitted ? 'Fitted life model' : 'No fitted life model'} hint={fitted ? 'From this asset\'s recorded failures.' : 'Needs 2 recorded failures on closed work orders.'} />
            </ul>
            {config === null && <p className="text-[10px] text-slate-400 mt-2">Loading setup…</p>}
        </div>
    );
};

/** Forecast tab: the number, the date the work hangs on, and the open alerts. */
const ForecastSection: React.FC<{ rulDays: number | null; fitted: boolean; neededBy: NeededBy | null; openAlerts: PredictionAlert[]; onCreateWR: () => void }> = ({ rulDays, fitted, neededBy, openAlerts, onCreateWR }) => (
    <div className={card}>
        <p className={heading}><FileWarning size={11} /> What to do</p>
        <Row k="Remaining life">{rulDays != null ? `${Math.round(rulDays)} d · ${fitted ? 'fitted' : 'directional'}` : '—'}</Row>
        <Row k="Needed by">{neededBy?.date ? new Date(neededBy.date).toLocaleDateString([], { day: 'numeric', month: 'short' }) : 'no date'}</Row>
        {neededBy && <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">{neededBy.note}</p>}
        {openAlerts.length > 0 ? (
            <ul className="space-y-1.5 mt-2">
                {openAlerts.slice(0, 4).map(a => (
                    <li key={a.alert_id} className="text-[12px] leading-snug">
                        <span className={`font-semibold uppercase text-[10px] mr-1 ${sevTone[a.severity] ?? 'text-slate-500'}`}>{a.severity}</span>
                        <span className="text-slate-700">{a.title}</span>
                        <span className="block text-[10px] text-slate-400">{a.status === 'in_progress' ? (a.work_done_at ? 'Work done — record the outcome' : 'Work raised') : a.status === 'acknowledged' ? 'Acknowledged — raise work or close' : 'New — acknowledge, raise work, or close'}</span>
                    </li>
                ))}
            </ul>
        ) : <p className="text-[12px] text-slate-500 mt-2 flex items-center gap-1.5"><CheckCircle size={13} className="text-emerald-500" /> No open alerts.</p>}
        <button onClick={onCreateWR} className="mt-3 w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100">
            <Wrench size={12} /> Raise work
        </button>
    </div>
);

export const PredictSideRail: React.FC<Props> = (props) => {
    const { rollups, onSelectAsset, statusSlot } = props;
    const assetId = props.mode === 'asset' ? props.asset.id : '';
    const [newest, setNewest] = useState<string | null>(null);
    useEffect(() => {
        if (!assetId) { setNewest(null); return; }
        let alive = true;
        predictionService.newestReadingAt(assetId).then((t) => { if (alive) setNewest(t); });
        return () => { alive = false; };
    }, [assetId]);

    if (props.mode === 'chooser') {
        const fleet = props.fleet;
        const avg = fleet.length ? fleet.reduce((s, a) => s + a.health_index, 0) / fleet.length : 0;
        const atRisk = fleet.filter((a) => isAtRisk(a.health_index)).length;
        const byCrit = (c: string) => fleet.filter((a) => a.criticality === c).length;
        const worst = [...fleet].sort((a, b) => a.health_index - b.health_index).slice(0, 5);
        return (
            <div className="space-y-4">
                {fleet.length > 0 ? (
                    <div className={card}>
                        <p className={heading}><Activity size={11} /> Fleet at a glance</p>
                        <div className="grid grid-cols-3 gap-2 text-center">
                            <div><p className={`text-xl font-bold tabular-nums ${hiTone(avg)}`}>{avg.toFixed(0)}</p><p className="text-[10px] text-slate-400">avg health</p></div>
                            <div><p className={`text-xl font-bold tabular-nums ${atRisk ? 'text-red-600' : 'text-slate-700'}`}>{atRisk}</p><p className="text-[10px] text-slate-400">below 70</p></div>
                            <div><p className="text-xl font-bold tabular-nums text-slate-700">{fleet.length}</p><p className="text-[10px] text-slate-400">monitored</p></div>
                        </div>
                        <div className="flex items-center gap-1.5 mt-3">
                            {(['A', 'B', 'C'] as const).map((c) => (
                                <span key={c} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${critTone[c]}`}>Crit {c} · {byCrit(c)}</span>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className={card}>
                        <p className={heading}><Activity size={11} /> Fleet at a glance</p>
                        <p className="text-[12px] text-slate-500">No asset has a health snapshot yet.</p>
                    </div>
                )}
                {worst.length > 0 && (
                    <div className={card}>
                        <p className={heading}><AlertTriangle size={11} /> Look at first</p>
                        <ul className="space-y-1">
                            {worst.map((a) => (
                                <li key={a.asset_id}>
                                    <button onClick={() => onSelectAsset(a.asset_id)} className="w-full flex items-center gap-2 px-1.5 py-1 rounded-md hover:bg-slate-50 text-left">
                                        <span className={`w-2 h-2 rounded-full shrink-0 ${hiDot(a.health_index)}`} />
                                        <span className="text-[12px] text-slate-700 truncate flex-1 min-w-0">{a.asset_name}</span>
                                        <span className={`text-[12px] font-bold tabular-nums ${hiTone(a.health_index)}`}>{Math.round(a.health_index)}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                <RollupList rollups={rollups} onSelectAsset={onSelectAsset} />
                <button onClick={props.onSetup} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:border-primary-300 hover:text-primary-700 text-slate-600 font-semibold rounded-xl text-sm transition-colors">
                    <HeartPulse size={15} /> Set up new equipment
                </button>
            </div>
        );
    }

    const { asset, twinHealth, rulDays, fitted, equipmentClass, breaches, alerts, onInvestigate, onCreateWR } = props;
    const tab = props.tab ?? 'overview';
    const twinAge = age(twinHealth?.updated_at);
    const readAge = age(newest);
    const hi = twinHealth ? Number(twinHealth.health_index) : null;
    const model = equipmentClass ? healthModelFor(equipmentClass.cls) : null;
    const openAlerts = alerts.filter(isOpenAlert);
    const watchCount = breaches.length + openAlerts.length;

    return (
        <div className="space-y-4">
            {statusSlot}
            {props.verdict && <VerdictLine verdict={props.verdict} onAction={props.onVerdictAction} compact />}

            <div className={card}>
                <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{asset.tag || asset.name}</p>
                        <p className="text-[11px] text-slate-400 truncate">{asset.name}</p>
                    </div>
                    {asset.criticality && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${critTone[asset.criticality] ?? critTone.C}`}>Crit {asset.criticality}</span>
                    )}
                </div>
                <div className="flex items-end gap-4 mb-2">
                    <div>
                        <p className={`text-2xl font-bold tabular-nums leading-none ${hi != null ? hiTone(hi) : 'text-slate-300'}`}>{hi != null ? hi.toFixed(0) : '—'}</p>
                        <p className="text-[10px] text-slate-400 mt-1">health</p>
                    </div>
                    <div>
                        <p className="text-2xl font-bold tabular-nums leading-none text-slate-700">{rulDays != null ? Math.round(rulDays) : '—'}<span className="text-xs font-medium text-slate-400 ml-0.5">{rulDays != null ? 'd' : ''}</span></p>
                        <p className="text-[10px] text-slate-400 mt-1">remaining life</p>
                    </div>
                </div>
                {asset.system && <Row k="System">{asset.system}</Row>}
                {model && equipmentClass && (
                    <Row k="Health model"><span title={equipmentClass.note}>{model.label}{equipmentClass.basis !== 'declared' ? ` · ${equipmentClass.basis}` : ''}</span></Row>
                )}
                <Row k="Last reading">
                    <span className={readAge && readAge.days > STALE_DAYS ? 'text-amber-600' : ''}>{readAge ? readAge.label : 'none yet'}</span>
                </Row>
                <Row k="Twin updated">{twinAge ? twinAge.label : 'not yet'}</Row>
                <p className={`mt-2 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded border inline-block ${fitted ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}
                    title={fitted ? 'Remaining life from a censored Weibull fit to this asset\'s recorded failures.' : 'Health Index and RUL are heuristic estimates from condition trends — useful for triage, not for life decisions. A fitted Weibull RUL appears once ≥2 failures are on record.'}>
                    {fitted ? 'Fitted life model' : 'Directional · no fitted life model'}
                </p>
            </div>

            {tab === 'twin' && <ModelSection assetId={asset.id} rotating={equipmentClass?.cls !== 'static'} fitted={fitted} healthPoints={props.healthPoints ?? 0} ignored={props.ignoredHealthPoints ?? 0} onOpenTab={props.onOpenTab} />}
            {tab === 'rul' && <ForecastSection rulDays={rulDays} fitted={fitted} neededBy={props.neededBy ?? null} openAlerts={openAlerts} onCreateWR={onCreateWR} />}

            {tab === 'overview' && <div className={card}>
                <p className={heading}><Gauge size={11} /> Watch list{watchCount > 0 ? ` · ${watchCount}` : ''}</p>
                {watchCount === 0 ? (
                    <p className="text-[12px] text-slate-500 flex items-center gap-1.5"><CheckCircle size={13} className="text-emerald-500" /> Nothing breaching a band, no open alerts.</p>
                ) : (
                    <ul className="space-y-2">
                        {breaches.slice(0, 5).map((b, i) => (
                            <li key={`b-${i}`} className="text-[12px] leading-snug">
                                <span className={`font-semibold ${b.level === 'CRITICAL' ? 'text-red-600' : 'text-amber-600'}`}>{b.name}</span>
                                <span className="text-slate-500"> — {b.value}{b.unit ? ` ${b.unit}` : ''}</span>
                                <span className="block text-[10px] text-slate-400">{b.detail}</span>
                            </li>
                        ))}
                        {openAlerts.slice(0, 5).map((a) => (
                            <li key={a.alert_id} className="text-[12px] leading-snug">
                                <span className={`font-semibold uppercase text-[10px] mr-1 ${sevTone[a.severity] ?? 'text-slate-500'}`}>{a.severity}</span>
                                <span className="text-slate-700">{a.title}</span>
                            </li>
                        ))}
                    </ul>
                )}
                <div className="flex items-center gap-2 mt-3">
                    <button onClick={onCreateWR} className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100">
                        <Wrench size={12} /> Work request
                    </button>
                    {watchCount > 0 && (
                        <button onClick={onInvestigate} className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100">
                            <FileWarning size={12} /> Investigate
                        </button>
                    )}
                </div>
            </div>}

            {/* The asset's own place in the plant — not the plant-wide weakest list. */}
            <WhereItSits lineage={props.lineage} rollups={rollups} onSelectAsset={onSelectAsset} />

            <div className="space-y-2">
                <DrawingsCard
                    assetId={asset.id}
                    assetTag={asset.tag}
                    pidHref={(pidId) => drawingHref({ assetId: asset.id, assetLabel: asset.tag || asset.name, drawingId: pidId })}
                />
                <Link
                    to={drawingHref({ assetId: asset.id, assetLabel: asset.tag || asset.name, newTitle: newDrawingTitle(asset.system, asset.tag || asset.name) })}
                    className="flex items-center gap-1 text-[11px] font-semibold text-primary-600 hover:text-primary-500 px-1"
                >
                    Open drawings in Reliability Modelling <ArrowRight size={11} />
                </Link>
            </div>
        </div>
    );
};

export default PredictSideRail;
