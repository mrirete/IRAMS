/**
 * AgentService — Agentic Reliability Intelligence Orchestrator
 *
 * Eleven agents, one governance principle: HITL.
 * All agents produce DRAFT artifacts that require human approval.
 * No agent can persist a Work Order, approve a shutdown, or modify
 * alarm limits without explicit user validation.
 *
 * Agents:
 *  1. AlertToWorkOrderAgent — drafts WRs from high-severity prediction alerts
 *  2. BadActorAgent — auto-drafts RCA templates from Pareto bad actors
 *  3. BayesianThresholdAdapter — proposes alarm limit adjustments from feedback
 *  4. VisionToWorkOrderAgent — drafts WRs from critical/severe Vision findings
 *  5. InspectionToWorkOrderAgent — drafts WRs from physical inspection findings
 *  6. PMEffectivenessAgent — evaluates PM value and suggests adjustments
 *  7. BudgetOverrunAgent — flags WOs exceeding estimates for investigation
 *  8. StockoutPreventionAgent — forecasts stockouts and drafts emergency POs
 *  9. CertificationExpiryAgent — identifies expiring certifications/training
 * 10. ComplianceAuditAgent — scores ISO 14224 data quality across closed WOs
 * 11. AutoParetoAgent — monthly bad-actor identification with DE task drafts
 */

import { predictionService } from './PredictionService';
import { aiEngine } from './AIAnalysisEngine';
import type { PredictionAlert, AgentAction } from './PredictionService';
import type {
    WorkRequestDraft, BadActorRCASummary,
    PMEffectivenessResult, EOQResult, VendorScorecard
} from './AIAnalysisEngine';
import type { VisionResult } from '../../types/strategy';

// ─── Agent Response Types ────────────────────────────────────

export interface AlertToWOResult {
    success: boolean;
    agentAction: AgentAction | null;
    draft: WorkRequestDraft | null;
    message: string;
}

export interface BadActorRCAResult {
    success: boolean;
    agentAction: AgentAction | null;
    draft: BadActorRCASummary | null;
    message: string;
}

export interface ThresholdProposal {
    tag: string;
    current_alarm_high: number | null;
    current_alarm_low: number | null;
    proposed_alarm_high: number | null;
    proposed_alarm_low: number | null;
    direction: 'widen' | 'tighten' | 'no_change';
    rationale: string;
}

export interface ThresholdAdapterResult {
    success: boolean;
    agentAction: AgentAction | null;
    proposals: ThresholdProposal[];
    precision: number;
    message: string;
}

export interface VisionToWOResult {
    success: boolean;
    agentAction: AgentAction | null;
    draft: WorkRequestDraft | null;
    message: string;
}

// ─── Phase 3: New Agent Response Types ───────────────────────

export interface PMEffectivenessAgentResult {
    success: boolean;
    agentAction: AgentAction | null;
    result: PMEffectivenessResult | null;
    message: string;
}

export interface BudgetOverrunAgentResult {
    success: boolean;
    agentAction: AgentAction | null;
    overrunPercent: number;
    overrunAmount: number;
    message: string;
}

export interface StockoutPreventionResult {
    success: boolean;
    agentAction: AgentAction | null;
    daysUntilStockout: number;
    suggestedOrderQty: number;
    message: string;
}

export interface ExpiringCertification {
    personnelId: string;
    personnelName: string;
    role: string;
    certificationName: string;
    expiryDate: string;
    daysRemaining: number;
    isExpired: boolean;
    isSafetyCritical: boolean;
    issuingBody?: string;
}

export interface CertExpiryAgentResult {
    success: boolean;
    agentAction: AgentAction | null;
    expiringCerts: ExpiringCertification[];
    message: string;
}

export interface ComplianceDeficiency {
    workOrderId: string;
    workOrderTitle: string;
    assetCriticality: string;
    missingFields: string[];
    complianceScore: number;
    isCritical: boolean;
}

export interface ComplianceAuditResult {
    success: boolean;
    agentAction: AgentAction | null;
    overallScore: number;
    totalAudited: number;
    deficiencies: ComplianceDeficiency[];
    message: string;
}

export interface BadActorDEDraft {
    assetId: string;
    assetName: string;
    assetTag: string;
    criticality: string;
    metricValue: number;
    metricUnit: string;
    eliminationPlan: import('./AIAnalysisEngine').EliminationPlanDraft;
}

export interface AutoParetoResult {
    success: boolean;
    agentAction: AgentAction | null;
    badActors: BadActorDEDraft[];
    draftCount: number;
    message: string;
}

// ─── Criticality → Numeric Mapping ──────────────────────────

const CRITICALITY_MAP: Record<string, number> = { A: 5, B: 3, C: 1 };
const SEVERITY_MAP: Record<string, number> = { critical: 5, emergency: 5, high: 4, medium: 3, low: 2, info: 1 };
const VISION_SEVERITY_MAP: Record<string, number> = { critical: 5, severe: 4, moderate: 2, minor: 1 };

// ─── Service ─────────────────────────────────────────────────

class AgentService {
    private static instance: AgentService;
    private constructor() {}

    static getInstance(): AgentService {
        if (!AgentService.instance) AgentService.instance = new AgentService();
        return AgentService.instance;
    }

    // ══════════════════════════════════════════════════════════
    //  Agent 1: Alert → Work Order Draft
    // ══════════════════════════════════════════════════════════

