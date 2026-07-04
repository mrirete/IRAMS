import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import {
  Factory, Save, Clock, AlertTriangle, CheckCircle2,
  ChevronDown, Loader2, Package, Search, X, Tag,
  Calendar, Sun, Timer, Zap, BarChart3, ThumbsUp,
  XCircle, RotateCcw, FileText, MessageSquare
} from 'lucide-react';

interface ProductionLogFormData {
  asset_id: string;
  shift_date: string;
  shift: string;
  planned_run_time_min: number;
  actual_run_time_min: number;
  total_output: number;
  good_output: number;
  defect_count: number;
  rework_count: number;
  downtime_minutes: number;
  downtime_reason_code: string;
  notes: string;
  source: string;
}

const DEFAULT_FORM: ProductionLogFormData = {
  asset_id: '',
  shift_date: new Date().toISOString().split('T')[0],
  shift: 'DAY',
  planned_run_time_min: 480,
  actual_run_time_min: 0,
  total_output: 0,
  good_output: 0,
  defect_count: 0,
  rework_count: 0,
  downtime_minutes: 0,
  downtime_reason_code: '',
  notes: '',
  source: 'manual',
};

const SHIFT_OPTIONS = [
  { value: 'DAY', label: 'Day Shift (06:00 - 18:00)' },
  { value: 'NIGHT', label: 'Night Shift (18:00 - 06:00)' },
  { value: 'SWING', label: 'Swing Shift (14:00 - 22:00)' },
  { value: 'A', label: 'Rotation A' },
  { value: 'B', label: 'Rotation B' },
  { value: 'C', label: 'Rotation C' },
  { value: 'D', label: 'Rotation D' },
];

