/**
 * RCMFunctionPanel — Tree-hierarchy view for RCM questions Q1–Q4
 * ═══════════════════════════════════════════════════════════════
 * Visual tree structure: Function (Q1) → Functional Failure (Q2) → Failure Modes (Q3) → Effects (Q4)
 * Each level is indented with CSS connector lines showing the parent-child relationship.
 */
import React, { useState, useCallback, useRef } from 'react';
import {
  Plus, Sparkles, RefreshCw, Trash2, Layers,
  ChevronDown, ChevronUp, AlertTriangle,
  EyeOff, ShieldAlert, CheckCircle2, Info,
} from 'lucide-react';
import { RCMContextualHelp } from './RCMContextualHelp';
import type { RCMFunctionPanelProps, RCMFailureMode, RCMDecision } from './types';
import { EVIDENT_CONSEQUENCES, HIDDEN_CONSEQUENCES, parseConsequenceCodes } from './types';

// ── Function type accent colors ────────────────────────────
const FN_ACCENTS: Record<string, string> = {
  primary: '#3b82f6',
  secondary: '#f59e0b',
  protective: '#8b5cf6',
};

// ── Q1-Q5 completion dots ──────────────────────────────────
const QDots: React.FC<{
  fn: { functional_failure?: string | null };
  fmCount: number;
  hasEffects: boolean;
  hasConsequence: boolean;
}> = ({ fn, fmCount, hasEffects, hasConsequence }) => {
  const dots = [
    { q: 'F', done: true, tip: 'Function defined' },
    { q: 'FF', done: !!fn.functional_failure, tip: 'Functional failure' },
    { q: 'FM', done: fmCount > 0, tip: 'Failure modes' },
    { q: 'FE', done: hasEffects, tip: 'Effects described' },
    { q: 'Q5', done: hasConsequence, tip: 'Consequence classified' },
  ];
  return (
    <div className="flex items-center gap-1">
      {dots.map(d => (
        <div
          key={d.q}
          title={`${d.q}: ${d.tip} — ${d.done ? 'Complete' : 'Incomplete'}`}
          className={`w-2 h-2 rounded-full transition-colors ${d.done ? 'bg-emerald-500' : 'bg-slate-200'}`}
        />
      ))}
    </div>
  );
};

// ── Tree Node Wrapper — adds vertical + horizontal connector lines ──
const TreeNode: React.FC<{
  level: number;
  isLast: boolean;
  color: string;
  children: React.ReactNode;
}> = ({ level, isLast, color, children }) => (
  <div className="relative" style={{ paddingLeft: level > 0 ? `${level * 24}px` : 0 }}>
    {/* Vertical line from parent */}
    {level > 0 && (
      <div
        className="absolute top-0"
        style={{
          left: `${(level - 1) * 24 + 11}px`,
          bottom: isLast ? '50%' : 0,
          width: '2px',
          background: color,
          opacity: 0.55,
        }}
      />
    )}
    {/* Horizontal branch connector */}
    {level > 0 && (
      <div
        className="absolute"
        style={{
          left: `${(level - 1) * 24 + 11}px`,
          top: '50%',
          width: '13px',
          height: '2px',
          background: color,
          opacity: 0.55,
          transform: 'translateY(-50%)',
        }}
      />
    )}
    {children}
  </div>
);

