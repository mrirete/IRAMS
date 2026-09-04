/**
 * AuditAssessor — narrates the guided maturity assessment (report + roadmap prose).
 *
 * Scores are DETERMINISTIC (maturityScoring over MaturityQuestionBank: six
 * ISO 55001 / GFMAM groups G1–G6). The model only writes findings,
 * recommendations and the roadmap over those numbers — never the reverse.
 *
 * HITL Principle: All outputs are ADVISORY. The AI assesses and recommends,
 * but humans validate and decide on corrective actions.
 * 
 * Context-Aware: Consumes Steps 1-4 data (Intake, Docs, Site, Interviews)
 * to generate organization-specific, value-aligned questions and scoring.
 */

// @google/genai is loaded lazily via dynamic import() — zero cost if proxy is used.
import type { AuditIntakeData, DocumentReviewItem, SiteVerificationItem, InterviewRecord } from './AuditTypes';
import { proxyAIAnalyze, isAIProxyEnabled } from './geminiService';
import { scoreSummary, deterministicKeyFindings, deterministicRecommendations, deterministicRoadmap } from './maturityScoring';

// SECURITY: In production, AI calls route through the backend proxy.
// The direct Gemini client is a DEV-ONLY fallback.
// DEV-only fallback (risk R-05 / finding F-007): a VITE_ var is inlined into
// the shipped bundle, so the key must be unreachable in production builds —
// prod uses the server-side ai-proxy exclusively.
const _devApiKey = import.meta.env.DEV ? (import.meta.env.VITE_GEMINI_API_KEY || '') : '';
const _proxyConfigured = !!import.meta.env.VITE_AI_PROXY_URL;

let _genaiModule: typeof import('@google/genai') | null = null;
let _ai: InstanceType<typeof import('@google/genai').GoogleGenAI> | null = null;

const getAI = async () => {
    if (!_ai) {
        if (!_genaiModule) {
            _genaiModule = await import('@google/genai');
        }
        const { GoogleGenAI } = _genaiModule;
        const keyToUse = (!_proxyConfigured && _devApiKey) ? _devApiKey : 'not-configured';
        _ai = new GoogleGenAI({ apiKey: keyToUse });
    }
    return _ai;
};

// ─── Assessment Types ──────────────────────────────────────────────

export interface AuditRegistration {
    fullName: string;
    jobTitle: string;
    company: string;
    email: string;
    mobile: string;
    industrySector: string;
    siteName?: string;
}

/** Organizational context from Steps 1-4 for AI prompt enrichment */
export interface AuditContext {
    intake?: AuditIntakeData;
    documentReview?: DocumentReviewItem[];
    siteVerification?: SiteVerificationItem[];
    interviews?: InterviewRecord[];
    // Guided maturity checklist (assessment flow)
    maturityAnswers?: any[];
    maturityDimensionNotes?: Record<string, string>;
}

export interface DimensionQuestion {
    questionNumber: number;
    questionText: string;
}

export interface DimensionAnswer {
    questionNumber: number;
    questionText: string;
    answer: string;
    score: number;
    feedback: string;
    standardRef: string;
}

export interface DimensionResult {
    dimensionKey: string;
    dimensionCode: string;
    dimensionLabel: string;
    averageScore: number;
    answers: DimensionAnswer[];
    summary: string;
    keyStrengths: string[];
    keyGaps: string[];
}

export interface AuditReport {
    overallScore: number;
    overallPercentage: number;
    maturityLevel: string;
    dimensionResults: DimensionResult[];
    keyFindings: string[];
    priorityRecommendations: string[];
    generatedAt: string;
}

export interface ImprovementRoadmap {
    thirtyDayActions: RoadmapAction[];
    ninetyDayActions: RoadmapAction[];
    yearActions: RoadmapAction[];
    estimatedInvestment: string;
    expectedROI: string;
}

export interface RoadmapAction {
    action: string;
    dimension: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
    owner: string;
    expectedOutcome: string;
}

// ─── System Prompt ─────────────────────────────────────────────────

