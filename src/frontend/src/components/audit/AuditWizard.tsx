/**
 * AuditWizard.tsx — Streamlined 5-Step Assessment Orchestrator
 *
 * Client-friendly assessment flow:
 *   1. Intake & Scope  →  2. Document Readiness  →  3. 6M Assessment
 *   4. Score Findings  →  5. Report & Roadmap
 *
 * Manages unified state, step transitions, auto-save, AI context injection,
 * and colleague invitation panel.
 *
 * Full 7-step professional audit (with Site Verification & Interviews)
 * is preserved in template configurations — not used here.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ArrowLeft, Check, Loader2, CheckCircle, AlertTriangle, Users } from 'lucide-react';
import { ASSESSMENT_STEPS } from '../../eam/services/AuditTypes';
import type { AuditAssessmentState, AuditIntakeData, ScoredFinding } from '../../eam/services/AuditTypes';
import type { SixMChecklistAnswer } from '../../eam/services/SixMQuestionBank';
import { auditAssessor } from '../../eam/services/AuditAssessor';
import { assessmentService } from '../../eam/services/AssessmentService';
import { useAuth } from '../../eam/contexts/AuthContext';

import { AuditIntake } from './AuditIntake';
import { AuditIntakeAnalysis } from './AuditIntakeAnalysis';
import { AuditDocReadiness } from './AuditDocReadiness';
import { AuditSixMChecklist } from './AuditSixMChecklist';
import { AuditScoredFindings } from './AuditScoredFindings';
import { AuditReportView } from './AuditReportView';
import { AssessmentInvite } from './AssessmentInvite';

interface Props {
    existingState?: AuditAssessmentState;
    onExit: () => void;
    onSaved: () => void;
}

const EMPTY_STATE: AuditAssessmentState = {
    currentStep: 1,
    status: 'in_progress',
    intake: {
        firstName: '', lastName: '', fullName: '', username: '', autoUsername: true, jobTitle: '', company: '', email: '', mobileCountryCode: '', mobile: '', siteName: '',
        industrySector: 'Oil & Gas (Upstream)', assetClass: 'Mixed / All Classes', auditDate: '',
        auditObjective: '', reportingLine: '', keyRisks: [], keyOpportunities: [],
        orgVision: '', orgMission: '', orgStrategicObjectives: '',
        orgAMPolicy: '', orgSAMP: '', orgRolesAuthorities: '',
        orgRiskFramework: '', orgBudgetAlignment: '',
        isoAlignment: {
            iso55010_financial_alignment: '', iso55010_register_alignment: '', iso55010_capex_integration: '',
            iso55011_regulatory_mapping: '', iso55011_policy_engagement: '',
            iso55012_competence_framework: '', iso55012_cultural_factors: '', iso55012_outsourced_competence: '',
            iso55013_data_governance: '', iso55013_data_quality: '', iso55013_data_asset_distinction: '',
        },
    },
    documentReview: [],
    siteVerification: [],
    interviews: [],
    sixmChecklistAnswers: [],
    sixmDimensionNotes: {},
    dimensionResults: [],
    dimensionsCompleted: 0,
    scoredFindings: [],
    overallMaturity: null,
    overallPercentage: null,
    maturityLevel: null,
    reportData: null,
    roadmapData: null,
    notes: '',
};

// ─── Auto-save debounce (ms) ────────────────────────────────────
const AUTOSAVE_DELAY = 1500;
const TOTAL_STEPS = 5;

export const AuditWizard: React.FC<Props> = ({ existingState, onExit, onSaved }) => {
    const [state, setState] = useState<AuditAssessmentState>(existingState || { ...EMPTY_STATE });
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [inviteOpen, setInviteOpen] = useState(false);
    // Interstitial: instant directional snapshot shown after intake, before Step 2.
    const [showAnalysis, setShowAnalysis] = useState(false);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const recordIdRef = useRef<string | undefined>(state.id);
    const stateRef = useRef<AuditAssessmentState>(state);
    const isSavingRef = useRef(false);

    const { user } = useAuth();
    const currentStep = state.currentStep;

    // Keep stateRef in sync
    useEffect(() => { stateRef.current = state; }, [state]);

    // ─── Auto-save on state change ──────────────────────────────
    const persistState = useCallback(async (s: AuditAssessmentState) => {
        if (!s.intake.firstName && !recordIdRef.current) return;
        if (isSavingRef.current) return;
        isSavingRef.current = true;

        setSaveStatus('saving');
        try {
            const stateToSave = { ...s, id: recordIdRef.current };
            const savedId = await assessmentService.saveState(stateToSave);

            if (savedId) {
                if (!recordIdRef.current) {
                    recordIdRef.current = savedId;
                    const rec = await assessmentService.getAssessment(savedId);
                    setState(prev => ({
                        ...prev,
                        id: savedId,
                        assessmentNumber: rec?.assessment_number,
                    }));
                }
                setSaveStatus('saved');
            } else {
                setSaveStatus('error');
            }
        } catch (e) {
            console.error('[AuditWizard] Auto-save failed:', e);
            setSaveStatus('error');
        } finally {
            isSavingRef.current = false;
        }
        setTimeout(() => setSaveStatus('idle'), 3000);
    }, []);

    const scheduleSave = useCallback((s: AuditAssessmentState) => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => persistState(s), AUTOSAVE_DELAY);
    }, [persistState]);

    // ─── Flush save on tab switch / page close ──────────────────
    useEffect(() => {
        const flushSave = () => {
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }
            const s = stateRef.current;
            if (s.intake.firstName || recordIdRef.current) {
                persistState(s);
            }
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') flushSave();
        };
        const handleBeforeUnload = () => flushSave();

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('beforeunload', handleBeforeUnload);
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
                persistState(stateRef.current);
            }
        };
    }, [persistState]);

    const goToStep = useCallback((step: number) => {
        setState(prev => ({ ...prev, currentStep: Math.max(1, Math.min(TOTAL_STEPS, step)) }));
    }, []);

    // ─── Context injection: update AI assessor when entering Step 4 (findings) ──
    useEffect(() => {
        if (currentStep === 4) {
            auditAssessor.setContext({
                intake: state.intake,
                documentReview: state.documentReview,
                sixmChecklistAnswers: state.sixmChecklistAnswers,
                sixmDimensionNotes: state.sixmDimensionNotes,
            });
        }
    }, [currentStep, state.intake, state.documentReview, state.sixmChecklistAnswers, state.sixmDimensionNotes]);

    // ─── Step Handlers ──────────────────────────────────────

    const handleIntakeComplete = (data: AuditIntakeData) => {
        // Stay on Step 1 and surface the instant directional snapshot.
        // Persisting here captures the lead (auto-save) before they go deeper.
        const next = { ...state, intake: data, currentStep: 1 };
        setState(next);
        scheduleSave(next);
        setShowAnalysis(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleAnalysisContinue = () => {
        setShowAnalysis(false);
        goToStep(2);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleAnalysisRefine = () => {
        setShowAnalysis(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDocReadinessComplete = (data: any[]) => {
        const next = { ...state, documentReview: data, currentStep: 3 };
        setState(next);
        scheduleSave(next);
    };

    const handleSixMComplete = (answers: SixMChecklistAnswer[], notes: Record<string, string>) => {
        const next: AuditAssessmentState = {
            ...state,
            sixmChecklistAnswers: answers,
            sixmDimensionNotes: notes,
            dimensionsCompleted: new Set(answers.map(a => a.dimensionKey)).size,
            currentStep: 4,
        };
        setState(next);
        scheduleSave(next);
    };

    const handleFindingsComplete = (data: ScoredFinding[]) => {
        const next = { ...state, scoredFindings: data, currentStep: 5 };
        setState(next);
        scheduleSave(next);
    };

    // Build registration object for report components
    const registration = {
        fullName: `${state.intake.firstName} ${state.intake.lastName}`.trim() || state.intake.fullName,
        jobTitle: state.intake.jobTitle,
        company: state.intake.company,
        email: state.intake.email,
        mobile: `${state.intake.mobileCountryCode} ${state.intake.mobile}`.trim(),
        industrySector: state.intake.industrySector,
        siteName: state.intake.siteName,
    };

    return (
        <div className="h-full flex flex-col bg-slate-50">
            {/* ─── Top Stepper ────────────────────────────────── */}
            <div className="bg-white border-b border-slate-200 px-6 py-4">
                <div className="ers-page-narrow">
                    {/* Back button + title + save status + invite */}
                    <div className="flex items-center gap-3 mb-4">
                        <button onClick={onExit} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                            <ArrowLeft size={18} />
                        </button>
                        <div>
                            <h1 className="text-lg font-black text-slate-800">Asset Management Assessment</h1>
                            <p className="text-[11px] text-slate-400">ISO 55000:2024 Series · 6M Maturity Assessment</p>
                        </div>
                        {state.intake.company && (
                            <span className="ml-auto text-xs text-slate-500 bg-slate-100 px-3 py-1 rounded-lg">
                                {state.intake.company}
                                {state.intake.siteName && ` · ${state.intake.siteName}`}
                            </span>
                        )}

                        {/* Invite Colleagues Button */}
                        <button
                            onClick={() => setInviteOpen(true)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 border border-blue-200 rounded-lg text-xs font-bold hover:bg-blue-100 transition-colors"
                        >
                            <Users size={14} /> Invite
                        </button>

                        {/* Auto-save indicator */}
                        <div className="flex items-center gap-1.5">
                            {saveStatus === 'saving' && <><Loader2 size={12} className="animate-spin text-slate-400" /><span className="text-[10px] text-slate-400">Saving...</span></>}
                            {saveStatus === 'saved' && <><CheckCircle size={12} className="text-green-500" /><span className="text-[10px] text-green-500">Saved</span></>}
                            {saveStatus === 'error' && <><AlertTriangle size={12} className="text-red-400" /><span className="text-[10px] text-red-400">Save failed</span></>}
                        </div>
                    </div>

                    {/* Step indicators */}
                    <div className="flex items-center gap-1">
                        {ASSESSMENT_STEPS.map((step, i) => {
                            const isActive = step.step === currentStep;
                            const isComplete = step.step < currentStep;
                            const isClickable = step.step <= currentStep;
                            return (
                                <React.Fragment key={step.step}>
                                    {i > 0 && (
                                        <div className={`flex-1 h-0.5 rounded-full transition-colors ${
                                            isComplete ? 'bg-blue-400' : 'bg-slate-200'
                                        }`} />
                                    )}
                                    <button
                                        onClick={() => isClickable && goToStep(step.step)}
                                        disabled={!isClickable}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                                            isActive
                                                ? 'bg-blue-50 text-blue-600 border border-blue-200 shadow-sm'
                                                : isComplete
                                                    ? 'bg-green-50 text-green-600 border border-green-200 cursor-pointer hover:bg-green-100'
                                                    : 'bg-slate-50 text-slate-400 border border-slate-200'
                                        }`}
                                    >
                                        {isComplete ? (
                                            <Check size={12} className="text-green-500" />
                                        ) : (
                                            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
                                                isActive ? 'bg-blue-500 text-white' : 'bg-slate-200 text-slate-500'
                                            }`}>
                                                {step.step}
                                            </span>
                                        )}
                                        <span className="hidden lg:inline">{step.shortLabel}</span>
                                    </button>
                                </React.Fragment>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* ─── Step Content ────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto">
                {currentStep === 1 && !showAnalysis && (
                    <AuditIntake
                        initialData={state.intake}
                        onComplete={handleIntakeComplete}
                    />
                )}
                {currentStep === 1 && showAnalysis && (
                    <AuditIntakeAnalysis
                        intake={state.intake}
                        onContinue={handleAnalysisContinue}
                        onRefine={handleAnalysisRefine}
                    />
                )}
                {currentStep === 2 && (
                    <AuditDocReadiness
                        initialData={state.documentReview as any}
                        onComplete={handleDocReadinessComplete}
                        onBack={() => goToStep(1)}
                    />
                )}
                {currentStep === 3 && (
                    <AuditSixMChecklist
                        initialData={state.sixmChecklistAnswers}
                        dimensionNotes={state.sixmDimensionNotes}
                        onComplete={handleSixMComplete}
                        onBack={() => goToStep(2)}
                    />
                )}
                {currentStep === 4 && (
                    <AuditScoredFindings
                        initialData={state.scoredFindings}
                        onComplete={handleFindingsComplete}
                        onBack={() => goToStep(3)}
                    />
                )}
                {currentStep === 5 && (
                    <AuditReportView
                        registration={registration}
                        results={state.dimensionResults}
                        auditState={state}
                        existingRecord={null}
                        onSaved={onSaved}
                    />
                )}
            </div>

            {/* ─── Invite Panel ────────────────────────────────── */}
            <AssessmentInvite
                assessmentId={recordIdRef.current || null}
                currentUser={user?.email || state.intake.email}
                isOpen={inviteOpen}
                onClose={() => setInviteOpen(false)}
            />
        </div>
    );
};