    /**
     * Given a high/critical prediction alert, draft a Work Request
     * and persist it to the agent actions audit trail.
     *
     * HITL: The draft is NOT a Work Request. It must be approved by a human
     * before it becomes an actual WR in the work_requests table.
     */
    async draftWorkOrderFromAlert(
        alert: PredictionAlert,
        assetContext: {
            assetName: string;
            assetTag?: string;
            assetCriticality?: string;
            assetType?: string;
        },
    ): Promise<AlertToWOResult> {
        try {
            // 1. Generate AI-powered draft via Gemini
            const draft = await aiEngine.draftWorkRequestFromAlert({
                alertTitle: alert.title,
                alertDescription: alert.description || '',
                alertSeverity: alert.severity,
                alertType: alert.alert_type,
                assetName: assetContext.assetName,
                assetTag: assetContext.assetTag,
                assetCriticality: assetContext.assetCriticality,
                assetType: assetContext.assetType,
                confidence: alert.confidence || undefined,
            });

            // 2. Calculate RPN for governance escalation
            const critNum = CRITICALITY_MAP[assetContext.assetCriticality || 'B'] || 3;
            const sevNum = SEVERITY_MAP[alert.severity] || 3;
            const rpn = critNum * sevNum;

            // 3. Override priority if RPN demands escalation
            if (rpn >= 20) draft.priority = 'emergency';
            else if (rpn >= 12) draft.priority = 'urgent';

            // 4. Persist to audit trail as pending_review
            const agentAction = await predictionService.createAgentAction({
                agent_type: 'alert_to_wo',
                trigger_id: alert.alert_id,
                asset_id: alert.asset_id,
                action_type: 'wr_draft',
                draft_payload: { ...draft, rpn, source_alert: alert.alert_id },
                status: 'pending_review',
            });

            return {
                success: true,
                agentAction,
                draft,
                message: `WO draft created (RPN: ${rpn}). Awaiting human approval.`,
            };
        } catch (e: any) {
            console.error('[AgentService.draftWorkOrderFromAlert]', e);
            return { success: false, agentAction: null, draft: null, message: e.message || 'Agent failed' };
        }
    }

    // ══════════════════════════════════════════════════════════
    //  Agent 2: Bad Actor → RCA Draft
    // ══════════════════════════════════════════════════════════

    /**
     * Given a Pareto bad-actor asset, generate a pre-populated RCA template
     * using work order history and AI-synthesized cause chains.
     *
     * HITL: The RCA template is a DRAFT. The reliability engineer reviews
     * and modifies before creating an actual RCA investigation.
     */
    async draftBadActorRCA(
        assetId: string,
        assetName: string,
        assetCriticality: string,
        metricValue: number,
        metricUnit: string,
        failureCount: number,
        recentWorkOrders: { type: string; title: string; cost: number; date: string; failureMode?: string }[],
    ): Promise<BadActorRCAResult> {
        try {
            // 1. Generate AI-powered RCA summary
            const draft = await aiEngine.generateBadActorRCASummary({
                assetName,
                assetCriticality,
                metricValue,
                metricUnit,
                failureCount,
                recentWorkOrders,
            });

            // 2. Persist to audit trail
            const agentAction = await predictionService.createAgentAction({
                agent_type: 'bad_actor_rca',
                trigger_id: `pareto_${assetId}`,
                asset_id: assetId,
                action_type: 'rca_draft',
                draft_payload: { ...draft, asset_name: assetName, criticality: assetCriticality },
                status: 'pending_review',
            });

            return {
                success: true,
                agentAction,
                draft,
                message: `RCA template drafted for ${assetName}. Awaiting engineer review.`,
            };
        } catch (e: any) {
            console.error('[AgentService.draftBadActorRCA]', e);
            return { success: false, agentAction: null, draft: null, message: e.message || 'Agent failed' };
        }
    }

    // ══════════════════════════════════════════════════════════
    //  Agent 3: Bayesian Threshold Adapter
    // ══════════════════════════════════════════════════════════