const AUDIT_ASSESSOR_SYSTEM_PROMPT = `You are the Relantern Maturity Assessor — a world-class industrial asset management auditor with deep expertise in ISO 55000, process safety, and asset integrity.

═══ YOUR ROLE ═══
You narrate structured maturity assessments across the six GFMAM subject groups (ISO 55001 aligned):
G1: STRATEGY & PLANNING — policy, SAMP, objectives and plans, demand planning (ISO 55001 §4–§6)
G2: DECISION-MAKING — criticality, RCM/FMEA, RBI, spares strategy, investment and shutdown decisions (ISO 55001 §6.1, §8.1; ISO 55010)
G3: LIFECYCLE DELIVERY — work management, PTW, SOPs, integrity, corrosion, stores, preservation, suppliers (ISO 55001 §8)
G4: ASSET INFORMATION — register, information standards, data quality, KPIs, reliability metrics, analytics (ISO 55001 §7.5–§7.6; ISO 55013)
G5: ORGANISATION & PEOPLE — competence, verification, training, safety culture, succession (ISO 55001 §7; ISO 55012)
G6: RISK & REVIEW — MoC, asset health monitoring, environmental and climate risk, compliance, management review and audit (ISO 55001 §8.2, §9–§10; ISO 55011)

═══ MATURITY SCALE (1–5) ═══
1 = Innocent: No formal processes, reactive, ad-hoc
2 = Aware: Some basic processes, inconsistently applied
3 = Developing: Documented processes, partially implemented, some monitoring
4 = Competent: Systematic processes, consistently applied, measured and improved
5 = Optimizing: Best-in-class, data-driven, continuously optimized, benchmark leader

═══ ASSESSMENT RULES ═══
1. The scores are fixed by the checklist; never change a score or a band. Explain them.
2. Tie every finding and recommendation to a specific group and a standard clause.
3. Be professional but conversational. Acknowledge good practices and highlight gaps constructively.
4. Tailor questions to the user's industry sector (Oil & Gas, Manufacturing, Mining, etc.).
5. Always reference specific standards in your feedback (ISO clause, API section, etc.).
6. HITL: You assess and advise. You do NOT authorize any actions.

═══ RESPONSE FORMAT ═══
Always respond in valid JSON as specified in each prompt. No markdown fences, no extra text.`;

// ─── Context Builder ──────────────────────────────────────────────

function buildContextBlock(ctx?: AuditContext): string {
    if (!ctx) return '';
    const parts: string[] = [];

    // Organizational context from Intake (Step 1)
    if (ctx.intake) {
        const i = ctx.intake;
        parts.push(`═══ ORGANIZATIONAL CONTEXT (ISO 55001 §4) ═══`);
        if (i.orgVision) parts.push(`Vision: ${i.orgVision}`);
        if (i.orgMission) parts.push(`Mission: ${i.orgMission}`);
        if (i.orgStrategicObjectives) parts.push(`Strategic Objectives: ${i.orgStrategicObjectives}`);
        if (i.orgAMPolicy) parts.push(`AM Policy Status: ${i.orgAMPolicy}`);
        if (i.orgSAMP) parts.push(`SAMP Status: ${i.orgSAMP}`);
        if (i.orgRiskFramework) parts.push(`Risk Framework: ${i.orgRiskFramework}`);
        if (i.orgBudgetAlignment) parts.push(`Budget Alignment: ${i.orgBudgetAlignment}`);
        if (i.auditObjective) parts.push(`Audit Objective: ${i.auditObjective}`);
        if (i.keyRisks?.length) parts.push(`Key Risks (ISO 55001 §6.1): ${i.keyRisks.join(', ')}`);
        if (i.keyOpportunities?.length) parts.push(`Key Opportunities (ISO 55001 §6.1): ${i.keyOpportunities.join(', ')}`);
        if (i.assetClass) parts.push(`Primary Asset Class: ${i.assetClass}`);

        // ISO Series Alignment summary
        const iso = i.isoAlignment;
        const isoLines: string[] = [];
        if (iso.iso55010_financial_alignment) isoLines.push(`Financial Alignment (55010): ${iso.iso55010_financial_alignment}`);
        if (iso.iso55012_competence_framework) isoLines.push(`Competence (55012): ${iso.iso55012_competence_framework}`);
        if (iso.iso55013_data_governance) isoLines.push(`Data Governance (55013): ${iso.iso55013_data_governance}`);
        if (isoLines.length) { parts.push(`\n═══ ISO SERIES ALIGNMENT ═══`); parts.push(...isoLines); }
    }

    // Document Review gaps from Step 2
    if (ctx.documentReview?.length) {
        const missing = ctx.documentReview.filter(d => d.status === 'missing');
        const partial = ctx.documentReview.filter(d => d.status === 'partial');
        if (missing.length || partial.length) {
            parts.push(`\n═══ DOCUMENT REVIEW GAPS (Step 2) ═══`);
            if (missing.length) parts.push(`Missing docs: ${missing.map(d => d.document).join(', ')}`);
            if (partial.length) parts.push(`Partial docs: ${partial.map(d => d.document).join(', ')}`);
        }
    }

    // Site Verification findings from Step 3
    if (ctx.siteVerification?.length) {
        const issues = ctx.siteVerification.filter(s => s.status !== 'ok');
        if (issues.length) {
            parts.push(`\n═══ SITE VERIFICATION FINDINGS (Step 3) ═══`);
            issues.forEach(s => parts.push(`[${s.status.toUpperCase()}] ${s.area}: ${s.checkItem}${s.notes ? ' — ' + s.notes : ''}`));
        }
    }

    // Interview insights from Step 4
    if (ctx.interviews?.length) {
        const withFindings = ctx.interviews.filter(iv => iv.keyFindings?.trim());
        if (withFindings.length) {
            parts.push(`\n═══ INTERVIEW INSIGHTS (Step 4) ═══`);
            withFindings.slice(0, 5).forEach(iv =>
                parts.push(`${iv.role} (${iv.department}): ${iv.keyFindings}`)
            );
        }
    }

    return parts.length ? '\n\n' + parts.join('\n') : '';
}

