/**
 * OperatingContextCard — the ISO 14224 operating context of one asset.
 *
 * The Details tab shows a CALM SUMMARY (what is set, what is still missing);
 * the editing happens in a pop-up so the register page stays readable. The
 * editor holds the Table 5 operating data (mode, utilisation, hours/starts,
 * redundancy, environment, service medium) and the Annex A class-specific
 * parameter table with a Design (nameplate) value, a Normal operating value
 * and an optional Max. Rows arrive from the class template the moment a class
 * is chosen; custom rows can be added. Operating above design is flagged
 * inline because that is exactly what an RCM study needs to see.
 *
 * There is no duty-description box: the asset's own Description field is the
 * duty narrative, and composeOperatingContext reads it from there.
 *
 * Edits flow through onUpdate like every other Details-tab field, so the
 * page's Save button persists them (DatabaseService.updateAsset →
 * assets.operating_context). Pure presentation: the rules live in
 * lib/operatingContext.ts.
 */
import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Gauge, Plus, Trash2, AlertTriangle, ArrowDownRight, CheckCircle2, X, Pencil } from 'lucide-react';
import type { Asset } from '../types';
import {
  normalizeContext, mergeTemplate, utilisationOf, deviationFlag, contextCompleteness, hasAnyValue,
  OPERATING_MODES, REDUNDANCY_OPTIONS, ENVIRONMENT_OPTIONS,
  type AssetOperatingContext, type OperatingParameter,
} from '../../lib/operatingContext';
import { getClass } from '../../lib/iso14224Taxonomy';

interface Props {
  asset: Asset;
  onUpdate: (a: Asset) => void;
}

const inputCls = 'w-full text-sm border border-slate-300 shadow-sm rounded-md bg-white p-2 focus:border-blue-500 focus:ring-1 focus:ring-primary-500 outline-none transition-colors';
const cellCls = 'w-full text-xs border border-slate-200 rounded px-1.5 py-1 bg-white focus:border-blue-500 focus:ring-1 focus:ring-primary-500 outline-none tabular-nums';

