/**
 * RCMModeRail — the study's failure modes as a rail beside one card.
 *
 * Shared by the Strategy tab (dots = where the decision stands) and the
 * Maintenance Plan (dots = whether the decision is implemented). Modes are
 * grouped under their functions in worksheet order; the rail is the
 * segmentation and the navigation — click a row, or use ←/→ on the page.
 * Desktop: a sticky column. Phone: a chip strip above the card.
 */
import React, { useMemo, useEffect } from 'react';
import type { RCMFailureMode, RCMFunction } from './types';

export type RailTone = 'emerald' | 'amber' | 'slate' | 'red' | 'primary';
const DOT: Record<RailTone, string> = {
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-400',
  slate: 'bg-slate-300',
  red: 'bg-red-500',
  primary: 'bg-primary-500',
};

export interface RailGroup { fn: RCMFunction | null; modes: RCMFailureMode[] }

/** Functions in worksheet order with their modes, then any orphan modes. */
export function groupModesByFunction(functions: RCMFunction[], failureModes: RCMFailureMode[]): RailGroup[] {
  const seen = new Set<string>();
  const out: RailGroup[] = [];
  for (const fn of functions) {
    const modes = failureModes.filter(m => m.function_id === fn.id);
    if (modes.length === 0) continue;
    modes.forEach(m => seen.add(m.id));
    out.push({ fn, modes });
  }
  const orphans = failureModes.filter(m => !seen.has(m.id));
  if (orphans.length) out.push({ fn: null, modes: orphans });
  return out;
}

export const modeTitle = (m: RCMFailureMode) => m.failure_mode_description || 'Unnamed failure mode';

export const RailDot: React.FC<{ tone: RailTone; title?: string; className?: string }> = ({ tone, title, className }) => (
  <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${DOT[tone]} ${className || ''}`} aria-label={title} title={title} />
);

export const RCMModeRail: React.FC<{
  groups: RailGroup[];
  /** FM-n numbering — the worksheet's, so the two tabs agree */
  fmNumber: (m: RCMFailureMode) => number;
  currentId: string | null;
  onSelect: (id: string) => void;
  /** dot colour + tooltip per mode */
  statusOf: (m: RCMFailureMode) => { tone: RailTone; title: string };
  /** small right-hand figure in the header, e.g. "2/4" */
  headerRight?: React.ReactNode;
  headerRightTitle?: string;
  label?: string;
}> = ({ groups, fmNumber, currentId, onSelect, statusOf, headerRight, headerRightTitle, label = 'Failure modes' }) => {
  const ordered = useMemo(() => groups.flatMap(g => g.modes), [groups]);

  // ← / → walk the rail when no field has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      const i = Math.max(0, ordered.findIndex(m => m.id === currentId));
      if (e.key === 'ArrowRight' && ordered[i + 1]) { e.preventDefault(); onSelect(ordered[i + 1].id); }
      else if (e.key === 'ArrowLeft' && ordered[i - 1]) { e.preventDefault(); onSelect(ordered[i - 1].id); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ordered, currentId, onSelect]);

  const row = (m: RCMFailureMode) => {
    const current = m.id === currentId;
    const s = statusOf(m);
    return (
      <button
        key={m.id}
        type="button"
        onClick={() => onSelect(m.id)}
        aria-current={current ? 'true' : undefined}
        title={`${s.title} — ${modeTitle(m)}`}
        className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
          current ? 'bg-primary-50 text-primary-800 ring-1 ring-primary-200' : 'text-slate-600 hover:bg-slate-50'
        }`}
      >
        <RailDot tone={s.tone} />
        <span className="text-[10px] font-bold text-slate-400 tabular-nums shrink-0 w-9">FM-{fmNumber(m)}</span>
        <span className="text-xs truncate">{modeTitle(m)}</span>
      </button>
    );
  };

  return (
    <>
      {/* Desktop: a column beside the card */}
      <nav aria-label={label} className="hidden lg:block lg:w-60 xl:w-64 shrink-0 lg:sticky lg:top-3">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-2">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
            {headerRight != null && <span className="text-[10px] font-semibold text-slate-500 tabular-nums" title={headerRightTitle}>{headerRight}</span>}
          </div>
          <div className="space-y-2 mt-1">
            {groups.map(g => (
              <div key={g.fn?.id ?? 'orphans'}>
                <p className="px-2 pt-1 pb-0.5 text-[10px] font-bold text-slate-500 truncate" title={g.fn ? `${g.fn.function_number}: ${g.fn.function_description}` : 'Function removed'}>
                  {g.fn ? <><span className="text-primary-600">{g.fn.function_number}</span> · {g.fn.function_description}</> : 'No function'}
                </p>
                <div className="space-y-0.5">{g.modes.map(row)}</div>
              </div>
            ))}
          </div>
        </div>
      </nav>

      {/* Phone: a strip above the card */}
      <div className="lg:hidden flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" role="tablist" aria-label={label}>
        {ordered.map(m => {
          const current = m.id === currentId;
          const s = statusOf(m);
          return (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={current}
              onClick={() => onSelect(m.id)}
              title={`${s.title} — ${modeTitle(m)}`}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold whitespace-nowrap shrink-0 ${
                current ? 'bg-primary-600 border-primary-600 text-white' : 'bg-white border-slate-200 text-slate-600'
              }`}
            >
              <RailDot tone={s.tone} className={current ? 'ring-1 ring-white/70' : ''} />
              FM-{fmNumber(m)}
            </button>
          );
        })}
      </div>
    </>
  );
};