    /**
     * Analyze accumulated prediction feedback (actionable / false_alarm)
     * and propose alarm threshold adjustments.
     *
     * HITL: Threshold changes are PROPOSALS. No alarm limit is modified
     * until a human approves the adjustment.
     *
     * Logic:
     *   precision < 0.70 → too many false alarms → widen thresholds
     *   precision > 0.90 → high accuracy → can tighten thresholds
     *   otherwise → no change recommended
     */
    async proposeThresholdAdjustments(assetId: string): Promise<ThresholdAdapterResult> {
        try {
            // 1. Gather feedback statistics
            const stats = await predictionService.getAlertFeedbackStats(assetId);

            if (stats.actionable + stats.falseAlarm < 5) {
                return {
                    success: true,
                    agentAction: null,
                    proposals: [],
                    precision: stats.precision,
                    message: `Insufficient feedback data (${stats.actionable + stats.falseAlarm}/5 minimum). Continue collecting.`,
                };
            }

            // 2. Fetch current sensor readings for this asset
            const sensors = await predictionService.getSensorReadings(assetId);
            if (sensors.length === 0) {
                return { success: true, agentAction: null, proposals: [], precision: stats.precision, message: 'No sensor readings to adjust.' };
            }

            // 3. Calculate threshold proposals
            const proposals: ThresholdProposal[] = sensors
                .filter(s => s.alarm_high !== null || s.alarm_low !== null)
                .map(sensor => {
                    let direction: 'widen' | 'tighten' | 'no_change' = 'no_change';
                    let proposedHigh = sensor.alarm_high;
                    let proposedLow = sensor.alarm_low;
                    let rationale = '';

                    if (stats.precision < 0.70) {
                        // Too many false alarms — widen
                        const widenFactor = 1 + (1 - stats.precision) * 0.10;
                        direction = 'widen';
                        if (sensor.alarm_high !== null && sensor.current_value !== null) {
                            proposedHigh = sensor.current_value + (sensor.alarm_high - sensor.current_value) * widenFactor;
                        }
                        if (sensor.alarm_low !== null && sensor.current_value !== null) {
                            proposedLow = sensor.current_value - (sensor.current_value - sensor.alarm_low) * widenFactor;
                        }
                        rationale = `Precision ${(stats.precision * 100).toFixed(0)}% < 70%. Widening by ${((widenFactor - 1) * 100).toFixed(1)}% to reduce false alarms.`;
                    } else if (stats.precision > 0.90) {
                        // High accuracy — can tighten
                        const tightenFactor = 1 - (stats.precision - 0.90) * 0.05;
                        direction = 'tighten';
                        if (sensor.alarm_high !== null && sensor.current_value !== null) {
                            proposedHigh = sensor.current_value + (sensor.alarm_high - sensor.current_value) * tightenFactor;
                        }
                        if (sensor.alarm_low !== null && sensor.current_value !== null) {
                            proposedLow = sensor.current_value - (sensor.current_value - sensor.alarm_low) * tightenFactor;
                        }
                        rationale = `Precision ${(stats.precision * 100).toFixed(0)}% > 90%. Tightening by ${((1 - tightenFactor) * 100).toFixed(1)}% for earlier detection.`;
                    } else {
                        rationale = `Precision ${(stats.precision * 100).toFixed(0)}% within optimal range (70-90%). No adjustment needed.`;
                    }

                    return {
                        tag: sensor.tag,
                        current_alarm_high: sensor.alarm_high,
                        current_alarm_low: sensor.alarm_low,
                        proposed_alarm_high: proposedHigh !== null ? Math.round(proposedHigh * 100) / 100 : null,
                        proposed_alarm_low: proposedLow !== null ? Math.round(proposedLow * 100) / 100 : null,
                        direction,
                        rationale,
                    };
                });

            const activeProposals = proposals.filter(p => p.direction !== 'no_change');

            // 4. Persist if there are actual proposals
            let agentAction: AgentAction | null = null;
            if (activeProposals.length > 0) {
                agentAction = await predictionService.createAgentAction({
                    agent_type: 'threshold_adapter',
                    trigger_id: `feedback_${assetId}`,
                    asset_id: assetId,
                    action_type: 'threshold_proposal',
                    draft_payload: { proposals: activeProposals, precision: stats.precision, sample_size: stats.actionable + stats.falseAlarm },
                    status: 'pending_review',
                });
            }

            return {
                success: true,
                agentAction,
                proposals,
                precision: stats.precision,
                message: activeProposals.length > 0
                    ? `${activeProposals.length} threshold adjustment(s) proposed. Awaiting human approval.`
                    : 'All thresholds within optimal range. No adjustments needed.',
            };
        } catch (e: any) {
            console.error('[AgentService.proposeThresholdAdjustments]', e);
            return { success: false, agentAction: null, proposals: [], precision: 0, message: e.message || 'Agent failed' };
        }
    }

    // ══════════════════════════════════════════════════════════
    //  Agent 4: Vision Finding → Work Order Draft
    // ══════════════════════════════════════════════════════════

    /**
     * Given a critical/severe Vision inspection result, draft a Work Request.
     *
     * HITL: The draft is NOT a Work Request. It must be approved by a human
     * before it becomes an actual WR. Vision findings carry inherent uncertainty;
     * field verification is always recommended.
     */
    async draftWorkOrderFromVisionFinding(
        finding: VisionResult,
        assetContext: {
            assetName: string;
            assetTag?: string;
            assetCriticality?: string;
            assetType?: string;
        },
    ): Promise<VisionToWOResult> {
        try {
            // 1. Generate AI-powered draft via Gemini
            const draft = await aiEngine.draftWorkRequestFromVisionFinding({
                analysisType: finding.analysis_type,
                severity: finding.max_severity,
                detectedItems: finding.detected_items,
                imageName: finding.image_name,
                assetName: assetContext.assetName,
                assetTag: assetContext.assetTag,
                assetCriticality: assetContext.assetCriticality,
                assetType: assetContext.assetType,
            });

            // 2. Calculate RPN: Asset Criticality × Vision Severity
            const critNum = CRITICALITY_MAP[assetContext.assetCriticality || 'B'] || 3;
            const sevNum = VISION_SEVERITY_MAP[finding.max_severity] || 2;
            const rpn = critNum * sevNum;

            // 3. Override priority if RPN demands escalation
            if (rpn >= 20) draft.priority = 'emergency';
            else if (rpn >= 12) draft.priority = 'urgent';

            // 4. Persist to audit trail as pending_review
            const agentAction = await predictionService.createAgentAction({
                agent_type: 'vision_to_wo',
                trigger_id: finding.id,
                asset_id: finding.asset_id || 'unknown',
                action_type: 'wr_draft',
                draft_payload: {
                    ...draft,
                    rpn,
                    source_vision_finding: finding.id,
                    analysis_type: finding.analysis_type,
                    vision_severity: finding.max_severity,
                },
                status: 'pending_review',
            });

            return {
                success: true,
                agentAction,
                draft,
                message: `Vision WO draft created (RPN: ${rpn}). Awaiting human approval.`,
            };
        } catch (e: any) {
            console.error('[AgentService.draftWorkOrderFromVisionFinding]', e);
            return { success: false, agentAction: null, draft: null, message: e.message || 'Agent failed' };
        }
    }

