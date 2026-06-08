import React, { useState } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';

export type DatePreset = '7d' | '30d' | '90d' | '6mo' | '12mo' | 'ytd' | 'custom';

export interface DateRange {
  start: Date;
  end: Date;
  preset: DatePreset;
  label: string;
}

interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

const PRESETS: { key: DatePreset; label: string; days?: number }[] = [
  { key: '7d', label: 'Last 7 Days', days: 7 },
  { key: '30d', label: 'Last 30 Days', days: 30 },
  { key: '90d', label: 'Last 90 Days', days: 90 },
  { key: '6mo', label: 'Last 6 Months', days: 183 },
  { key: '12mo', label: 'Last 12 Months', days: 365 },
  { key: 'ytd', label: 'Year to Date' },
];

export const getDateRange = (preset: DatePreset): DateRange => {
  const end = new Date();
  let start: Date;
  const p = PRESETS.find(p => p.key === preset);

  if (preset === 'ytd') {
    start = new Date(end.getFullYear(), 0, 1);
  } else if (p?.days) {
    start = new Date(end.getTime() - p.days * 86400000);
  } else {
    start = new Date(end.getTime() - 30 * 86400000);
  }

  return { start, end, preset, label: p?.label || 'Custom' };
};

export const DateRangePicker: React.FC<DateRangePickerProps> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);

  const handlePreset = (preset: DatePreset) => {
    onChange(getDateRange(preset));
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-sm text-slate-200 hover:bg-slate-700 transition-colors"
      >
        <Calendar size={14} className="text-slate-400" />
        <span>{value.label}</span>
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-56 bg-slate-800 border border-slate-600 rounded-xl shadow-xl z-50 py-2">
            {PRESETS.map(p => (
              <button
                key={p.key}
                onClick={() => handlePreset(p.key)}
                className={`w-full text-left px-4 py-2 text-sm transition-colors
                  ${value.preset === p.key
                    ? 'bg-blue-500/20 text-blue-400 font-medium'
                    : 'text-slate-300 hover:bg-slate-700'
                  }`}
              >
                {p.label}
              </button>
            ))}
            {/* Divider */}
            <div className="border-t border-slate-700 my-1" />
            {/* Custom date inputs */}
            <div className="px-4 py-2 space-y-2">
              <label className="text-xs text-slate-400 font-medium">Custom Range</label>
              <div className="flex gap-2">
                <input
                  type="date" value={value.start.toISOString().slice(0, 10)}
                  onChange={e => {
                    const s = new Date(e.target.value);
                    if (!isNaN(s.getTime())) onChange({ ...value, start: s, preset: 'custom', label: 'Custom' });
                  }}
                  className="w-full px-2 py-1 bg-slate-900 border border-slate-600 rounded text-xs text-white"
                />
              </div>
              <div className="flex gap-2">
                <input
                  type="date" value={value.end.toISOString().slice(0, 10)}
                  onChange={e => {
                    const nd = new Date(e.target.value);
                    if (!isNaN(nd.getTime())) onChange({ ...value, end: nd, preset: 'custom', label: 'Custom' });
                  }}
                  className="w-full px-2 py-1 bg-slate-900 border border-slate-600 rounded text-xs text-white"
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
