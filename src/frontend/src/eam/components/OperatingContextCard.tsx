/**
 * OperatingContextCard — the ISO 14224 operating context of one asset, on the
 * register's Details tab (0317).
 *
 * Two halves: the Table 5 operating data (mode, utilisation, redundancy,
 * environment, medium, duty narrative) and the Annex A class-specific
 * parameter table with a Design (nameplate) value, a Normal operating value
 * and an optional Max. Rows arrive from the class template the moment a class
 * is chosen; custom rows can be added. Operating above design is flagged
 * inline because that is exactly what an RCM study needs to see.
 *
 * Edits flow through onUpdate like every other Details-tab field, so the
 * page's Save button persists them (DatabaseService.updateAsset →
 * assets.operating_context). Pure presentation: the rules live in
 * lib/operatingContext.ts.
 */
import React, { useMemo, useState } from 'react';
import { Gauge, Plus, Trash2, AlertTriangle, ArrowDownRight, Info, CheckCircle2 } from 'lucide-react';
import type { Asset } from '../types';
import {
  normalizeContext, mergeTemplate, utilisationOf, deviationFlag, contextCompleteness,
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

export const OperatingContextCard: React.FC<Props> = ({ asset, onUpdate }) => {
  // The stored shape, merged with the template for the CURRENT class so the
  // table always shows the rows this class needs (values are never lost).
  const ctx = useMemo<AssetOperatingContext>(
    () => mergeTemplate(normalizeContext(asset.operatingContext), asset.assetClass, asset.assetCategory),
    [asset.operatingContext, asset.assetClass, asset.assetCategory],
  );
  const completeness = useMemo(() => contextCompleteness(ctx), [ctx]);
  const [newRow, setNewRow] = useState<{ label: string; unit: string } | null>(null);

  const commit = (next: AssetOperatingContext) => {
    onUpdate({ ...asset, operatingContext: { ...next, updated_at: new Date().toISOString() } });
  };
  const set = <K extends keyof AssetOperatingContext>(k: K, v: AssetOperatingContext[K]) => commit({ ...ctx, [k]: v });
  const setParam = (key: string, patch: Partial<OperatingParameter>) =>
    commit({ ...ctx, parameters: (ctx.parameters || []).map(p => (p.key === key ? { ...p, ...patch } : p)) });
  const removeParam = (key: string) => commit({ ...ctx, parameters: (ctx.parameters || []).filter(p => p.key !== key) });
  const addParam = () => {
    if (!newRow || !newRow.label.trim()) return;
    const key = 'custom_' + newRow.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if ((ctx.parameters || []).some(p => p.key === key)) { setNewRow(null); return; }
    commit({ ...ctx, parameters: [...(ctx.parameters || []), { key, label: newRow.label.trim(), unit: newRow.unit.trim(), kind: 'both', custom: true, design: null, operating: null, max: null }] });
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
    <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-2">
        <div>
          <h3 className="font-bold text-slate-800 flex items-center gap-2"><Gauge size={16} className="text-slate-400" /> Operating Context</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">ISO 14224 §7 operating data and Annex A design vs operating parameters. RCM studies and the Reliability Specialist read this.</p>
        </div>
        <span
          title={completeness.missing.length ? `Still missing: ${completeness.missing.join('; ')}` : 'Enough for an RCM study'}
          className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full border ${completeness.complete ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}
        >
          {completeness.complete ? <CheckCircle2 size={11} /> : <Info size={11} />}
          {completeness.complete ? 'RCM-ready' : `${completeness.score}% · ${completeness.missing[0]}`}
        </span>
      </div>

      {/* ── Operating data (Table 5) ── */}
      <div className="grid grid-cols-2 gap-4">
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
        <div className="col-span-2">
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Service medium</label>
          <input value={ctx.service_medium || ''} onChange={e => set('service_medium', e.target.value || null)} className={inputCls} placeholder="e.g. Sour crude 32 °API with 2 % BS&W; seawater; instrument air" />
        </div>
        <div className="col-span-2">
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
        <div className="col-span-2">
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Duty description</label>
          <textarea value={ctx.duty_description || ''} onChange={e => set('duty_description', e.target.value || null)} rows={2} className={`${inputCls} resize-y`} placeholder="What it does, for which process, and how it is run — e.g. 'Charges the crude unit from the desalter; runs at reduced rate during turnaround; spared by P-101B'" />
        </div>
      </div>

      {/* ── Design vs operating parameters (Annex A) ── */}
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
                <tr><td colSpan={7} className="px-1 py-4 text-center text-slate-400 italic">Choose an Asset Category and Class above to load the ISO 14224 parameter set for this equipment.</td></tr>
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
      {ctx.updated_at && <p className="text-[10px] text-slate-400">Last updated {new Date(ctx.updated_at).toLocaleString()}</p>}
    </div>
  );
};

export default OperatingContextCard;