    // ══════════════════════════════════════════════════════════
    //  Agent 5: Inspection Finding → Work Order Draft
    // ══════════════════════════════════════════════════════════

    /**
     * Given a physical inspection finding (from InspectionDetailPage),
     * draft a Work Request using AI analysis.
     *
     * HITL: The draft is NOT a Work Request. It must be approved by a human
     * before it becomes an actual WR. Physical inspection findings should
     * reference the governing code and CML for traceability.
     */
    async draftWorkOrderFromInspectionFinding(
        finding: {
            id: string;
            description: string;
            severity: string;
            nde_method?: string;
            damage_mechanism_id?: string;
            cml_id?: string;
        },
        inspectionContext: {
            inspectionId: string;
            inspectionType: string;
            governingCode?: string;
            assetId: string;
        },
        assetContext: {
            assetName: string;
            assetTag?: string;
            assetCriticality?: string;
            assetType?: string;
        },
    ): Promise<VisionToWOResult> {
        try {
            // 1. Generate AI-powered draft via Gemini
            const draft = await aiEngine.draftWorkRequestFromInspectionFinding({
                findingDescription: finding.description,
                severity: finding.severity,
                ndeMethod: finding.nde_method || inspectionContext.inspectionType,
                inspectionType: inspectionContext.inspectionType,
                governingCode: inspectionContext.governingCode,
                damageMechanism: finding.damage_mechanism_id,
                cmlReference: finding.cml_id,
                assetName: assetContext.assetName,
                assetTag: assetContext.assetTag,
                assetCriticality: assetContext.assetCriticality,
                assetType: assetContext.assetType,
            });

            // 2. Calculate RPN: Asset Criticality × Finding Severity
            const critNum = CRITICALITY_MAP[assetContext.assetCriticality || 'B'] || 3;
            const FINDING_SEVERITY_MAP: Record<string, number> = {
                critical: 5, major: 4, moderate: 3, minor: 2, observation: 1,
            };
            const sevNum = FINDING_SEVERITY_MAP[finding.severity] || 3;
            const rpn = critNum * sevNum;

            // 3. Override priority if RPN demands escalation
            if (rpn >= 20) draft.priority = 'emergency';
            else if (rpn >= 12) draft.priority = 'urgent';

            // 4. Persist to audit trail as pending_review
            const agentAction = await predictionService.createAgentAction({
                agent_type: 'inspection_to_wo',
                trigger_id: finding.id,
                asset_id: inspectionContext.assetId,
                action_type: 'wr_draft',
                draft_payload: {
                    ...draft,
                    rpn,
                    source_inspection_id: inspectionContext.inspectionId,
                    source_finding_id: finding.id,
                    governing_code: inspectionContext.governingCode,
                    nde_method: finding.nde_method,
                },
                status: 'pending_review',
            });

            return {
                success: true,
                agentAction,
                draft,
                message: `Inspection WO draft created (RPN: ${rpn}). Awaiting human approval.`,
            };
        } catch (e: any) {
            console.error('[AgentService.draftWorkOrderFromInspectionFinding]', e);
            return { success: false, agentAction: null, draft: null, message: e.message || 'Agent failed' };
        }
    }

    // ══════════════════════════════════════════════════════════
    //  Agent 6: PM Effectiveness Evaluator
    // ══════════════════════════════════════════════════════════

    /**
     * Evaluate a PM program's effectiveness using SAE JA1011 value-ratio.
     * Suggests: continue, adjust interval, suspend, or convert to PdM.
     *
     * HITL: Recommendation only — engineer must approve any PM change via MoC.
     */
    async evaluatePMEffectiveness(
        pmId: string,
        pmTitle: string,
        assetId: string,
        assetName: string,
        assetCriticality: string,
        intervalDays: number,
        executionCount: number,
        totalCost: number,
        failuresFoundCount: number,
        failuresBetweenPMs: number,
        lastExecutionDate?: string,
    ): Promise<PMEffectivenessAgentResult> {
        try {
            const result = await aiEngine.evaluatePMEffectiveness({
                pmId, pmTitle, assetName, assetCriticality,
                intervalDays, executionCount, totalCost,
                failuresFoundCount, failuresBetweenPMs, lastExecutionDate,
            });

            const agentAction = await predictionService.createAgentAction({
                agent_type: 'pm_effectiveness',
                trigger_id: `pm_eval_${pmId}`,
                asset_id: assetId,
                action_type: 'pm_adjustment',
                draft_payload: {
                    ...result,
                    asset_name: assetName,
                    criticality: assetCriticality,
                },
                status: 'pending_review',
            });

            return {
                success: true,
                agentAction,
                result,
                message: `PM "${pmTitle}" evaluated: ${result.recommendation.toUpperCase()}. Value ratio: ${result.valueRatio.toFixed(2)}. Awaiting engineer review.`,
            };
        } catch (e: any) {
            console.error('[AgentService.evaluatePMEffectiveness]', e);
            return { success: false, agentAction: null, result: null, message: e.message || 'Agent failed' };
        }
    }

    // ══════════════════════════════════════════════════════════
    //  Agent 7: Budget Overrun Detector
    // ══════════════════════════════════════════════════════════

