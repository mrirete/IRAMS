/**
 * RCM Sub-Component Shared Types & Props
 * ═══════════════════════════════════════
 * Shared interfaces for the decomposed RCM module components.
 * All types re-export from RCMService to keep a single source of truth.
 */
import type {
  RCMStudy, RCMFunction, RCMFailureMode, RCMDecision,
  RCMTaskSummary, AIRecommendation
} from '../../eam/services/RCMService';
import type { StudyCollaborator } from '../../eam/services/AnalyzeService';

// Re-export for convenience
export type { RCMStudy, RCMFunction, RCMFailureMode, RCMDecision, RCMTaskSummary, AIRecommendation, StudyCollaborator };

// ── Status & Strategy Constants ──────────────────────────────

export const STATUS_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  draft:       { bg: 'bg-slate-50',    text: 'text-slate-600',   border: 'border-slate-200', dot: 'bg-slate-400' },
  in_progress: { bg: 'bg-blue-50',     text: 'text-blue-600',    border: 'border-blue-200',  dot: 'bg-blue-500' },
  review:      { bg: 'bg-amber-50',    text: 'text-amber-600',   border: 'border-amber-200', dot: 'bg-amber-500' },
  approved:    { bg: 'bg-emerald-50',  text: 'text-emerald-600', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  closed:      { bg: 'bg-slate-50',    text: 'text-slate-500',   border: 'border-slate-200', dot: 'bg-slate-400' },
};

export const CRIT_COLORS: Record<string, string> = {
  A: 'bg-red-500/15 text-red-500 border-red-500/30',
  B: 'bg-yellow-500/15 text-yellow-600 border-yellow-500/30',
  C: 'bg-slate-100 text-slate-500 border-slate-300',
};

export const STRATEGY_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  PM_TIME:      { label: 'Time-Based PM',   color: 'bg-blue-100 text-blue-700',    icon: '🕐' },
  PM_CONDITION: { label: 'Condition-Based',  color: 'bg-cyan-100 text-cyan-700',    icon: '📊' },
  PM_PREDICTIVE:{ label: 'Predictive',       color: 'bg-blue-100 text-blue-700',icon: '🤖' },
  RTF:          { label: 'Run-to-Failure',   color: 'bg-orange-100 text-orange-700',icon: '⚡' },
  REDESIGN:     { label: 'Redesign',         color: 'bg-red-100 text-red-700',      icon: '🔧' },
  COMBINATION:  { label: 'Combined',         color: 'bg-emerald-100 text-emerald-700',icon: '🔀' },
};

// Evident failure consequence cards (shown when Hidden = No)
export const EVIDENT_CONSEQUENCES = [
  { code: 'SAFETY_ENV',     label: 'Safety / Environmental', color: '#dc2626', icon: '🚨', desc: 'Could cause injury, fatality, or breach environmental regulations' },
  { code: 'OPERATIONAL',    label: 'Operational',            color: '#d97706', icon: '⚠️', desc: 'Directly affects production output, throughput, product quality, or customer service' },
  { code: 'NON_OPERATIONAL',label: 'Non-Operational',        color: '#2563eb', icon: '🔧', desc: 'No production impact — no safety, environmental, or output consequences' },
  { code: 'REPAIR_COST',    label: 'Repair / Replacement Cost', color: '#0891b2', icon: '💰', desc: 'Incurs significant material, labor, or equipment cost to repair or replace' },
  { code: 'REPUTATION',     label: 'Reputation',             color: '#7c3aed', icon: '📉', desc: 'Loss of customer confidence, brand damage, regulatory scrutiny, or contractual penalties' },
] as const;

// Hidden failure consequence sub-question (shown when Hidden = Yes)
export const HIDDEN_CONSEQUENCES = [
  { code: 'HIDDEN_SAFETY',     label: 'Yes — Safety / Environmental', color: '#7c3aed', icon: '🚨', desc: 'If this hidden failure occurs alongside another failure, it could result in injury, fatality, or environmental breach' },
  { code: 'HIDDEN_NON_SAFETY', label: 'No — Economic Only',           color: '#6366f1', icon: '🛡️', desc: 'Combined with another failure, the outcome has no safety or environmental impact — only direct repair cost' },
] as const;

// All consequence codes for lookups (backwards-compatible)
export const CONSEQUENCE_OPTIONS = [
  ...EVIDENT_CONSEQUENCES,
  ...HIDDEN_CONSEQUENCES,
] as const;

