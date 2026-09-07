/**
 * Shared RCM field controls — used by the Strategy wizard and the Maintenance
 * Plan so a task line or an interval is edited the same way wherever it shows.
 */
import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import {
  INTERVAL_UNITS, parseIntervalText, canonicalInterval, type IntervalUnit,
} from '../../eam/services/rcmPlan';

// ── Synced text field ───────────────────────────────────────
// Local state so the caret never jumps, debounced commit, and a re-sync when
// the stored value changes underneath while the field isn't focused — which is
// exactly what happens when the Specialist's recommendation (or "Use measured")
// writes task_description/interval/justification.
export const SyncedField: React.FC<{
  value: string | null | undefined;
  onCommit: (v: string) => void;
  placeholder?: string;
  minRows?: number;
  maxRows?: number;
  label: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}> = ({ value, onCommit, placeholder, minRows, maxRows = 14, label, disabled, autoFocus, className }) => {
  const incoming = value ?? '';
  const [local, setLocal] = useState(incoming);
  const focused = useRef(false);
  const committed = useRef(incoming);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!focused.current && incoming !== committed.current) {
      committed.current = incoming;
      setLocal(incoming);
    }
  }, [incoming]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Auto-grow: measure after every render that changed the text.
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const line = 22; // text-sm leading-relaxed ≈ 22px
    const max = maxRows * line + 20;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [local, maxRows]);

  const commit = (v: string) => {
    if (v === committed.current) return;
    committed.current = v;
    onCommit(v);
  };
  const handleChange = (v: string) => {
    setLocal(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(v), 700);
  };
  const shared = {
    value: local,
    placeholder,
    disabled,
    autoFocus,
    'aria-label': label,
    onFocus: () => { focused.current = true; },
    onBlur: () => { focused.current = false; if (timer.current) clearTimeout(timer.current); commit(local); },
    className: `w-full mt-1 px-3 py-2 text-sm leading-relaxed text-slate-800 bg-white border border-slate-200 rounded-lg focus:border-accent-cyan focus:ring-2 focus:ring-accent-cyan/20 focus:outline-none placeholder:text-slate-400 disabled:bg-slate-50 disabled:text-slate-500 ${className || ''}`,
  };
  return minRows
    ? <textarea ref={areaRef} {...shared} rows={minRows} onChange={e => handleChange(e.target.value)} style={{ resize: 'none' }} />
    : <input type="text" {...shared} onChange={e => handleChange(e.target.value)} />;
};

// ── Structured interval ─────────────────────────────────────
// The interval is the program's executable output — free text like "when
// needed" can't schedule anything. Value + unit compose a canonical string
// ("1700 Hours") that the PM generator parses losslessly. Legacy free text
// that doesn't parse is kept in the field's tooltip (amber border) rather
// than as a sentence under it.
export const IntervalField: React.FC<{
  value: string | null | undefined;
  onCommit: (v: string | null) => void;
  disabled?: boolean;
  compact?: boolean;
}> = ({ value, onCommit, disabled, compact }) => {
  const parsed = parseIntervalText(value);
  const unparseable = !!parsed.raw && parsed.n === null;
  const isProse = parsed.n !== null && parsed.raw.length > 20;
  const flagged = unparseable || isProse;

  const commit = (n: number | null, unit: IntervalUnit) => onCommit(canonicalInterval(n, unit));
  const tip = unparseable
    ? `The draft said "${parsed.raw}" — set a value and unit so the PM can be scheduled.`
    : isProse
      ? `Stored as prose: "${parsed.raw}". Re-enter the value to keep just ${parsed.n} ${parsed.unit}.`
      : parsed.unit === 'Hours' && parsed.n !== null
        ? 'Running-hours cadence — the PM is served by meter readings, not the calendar.'
        : undefined;
  const pad = compact ? 'py-1.5' : 'py-2';

  return (
    <div className={`flex items-center gap-1.5 ${compact ? '' : 'mt-1'}`} title={tip}>
      <input
        type="number" min={1} aria-label="Interval value" disabled={disabled}
        value={parsed.n ?? ''}
        placeholder="e.g. 3"
        onChange={e => commit(e.target.value === '' ? null : Math.max(1, parseInt(e.target.value, 10) || 0), parsed.unit)}
        className={`w-20 px-3 ${pad} text-sm bg-white border rounded-lg focus:border-accent-cyan focus:outline-none text-center font-semibold tabular-nums disabled:bg-slate-50 ${flagged ? 'border-amber-300' : 'border-slate-200'}`}
      />
      <select
        aria-label="Interval unit" disabled={disabled}
        value={parsed.unit}
        onChange={e => commit(parsed.n ?? 1, e.target.value as IntervalUnit)}
        className={`flex-1 px-2 ${pad} text-sm bg-white border rounded-lg focus:border-accent-cyan focus:outline-none cursor-pointer disabled:bg-slate-50 ${flagged ? 'border-amber-300' : 'border-slate-200'}`}
      >
        {INTERVAL_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
      </select>
    </div>
  );
};