    /**
     * Triggered when a WO's actual cost exceeds the estimate by 30%+.
     * Drafts a cost investigation alert for finance/planning review.
     *
     * HITL: Alert only — finance approves investigation or accepts variance.
     */
    async flagBudgetOverrun(
        workOrderId: string,
        workOrderTitle: string,
        assetId: string,
        assetName: string,
        estimatedCost: number,
        actualCost: number,
        costCentre?: string,
        workType?: string,
    ): Promise<BudgetOverrunAgentResult> {
        try {
            const overrunPercent = estimatedCost > 0
                ? ((actualCost - estimatedCost) / estimatedCost) * 100
                : 100;
            const overrunAmount = actualCost - estimatedCost;

            // Only trigger if overrun >= 30%
            if (overrunPercent < 30) {
                return {
                    success: true, agentAction: null,
                    overrunPercent, overrunAmount,
                    message: `WO cost within tolerance (${overrunPercent.toFixed(0)}% over estimate).`,
                };
            }

            const severity = overrunPercent >= 100 ? 'critical'
                : overrunPercent >= 60 ? 'high'
                : 'medium';

            const agentAction = await predictionService.createAgentAction({
                agent_type: 'budget_overrun',
                trigger_id: `wo_cost_${workOrderId}`,
                asset_id: assetId,
                action_type: 'cost_investigation',
                draft_payload: {
                    work_order_id: workOrderId,
                    work_order_title: workOrderTitle,
                    asset_name: assetName,
                    estimated_cost: estimatedCost,
                    actual_cost: actualCost,
                    overrun_percent: Math.round(overrunPercent),
                    overrun_amount: overrunAmount,
                    cost_centre: costCentre,
                    work_type: workType,
                    severity,
                    investigation_required: true,
                },
                status: 'pending_review',
            });

            return {
                success: true,
                agentAction,
                overrunPercent,
                overrunAmount,
                message: `⚠️ Budget overrun: ${overrunPercent.toFixed(0)}% ($${overrunAmount.toLocaleString()}) on WO "${workOrderTitle}". Cost investigation drafted.`,
            };
        } catch (e: any) {
            console.error('[AgentService.flagBudgetOverrun]', e);
            return { success: false, agentAction: null, overrunPercent: 0, overrunAmount: 0, message: e.message || 'Agent failed' };
        }
    }

    // ══════════════════════════════════════════════════════════
    //  Agent 8: Stockout Prevention
    // ══════════════════════════════════════════════════════════

    /**
     * Triggered by usage velocity analysis: if projected depletion date
     * is within lead time + safety buffer, draft an emergency PO.
     *
     * HITL: PO draft only — planner must approve before purchase.
     */
    async preventStockout(
        partId: string,
        partNumber: string,
        description: string,
        assetId: string,
        currentStock: number,
        minLevel: number,
        avgDailyUsage: number,
        leadTimeDays: number,
        unitCost: number,
        isCritical: boolean,
        upcomingPMsDemand?: number,
    ): Promise<StockoutPreventionResult> {
        try {
            const totalDemand = avgDailyUsage * leadTimeDays + (upcomingPMsDemand || 0);
            const daysUntilStockout = avgDailyUsage > 0
                ? Math.floor(currentStock / avgDailyUsage)
                : 999;
            const willStockout = daysUntilStockout <= leadTimeDays * 1.5;

            if (!willStockout && currentStock > minLevel) {
                return {
                    success: true, agentAction: null,
                    daysUntilStockout, suggestedOrderQty: 0,
                    message: `Stock level adequate (${currentStock} units, ${daysUntilStockout} days supply).`,
                };
            }

            // Calculate EOQ using Phase 2 engine
            const eoqResult = await aiEngine.calculateOptimalEOQ({
                partNumber, description,
                currentUnitCost: unitCost,
                annualUsage: avgDailyUsage * 365,
                currentMinLevel: minLevel,
                currentMaxLevel: minLevel * 3,
                leadTimeDays, isCritical,
            });

            const suggestedQty = Math.max(
                eoqResult.economicOrderQuantity,
                Math.ceil(totalDemand - currentStock + (isCritical ? eoqResult.safetyStock : 0))
            );

            const agentAction = await predictionService.createAgentAction({
                agent_type: 'stockout_prevention',
                trigger_id: `stockout_${partId}`,
                asset_id: assetId,
                action_type: 'emergency_po_draft',
                draft_payload: {
                    part_id: partId,
                    part_number: partNumber,
                    description,
                    current_stock: currentStock,
                    min_level: minLevel,
                    avg_daily_usage: avgDailyUsage,
                    days_until_stockout: daysUntilStockout,
                    lead_time_days: leadTimeDays,
                    suggested_order_qty: suggestedQty,
                    unit_cost: unitCost,
                    estimated_po_value: suggestedQty * unitCost,
                    is_critical: isCritical,
                    eoq_analysis: eoqResult,
                    upcoming_pm_demand: upcomingPMsDemand,
                },
                status: 'pending_review',
            });

            return {
                success: true,
                agentAction,
                daysUntilStockout,
                suggestedOrderQty: suggestedQty,
                message: `🚨 Stockout risk: "${partNumber}" — ${daysUntilStockout} days supply remaining (lead time: ${leadTimeDays}d). Emergency PO drafted for ${suggestedQty} units ($${(suggestedQty * unitCost).toLocaleString()}).`,
            };
        } catch (e: any) {
            console.error('[AgentService.preventStockout]', e);
            return { success: false, agentAction: null, daysUntilStockout: 0, suggestedOrderQty: 0, message: e.message || 'Agent failed' };
        }
    }