// ── Step Badge with color ──────────────────────────────────
const StepBadge: React.FC<{ label: string; color: string; done?: boolean }> = ({ label, color, done }) => (
  <span
    className="text-[9px] font-bold px-2 py-0.5 rounded-md border flex items-center gap-1 shrink-0"
    style={{
      background: `${color}18`,
      color: color,
      borderColor: `${color}45`,
    }}
  >
    {done && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
    {label}
  </span>
);

// ── Failure Mode Tree Node (Q3) with nested Q4 ─────────────
const FailureModeTreeNode: React.FC<{
  fm: RCMFailureMode;
  index: number;
  isLast: boolean;
  decision?: RCMDecision;
  onUpdate: (id: string, updates: Partial<RCMFailureMode>) => void;
  onDelete: (id: string, name: string) => void;
  onUpdateDecision: (failureModeId: string, updates: Partial<RCMDecision>) => void;
}> = ({ fm, index, isLast, decision, onUpdate, onDelete, onUpdateDecision }) => {
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [showEffects, setShowEffects] = useState(true);

  const debouncedUpdate = useCallback((field: string, value: any) => {
    if (debounceRef.current[field]) clearTimeout(debounceRef.current[field]);
    debounceRef.current[field] = setTimeout(() => {
      // Auto-compute RPN when severity or occurrence changes
      if (field === 'severity' || field === 'occurrence') {
        const sev = field === 'severity' ? (value || 0) : (fm.severity || 0);
        const occ = field === 'occurrence' ? (value || 0) : (fm.occurrence || 0);
        const computedRpn = sev * occ;
        onUpdate(fm.id, { [field]: value, rpn: computedRpn });
      } else {
        onUpdate(fm.id, { [field]: value });
      }
    }, 800);
  }, [fm.id, fm.severity, fm.occurrence, onUpdate]);

  // RPN computed client-side: Severity × Occurrence (max 100, per SAE JA1011)
  const rpn = (fm.severity || 0) * (fm.occurrence || 0);
  const rpnLevel = rpn > 80 ? 'critical' : rpn > 50 ? 'high' : rpn > 25 ? 'medium' : 'low';
  const rpnConfig = {
    critical: { ring: 'ring-red-500/30', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', label: 'Critical', barColor: '#ef4444' },
    high:     { ring: 'ring-amber-500/30', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', label: 'High', barColor: '#f59e0b' },
    medium:   { ring: 'ring-blue-500/20', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', label: 'Medium', barColor: '#3b82f6' },
    low:      { ring: 'ring-emerald-500/20', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', label: 'Low', barColor: '#10b981' },
  }[rpnLevel];

  const hasEffects = !!(fm.failure_effect_local || fm.failure_effect_system || fm.end_effect);

  return (
    <>
      {/* ── Q3 Node: Failure Mode + Cause ── */}
      <TreeNode level={2} isLast={isLast && !showEffects} color="#3b82f6">
        <div className="bg-white border border-blue-300 border-l-4 border-l-blue-500 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all group/fm my-1.5">
          {/* Header strip */}
          <div className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-blue-50 via-blue-50/15 to-white border-b border-blue-300/40">
            <StepBadge label={`FM-${index + 1}`} color="#3b82f6" done={!!fm.failure_mode_description} />
            {fm.data_source !== 'manual' && (
              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200">
                {fm.data_source === 'ai_generated' ? '🤖 AI' : fm.data_source === 'fmea_import' ? '📋 FMEA' : '📊 WO'}
              </span>
            )}
            <span className="text-[9px] text-slate-400 italic ml-1">Failure Mode & Cause</span>

            {/* RPN badge */}
            {rpn > 0 && (
              <span className={`ml-auto text-[9px] font-bold px-2 py-0.5 rounded-md border ${rpnConfig.bg} ${rpnConfig.text} ${rpnConfig.border}`}>
                RPN {rpn} · {rpnConfig.label}
              </span>
            )}

            {/* Expand effects toggle */}
            <button
              onClick={() => setShowEffects(!showEffects)}
              className="p-1 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded transition-colors"
              title={showEffects ? 'Collapse effects' : 'Expand effects'}
            >
              {showEffects ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>

            {/* Delete */}
            <button
              onClick={() => onDelete(fm.id, fm.failure_mode_description || 'Unnamed')}
              className="p-1 opacity-0 group-hover/fm:opacity-100 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-all"
              title="Delete failure mode"
            >
              <Trash2 size={12} />
            </button>
          </div>

          {/* Mode + Cause fields */}
          <div className="px-3 py-2.5 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] font-bold text-blue-600 uppercase tracking-wider">Failure Mode</label>
              <input
                type="text"
                defaultValue={fm.failure_mode_description}
                onChange={e => debouncedUpdate('failure_mode_description', e.target.value)}
                placeholder="What failed? e.g. Shaft seal leaking"
                className="w-full text-xs text-slate-700 bg-blue-50/30 border border-blue-300/70 rounded-lg px-2.5 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20 mt-1 transition-colors placeholder:text-slate-300"
              />
            </div>
            <div>
              <label className="text-[9px] font-bold text-blue-600 uppercase tracking-wider">Cause</label>
              <input
                type="text"
                defaultValue={fm.failure_cause_description || ''}
                onChange={e => debouncedUpdate('failure_cause_description', e.target.value)}
                placeholder="Why? e.g. Wear, corrosion, fatigue"
                className="w-full text-xs text-slate-700 bg-blue-50/30 border border-blue-300/70 rounded-lg px-2.5 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20 mt-1 transition-colors placeholder:text-slate-300"
              />
            </div>
          </div>
        </div>
      </TreeNode>

      {/* ── Step 4 Node: Effects (nested under Step 3) ── */}
      {showEffects && (
        <TreeNode level={3} isLast={!rpn && isLast} color="#f59e0b">
          <div className="bg-white border border-amber-300 border-l-4 border-l-amber-500 rounded-xl overflow-hidden shadow-sm my-1">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-amber-50 via-amber-50/15 to-white border-b border-amber-300/40">
              <StepBadge label={`FE-${index + 1}`} color="#d97706" done={hasEffects} />
              <span className="text-[9px] text-slate-400 italic">Failure Effects — What happens when it fails?</span>
              <RCMContextualHelp
                question="Describe the local, system, and plant-level effects. Include evidence of failure visible to operators."
                standard="SAE JA1011 Step 4"
              />
            </div>
            <div className="px-3 py-2.5">
              {/* Effects in a flow: Local → System → End */}
              <div className="flex items-center gap-1 flex-wrap md:flex-nowrap">
                <div className="flex-1 min-w-0">
                  <label className="text-[9px] font-bold text-amber-600 uppercase tracking-wider">Local Effect</label>
                  <input
                    type="text"
                    defaultValue={fm.failure_effect_local || ''}
                    onChange={e => debouncedUpdate('failure_effect_local', e.target.value)}
                    placeholder="Component level"
                    className="w-full text-xs text-slate-700 bg-amber-50/20 border border-amber-300/70 rounded-lg px-2.5 py-1.5 focus:border-amber-500 focus:outline-none mt-0.5 transition-colors placeholder:text-slate-300"
                  />
                </div>
                <span className="text-amber-500 text-lg font-light mt-3 hidden md:block">→</span>
                <div className="flex-1 min-w-0">
                  <label className="text-[9px] font-bold text-amber-600 uppercase tracking-wider">System Effect</label>
                  <input
                    type="text"
                    defaultValue={fm.failure_effect_system || ''}
                    onChange={e => debouncedUpdate('failure_effect_system', e.target.value)}
                    placeholder="System level"
                    className="w-full text-xs text-slate-700 bg-amber-50/20 border border-amber-300/70 rounded-lg px-2.5 py-1.5 focus:border-amber-500 focus:outline-none mt-0.5 transition-colors placeholder:text-slate-300"
                  />
                </div>
                <span className="text-amber-500 text-lg font-light mt-3 hidden md:block">→</span>
                <div className="flex-1 min-w-0">
                  <label className="text-[9px] font-bold text-red-600 uppercase tracking-wider">End Effect ⚠</label>
                  <input
                    type="text"
                    defaultValue={fm.end_effect || ''}
                    onChange={e => debouncedUpdate('end_effect', e.target.value)}
                    placeholder="Plant / production impact"
                    className="w-full text-xs text-slate-700 bg-red-50/20 border border-red-300/70 rounded-lg px-2.5 py-1.5 focus:border-red-500 focus:outline-none mt-0.5 transition-colors placeholder:text-slate-300"
                  />
                </div>
              </div>
            </div>
          </div>
        </TreeNode>
      )}

      {/* ── Q5 Node: Consequence Classification — Does the failure matter? ── */}
      {showEffects && (
        <TreeNode level={3} isLast={false} color="#dc2626">
          <div className="bg-white border border-red-300 border-l-4 border-l-red-500 rounded-xl overflow-hidden shadow-sm my-1">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-red-50 via-red-50/15 to-white border-b border-red-300/40">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
              <span className="text-[9px] font-bold text-red-600 uppercase tracking-wider">Consequence — Does the failure matter?</span>
              <RCMContextualHelp
                question="Classify the consequence: Is the failure hidden or evident? Then categorize by Safety, Operational, or Economic impact."
                standard="SAE JA1012 Step 5"
              />
            </div>
            <div className="px-3 py-2 space-y-2">

              {/* Hidden / Evident toggle — inline compact */}
              <div className="flex items-center gap-2">
                <EyeOff size={12} className="text-blue-500 shrink-0" />
                <span className="text-[9px] font-bold text-blue-600 uppercase">Evident to operators?</span>
                <div className="flex items-center gap-1">
                  {[
                    { label: 'Evident', value: false },
                    { label: 'Hidden', value: true },
                  ].map(opt => (
                    <button
                      key={opt.label}
                      onClick={() => {
                        const updates: Partial<RCMDecision> = {
                          is_hidden_failure: opt.value,
                          consequence_code: null,
                        };
                        onUpdateDecision(fm.id, updates);
                      }}
                      className={`px-3 py-1 text-[10px] font-bold rounded-md border transition-all ${
                        (decision?.is_hidden_failure ?? false) === opt.value
                          ? opt.value
                            ? 'bg-blue-500 text-white border-blue-500'
                            : 'bg-accent-cyan text-brand-900 border-accent-cyan'
                          : 'bg-white border-slate-300/80 text-slate-500 hover:border-slate-400 hover:text-slate-700 shadow-2xs'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div className="relative group ml-auto">
                  <Info size={10} className="text-slate-300 cursor-help" />
                  <div className="absolute bottom-full right-0 mb-1.5 hidden group-hover:block z-50">
                    <div className="bg-slate-800 text-white text-[9px] leading-relaxed rounded-lg px-3 py-2 max-w-[220px] shadow-lg">
                      <strong>Evident</strong> = operators notice under normal conditions.<br />
                      <strong>Hidden</strong> = requires inspection or testing to discover.
                    </div>
                  </div>
                </div>
              </div>

              {/* Consequence chips — compact multi-select */}
              {decision?.is_hidden_failure ? (
                /* HIDDEN path */
                <div className="space-y-1.5">
                  <span className="text-[9px] text-blue-500 font-medium italic">
                    If combined with another failure, could it threaten safety?
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {HIDDEN_CONSEQUENCES.map(c => {
                      const activeCodes = parseConsequenceCodes(decision?.consequence_code);
                      const selected = activeCodes.includes(c.code);
                      return (
                        <button
                          key={c.code}
                          onClick={() => {
                            const updated = selected
                              ? activeCodes.filter(x => x !== c.code)
                              : [...activeCodes, c.code];
                            onUpdateDecision(fm.id, { consequence_code: updated.length > 0 ? updated.join(',') : null });
                          }}
                          title={c.desc}
                          className={`group/chip flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10px] font-bold transition-all ${
                            selected
                              ? 'border-2 shadow-sm'
                              : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                          }`}
                          style={selected ? {
                            background: `${c.color}18`,
                            borderColor: c.color,
                            color: c.color,
                          } : undefined}
                        >
                          <span className="text-sm leading-none">{c.icon}</span>
                          {c.label}
                          {selected && <CheckCircle2 size={12} className="text-emerald-500" />}
                        </button>
                      );
                    })}
                  </div>
                  {parseConsequenceCodes(decision?.consequence_code).includes('HIDDEN_SAFETY') && (
                    <div className="flex items-center gap-1.5 px-2 py-1 bg-red-50/60 border border-red-200/50 rounded-md">
                      <ShieldAlert size={11} className="text-red-500 shrink-0" />
                      <span className="text-[9px] text-red-700"><strong>SAE JA1012:</strong> Failure-Finding mandatory. No task → redesign compulsory.</span>
                    </div>
                  )}
                </div>
              ) : (
                /* EVIDENT path */
                <div className="space-y-1.5">
                  <span className="text-[9px] text-slate-400 italic">Select all that apply</span>
                  <div className="flex flex-wrap gap-1.5">
                    {EVIDENT_CONSEQUENCES.map(c => {
                      const activeCodes = parseConsequenceCodes(decision?.consequence_code);
                      const selected = activeCodes.includes(c.code);
                      return (
                        <button
                          key={c.code}
                          onClick={() => {
                            const updated = selected
                              ? activeCodes.filter(x => x !== c.code)
                              : [...activeCodes, c.code];
                            onUpdateDecision(fm.id, { consequence_code: updated.length > 0 ? updated.join(',') : null });
                          }}
                          title={c.desc}
                          className={`group/chip flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10px] font-bold transition-all ${
                            selected
                              ? 'border-2 shadow-sm'
                              : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                          }`}
                          style={selected ? {
                            background: `${c.color}18`,
                            borderColor: c.color,
                            color: c.color,
                          } : undefined}
                        >
                          <span className="text-sm leading-none">{c.icon}</span>
                          {c.label}
                          {selected && <CheckCircle2 size={12} className="text-emerald-500" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </TreeNode>
      )}

      {/* ── Risk Assessment Node ── */}
      {showEffects && (
        <TreeNode level={3} isLast={isLast} color="#8b5cf6">
          <div className="bg-white border border-blue-300 border-l-4 border-l-blue-500 rounded-xl overflow-hidden shadow-sm my-1">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-blue-50 via-blue-50/15 to-white border-b border-blue-300/40">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              <span className="text-[9px] font-bold text-blue-600 uppercase tracking-wider">Risk Assessment</span>
            </div>
            <div className="px-3 py-2.5">
              <div className="flex items-center gap-2">
                <div className="w-20">
                  <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Severity</label>
                  <input
                    type="number" min={1} max={10}
                    defaultValue={fm.severity || ''}
                    onChange={e => debouncedUpdate('severity', parseInt(e.target.value) || null)}
                    placeholder="1-10"
                    className="w-full text-xs text-center font-semibold text-slate-700 bg-blue-50/10 border border-blue-300/70 rounded-lg px-2 py-1.5 focus:border-blue-500 focus:outline-none mt-0.5 transition-colors"
                  />
                </div>
                <span className="text-slate-300 text-sm font-bold mt-3">×</span>
                <div className="w-20">
                  <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Occurrence</label>
                  <input
                    type="number" min={1} max={10}
                    defaultValue={fm.occurrence || ''}
                    onChange={e => debouncedUpdate('occurrence', parseInt(e.target.value) || null)}
                    placeholder="1-10"
                    className="w-full text-xs text-center font-semibold text-slate-700 bg-blue-50/10 border border-blue-300/70 rounded-lg px-2 py-1.5 focus:border-blue-500 focus:outline-none mt-0.5 transition-colors"
                  />
                </div>
                <span className="text-slate-300 text-sm font-bold mt-3">=</span>
                {/* RPN gauge */}
                <div className="mt-3">
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border-2 ring-2 ${rpnConfig.bg} ${rpnConfig.text} ${rpnConfig.border} ${rpnConfig.ring} transition-all`}>
                    <span className="font-bold text-sm tabular-nums">{rpn || '—'}</span>
                    {rpn > 0 && <span className="text-[9px] font-bold opacity-70">{rpnConfig.label}</span>}
                  </div>
                </div>
                {/* Mini RPN bar */}
                {rpn > 0 && (
                  <div className="flex-1 ml-3 mt-3">
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${Math.min((rpn / 100) * 100, 100)}%`, background: rpnConfig.barColor }}
                      />
                    </div>
                    <div className="flex justify-between text-[8px] text-slate-400 mt-0.5">
                      <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </TreeNode>
      )}
    </>
  );
};

// ── Main Component ──────────────────────────────────────────
export const RCMFunctionPanel: React.FC<RCMFunctionPanelProps> = ({
  study, functions, failureModes, decisions, aiLoading,
  onAddFunction, onUpdateFunction, onDeleteFunction,
  onAddFailureMode, onUpdateFailureMode, onDeleteFailureMode, onAISuggest,
  onUpdateDecision,
}) => {
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(functions.length > 0 ? [functions[0].id] : [])
  );
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const debouncedFnUpdate = useCallback((id: string, field: string, value: any) => {
    const key = `${id}-${field}`;
    if (debounceRef.current[key]) clearTimeout(debounceRef.current[key]);
    debounceRef.current[key] = setTimeout(() => {
      onUpdateFunction(id, { [field]: value });
    }, 800);
  }, [onUpdateFunction]);

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {/* Actions Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={onAddFunction}
          className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:border-accent-cyan hover:text-accent-cyan transition-colors shadow-sm"
        >
          <Plus size={14} /> Add Function
        </button>
        <button
          onClick={onAISuggest}
          disabled={aiLoading === 'suggest'}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-lg text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50 shadow-sm"
        >
          {aiLoading === 'suggest' ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
          AI Suggest Functions
        </button>
        <span className="text-xs text-slate-400 ml-auto">
          {functions.length} function{functions.length !== 1 ? 's' : ''} · {failureModes.length} failure mode{failureModes.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Function Accordions */}
      {functions.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center shadow-sm">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-slate-50 flex items-center justify-center">
            <Layers size={28} className="text-slate-300" />
          </div>
          <p className="text-sm font-semibold text-slate-500">No functions defined yet</p>
          <p className="text-xs text-slate-400 mt-1">Add a function or use AI to auto-populate based on the asset type.</p>
        </div>
      ) : (
        functions.map(fn => {
          const fnFMs = failureModes.filter(fm => fm.function_id === fn.id);
          const isExpanded = expanded.has(fn.id);
          const accent = FN_ACCENTS[fn.function_type] || FN_ACCENTS.primary;
          const hasEffects = fnFMs.some(fm => !!fm.end_effect || !!fm.failure_effect_local);
          const hasConsequence = fnFMs.some(fm => !!decisions.get(fm.id)?.consequence_code);

          return (
            <div
              key={fn.id}
              className="rcm-fn-strip bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow"
              style={{ '--fn-accent': accent } as React.CSSProperties}
            >
              {/* ═══ Q1 — Function Header (always visible) ═══ */}
              <div
                className="px-5 py-4 bg-gradient-to-r from-slate-50/80 to-white border-b border-slate-100 cursor-pointer"
                onClick={() => toggleExpand(fn.id)}
              >
                <div className="flex items-center gap-3">
                  {/* Function Code Badge */}
                  <StepBadge label={fn.function_number || 'F1'} color={accent} done />

                  {/* Description — inline editable */}
                  <input
                    type="text"
                    defaultValue={fn.function_description}
                    onChange={e => debouncedFnUpdate(fn.id, 'function_description', e.target.value)}
                    onClick={e => e.stopPropagation()}
                    placeholder="Describe the function and performance standard..."
                    className="flex-1 text-sm font-medium text-slate-800 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-accent-cyan focus:outline-none transition-colors px-1 py-0.5"
                  />

                  {/* Q dots */}
                  <QDots fn={fn} fmCount={fnFMs.length} hasEffects={hasEffects} hasConsequence={hasConsequence} />

                  {/* Type selector */}
                  <select
                    value={fn.function_type}
                    onChange={e => { e.stopPropagation(); onUpdateFunction(fn.id, { function_type: e.target.value as any }); }}
                    onClick={e => e.stopPropagation()}
                    className="text-[10px] font-bold uppercase bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-slate-500 appearance-none cursor-pointer focus:border-accent-cyan focus:outline-none"
                  >
                    <option value="primary">Primary</option>
                    <option value="secondary">Secondary</option>
                    <option value="protective">Protective</option>
                  </select>

                  {/* Delete */}
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteFunction(fn.id, fn.function_number + ': ' + (fn.function_description || 'Unnamed')); }}
                    className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete function"
                  >
                    <Trash2 size={14} />
                  </button>

                  {/* Expand toggle */}
                  <div className="text-slate-400">
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </div>
              </div>

              {/* ═══ Tree Hierarchy (expanded) ═══ */}
              {isExpanded && (
                <div className="rcm-accordion-body px-5 py-4">

                  {/* ── Q2 Node: Functional Failure ── */}
                  <TreeNode level={1} isLast={fnFMs.length === 0} color="#06b6d4">
                    <div className="bg-white border border-cyan-300 border-l-4 border-l-cyan-500 rounded-xl overflow-hidden shadow-sm mb-2">
                      <div className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-cyan-50 via-cyan-50/15 to-white border-b border-cyan-300/40">
                        <StepBadge label={fn.function_number ? fn.function_number.replace(/^F/i, 'FF') : 'FF'} color="#0891b2" done={!!fn.functional_failure} />
                        <span className="text-[9px] text-slate-400 italic">Functional Failure — How can this function fail?</span>
                        <RCMContextualHelp
                          question="Identify all the ways the function can fail — total loss, partial loss, or degraded performance."
                          standard="SAE JA1012 Step 2"
                        />
                      </div>
                      <div className="px-3 py-2.5">
                        <input
                          type="text"
                          defaultValue={fn.functional_failure || ''}
                          onChange={e => debouncedFnUpdate(fn.id, 'functional_failure', e.target.value)}
                          placeholder="e.g. Unable to separate crude oil into specified fractions"
                          className="w-full text-xs text-slate-700 bg-cyan-50/30 border border-cyan-300/70 rounded-lg px-3 py-2 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/20 transition-colors placeholder:text-slate-300"
                        />
                      </div>
                    </div>
                  </TreeNode>
                  {/* ── Q3–Q4 Nodes: Failure Modes ── */}
                  {fnFMs.length === 0 ? (
                    <TreeNode level={2} isLast color="#3b82f6">
                      <div className="flex items-center gap-3 py-3 px-3 text-xs text-slate-400 italic bg-slate-50/50 rounded-lg border border-dashed border-slate-200 my-1">
                        <AlertTriangle size={14} className="text-slate-300" />
                        No failure modes yet. Add manually or use AI to auto-populate.
                      </div>
                    </TreeNode>
                  ) : (
                    fnFMs.map((fm, idx) => (
                      <FailureModeTreeNode
                        key={fm.id}
                        fm={fm}
                        index={idx}
                        isLast={idx === fnFMs.length - 1}
                        decision={decisions.get(fm.id)}
                        onUpdate={onUpdateFailureMode}
                        onDelete={onDeleteFailureMode}
                        onUpdateDecision={onUpdateDecision}
                      />
                    ))
                  )}

                  {/* Add Failure Mode button at tree bottom */}
                  <div style={{ paddingLeft: '48px' }} className="mt-2">
                    <button
                      onClick={() => onAddFailureMode(fn.id)}
                      className="text-xs text-accent-cyan hover:text-cyan-400 font-semibold flex items-center gap-1.5 px-3 py-2 bg-accent-cyan/5 rounded-lg hover:bg-accent-cyan/10 transition-colors border border-dashed border-accent-cyan/30"
                    >
                      <Plus size={12} /> Add Failure Mode
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};

export default RCMFunctionPanel;
