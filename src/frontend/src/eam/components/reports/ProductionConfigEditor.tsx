import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { Settings2, Save, Loader2, X, CheckCircle2, AlertTriangle, Gauge } from 'lucide-react';
import { OEE_TARGETS, type ProcessType } from '../../../lib/smrpCatalog';

/**
 * Per-asset production parameters behind the OEE calculation
 * (asset_production_config, 0105 + 0307): the best rate the performance leg
 * divides by, the unit of measure, the quality/OEE targets, and — since the
 * SMRP 7th-edition pass — the process type that picks the best-in-class OEE
 * band (batch 85 / continuous discrete 90 / continuous process 95).
 *
 * Until this panel existed the only writer was seed SQL, so every asset sat
 * on the batch band whatever it was.
 */

const UOM_OPTIONS = ['units', 'barrels', 'tonnes', 'litres', 'cubic_metres', 'kg'];

interface ConfigForm {
  process_type: ProcessType;
  ideal_cycle_time_sec: number;
  design_capacity_per_hr: number;
  uom: string;
  planned_production_hrs_day: number;
  quality_target_pct: number;
  oee_target_pct: number;
}

const DEFAULTS: ConfigForm = {
  process_type: 'batch',
  ideal_cycle_time_sec: 0,
  design_capacity_per_hr: 0,
  uom: 'units',
  planned_production_hrs_day: 24,
  quality_target_pct: 99.5,
  oee_target_pct: OEE_TARGETS.batch.oee,
};

const inputBase = 'w-full bg-slate-800/80 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500 transition';

const Label: React.FC<{ children: React.ReactNode; hint?: string }> = ({ children, hint }) => (
  <label className="block text-xs font-semibold text-slate-300 mb-1 tracking-wide">
    {children}
    {hint && <span className="ml-1.5 font-normal text-slate-500">{hint}</span>}
  </label>
);