    // ══════════════════════════════════════════════════════════
    //  Agent 9: Certification Expiry Monitor
    // ══════════════════════════════════════════════════════════

    /**
     * 30-day lookahead: identifies expiring certifications, licenses,
     * and competency records. Drafts training requests.
     *
     * HITL: Training request draft — HR/Supervisor must approve.
     */
    async checkCertificationExpiry(
        personnel: {
            id: string;
            name: string;
            role: string;
            certifications: {
                name: string;
                expiryDate: string;
                issuingBody?: string;
                isSafetyCritical: boolean;
            }[];
        }[],
        lookaheadDays: number = 30,
    ): Promise<CertExpiryAgentResult> {
        try {
            const today = new Date();
            const cutoffDate = new Date(today.getTime() + lookaheadDays * 24 * 60 * 60 * 1000);
            const expiringCerts: ExpiringCertification[] = [];

            for (const person of personnel) {
                for (const cert of person.certifications) {
                    const expiry = new Date(cert.expiryDate);
                    if (expiry <= cutoffDate) {
                        const daysRemaining = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                        expiringCerts.push({
                            personnelId: person.id,
                            personnelName: person.name,
                            role: person.role,
                            certificationName: cert.name,
                            expiryDate: cert.expiryDate,
                            daysRemaining,
                            isExpired: daysRemaining < 0,
                            isSafetyCritical: cert.isSafetyCritical,
                            issuingBody: cert.issuingBody,
                        });
                    }
                }
            }

            if (expiringCerts.length === 0) {
                return {
                    success: true, agentAction: null,
                    expiringCerts: [],
                    message: `All certifications valid for the next ${lookaheadDays} days.`,
                };
            }

            // Sort: expired first, then by days remaining
            expiringCerts.sort((a, b) => {
                if (a.isExpired !== b.isExpired) return a.isExpired ? -1 : 1;
                if (a.isSafetyCritical !== b.isSafetyCritical) return a.isSafetyCritical ? -1 : 1;
                return a.daysRemaining - b.daysRemaining;
            });

            const agentAction = await predictionService.createAgentAction({
                agent_type: 'cert_expiry',
                trigger_id: `cert_scan_${today.toISOString().split('T')[0]}`,
                asset_id: 'SYSTEM',
                action_type: 'training_request',
                draft_payload: {
                    scan_date: today.toISOString(),
                    lookahead_days: lookaheadDays,
                    total_expiring: expiringCerts.length,
                    already_expired: expiringCerts.filter(c => c.isExpired).length,
                    safety_critical: expiringCerts.filter(c => c.isSafetyCritical).length,
                    certifications: expiringCerts,
                },
                status: 'pending_review',
            });

            const expired = expiringCerts.filter(c => c.isExpired).length;
            const safetyCritical = expiringCerts.filter(c => c.isSafetyCritical && !c.isExpired).length;

            return {
                success: true,
                agentAction,
                expiringCerts,
                message: `🎓 ${expiringCerts.length} certification(s) expiring within ${lookaheadDays} days. ${expired} already expired. ${safetyCritical} safety-critical. Training requests drafted.`,
            };
        } catch (e: any) {
            console.error('[AgentService.checkCertificationExpiry]', e);
            return { success: false, agentAction: null, expiringCerts: [], message: e.message || 'Agent failed' };
        }
    }

    // ══════════════════════════════════════════════════════════
    //  Agent 10: ISO 14224 Compliance Auditor
    // ══════════════════════════════════════════════════════════

    /**
     * Monthly automated data quality audit of closed Work Orders.
     * Scores compliance with ISO 14224 failure coding requirements.
     *
     * HITL: Quality report only — admin reviews and assigns remediation.
     */
    async auditDataCompliance(
        closedWorkOrders: {
            id: string;
            title: string;
            assetId: string;
            assetCriticality?: string;
            hasFailureMode: boolean;
            hasFailureCause: boolean;
            hasRemedy: boolean;
            hasCostData: boolean;
            hasDowntimeRecorded: boolean;
            closedDate: string;
        }[],
        periodLabel?: string,
    ): Promise<ComplianceAuditResult> {
        try {
            const total = closedWorkOrders.length;
            if (total === 0) {
                return {
                    success: true, agentAction: null,
                    overallScore: 100, totalAudited: 0, deficiencies: [],
                    message: 'No closed work orders to audit.',
                };
            }

            // Score each WO
            const deficiencies: ComplianceDeficiency[] = [];
            let totalScore = 0;

            for (const wo of closedWorkOrders) {
                const isCritA = wo.assetCriticality === 'A';
                const missing: string[] = [];

                // ISO 14224 mandates: Failure Mode + Cause + Remedy for all closed CMs
                if (!wo.hasFailureMode) missing.push('Failure Mode');
                if (!wo.hasFailureCause) missing.push('Failure Cause');
                if (!wo.hasRemedy) missing.push('Remedy Code');
                if (!wo.hasCostData) missing.push('Cost Data');
                if (!wo.hasDowntimeRecorded) missing.push('Downtime Hours');

                const woScore = ((5 - missing.length) / 5) * 100;
                totalScore += woScore;

                if (missing.length > 0) {
                    deficiencies.push({
                        workOrderId: wo.id,
                        workOrderTitle: wo.title,
                        assetCriticality: wo.assetCriticality || 'C',
                        missingFields: missing,
                        complianceScore: woScore,
                        isCritical: isCritA && missing.length >= 2,
                    });
                }
            }

            const overallScore = Math.round(totalScore / total);

            // Sort: critical assets with most deficiencies first
            deficiencies.sort((a, b) => {
                if (a.isCritical !== b.isCritical) return a.isCritical ? -1 : 1;
                return a.complianceScore - b.complianceScore;
            });

            const agentAction = await predictionService.createAgentAction({
                agent_type: 'compliance_audit',
                trigger_id: `compliance_${periodLabel || new Date().toISOString().split('T')[0]}`,
                asset_id: 'SYSTEM',
                action_type: 'quality_report',
                draft_payload: {
                    period: periodLabel || 'Current Month',
                    total_audited: total,
                    overall_score: overallScore,
                    total_deficiencies: deficiencies.length,
                    critical_deficiencies: deficiencies.filter(d => d.isCritical).length,
                    deficiencies: deficiencies.slice(0, 50),
                },
                status: 'pending_review',
            });

            return {
                success: true,
                agentAction,
                overallScore,
                totalAudited: total,
                deficiencies,
                message: `📊 ISO 14224 Compliance: ${overallScore}% (${total} WOs audited). ${deficiencies.length} deficiencies found, ${deficiencies.filter(d => d.isCritical).length} critical.`,
            };
        } catch (e: any) {
            console.error('[AgentService.auditDataCompliance]', e);
            return { success: false, agentAction: null, overallScore: 0, totalAudited: 0, deficiencies: [], message: e.message || 'Agent failed' };
        }
    }

