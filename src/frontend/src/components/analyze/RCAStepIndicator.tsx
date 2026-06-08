/**
 * RCAStepIndicator.tsx — 6-Step RCA Investigation Stepper
 *
 * Renders a horizontal stepper aligned with the canonical RCA lifecycle:
 *   1. Define  → 2. Collect  → 3. Identify  → 4. Develop  → 5. Implement  → 6. Track
 *
 * Each step shows completion state, and clicking a step navigates the detail view.
 */
import React from 'react';
import {
    FileText, Database, Search, Wrench, Rocket, BarChart3,
    Check, ChevronRight,
} from 'lucide-react';

// ── Step definitions aligned with domain.md ──────────────────
export interface RCAStep {
    id: number;
    key: string;
    label: string;
    sublabel: string;
    icon: React.ReactNode;
    color: string;
}

export const RCA_STEPS: RCAStep[] = [
    { id: 1, key: 'define',    label: 'Define',     sublabel: 'Problem & Context',    icon: <FileText size={14} />,  color: '#6366f1' },
    { id: 2, key: 'collect',   label: 'Collect',    sublabel: 'Evidence & Data',      icon: <Database size={14} />,  color: '#0891b2' },
    { id: 3, key: 'identify',  label: 'Identify',   sublabel: 'Causal Factors',       icon: <Search size={14} />,    color: '#d97706' },
    { id: 4, key: 'develop',   label: 'Develop',    sublabel: 'Solutions & Actions',  icon: <Wrench size={14} />,    color: '#059669' },
    { id: 5, key: 'implement', label: 'Implement',  sublabel: 'Execute & Assign',     icon: <Rocket size={14} />,    color: '#8b5cf6' },
    { id: 6, key: 'track',     label: 'Track',      sublabel: 'Verify Effectiveness', icon: <BarChart3 size={14} />, color: '#ec4899' },
];

// ── Completion logic ─────────────────────────────────────────
export interface StepCompletionData {
    hasProblemStatement: boolean;
    has5W2H: boolean;        // at least 2 of 5W2H fields filled
    evidenceCount: number;
    hasRootCause: boolean;
    actionCount: number;
    allActionsAssigned: boolean;
    effectivenessReviewed: boolean;
}

export function getStepCompletion(data: StepCompletionData): boolean[] {
    return [
        data.hasProblemStatement && data.has5W2H,                // Step 1: Define
        data.evidenceCount > 0,                                   // Step 2: Collect
        data.hasRootCause,                                        // Step 3: Identify
        data.actionCount > 0,                                     // Step 4: Develop
        data.actionCount > 0 && data.allActionsAssigned,         // Step 5: Implement
        data.effectivenessReviewed,                               // Step 6: Track
    ];
}

// ── Props ────────────────────────────────────────────────────
interface RCAStepIndicatorProps {
    currentStep: number;           // 1-6
    onStepClick: (step: number) => void;
    completionData: StepCompletionData;
}

// ── Component ────────────────────────────────────────────────
const RCAStepIndicator: React.FC<RCAStepIndicatorProps> = ({
    currentStep,
    onStepClick,
    completionData,
}) => {
    const completions = getStepCompletion(completionData);

    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 0,
            padding: '12px 16px',
            background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
            borderBottom: '1px solid #e2e8f0',
            overflowX: 'auto',
        }}>
            {RCA_STEPS.map((step, idx) => {
                const isActive = currentStep === step.id;
                const isComplete = completions[idx];
                const isPast = step.id < currentStep;

                return (
                    <React.Fragment key={step.id}>
                        {/* Step node */}
                        <button
                            onClick={() => onStepClick(step.id)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '8px 14px',
                                background: isActive
                                    ? `${step.color}12`
                                    : 'transparent',
                                border: isActive
                                    ? `1.5px solid ${step.color}40`
                                    : '1.5px solid transparent',
                                borderRadius: 10,
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                flexShrink: 0,
                                minWidth: 0,
                            }}
                            title={`${step.label}: ${step.sublabel}`}
                        >
                            {/* Step circle */}
                            <div style={{
                                width: 28, height: 28, borderRadius: '50%',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                flexShrink: 0,
                                background: isComplete
                                    ? step.color
                                    : isActive
                                        ? `${step.color}20`
                                        : '#f1f5f9',
                                border: `2px solid ${isComplete ? step.color : isActive ? step.color : '#cbd5e1'}`,
                                transition: 'all 0.2s',
                            }}>
                                {isComplete ? (
                                    <Check size={13} color="#fff" strokeWidth={3} />
                                ) : (
                                    <span style={{
                                        fontSize: 11, fontWeight: 700,
                                        color: isActive ? step.color : '#94a3b8',
                                    }}>
                                        {step.id}
                                    </span>
                                )}
                            </div>
                            {/* Labels */}
                            <div style={{ textAlign: 'left', minWidth: 0 }}>
                                <div style={{
                                    fontSize: 11, fontWeight: 700,
                                    color: isActive ? step.color : isComplete ? '#334155' : '#94a3b8',
                                    lineHeight: 1.2,
                                    whiteSpace: 'nowrap',
                                }}>
                                    {step.label}
                                </div>
                                <div style={{
                                    fontSize: 9,
                                    color: isActive ? step.color + 'aa' : '#cbd5e1',
                                    lineHeight: 1.2,
                                    whiteSpace: 'nowrap',
                                }}>
                                    {step.sublabel}
                                </div>
                            </div>
                        </button>

                        {/* Connector line between steps */}
                        {idx < RCA_STEPS.length - 1 && (
                            <div style={{
                                display: 'flex', alignItems: 'center',
                                padding: '0 2px', flexShrink: 0,
                            }}>
                                <ChevronRight
                                    size={14}
                                    color={isPast || isComplete ? step.color : '#d1d5db'}
                                    style={{ opacity: 0.6 }}
                                />
                            </div>
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );
};

export default RCAStepIndicator;