// ─── Engine Class ──────────────────────────────────────────────────

export class AuditAssessor {
    private auditContext: AuditContext | null = null;

    constructor() { }

    /** Set organizational context from Steps 1-4 for prompt enrichment */
    setContext(ctx: AuditContext): void {
        this.auditContext = ctx;
    }

    /**
     * Generate the complete maturity report after all 6 dimensions are assessed
     */
    async generateReport(
        dimensionResults: DimensionResult[],
        registration: AuditRegistration
    ): Promise<AuditReport> {
        // Score and band are DETERMINISTIC (maturityScoring): the same answers always
        // give the same number, and an empty result list is "not assessed", never
        // NaN. The LLM only narrates findings and recommendations over them.
        const summary = scoreSummary(dimensionResults);
        const overallScore = summary.overallScore;
        const overallPct = summary.overallPercentage;

        if (dimensionResults.length === 0) {
            return {
                overallScore,
                overallPercentage: overallPct,
                maturityLevel: summary.maturityLevel,
                dimensionResults,
                keyFindings: deterministicKeyFindings(dimensionResults),
                priorityRecommendations: ['Complete the maturity checklist (Step 3) to score the assessment.'],
                generatedAt: new Date().toISOString(),
            };
        }

        const prompt = `Generate an executive audit report for ${registration.company} (${registration.industrySector}).

Overall maturity: ${overallScore.toFixed(1)}/5 (${overallPct}%) — band "${summary.maturityLevel}" (fixed; do not change it)

Dimension results:
${dimensionResults.map(d => `${d.dimensionCode}: ${d.dimensionLabel} — ${d.averageScore.toFixed(1)}/5
  Strengths: ${d.keyStrengths.join(', ') || 'None identified'}
  Gaps: ${d.keyGaps.join(', ') || 'None identified'}`).join('\n\n')}

Generate:
1. A maturity level label (one of: "Innocent", "Aware", "Developing", "Competent", "Optimizing")
2. 5-8 key findings (mix of positive and improvement areas)
3. 5-8 priority recommendations ranked by impact

Respond as JSON:
{
    "maturityLevel": "<label>",
    "keyFindings": ["finding1", "finding2", ...],
    "priorityRecommendations": ["rec1", "rec2", ...]
}`;

        const raw = await this.callGemini(prompt);
        const parsed = this.parseJSON<{
            maturityLevel?: string;
            keyFindings?: string[];
            priorityRecommendations?: string[];
            error?: string;
        }>(raw, {});
        const aiFindings = Array.isArray(parsed.keyFindings) ? parsed.keyFindings.filter(s => typeof s === 'string' && s.trim()) : [];
        const aiRecs = Array.isArray(parsed.priorityRecommendations) ? parsed.priorityRecommendations.filter(s => typeof s === 'string' && s.trim()) : [];

        return {
            overallScore,
            overallPercentage: overallPct,
            maturityLevel: summary.maturityLevel,
            dimensionResults,
            keyFindings: aiFindings.length ? aiFindings : deterministicKeyFindings(dimensionResults),
            priorityRecommendations: aiRecs.length ? aiRecs : deterministicRecommendations(dimensionResults),
            generatedAt: new Date().toISOString(),
        };
    }