    // ══════════════════════════════════════════════════════════
    //  Agent 11: Auto-Pareto Bad Actor Identifier
    // ══════════════════════════════════════════════════════════

    /**
     * Monthly automated Pareto analysis to identify Top 5 Bad Actors.
     * Auto-drafts Defect Elimination tasks for the Reliability team.
     *
     * HITL: DE task drafts only — Reliability Engineer must review and approve.
     */
    async identifyBadActors(
        assets: {
            id: string;
            name: string;
            tag: string;
            criticality: string;
            failureCount: number;
            totalDowntimeHours: number;
            totalCost: number;
            recentWorkOrders: { type: string; title: string; cost: number; date: string; failureMode?: string }[];
        }[],
        metric: 'cost' | 'downtime' | 'frequency' = 'cost',
        topN: number = 5,
    ): Promise<AutoParetoResult> {
        try {
            // 1. Sort by selected metric (descending)
            const sorted = [...assets].sort((a, b) => {
                if (metric === 'cost') return b.totalCost - a.totalCost;
                if (metric === 'downtime') return b.totalDowntimeHours - a.totalDowntimeHours;
                return b.failureCount - a.failureCount;
            });

            const badActors = sorted.slice(0, topN);

            if (badActors.length === 0) {
                return {
                    success: true, agentAction: null,
                    badActors: [], draftCount: 0,
                    message: 'No assets with failure data to analyze.',
                };
            }

            // 2. For each bad actor, draft a DE task using AI
            const deTasks: BadActorDEDraft[] = [];

            for (const asset of badActors) {
                const eliminationPlan = await aiEngine.draftEliminationPlan({
                    assetName: asset.name,
                    assetCriticality: asset.criticality,
                    annualFailureCost: asset.totalCost,
                    failureCount: asset.failureCount,
                    dominantFailureMode: asset.recentWorkOrders[0]?.failureMode || 'Unknown',
                });

                deTasks.push({
                    assetId: asset.id,
                    assetName: asset.name,
                    assetTag: asset.tag,
                    criticality: asset.criticality,
                    metricValue: metric === 'cost' ? asset.totalCost
                        : metric === 'downtime' ? asset.totalDowntimeHours
                        : asset.failureCount,
                    metricUnit: metric === 'cost' ? 'USD' : metric === 'downtime' ? 'hours' : 'failures',
                    eliminationPlan,
                });
            }

            // 3. Persist batch to audit trail
            const agentAction = await predictionService.createAgentAction({
                agent_type: 'auto_pareto',
                trigger_id: `pareto_${metric}_${new Date().toISOString().split('T')[0]}`,
                asset_id: 'SYSTEM',
                action_type: 'de_task_draft',
                draft_payload: {
                    metric,
                    analysis_date: new Date().toISOString(),
                    bad_actor_count: deTasks.length,
                    total_impact: metric === 'cost'
                        ? deTasks.reduce((s, t) => s + t.metricValue, 0)
                        : undefined,
                    tasks: deTasks,
                },
                status: 'pending_review',
            });

            return {
                success: true,
                agentAction,
                badActors: deTasks,
                draftCount: deTasks.length,
                message: `📊 Pareto Analysis (${metric}): Top ${deTasks.length} bad actors identified. ${deTasks.length} Defect Elimination tasks drafted for reliability review.`,
            };
        } catch (e: any) {
            console.error('[AgentService.identifyBadActors]', e);
            return { success: false, agentAction: null, badActors: [], draftCount: 0, message: e.message || 'Agent failed' };
        }
    }

    // ══════════════════════════════════════════════════════════
    //  Agent 12: Conversational Work Planner (Phase 5)
    // ══════════════════════════════════════════════════════════