/* ─────────── Searchable Asset Picker ─────────── */
const AssetSearchPicker: React.FC<{
  value: string;
  onChange: (id: string) => void;
  assets: any[];
}> = ({ value, onChange, assets }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return assets;
    const q = search.toLowerCase();
    return assets.filter((a: any) =>
      (a.tag?.toLowerCase() || '').includes(q) ||
      (a.name?.toLowerCase() || '').includes(q) ||
      (a.hierarchy_level?.toLowerCase() || '').includes(q)
    );
  }, [assets, search]);

  const selected = assets.find((a: any) => a.id === value);

  return (
    <div ref={ref} className="relative">
      <label className="block text-xs font-semibold text-slate-200 mb-1.5 tracking-wide">
        ASSET <span className="text-amber-400">*</span>
      </label>

      {/* Selected display / trigger */}
      <button
        type="button"
        onClick={() => { setOpen(!open); setTimeout(() => inputRef.current?.focus(), 50); }}
        className={`w-full flex items-center gap-2 bg-slate-800/80 border rounded-lg px-3 py-2.5 text-left transition
          ${open ? 'border-primary-500 ring-2 ring-primary-500/30' : 'border-slate-600 hover:border-slate-500'}
          ${!value ? 'text-slate-500' : 'text-white'}`}
      >
        <Search size={14} className="text-slate-400 shrink-0" />
        {selected ? (
          <span className="text-sm truncate">
            <span className="text-primary-300 font-semibold">{selected.tag}</span>
            <span className="text-slate-400 mx-1.5">|</span>
            <span className="text-white">{selected.name}</span>
          </span>
        ) : (
          <span className="text-sm text-slate-500">Search by tag, name, or type...</span>
        )}
        {value && (
          <X
            size={14}
            className="ml-auto text-slate-400 hover:text-white shrink-0"
            onClick={(e) => { e.stopPropagation(); onChange(''); setSearch(''); }}
          />
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-slate-800 border border-slate-600 rounded-lg shadow-2xl shadow-black/50 overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b border-slate-700">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={inputRef}
                type="text"
                className="w-full bg-slate-900 border border-slate-600 rounded-md pl-8 pr-3 py-2 text-sm text-white
                  placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500"
                placeholder="Filter by tag, name, or type..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Results */}
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-slate-500">No assets match "{search}"</div>
            ) : (
              filtered.map((a: any) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => { onChange(a.id); setOpen(false); setSearch(''); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition hover:bg-slate-700/60
                    ${a.id === value ? 'bg-primary-900/30 border-l-2 border-primary-400' : 'border-l-2 border-transparent'}`}
                >
                  <Tag size={13} className="text-slate-500 shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-primary-300">{a.tag}</span>
                      {a.hierarchy_level && (
                        <span className="text-[10px] bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded">
                          {a.hierarchy_level}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 truncate">{a.name}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/* ─────────── Field Label Component ─────────── */
const FieldLabel: React.FC<{
  children: React.ReactNode;
  icon?: React.ReactNode;
  color?: 'default' | 'green' | 'red' | 'amber';
}> = ({ children, icon, color = 'default' }) => {
  const colorClasses = {
    default: 'text-slate-300',
    green: 'text-emerald-300',
    red: 'text-red-300',
    amber: 'text-amber-300',
  };
  return (
    <label className={`flex items-center gap-1.5 text-xs font-semibold mb-1.5 tracking-wide ${colorClasses[color]}`}>
      {icon}
      {children}
    </label>
  );
};

/* ─────────── Section Header ─────────── */
const SectionHeader: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}> = ({ icon, title, subtitle }) => (
  <div className="flex items-center gap-2 mb-3">
    <div className="text-slate-300">{icon}</div>
    <span className="text-xs font-bold text-slate-200 tracking-wider uppercase">{title}</span>
    {subtitle && <span className="text-xs text-slate-500">{subtitle}</span>}
  </div>
);


export const ProductionLogEntry: React.FC<{
  assetId?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}> = ({ assetId, onSuccess, onCancel }) => {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ProductionLogFormData>({
    ...DEFAULT_FORM,
    asset_id: assetId || '',
  });
  const [showDowntimeDetail, setShowDowntimeDetail] = useState(false);

  // Fetch assets  — include hierarchy_level for filtering
  const { data: assets = [] } = useQuery({
    queryKey: ['prod-log-assets'],
    queryFn: async () => {
      const { data } = await supabase
        .from('assets')
        .select('id, tag, name, hierarchy_level')
        .order('tag');
      return data || [];
    },
  });

  // Fetch downtime reason codes
  const { data: downtimeReasons = [] } = useQuery({
    queryKey: ['downtime-reasons'],
    queryFn: async () => {
      const { data } = await supabase
        .from('dictionaries')
        .select('code, description')
        .eq('type', 'DOWNTIME_REASON')
        .eq('active', true);
      return data || [];
    },
  });

  // Fetch production config for selected asset
  const { data: assetConfig } = useQuery({
    queryKey: ['asset-prod-config', form.asset_id],
    queryFn: async () => {
      if (!form.asset_id) return null;
      const { data } = await supabase
        .from('asset_production_config')
        .select('*')
        .eq('asset_id', form.asset_id)
        .maybeSingle();
      return data;
    },
    enabled: !!form.asset_id,
  });

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (logData: ProductionLogFormData) => {
      const { error } = await supabase.from('production_logs').insert({
        asset_id: logData.asset_id,
        shift_date: logData.shift_date,
        shift: logData.shift,
        planned_run_time_min: logData.planned_run_time_min,
        actual_run_time_min: logData.actual_run_time_min,
        total_output: logData.total_output,
        good_output: logData.good_output,
        defect_count: logData.defect_count,
        rework_count: logData.rework_count,
        downtime_minutes: logData.downtime_minutes,
        downtime_reason_code: logData.downtime_reason_code || null,
        notes: logData.notes || null,
        source: logData.source,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-logs'] });
      queryClient.invalidateQueries({ queryKey: ['report-oee'] });
      queryClient.invalidateQueries({ queryKey: ['plant-oee'] });
      setForm({ ...DEFAULT_FORM, asset_id: assetId || '' });
      onSuccess?.();
    },
  });

  // Live OEE calculation preview
  const liveOEE = useMemo(() => {
    const a = form.planned_run_time_min > 0
      ? (form.actual_run_time_min / form.planned_run_time_min) * 100 : 0;
    let p = 0;
    if (form.actual_run_time_min > 0 && assetConfig) {
      if (assetConfig.ideal_cycle_time_sec > 0) {
        p = (form.total_output * assetConfig.ideal_cycle_time_sec) / (form.actual_run_time_min * 60) * 100;
      } else if (assetConfig.design_capacity_per_hr > 0) {
        p = form.total_output / (form.actual_run_time_min / 60 * assetConfig.design_capacity_per_hr) * 100;
      }
    }
    p = Math.min(p, 100);
    const q = form.total_output > 0 ? (form.good_output / form.total_output) * 100 : 0;
    const oee = a * p * q / 10000;
    return { availability: a, performance: p, quality: q, oee };
  }, [form, assetConfig]);

  const update = useCallback((field: keyof ProductionLogFormData, value: any) => {
    setForm(prev => {
      const next = { ...prev, [field]: value };
      if (field === 'total_output' || field === 'defect_count' || field === 'rework_count') {
        const total = field === 'total_output' ? Number(value) : prev.total_output;
        const defects = field === 'defect_count' ? Number(value) : prev.defect_count;
        const rework = field === 'rework_count' ? Number(value) : prev.rework_count;
        next.good_output = Math.max(0, total - defects - rework);
      }
      if (field === 'downtime_minutes') {
        next.actual_run_time_min = Math.max(0, prev.planned_run_time_min - Number(value));
      }
      if (field === 'planned_run_time_min') {
        next.actual_run_time_min = Math.max(0, Number(value) - prev.downtime_minutes);
      }
      return next;
    });
  }, []);

  const canSubmit = form.asset_id && form.actual_run_time_min > 0 && form.total_output >= 0;

  const getOEERagColor = (value: number) => {
    if (value >= 85) return 'text-emerald-400';
    if (value >= 65) return 'text-amber-400';
    return 'text-red-400';
  };

  const inputBase = 'w-full bg-slate-800/80 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white text-center focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500 transition';

  return (
    <div className="bg-slate-900/80 border border-slate-700/60 rounded-xl overflow-hidden backdrop-blur">
      {/* Header */}
      <div className="px-5 py-3.5 bg-gradient-to-r from-blue-600/25 to-primary-600/20 border-b border-slate-700/50 flex items-center gap-2.5">
        <Factory size={18} className="text-primary-400" />
        <h3 className="text-sm font-bold text-white tracking-wide">Production Log Entry</h3>
        {assetConfig && (
          <span className="ml-auto text-xs bg-emerald-500/20 text-emerald-300 px-2.5 py-1 rounded-full font-medium">
            Capacity: {assetConfig.design_capacity_per_hr} {assetConfig.uom}/hr
          </span>
        )}
      </div>

      <div className="p-5 space-y-5">
        {/* Row 1: Searchable Asset + Date + Shift */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <AssetSearchPicker
            value={form.asset_id}
            onChange={(id) => update('asset_id', id)}
            assets={assets}
          />
          <div>
            <FieldLabel icon={<Calendar size={13} />}>SHIFT DATE</FieldLabel>
            <input
              type="date"
              className={`${inputBase} text-left`}
              value={form.shift_date}
              onChange={e => update('shift_date', e.target.value)}
            />
          </div>
          <div>
            <FieldLabel icon={<Sun size={13} />}>SHIFT</FieldLabel>
            <select
              className={`${inputBase} text-left`}
              value={form.shift}
              onChange={e => update('shift', e.target.value)}
            >
              {SHIFT_OPTIONS.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Row 2: Time Section */}
        <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/40">
          <SectionHeader
            icon={<Clock size={14} />}
            title="Time"
            subtitle="minutes"
          />
          <div className="grid grid-cols-3 gap-4">
            <div>
              <FieldLabel icon={<Timer size={13} />}>Planned Time</FieldLabel>
              <input
                type="number"
                className={inputBase}
                value={form.planned_run_time_min}
                onChange={e => update('planned_run_time_min', Number(e.target.value))}
              />
            </div>
            <div>
              <FieldLabel icon={<Zap size={13} />} color="amber">Downtime</FieldLabel>
              <input
                type="number"
                className={`${inputBase} !border-amber-600/50 !text-amber-300`}
                value={form.downtime_minutes}
                onChange={e => update('downtime_minutes', Number(e.target.value))}
              />
            </div>
            <div>
              <FieldLabel icon={<CheckCircle2 size={13} />} color="green">Actual Run</FieldLabel>
              <div className={`${inputBase} !bg-slate-900/60 !border-emerald-700/40 !text-emerald-300 font-mono font-semibold cursor-default`}>
                {form.actual_run_time_min}
              </div>
            </div>
          </div>
        </div>

        {/* Row 3: Output + Quality */}
        <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/40">
          <SectionHeader
            icon={<Package size={14} />}
            title="Output & Quality"
            subtitle={assetConfig ? `(${assetConfig.uom})` : undefined}
          />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <FieldLabel icon={<BarChart3 size={13} />}>Total Output</FieldLabel>
              <input
                type="number"
                className={inputBase}
                value={form.total_output}
                onChange={e => update('total_output', Number(e.target.value))}
              />
            </div>
            <div>
              <FieldLabel icon={<ThumbsUp size={13} />} color="green">Good Output</FieldLabel>
              <div className={`${inputBase} !bg-emerald-950/30 !border-emerald-700/40 !text-emerald-300 font-mono font-semibold cursor-default`}>
                {form.good_output}
              </div>
            </div>
            <div>
              <FieldLabel icon={<XCircle size={13} />} color="red">Defects</FieldLabel>
              <input
                type="number"
                className={`${inputBase} !border-red-700/40 !text-red-300`}
                value={form.defect_count}
                onChange={e => update('defect_count', Number(e.target.value))}
              />
            </div>
            <div>
              <FieldLabel icon={<RotateCcw size={13} />} color="amber">Rework</FieldLabel>
              <input
                type="number"
                className={`${inputBase} !border-amber-700/40 !text-amber-300`}
                value={form.rework_count}
                onChange={e => update('rework_count', Number(e.target.value))}
              />
            </div>
          </div>
        </div>

        {/* Downtime Reason (expandable) */}
        <button
          className="w-full text-left text-xs text-slate-300 hover:text-white flex items-center gap-2 py-1 transition font-medium"
          onClick={() => setShowDowntimeDetail(!showDowntimeDetail)}
        >
          <ChevronDown size={14} className={`transition-transform ${showDowntimeDetail ? 'rotate-180' : ''}`} />
          Downtime Details & Notes
        </button>
        {showDowntimeDetail && (
          <div className="space-y-4 pl-3 border-l-2 border-slate-600">
            <div>
              <FieldLabel icon={<FileText size={13} />}>Downtime Reason</FieldLabel>
              <select
                className={`${inputBase} text-left`}
                value={form.downtime_reason_code}
                onChange={e => update('downtime_reason_code', e.target.value)}
              >
                <option value="">Select reason...</option>
                {downtimeReasons.map((r: any) => (
                  <option key={r.code} value={r.code}>{r.description}</option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel icon={<MessageSquare size={13} />}>Notes</FieldLabel>
              <textarea
                className="w-full bg-slate-800/80 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white resize-none
                  placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500"
                rows={2}
                placeholder="Shift notes, observations, issues..."
                value={form.notes}
                onChange={e => update('notes', e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Live OEE Preview */}
        {form.asset_id && form.actual_run_time_min > 0 && (
          <div className="bg-gradient-to-r from-slate-800/70 to-slate-900/70 rounded-xl p-4 border border-slate-600/40">
            <p className="text-xs font-bold text-slate-300 mb-3 tracking-wider uppercase">Live OEE Preview</p>
            <div className="grid grid-cols-4 gap-3 text-center">
              <div>
                <p className="text-xs text-slate-400 mb-1">Availability</p>
                <p className={`text-lg font-bold font-mono ${getOEERagColor(liveOEE.availability)}`}>
                  {liveOEE.availability.toFixed(1)}%
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">Performance</p>
                <p className={`text-lg font-bold font-mono ${assetConfig ? getOEERagColor(liveOEE.performance) : 'text-slate-500'}`}>
                  {assetConfig ? `${liveOEE.performance.toFixed(1)}%` : '—'}
                </p>
                {!assetConfig && <p className="text-[10px] text-amber-400 mt-0.5">No config</p>}
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">Quality</p>
                <p className={`text-lg font-bold font-mono ${getOEERagColor(liveOEE.quality)}`}>
                  {liveOEE.quality.toFixed(1)}%
                </p>
              </div>
              <div className="bg-slate-700/40 rounded-lg p-2">
                <p className="text-xs text-slate-300 font-bold mb-1">OEE</p>
                <p className={`text-xl font-black font-mono ${getOEERagColor(liveOEE.oee)}`}>
                  {liveOEE.oee.toFixed(1)}%
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          {onCancel && (
            <button
              onClick={onCancel}
              className="flex-1 px-4 py-3 bg-slate-800 border border-slate-600 rounded-lg text-sm text-slate-300 font-medium hover:bg-slate-700 transition"
            >
              Cancel
            </button>
          )}
          <button
            onClick={() => saveMutation.mutate(form)}
            disabled={!canSubmit || saveMutation.isPending}
            className="flex-1 px-4 py-3 bg-gradient-to-r from-primary-600 to-blue-600 rounded-lg text-sm text-white font-bold
              hover:from-primary-500 hover:to-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition
              flex items-center justify-center gap-2 shadow-lg shadow-primary-600/20"
          >
            {saveMutation.isPending ? (
              <><Loader2 size={14} className="animate-spin" /> Saving...</>
            ) : saveMutation.isSuccess ? (
              <><CheckCircle2 size={14} /> Saved!</>
            ) : (
              <><Save size={14} /> Save Production Log</>
            )}
          </button>
        </div>

        {saveMutation.isError && (
          <div className="flex items-center gap-2 text-red-300 text-xs bg-red-900/30 border border-red-700/40 rounded-lg p-3">
            <AlertTriangle size={14} />
            {(saveMutation.error as Error).message || 'Failed to save'}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProductionLogEntry;