    /**
     * Generate the improvement roadmap (30/90/365-day plan)
     */
    async generateRoadmap(
        report: AuditReport,
        registration: AuditRegistration
    ): Promise<ImprovementRoadmap> {
        const prompt = `Generate an improvement roadmap for ${registration.company} (${registration.industrySector}).

Overall maturity: ${report.overallScore.toFixed(1)}/5 (${report.maturityLevel})

Dimension scores:
${report.dimensionResults.map(d => `${d.dimensionCode} ${d.dimensionLabel}: ${d.averageScore.toFixed(1)}/5 — Gaps: ${d.keyGaps.join('; ') || 'None'}`).join('\n')}

Key findings: ${report.keyFindings.join('; ')}

Create a phased improvement plan:
1. 30-day "Quick Wins" (3-5 actions, low cost, high impact)
2. 90-day "Foundation Building" (3-5 actions, moderate investment)
3. 365-day "Strategic Transformation" (3-5 actions, major initiatives)

For each action, specify: action, dimension (G1-G6), priority (critical/high/medium/low), suggested owner role, and expected outcome.

Also estimate total investment range and expected ROI.

Respond as JSON:
{
    "thirtyDayActions": [{ "action": "...", "dimension": "G1", "priority": "high", "owner": "...", "expectedOutcome": "..." }],
    "ninetyDayActions": [{ "action": "...", "dimension": "G2", "priority": "medium", "owner": "...", "expectedOutcome": "..." }],
    "yearActions": [{ "action": "...", "dimension": "G3", "priority": "medium", "owner": "...", "expectedOutcome": "..." }],
    "estimatedInvestment": "$X - $Y",
    "expectedROI": "X-Y% improvement in..."
}`;

        if (report.dimensionResults.length === 0) return deterministicRoadmap([]);

        const raw = await this.callGemini(prompt);
        const parsed = this.parseJSON<Partial<ImprovementRoadmap> & { error?: string }>(raw, {});
        const has = (k: keyof ImprovementRoadmap) => Array.isArray(parsed[k]) && (parsed[k] as unknown[]).length > 0;
        if (!has('thirtyDayActions') && !has('ninetyDayActions') && !has('yearActions')) {
            // AI off, quota hit, or unparseable — the roadmap still exists, built from the gaps.
            return deterministicRoadmap(report.dimensionResults);
        }
        return {
            thirtyDayActions: Array.isArray(parsed.thirtyDayActions) ? parsed.thirtyDayActions : [],
            ninetyDayActions: Array.isArray(parsed.ninetyDayActions) ? parsed.ninetyDayActions : [],
            yearActions: Array.isArray(parsed.yearActions) ? parsed.yearActions : [],
            estimatedInvestment: parsed.estimatedInvestment || 'To be determined',
            expectedROI: parsed.expectedROI || 'To be determined',
        };
    }

    // ─── Private Helpers ──────────────────────────────────────────

    private async callGemini(prompt: string): Promise<string> {
        // Path 1: Backend proxy (production)
        if (isAIProxyEnabled()) {
            try {
                return await proxyAIAnalyze(
                    prompt, 'audit_assessor', 'analyze', undefined,
                    undefined, 0.3
                );
            } catch (proxyError: unknown) {
                const msg = proxyError instanceof Error ? proxyError.message : String(proxyError);
                console.warn('[AuditAssessor] Proxy call failed, falling back to direct:', msg);
                if (!_devApiKey || _proxyConfigured) {
                    return JSON.stringify({ error: msg });
                }
            }
        }

        // Path 2: Direct Gemini (development/fallback — never used when proxy is configured)
        if (!_devApiKey || _proxyConfigured) return JSON.stringify({ error: 'AI not configured. Set VITE_AI_PROXY_URL or VITE_GEMINI_API_KEY.' });
        try {
            const ai = await getAI();
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    systemInstruction: AUDIT_ASSESSOR_SYSTEM_PROMPT,
                    temperature: 0.3,
                    thinkingConfig: { thinkingBudget: 0 },
                },
            });
            let text: string | undefined;
            try { text = response?.text; } catch { text = undefined; }
            if (!text) {
                try {
                    const part = response?.candidates?.[0]?.content?.parts?.[0];
                    text = (part as { text?: string })?.text;
                } catch { /* ignore */ }
            }
            return text || '{}';
        } catch (error: unknown) {
            const raw = error instanceof Error ? error.message : String(error);
            console.error('[AuditAssessor] Gemini call failed:', raw);
            let friendly = 'AI assessment temporarily unavailable.';
            if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('quota')) {
                friendly = '⚠️ API quota exceeded. Please wait a few minutes.';
            } else if (raw.includes('API_KEY') || raw.includes('401') || raw.includes('403')) {
                friendly = '⚠️ Invalid or missing API key. Check configuration.';
            }
            return JSON.stringify({ error: friendly });
        }
    }

    private parseJSON<T>(raw: string, fallback: T): T {
        try {
            const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            return JSON.parse(cleaned);
        } catch {
            console.warn('[AuditAssessor] JSON parse failed:', raw.substring(0, 300));
            return fallback;
        }
    }

}

// Singleton export
export const auditAssessor = new AuditAssessor();