const Chip: React.FC<{ tone?: 'muted' | 'warn' | 'danger'; children: React.ReactNode }> = ({ tone = 'muted', children }) => (
  <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${
    tone === 'danger' ? 'bg-red-50 text-red-700 border-red-200'
      : tone === 'warn' ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
    {children}
  </span>
);

export const OperatingContextCard: React.FC<Props> = ({ asset, onUpdate }) => {
  const [open, setOpen] = useState(false);

  // The stored shape, merged with the template for the CURRENT class so the
  // table always shows the rows this class needs (values are never lost).
  const ctx = useMemo<AssetOperatingContext>(
    () => mergeTemplate(normalizeContext(asset.operatingContext), asset.assetClass, asset.assetCategory),
    [asset.operatingContext, asset.assetClass, asset.assetCategory],
  );
  const completeness = useMemo(() => contextCompleteness(ctx), [ctx]);
  const params = ctx.parameters || [];
  const valued = params.filter(hasAnyValue);
  const aboveDesign = valued.filter(p => deviationFlag(p) === 'above_design');
  const isEmpty = !ctx.mode && valued.length === 0 && !ctx.service_medium && !(ctx.environment || []).length;

  const commit = (next: AssetOperatingContext) => {
    onUpdate({ ...asset, operatingContext: { ...next, updated_at: new Date().toISOString() } });
  };

  return (
    <>
      <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 mb-3">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <Gauge size={16} className="text-slate-400" /> Operating Context
          </h3>
          <div className="flex items-center gap-2">
            <span
              title={completeness.missing.length ? `Still missing: ${completeness.missing.join('; ')}` : 'Enough for an RCM study'}
              className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full border ${completeness.complete ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}
            >
              {completeness.complete ? <CheckCircle2 size={11} /> : null}
              {completeness.complete ? 'RCM-ready' : `${completeness.score}%`}
            </span>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-primary-600 hover:bg-primary-500 shadow-sm"
            >
              {isEmpty ? <><Plus size={13} /> Add</> : <><Pencil size={12} /> Edit</>}
            </button>
          </div>
        </div>

        {isEmpty ? (
          <button type="button" onClick={() => setOpen(true)} className="w-full text-left text-sm text-slate-400 italic hover:text-slate-600 transition-colors">
            How this equipment is run — duty, environment, and its design vs operating values. Reliability studies read it from here.
          </button>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {ctx.mode && <Chip>{OPERATING_MODES.find(m => m.code === ctx.mode)?.label || ctx.mode}</Chip>}
              {ctx.utilisation_pct != null && <Chip>{ctx.utilisation_pct}% utilisation</Chip>}
              {ctx.hours_per_year != null && <Chip>{ctx.hours_per_year.toLocaleString()} h/yr</Chip>}
              {ctx.starts_per_year != null && <Chip>{ctx.starts_per_year} starts/yr</Chip>}
              {ctx.redundancy && <Chip>{REDUNDANCY_OPTIONS.find(r => r.code === ctx.redundancy)?.label || ctx.redundancy}</Chip>}
              {ctx.service_medium && <Chip>{ctx.service_medium}</Chip>}
              {(ctx.environment || []).map(e => <Chip key={e}>{e}</Chip>)}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
              <span><strong className="text-slate-700 tabular-nums">{completeness.filledParameters}</strong> of {completeness.totalParameters} parameters filled</span>
              {aboveDesign.length > 0 && (
                <span className="inline-flex items-center gap-1 text-red-700 font-semibold">
                  <AlertTriangle size={11} /> Operating above design: {aboveDesign.map(p => p.label).join(', ')}
                </span>
              )}
              {!completeness.complete && <span className="text-amber-700">Still needed: {completeness.missing.join(', ')}</span>}
            </div>
          </div>
        )}
      </div>

      {open && createPortal(
        <OperatingContextModal
          asset={asset}
          ctx={ctx}
          onCommit={commit}
          onClose={() => setOpen(false)}
        />,
        document.body,
      )}
    </>
  );
};

// ── The editor, in a pop-up ─────────────────────────────────────────────────
const OperatingContextModal: React.FC<{
  asset: Asset;
  ctx: AssetOperatingContext;
  onCommit: (next: AssetOperatingContext) => void;
  onClose: () => void;
}> = ({ asset, ctx, onCommit, onClose }) => {
  const [newRow, setNewRow] = useState<{ label: string; unit: string } | null>(null);
  const completeness = useMemo(() => contextCompleteness(ctx), [ctx]);

  const set = <K extends keyof AssetOperatingContext>(k: K, v: AssetOperatingContext[K]) => onCommit({ ...ctx, [k]: v });
  const setParam = (key: string, patch: Partial<OperatingParameter>) =>
    onCommit({ ...ctx, parameters: (ctx.parameters || []).map(p => (p.key === key ? { ...p, ...patch } : p)) });
  const removeParam = (key: string) => onCommit({ ...ctx, parameters: (ctx.parameters || []).filter(p => p.key !== key) });
  const addParam = () => {
    if (!newRow || !newRow.label.trim()) return;
    const key = 'custom_' + newRow.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if ((ctx.parameters || []).some(p => p.key === key)) { setNewRow(null); return; }
    onCommit({ ...ctx, parameters: [...(ctx.parameters || []), { key, label: newRow.label.trim(), unit: newRow.unit.trim(), kind: 'both', custom: true, design: null, operating: null, max: null }] });
    setNewRow(null);
  };
  const toggleEnv = (e: string) => {
    const cur = ctx.environment || [];
    set('environment', cur.includes(e) ? cur.filter(x => x !== e) : [...cur, e]);
  };
  const num = (v: string): number | string | null => {
    if (v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  };

  const cls = getClass(asset.assetClass);
  const params = ctx.parameters || [];
  const flagged = params.filter(p => deviationFlag(p) === 'above_design');

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white w-full max-w-3xl max-h-[88vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <Gauge size={17} className="text-primary-600" /> Operating Context
            </h3>
            <p className="text-[11px] text-slate-500 truncate">{asset.tag} · {asset.name}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span
              title={completeness.missing.length ? `Still missing: ${completeness.missing.join('; ')}` : 'Enough for an RCM study'}
              className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full border ${completeness.complete ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}
            >
              {completeness.complete ? <CheckCircle2 size={11} /> : null}
              {completeness.complete ? 'RCM-ready' : `${completeness.score}% · ${completeness.missing[0]}`}
            </span>
            <button onClick={onClose} title="Close"><X size={20} className="text-slate-400 hover:text-slate-600" /></button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Operating mode</label>
              <select value={ctx.mode || ''} onChange={e => set('mode', (e.target.value || null) as AssetOperatingContext['mode'])} className={inputCls}>
                <option value="">Select mode…</option>
                {OPERATING_MODES.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
              </select>
              {ctx.mode && <p className="text-[10px] text-slate-400 mt-1">{OPERATING_MODES.find(m => m.code === ctx.mode)?.hint}</p>}
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Redundancy</label>
              <select value={ctx.redundancy || ''} onChange={e => set('redundancy', (e.target.value || null) as AssetOperatingContext['redundancy'])} className={inputCls}>
                <option value="">Select…</option>
                {REDUNDANCY_OPTIONS.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Utilisation</label>
              <div className="flex items-center gap-1">
                <input type="number" min={0} max={100} value={ctx.utilisation_pct ?? ''} onChange={e => set('utilisation_pct', e.target.value === '' ? null : Number(e.target.value))} className={inputCls} placeholder="e.g. 95" />
                <span className="text-xs text-slate-400 shrink-0">%</span>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Hours / starts per year</label>
              <div className="grid grid-cols-2 gap-1">
                <input type="number" min={0} max={8784} value={ctx.hours_per_year ?? ''} onChange={e => set('hours_per_year', e.target.value === '' ? null : Number(e.target.value))} className={inputCls} placeholder="h/yr" />
                <input type="number" min={0} value={ctx.starts_per_year ?? ''} onChange={e => set('starts_per_year', e.target.value === '' ? null : Number(e.target.value))} className={inputCls} placeholder="starts/yr" />
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Service medium</label>
              <input value={ctx.service_medium || ''} onChange={e => set('service_medium', e.target.value || null)} className={inputCls} placeholder="e.g. Sour crude 32 °API with 2 % BS&W; seawater; instrument air" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Environment</label>
              <div className="flex flex-wrap gap-1">
                {ENVIRONMENT_OPTIONS.map(e => {
                  const on = (ctx.environment || []).includes(e);
                  return (
                    <button key={e} type="button" onClick={() => toggleEnv(e)} className={`text-[11px] px-2 py-0.5 rounded-full border transition ${on ? 'bg-primary-50 border-primary-300 text-primary-700 font-semibold' : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                      {e}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Design vs operating parameters (Annex A) */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h4 className="text-xs font-bold text-slate-500 uppercase">
                Design vs operating parameters
                <span className="ml-2 font-normal normal-case text-slate-400">{cls ? `ISO 14224 ${cls.isoRef ? cls.isoRef + ' · ' : ''}${cls.label}` : asset.assetClass ? asset.assetClass : 'select an Asset Class to load its parameter set'}</span>
              </h4>
              <span className="text-[10px] text-slate-400">{completeness.filledParameters}/{completeness.totalParameters} filled</span>
            </div>
            {flagged.length > 0 && (
              <div className="flex items-start gap-2 mb-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[11px] text-red-700">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span><strong>Operating above design:</strong> {flagged.map(p => p.label).join(', ')}. Expect accelerated wear — the RCM study will be told.</span>
              </div>
            )}
            <div className="overflow-x-auto -mx-1">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                    <th className="text-left font-bold px-1 py-1.5">Parameter</th>
                    <th className="text-left font-bold px-1 py-1.5 w-16">Unit</th>
                    <th className="text-left font-bold px-1 py-1.5 w-28" title="Nameplate / rated / design value">Design</th>
                    <th className="text-left font-bold px-1 py-1.5 w-28" title="Normal operating value">Operating</th>
                    <th className="text-left font-bold px-1 py-1.5 w-24" title="Maximum operating value">Max</th>
                    <th className="text-left font-bold px-1 py-1.5 w-20" title="Operating as % of design">%</th>
                    <th className="w-6" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {params.map(p => {
                    const u = utilisationOf(p);
                    const flag = deviationFlag(p);
                    const designOnly = p.kind === 'design';
                    return (
                      <tr key={p.key} className={flag === 'above_design' ? 'bg-red-50/40' : ''}>
                        <td className="px-1 py-1 text-slate-700">
                          {p.label}
                          {p.custom && <span className="ml-1 text-[9px] text-slate-400 uppercase">custom</span>}
                        </td>
                        <td className="px-1 py-1 text-slate-400">{p.unit || '—'}</td>
                        <td className="px-1 py-1">
                          <input value={p.design ?? ''} onChange={e => setParam(p.key, { design: p.text ? e.target.value : num(e.target.value) })} className={cellCls} placeholder={p.text ? 'text' : 'rated'} />
                        </td>
                        <td className="px-1 py-1">
                          {designOnly ? <span className="text-slate-300 text-[10px]">nameplate only</span>
                            : <input value={p.operating ?? ''} onChange={e => setParam(p.key, { operating: num(e.target.value) })} className={cellCls} placeholder="normal" />}
                        </td>
                        <td className="px-1 py-1">
                          {designOnly ? '' : <input value={p.max ?? ''} onChange={e => setParam(p.key, { max: num(e.target.value) })} className={cellCls} placeholder="max" />}
                        </td>
                        <td className="px-1 py-1 tabular-nums">
                          {u !== null && (
                            <span className={`inline-flex items-center gap-0.5 font-semibold ${flag === 'above_design' ? 'text-red-600' : flag === 'far_below_design' ? 'text-amber-600' : 'text-slate-500'}`}>
                              {flag === 'above_design' ? <AlertTriangle size={10} /> : flag === 'far_below_design' ? <ArrowDownRight size={10} /> : null}{u}%
                            </span>
                          )}
                        </td>
                        <td className="px-1 py-1 text-right">
                          {p.custom && <button type="button" onClick={() => removeParam(p.key)} className="text-slate-300 hover:text-red-500" title="Remove custom parameter"><Trash2 size={12} /></button>}
                        </td>
                      </tr>
                    );
                  })}
                  {params.length === 0 && (
                    <tr><td colSpan={7} className="px-1 py-4 text-center text-slate-400 italic">Choose an Asset Category and Class on the Details tab to load the ISO 14224 parameter set for this equipment.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {newRow ? (
              <div className="flex items-center gap-2 mt-2">
                <input autoFocus value={newRow.label} onChange={e => setNewRow({ ...newRow, label: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') addParam(); if (e.key === 'Escape') setNewRow(null); }} placeholder="Parameter name" className={`${cellCls} max-w-[220px]`} />
                <input value={newRow.unit} onChange={e => setNewRow({ ...newRow, unit: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') addParam(); }} placeholder="unit" className={`${cellCls} w-20`} />
                <button type="button" onClick={addParam} className="text-[11px] font-semibold text-white bg-primary-600 hover:bg-primary-500 px-2.5 py-1 rounded-md">Add</button>
                <button type="button" onClick={() => setNewRow(null)} className="text-[11px] text-slate-500 px-2 py-1">Cancel</button>
              </div>
            ) : (
              <button type="button" onClick={() => setNewRow({ label: '', unit: '' })} className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-primary-600 hover:text-primary-700">
                <Plus size={12} /> Add other parameter
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <span className="text-[11px] text-slate-500">Changes apply to the record — use <strong>Save</strong> on the asset to persist them.</span>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary-600 hover:bg-primary-500 shadow-sm">Done</button>
        </div>
      </div>
    </div>
  );
};

export default OperatingContextCard;
