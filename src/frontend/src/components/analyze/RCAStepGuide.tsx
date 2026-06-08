/**
 * RCAStepGuide.tsx — Collapsible contextual-help panel that displays
 * guidance for whichever RCA step the user is currently on.
 *
 * Aligns with domain.md "Six Steps in RCA" process.
 */
import React, { useState } from 'react';
import { HelpCircle, ChevronDown, ChevronRight } from 'lucide-react';

interface RCAStepGuideProps {
    /** 0-based index of the active RCA step */
    activeStep: number;
}

// ── Canonical guidance per step (maps to domain.md) ──────────
const STEP_GUIDANCE: {
    title: string;
    summary: string;
    tips: string[];
    checklist: string[];
}[] = [
    {
        title: 'Step 1 — Define the Problem',
        summary: 'Clearly articulate the failure event. Use the 3W2H framework (What, Where, When, How, How Much) to capture all dimensions.',
        tips: [
            'Be specific: "Pump P-101A seized" is better than "pump failed".',
            'Include the operational impact — was there a shutdown, safety incident, or production loss?',
            'Attach the Work Order or Work Request that triggered this investigation.',
        ],
        checklist: [
            'Problem statement written (concise, factual)',
            '3W2H summary completed',
            'Asset criticality & functional location noted',
        ],
    },
    {
        title: 'Step 2 — Collect Data & Evidence',
        summary: 'Gather all available evidence before jumping to conclusions. Evidence includes maintenance logs, photographs, sensor readings, witness statements, and process data.',
        tips: [
            'Interview operators and technicians who were present at the time of failure.',
            'Collect time-series data from SCADA/DCS if available.',
            'Photograph the failure scene before any repair work begins.',
            'Review Work Order history for the asset (look for repeat failures).',
        ],
        checklist: [
            'Maintenance history reviewed',
            'Physical evidence collected (photos, samples)',
            'Operational data gathered (SCADA, sensor logs)',
            'Witness statements documented',
        ],
    },
    {
        title: 'Step 3 — Identify Possible Causal Factors',
        summary: 'Apply structured analysis techniques to identify all potential causes. Use 5-Why for simple linear chains, Fishbone (Ishikawa) for multi-category analysis, or Fault Tree Analysis for complex systems.',
        tips: [
            '5-Why: Best for straightforward failures. Validate with the "therefore" reverse test.',
            'Fishbone: Choose the right framework — 6Ms for manufacturing, 4Ps for process industries, 4Ss for service.',
            'FTA: Use for safety-critical assets (Criticality A) where redundancy and gate logic matter.',
            'Look beyond the immediate technical cause — also investigate human and organizational factors.',
        ],
        checklist: [
            'Analysis method selected and applied',
            'Causes categorized (Physical / Human / Organizational)',
            'Root cause validated (therefore test or peer review)',
        ],
    },
    {
        title: 'Step 4 — Develop Solutions & Recommendations',
        summary: 'For each identified root cause, develop corrective and preventive actions (CAPA). Group actions into Physical, Human, and Organizational categories.',
        tips: [
            'Physical: Equipment modifications, material upgrades, design changes.',
            'Human: Training, procedure revisions, competency assessments.',
            'Organizational: Policy changes, staffing adjustments, management-of-change.',
            'Assign clear ownership, due dates, and priority to each action.',
        ],
        checklist: [
            'At least one corrective action per root cause',
            'Actions categorized by cause type',
            'Each action has an owner and due date',
            'Actions reviewed and approved by supervisor',
        ],
    },
    {
        title: 'Step 5 — Implement Recommendations',
        summary: 'Execute the approved corrective actions. Track progress and ensure actions are completed on schedule. Update Work Orders as needed.',
        tips: [
            'Link corrective actions to Work Orders for traceability.',
            'Use the Gantt timeline or task board to monitor progress.',
            'Escalate overdue actions to management.',
            'Document any deviations from the original plan.',
        ],
        checklist: [
            'Work Orders created for each action',
            'Resources allocated (parts, labor, budget)',
            'Implementation timeline communicated to stakeholders',
            'Progress tracked weekly',
        ],
    },
    {
        title: 'Step 6 — Track Effectiveness',
        summary: 'Verify that the implemented solutions actually prevented recurrence. Monitor KPIs for an appropriate period (typically 90 days) and close the investigation when effectiveness is confirmed.',
        tips: [
            'Define measurable success criteria upfront (e.g., "zero repeat failures in 90 days").',
            'Track MTBF or failure frequency for the affected asset.',
            'If the failure recurs, reopen the investigation and revisit Step 3.',
            'Share lessons learned with the reliability team via a Defect Elimination report.',
        ],
        checklist: [
            'Effectiveness review period defined',
            'KPIs monitored (MTBF, failure count, downtime)',
            'Results documented and reviewed',
            'Investigation formally closed (or escalated)',
        ],
    },
];

