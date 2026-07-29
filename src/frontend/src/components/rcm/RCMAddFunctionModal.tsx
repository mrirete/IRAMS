/**
 * RCMAddFunctionModal — Q1, asked properly
 * ═════════════════════════════════════════
 * Progressive disclosure in JA1011's own order: the function statement comes
 * first, and nothing else appears until it exists. Only once the function is
 * described do the type and the functional failure (Q2) reveal — you cannot
 * classify or fail a function you haven't stated.
 *
 * This also replaces the old behaviour of inserting a blank row into the
 * worksheet on click, which left junk rows behind when abandoned.
 */
import React, { useState } from 'react';
import { Layers, X, Plus, RefreshCw, Lightbulb } from 'lucide-react';
import type { RCMFunction } from './types';

const TYPE_OPTIONS: { value: RCMFunction['function_type']; label: string; desc: string; accent: string }[] = [
  { value: 'primary', label: 'Primary', desc: 'Why the asset exists — its main duty', accent: '#3b82f6' },
  { value: 'secondary', label: 'Secondary', desc: 'Containment, control, comfort, appearance…', accent: '#f59e0b' },
  { value: 'protective', label: 'Protective', desc: 'Acts only when something else goes wrong', accent: '#8b5cf6' },
];

const EXAMPLES = [
  'Pump firewater at ≥ 400 m³/h and 8 bar within 10 s of demand',
  'Contain process fluid with zero external leakage',
  'Trip the pump on low-low suction pressure within 2 s',
];

interface Props {
  /** e.g. "F3" — the number this function will get. */
  nextNumber: string;
  saving: boolean;
  onClose: () => void;
  onCreate: (data: {
    description: string;
    type: RCMFunction['function_type'];
    functional_failure: string;
  }) => void;
}

export const RCMAddFunctionModal: React.FC<Props> = ({ nextNumber, saving, onClose, onCreate }) => {
  const [description, setDescription] = useState('');
  const [type, setType] = useState<RCMFunction['function_type']>('primary');
  const [functionalFailure, setFunctionalFailure] = useState('');

  // The rest of the form earns its place only once a real statement exists.
  const described = description.trim().length >= 8;

  const submit = () => {
    if (!described || saving) return;
    onCreate({
      description: description.trim(),
      type,
      functional_failure: functionalFailure.trim(),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl mx-4 shadow-2xl animate-in zoom-in-95 duration-200 max-h-[88vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white rounded-t-2xl z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary-50 rounded-lg text-primary-600"><Layers size={20} /></div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Add Function <span className="text-slate-300 font-semibold">·</span> <span className="text-primary-600">{nextNumber}</span></h2>
              <p className="text-xs text-slate-500 mt-0.5">Q1 — What must this asset do, in this operating context?</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-5">
          {/* ── The one field that matters first ── */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
              Function <span className="text-red-400">*</span>
              <span className="ml-2 font-medium normal-case text-slate-400">verb + object + performance standard</span>
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); }}
              placeholder={`e.g. ${EXAMPLES[0]}`}
              rows={3}
              autoFocus
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-base text-slate-800 focus:outline-none focus:border-accent-cyan focus:bg-white placeholder:text-slate-300 resize-none transition-colors"
            />
            {!described && (
              <div className="flex items-start gap-2 mt-2 px-3 py-2 bg-primary-50/50 border border-primary-100 rounded-lg">
                <Lightbulb size={13} className="text-primary-400 mt-0.5 shrink-0" />
                <div className="text-[11px] text-slate-500 leading-relaxed">
                  A good function statement is measurable — the failure is whatever misses the number.
                  {' '}Examples: {EXAMPLES.map((ex, i) => (
                    <button
                      key={i}
                      onClick={() => setDescription(ex)}
                      className="block text-left text-primary-600 hover:underline mt-0.5"
                    >
                      “{ex}”
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Revealed once the function is stated ── */}
          {described && (
            <div className="space-y-5 animate-in fade-in slide-in-from-top-2 duration-300">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Function type</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {TYPE_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setType(opt.value)}
                      className={`text-left px-3 py-2.5 rounded-xl border-2 transition-all ${
                        type === opt.value ? 'shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                      style={type === opt.value ? { borderColor: opt.accent, background: `${opt.accent}0d` } : undefined}
                    >
                      <span className="block text-xs font-bold" style={{ color: type === opt.value ? opt.accent : '#475569' }}>
                        {opt.label}
                      </span>
                      <span className="block text-[10px] text-slate-400 mt-0.5 leading-snug">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Functional failure
                  <span className="ml-2 font-medium normal-case text-slate-400">Q2 — how can it fail to do that? (optional)</span>
                </label>
                <textarea
                  value={functionalFailure}
                  onChange={e => setFunctionalFailure(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); }}
                  placeholder="e.g. Unable to deliver ≥ 400 m³/h · delivers but below 8 bar · fails to start on demand"
                  rows={2}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:border-accent-cyan focus:bg-white placeholder:text-slate-300 resize-none transition-colors"
                />
                <p className="text-[10px] text-slate-400 mt-1.5">
                  Total loss, partial loss, or degraded performance — leave blank and the Specialist can draft it. Failure modes are added on the worksheet next.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 pt-0 flex items-center justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-medium">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!described || saving}
            title={described ? 'Ctrl+Enter also works' : 'State the function first — everything in the study hangs off it'}
            className="px-6 py-2 bg-accent-cyan hover:bg-primary-400 disabled:opacity-40 text-brand-900 font-bold rounded-lg text-sm transition-colors shadow-[0_0_15px_rgba(6,182,212,0.2)] flex items-center gap-2"
          >
            {saving ? <RefreshCw size={15} className="animate-spin" /> : <Plus size={15} />}
            Add to worksheet
          </button>
        </div>
      </div>
    </div>
  );
};

export default RCMAddFunctionModal;