/** Parse a comma-separated consequence_code string into an array of codes */
export function parseConsequenceCodes(code: string | null | undefined): string[] {
  if (!code) return [];
  return code.split(',').map(c => c.trim()).filter(Boolean);
}

/** Check if any safety-level consequence is present in a multi-code string */
export function hasSafetyConsequence(code: string | null | undefined): boolean {
  const codes = parseConsequenceCodes(code);
  return codes.some(c => c === 'SAFETY_ENV' || c === 'HIDDEN_SAFETY');
}

// ── RCM Seven Steps ──────────────────────────────────────────

export interface RCMStep {
  id: string;
  number: number;
  question: string;
  shortLabel: string;
  tab: 'functions' | 'decisions' | 'tasks';
  description: string;
}

export const RCM_STEPS: RCMStep[] = [
  { id: 'q1', number: 1, question: 'What are the functions?',            shortLabel: 'Functions',   tab: 'functions', description: 'Define what the asset is expected to do in its current operating context, including performance standards.' },
  { id: 'q2', number: 2, question: 'What are the functional failures?',  shortLabel: 'Failures',    tab: 'functions', description: 'Identify all the ways the function can fail — total loss, partial loss, or degraded performance.' },
  { id: 'q3', number: 3, question: 'What causes each failure?',          shortLabel: 'Modes',       tab: 'functions', description: 'List every reasonably likely failure mode (cause) that could lead to each functional failure.' },
  { id: 'q4', number: 4, question: 'What happens when it fails?',        shortLabel: 'Effects',     tab: 'functions', description: 'Describe the local, system, and plant-level effects of each failure mode, including evidence of failure.' },
  { id: 'q5', number: 5, question: 'Does the failure matter?',           shortLabel: 'Consequence', tab: 'functions', description: 'Classify each failure by consequence: Safety/Environmental, Operational, Non-Operational, or Hidden.' },
  { id: 'q6', number: 6, question: 'What can be done to prevent it?',    shortLabel: 'Tasks',       tab: 'decisions', description: 'Select the optimal proactive task: On-Condition, Scheduled Restoration, Scheduled Discard, or Failure-Finding.' },
  { id: 'q7', number: 7, question: 'What if no task is appropriate?',    shortLabel: 'Default',     tab: 'tasks',     description: 'If no proactive task is effective, select Run-to-Failure or Redesign as the default action.' },
];

// ── Shared Props for Sub-Components ──────────────────────────

export interface RCMDashboardProps {
  studies: RCMStudy[];
  loading: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSelectStudy: (study: RCMStudy) => void;
  onCreateStudy: () => void;
  onEditStudy: (study: RCMStudy, e?: React.MouseEvent) => void;
  onDeleteStudy: (study: RCMStudy) => void;
}

// The FMEA worksheet owns its own props (see RCMFMEATable.tsx) — they include
// the Specialist callbacks, which are specific to that surface.

/** Measured life data from Reliability Modelling — the study's latest saved Weibull fit. */
export interface RCMLifeEvidence {
  beta: number;
  eta: number;
  b10: number;
  interval: number;   // suggested PM interval, hours
  r2?: number;
  source: string;     // analysis title
  date: string;       // ISO date of the fit
}

export interface RCMDecisionWizardProps {
  study: RCMStudy;
  failureModes: RCMFailureMode[];
  functions: RCMFunction[];
  decisions: Map<string, RCMDecision>;
  aiLoading: string | null;
  /** Latest saved Weibull fit for the study's asset — drives measured-interval suggestions. */
  lifeEvidence?: RCMLifeEvidence | null;
  onUpdateDecision: (failureModeId: string, updates: Partial<RCMDecision>) => void;
  onAIRecommend: (fm: RCMFailureMode) => void;
}

export interface RCMTaskMatrixProps {
  study: RCMStudy;
  taskSummaries: RCMTaskSummary[];
  decisions: Map<string, RCMDecision>;
  aiLoading: string | null;
  aiReport: string | null;
  onGeneratePM: () => void;
  /** Specialist program review — fires only when optimizeGate.ok. */
  onAIOptimize: () => void;
  optimizeGate: { ok: boolean; missing: string[]; reason: string };
  /** Back-link for the empty state: tasks are the output of Strategy (Q6–Q7). */
  onGoToStrategy: () => void;
  onCloseReport: () => void;
}

export interface RCMProgressTrackerProps {
  functions: RCMFunction[];
  failureModes: RCMFailureMode[];
  decisions: Map<string, RCMDecision>;
  activeTab: string;
  onNavigate: (tab: string) => void;
}