const RCAStepGuide: React.FC<RCAStepGuideProps> = ({ activeStep }) => {
    const [expanded, setExpanded] = useState(false);

    const guide = STEP_GUIDANCE[activeStep] ?? STEP_GUIDANCE[0];

    return (
        <div style={{
            borderRadius: 10, overflow: 'hidden',
            border: `1px solid ${expanded ? '#c7d2fe' : '#e2e8f0'}`,
            background: expanded ? '#f5f3ff' : '#fff',
            marginBottom: 16,
            transition: 'all 0.2s ease',
        }}>
            {/* Header — always visible */}
            <button
                onClick={() => setExpanded(!expanded)}
                style={{
                    width: '100%', padding: '10px 14px',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8,
                }}
            >
                <HelpCircle size={15} color={expanded ? '#6366f1' : '#94a3b8'} />
                <span style={{
                    fontSize: 12, fontWeight: 600,
                    color: expanded ? '#4338ca' : '#64748b',
                }}>
                    {guide.title}
                </span>
                <span style={{ marginLeft: 'auto' }}>
                    {expanded
                        ? <ChevronDown size={14} color="#6366f1" />
                        : <ChevronRight size={14} color="#94a3b8" />}
                </span>
            </button>

            {/* Body — collapsible */}
            {expanded && (
                <div style={{ padding: '0 14px 14px', borderTop: '1px solid #e2e8f0' }}>
                    {/* Summary */}
                    <p style={{
                        fontSize: 12, color: '#475569', lineHeight: 1.6,
                        margin: '10px 0 12px', fontStyle: 'italic',
                    }}>
                        {guide.summary}
                    </p>

                    {/* Tips */}
                    <div style={{ marginBottom: 12 }}>
                        <div style={{
                            fontSize: 10, fontWeight: 700, color: '#6366f1',
                            textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6,
                        }}>
                            💡 Tips
                        </div>
                        <ul style={{ margin: 0, paddingLeft: 16, listStyle: 'none' }}>
                            {guide.tips.map((tip, i) => (
                                <li key={i} style={{
                                    fontSize: 11, color: '#334155', lineHeight: 1.6,
                                    marginBottom: 4, position: 'relative', paddingLeft: 4,
                                }}>
                                    <span style={{ position: 'absolute', left: -12, color: '#a78bfa' }}>•</span>
                                    {tip}
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Checklist */}
                    <div>
                        <div style={{
                            fontSize: 10, fontWeight: 700, color: '#059669',
                            textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6,
                        }}>
                            ✓ Step Checklist
                        </div>
                        <ul style={{ margin: 0, paddingLeft: 16, listStyle: 'none' }}>
                            {guide.checklist.map((item, i) => (
                                <li key={i} style={{
                                    fontSize: 11, color: '#475569', lineHeight: 1.8,
                                    position: 'relative', paddingLeft: 4,
                                }}>
                                    <span style={{ position: 'absolute', left: -14, color: '#a5f3fc' }}>○</span>
                                    {item}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            )}
        </div>
    );
};

export default RCAStepGuide;