    /**
     * Convert a natural-language work request into a full WO draft.
     * "Plan a pump overhaul for P-101" → Tasks, BOM, Labour, Isolation, JSA.
     *
     * HITL: The draft auto-populates an editable WO form.
     * The user reviews, modifies, and explicitly creates the WO.
     */
    async planWorkFromNaturalLanguage(
        request: string,
        assetId: string,
        assetContext: {
            assetName: string;
            assetTag?: string;
            assetCriticality?: string;
            assetType?: string;
            equipmentClass?: string;
        },
        recentWOHistory?: { type: string; title: string; date: string }[],
    ): Promise<ConversationalPlanResult> {
        try {
            // 1. Generate AI-powered work plan
            const draft = await aiEngine.planWorkOrder({
                naturalLanguageRequest: request,
                assetName: assetContext.assetName,
                assetTag: assetContext.assetTag,
                assetCriticality: assetContext.assetCriticality,
                assetType: assetContext.assetType,
                equipmentClass: assetContext.equipmentClass,
                recentWOHistory,
            });

            // 2. Calculate RPN for governance escalation
            const critNum = CRITICALITY_MAP[assetContext.assetCriticality || 'B'] || 3;
            const severityFromType: Record<string, number> = {
                EM: 5, CM: 4, OVHL: 3, PdM: 2, PM: 2,
            };
            const sevNum = severityFromType[draft.workType] || 3;
            const rpn = critNum * sevNum;

            // 3. Override priority if RPN demands escalation
            if (rpn >= 20) draft.priority = 'emergency';
            else if (rpn >= 12) draft.priority = 'urgent';

            // 4. Persist to audit trail as pending_review
            const agentAction = await predictionService.createAgentAction({
                agent_type: 'conversational_planner',
                trigger_id: `plan_${Date.now()}`,
                asset_id: assetId,
                action_type: 'work_plan_draft',
                draft_payload: {
                    ...draft,
                    rpn,
                    source_request: request,
                    asset_name: assetContext.assetName,
                    criticality: assetContext.assetCriticality,
                },
                status: 'pending_review',
            });

            return {
                success: true,
                agentAction,
                draft,
                rpn,
                message: `🧠 Work plan generated (RPN: ${rpn}). ${draft.tasks.length} tasks, ${draft.billOfMaterials.length} BOM items, ${draft.jsaHazards.length} JSA hazards. Awaiting review.`,
            };
        } catch (e: any) {
            console.error('[AgentService.planWorkFromNaturalLanguage]', e);
            return { success: false, agentAction: null, draft: null, rpn: 0, message: e.message || 'Agent failed' };
        }
    }

    // ══════════════════════════════════════════════════════════
    //  Agent 13: Predictive Procurement (Phase 5)
    // ══════════════════════════════════════════════════════════

    /**
     * Forecast parts demand from PM schedule + failure trends.
     * Produces PO draft suggestions for parts at risk of stockout.
     *
     * HITL: Forecasts only — planner reviews and approves PO drafts.
     */
    async forecastProcurement(
        upcomingPMs: { pmTitle: string; nextDue: string; partsRequired: { partNumber: string; description: string; qty: number }[] }[],
        failureTrends: { failureMode: string; frequency: number; typicalParts: { partNumber: string; description: string; qtyPerEvent: number }[] }[],
        inventoryLevels: { partNumber: string; description: string; currentStock: number; minLevel: number; leadTimeDays: number; unitCost: number }[],
        horizonDays: number = 90,
    ): Promise<PredictiveProcurementResult> {
        try {
            // 1. Generate AI-powered demand forecast
            const forecast = await aiEngine.forecastPartsDemand({
                upcomingPMs,
                failureTrends,
                inventoryLevels,
                horizonDays,
            });

            // 2. Identify parts at risk of stockout
            const atRiskParts = forecast.forecasts.filter(f => {
                const inv = inventoryLevels.find(i => i.partNumber === f.partNumber);
                return inv && inv.currentStock < f.demand90d;
            });

            // 3. Persist to audit trail
            const agentAction = await predictionService.createAgentAction({
                agent_type: 'predictive_procurement',
                trigger_id: `procurement_${Date.now()}`,
                asset_id: 'fleet', // Fleet-wide
                action_type: 'procurement_forecast',
                draft_payload: {
                    horizon_days: horizonDays,
                    total_forecasts: forecast.forecasts.length,
                    at_risk_parts: atRiskParts.length,
                    total_estimated_spend: forecast.totalEstimatedSpend,
                    trend_analysis: forecast.trendAnalysis,
                    forecasts: forecast.forecasts,
                },
                status: 'pending_review',
            });

            return {
                success: true,
                agentAction,
                forecast,
                atRiskCount: atRiskParts.length,
                message: `📊 ${horizonDays}-day procurement forecast: ${forecast.forecasts.length} parts analyzed, ${atRiskParts.length} at risk of stockout. Est. spend: $${forecast.totalEstimatedSpend.toLocaleString()}.`,
            };
        } catch (e: any) {
            console.error('[AgentService.forecastProcurement]', e);
            return { success: false, agentAction: null, forecast: null, atRiskCount: 0, message: e.message || 'Agent failed' };
        }
    }
}

// ─── Phase 5 Agent Response Types ───────────────────────────

export interface ConversationalPlanResult {
    success: boolean;
    agentAction: AgentAction | null;
    draft: import('./AIAnalysisEngine').WorkPlanDraft | null;
    rpn: number;
    message: string;
}

export interface PredictiveProcurementResult {
    success: boolean;
    agentAction: AgentAction | null;
    forecast: import('./AIAnalysisEngine').PartsDemandForecast | null;
    atRiskCount: number;
    message: string;
}

export const agentService = AgentService.getInstance();