export const ProductionConfigEditor: React.FC<{
  assetId?: string;
  onClose?: () => void;
}> = ({ assetId: initialAssetId, onClose }) => {
  const queryClient = useQueryClient();
  const [assetId, setAssetId] = useState(initialAssetId || '');
  const [form, setForm] = useState<ConfigForm>(DEFAULTS);
  // The OEE target follows the process band until the user types their own.
  const [targetTouched, setTargetTouched] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (initialAssetId) setAssetId(initialAssetId); }, [initialAssetId]);

  const { data: assets = [] } = useQuery({
    queryKey: ['prod-log-assets'],
    queryFn: async () => {
      const { data } = await supabase.from('assets').select('id, tag, name, hierarchy_level').order('tag');
      return data || [];
    },
  });

  const { data: existing, isFetching } = useQuery({
    queryKey: ['asset-prod-config', assetId],
    queryFn: async () => {
      if (!assetId) return null;
      const { data } = await supabase.from('asset_production_config').select('*').eq('asset_id', assetId).maybeSingle();
      return data;
    },
    enabled: !!assetId,
  });

  // Seed the form from the stored row (or defaults) whenever the asset changes.
  useEffect(() => {
    setSaved(false);
    if (!assetId) { setForm(DEFAULTS); setTargetTouched(false); return; }
    if (existing) {
      const pt = (existing.process_type as ProcessType) || 'batch';
      setForm({
        process_type: pt,
        ideal_cycle_time_sec: Number(existing.ideal_cycle_time_sec) || 0,
        design_capacity_per_hr: Number(existing.design_capacity_per_hr) || 0,
        uom: existing.uom || 'units',
        planned_production_hrs_day: Number(existing.planned_production_hrs_day) || 24,
        quality_target_pct: Number(existing.quality_target_pct) || 99.5,
        oee_target_pct: Number(existing.oee_target_pct) || OEE_TARGETS[pt].oee,
      });
      setTargetTouched(Number(existing.oee_target_pct) !== OEE_TARGETS[pt].oee);
    } else if (existing === null) {
      setForm(DEFAULTS);
      setTargetTouched(false);
    }
  }, [assetId, existing]);

  const update = <K extends keyof ConfigForm>(k: K, v: ConfigForm[K]) => setForm(f => ({ ...f, [k]: v }));

  const setProcess = (pt: ProcessType) => {
    setForm(f => ({ ...f, process_type: pt, oee_target_pct: targetTouched ? f.oee_target_pct : OEE_TARGETS[pt].oee }));
  };

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('asset_production_config')
        .upsert({ asset_id: assetId, ...form, updated_at: new Date().toISOString() }, { onConflict: 'asset_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ['asset-prod-config', assetId] });
      queryClient.invalidateQueries({ queryKey: ['report-oee'] });
      queryClient.invalidateQueries({ queryKey: ['plant-oee'] });
    },
  });

  const selected = useMemo(() => assets.find((a: any) => a.id === assetId), [assets, assetId]);
  const noBestRate = form.ideal_cycle_time_sec <= 0 && form.design_capacity_per_hr <= 0;
  const bandTarget = OEE_TARGETS[form.process_type].oee;

  return (
    <div className="bg-slate-900/80 border border-slate-700/60 rounded-xl overflow-hidden backdrop-blur">
      <div className="px-5 py-3.5 bg-gradient-to-r from-slate-700/40 to-primary-600/20 border-b border-slate-700/50 flex items-center gap-2.5">
        <Settings2 size={18} className="text-primary-400" />
        <h3 className="text-sm font-bold text-white tracking-wide">Asset Setup for OEE</h3>
        <span className="text-[11px] text-slate-400">best rate · process type · targets</span>
        {onClose && (
          <button type="button" onClick={onClose} className="ml-auto text-slate-400 hover:text-white" aria-label="Close">
            <X size={16} />
          </button>
        )}
      </div>

      <div className="p-5 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <Label>ASSET</Label>
            <select className={inputBase} value={assetId} onChange={e => setAssetId(e.target.value)}>
              <option value="">Select an asset…</option>
              {assets.map((a: any) => (
                <option key={a.id} value={a.id}>{a.tag} · {a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label hint="SMRP 2.1.1 band">PROCESS TYPE</Label>
            <select className={inputBase} value={form.process_type} onChange={e => setProcess(e.target.value as ProcessType)} disabled={!assetId}>
              {(Object.keys(OEE_TARGETS) as ProcessType[]).map(pt => (
                <option key={pt} value={pt}>{OEE_TARGETS[pt].label} · {OEE_TARGETS[pt].oee}%+</option>
              ))}
            </select>
          </div>
        </div>

        {assetId && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <Label hint="sec / unit">IDEAL CYCLE TIME</Label>
                <input type="number" min={0} step="0.01" className={inputBase} value={form.ideal_cycle_time_sec}
                  onChange={e => update('ideal_cycle_time_sec', Number(e.target.value))} />
              </div>
              <div>
                <Label hint="best rate / hr">DESIGN CAPACITY</Label>
                <input type="number" min={0} step="0.1" className={inputBase} value={form.design_capacity_per_hr}
                  onChange={e => update('design_capacity_per_hr', Number(e.target.value))} />
              </div>
              <div>
                <Label>UNIT OF MEASURE</Label>
                <select className={inputBase} value={form.uom} onChange={e => update('uom', e.target.value)}>
                  {UOM_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <Label hint="hrs / day">PLANNED PRODUCTION</Label>
                <input type="number" min={0} max={24} step="0.5" className={inputBase} value={form.planned_production_hrs_day}
                  onChange={e => update('planned_production_hrs_day', Number(e.target.value))} />
              </div>
              <div>
                <Label hint="% first-pass">QUALITY TARGET</Label>
                <input type="number" min={0} max={100} step="0.1" className={inputBase} value={form.quality_target_pct}
                  onChange={e => update('quality_target_pct', Number(e.target.value))} />
              </div>
              <div>
                <Label hint={targetTouched ? `band ${bandTarget}%` : 'from band'}>OEE TARGET %</Label>
                <input type="number" min={0} max={100} step="1" className={inputBase} value={form.oee_target_pct}
                  onChange={e => { setTargetTouched(true); update('oee_target_pct', Number(e.target.value)); }} />
              </div>
            </div>

            {noBestRate ? (
              <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>No best rate yet — the performance leg cannot be computed for {selected?.tag || 'this asset'}. Enter either an ideal cycle time or a design capacity. The 7th Edition warns that a mis-specified best rate shows up as performance above 100%.</span>
              </div>
            ) : (
              <div className="flex items-start gap-2 text-xs text-slate-400">
                <Gauge size={14} className="mt-0.5 shrink-0 text-slate-500" />
                <span>
                  Best rate: {form.ideal_cycle_time_sec > 0
                    ? `${form.ideal_cycle_time_sec}s per ${form.uom.replace(/s$/, '')} (${Math.round(3600 / form.ideal_cycle_time_sec)} ${form.uom}/hr)`
                    : `${form.design_capacity_per_hr} ${form.uom}/hr`}
                  {' · '}best-in-class OEE for {OEE_TARGETS[form.process_type].label.toLowerCase()} is {bandTarget}%+.
                </span>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => save.mutate()}
                disabled={save.isPending || isFetching}
                className="px-4 py-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 rounded-lg text-sm text-white font-semibold transition flex items-center gap-2"
              >
                {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {existing ? 'Update' : 'Save'} setup
              </button>
              {saved && !save.isPending && (
                <span className="text-xs text-emerald-300 flex items-center gap-1"><CheckCircle2 size={13} /> Saved — OEE recomputes on next load.</span>
              )}
              {save.isError && (
                <span className="text-xs text-red-300">Could not save: {(save.error as any)?.message || 'unknown error'}</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ProductionConfigEditor;
