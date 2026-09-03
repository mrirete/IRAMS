/**
 * AuditAssessor — Gemini-powered 6M Conversational Audit Engine
 * 
 * Conducts a structured, AI-driven maturity assessment across 6 dimensions:
 * M1: Man, M2: Machine, M3: Method, M4: Material, M5: Measurement, M6: Mother Nature
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
import { scoreSummary, deterministicKeyFindings, deterministicRecommendations, deterministicRoadmap } from './sixmScoring';

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

// ─── 6M Dimension Definitions ──────────────────────────────────────

export interface SixMDimension {
    key: string;
    code: string;
    label: string;
    icon: string;
    color: string;
    gradient: string;
    description: string;
    standards: string[];
    covers: string;
}

export const SIXM_DIMENSIONS: SixMDimension[] = [
    {
        key: 'man', code: 'M1', label: 'Man', icon: 'Users',
        color: '#3b82f6', gradient: 'from-blue-500 to-blue-600',
        description: 'People, Competency & HSE Culture',
        covers: 'Staffing levels, competency frameworks, training programs, safety culture, leadership engagement, succession planning',
        standards: ['ISO 55001 §7.2', 'CAMA2 Domain 1', 'OSHA PSM §1910.119(g)', 'ISO 45001'],
    },
    {
        key: 'machine', code: 'M2', label: 'Machine', icon: 'Cog',
        color: '#ef4444', gradient: 'from-red-500 to-red-600',
        description: 'Asset Register, RBI & Condition Monitoring',
        covers: 'Asset hierarchy, register completeness, condition monitoring, RBI programs, mechanical integrity, criticality assessment',
        standards: ['API 510/570/653', 'ASME PCC-3', 'API 580/581', 'ISO 14224', 'ASME BPVC'],
    },
    {
        key: 'method', code: 'M3', label: 'Method', icon: 'ClipboardList',
        color: '#22c55e', gradient: 'from-green-500 to-green-600',
        description: 'PTW, MOC, HAZOP & SOPs',
        covers: 'Work management processes, permit to work, management of change, HAZOP/LOPA, SOPs, maintenance strategies (RCM/FMEA)',
        standards: ['ISO 55001 §7.5/§8', 'IEC 61511', 'API RP 750', 'IEC 61882', 'SAE JA1011'],
    },
    {
        key: 'material', code: 'M4', label: 'Material', icon: 'Package',
        color: '#f59e0b', gradient: 'from-amber-500 to-amber-600',
        description: 'Spares, MRO & Preservation',
        covers: 'Spare parts management, MRO inventory, critical spares identification, preservation programs, vendor management, procurement',
        standards: ['API 686', 'CAMA2 Domain 4', 'ISO 55001 §8.1', 'NORSOK Z-CR-002'],
    },
    {
        key: 'measurement', code: 'M5', label: 'Measurement', icon: 'Gauge',
        color: '#8b5cf6', gradient: 'from-blue-500 to-blue-600',
        description: 'OEE, MTBF, MTTR & CMMS',
        covers: 'KPIs, OEE tracking, MTBF/MTTR measurement, CMMS data quality, reporting, benchmarking, data-driven decision making',
        standards: ['ISO 14224', 'SMRP Best Practices', 'ISO 55001 §9.1', 'EN 15341'],
    },
    {
        key: 'mother_nature', code: 'M6', label: 'Mother Nature', icon: 'Cloud',
        color: '#06b6d4', gradient: 'from-cyan-500 to-cyan-600',
        description: 'Environment, Regulatory & Climate Risk',
        covers: 'Environmental compliance, regulatory readiness, climate risk assessment, corrosion management, waste management, sustainability',
        standards: ['ISO 14001:2015', 'API RP 752/753', 'ISO 55001 §4.1', 'TCFD'],
    },
];

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
    // 6M guided checklist (assessment flow)
    sixmChecklistAnswers?: any[];
    sixmDimensionNotes?: Record<string, string>;
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

const AUDIT_ASSESSOR_SYSTEM_PROMPT = `You are the Relantern 6M Audit Assessor — a world-class industrial asset management auditor with deep expertise in ISO 55000, process safety, and asset integrity.

═══ YOUR ROLE ═══
You conduct structured maturity assessments across 6 dimensions (the "6M" framework):
M1: MAN — People, Competency & HSE Culture (ISO 55001 §7.2, CAMA2, OSHA PSM)
M2: MACHINE — Asset Register, RBI & Condition Monitoring (API 510/570/653, ASME PCC-3, API 580/581)
M3: METHOD — PTW, MOC, HAZOP & SOPs (ISO 55001 §7.5/§8, IEC 61511, API RP 750)
M4: MATERIAL — Spares, MRO & Preservation (API 686, CAMA2 Domain 4)
M5: MEASUREMENT — OEE, MTBF, MTTR & CMMS (ISO 14224, SMRP, ISO 55001 §9.1)
M6: MOTHER NATURE — Environment, Regulatory & Climate Risk (ISO 14001:2015, API RP 752/753)

═══ MATURITY SCALE (1–5) ═══
1 = Innocent: No formal processes, reactive, ad-hoc
2 = Aware: Some basic processes, inconsistently applied
3 = Developing: Documented processes, partially implemented, some monitoring
4 = Competent: Systematic processes, consistently applied, measured and improved
5 = Optimizing: Best-in-class, data-driven, continuously optimized, benchmark leader

═══ ASSESSMENT RULES ═══
1. Ask exactly 5 questions per dimension — targeted, industry-specific, and probing.
2. After the user answers each question, score it 1–5 and provide brief, constructive feedback with a standard reference.
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
    private chat: any = null;
    private registration: AuditRegistration | null = null;
    private auditContext: AuditContext | null = null;

    constructor() { }

    /** Set organizational context from Steps 1-4 for prompt enrichment */
    setContext(ctx: AuditContext): void {
        this.auditContext = ctx;
    }

    /**
     * Generate 5 questions for a specific 6M dimension
     */
    async generateQuestions(
        dimension: SixMDimension,
        registration: AuditRegistration
    ): Promise<DimensionQuestion[]> {
        this.registration = registration;
        const contextBlock = buildContextBlock(this.auditContext || undefined);

        const prompt = `Generate exactly 5 audit assessment questions for the "${dimension.code}: ${dimension.label}" dimension.

Context:
- Assessor: ${registration.fullName} (${registration.jobTitle}) at ${registration.company}
- Industry: ${registration.industrySector}
- Site: ${registration.siteName || 'Not specified'}
- Dimension covers: ${dimension.covers}
- Key standards: ${dimension.standards.join(', ')}
${contextBlock}

Requirements:
- Questions must be specific to the ${registration.industrySector} industry
- Questions should probe for EVIDENCE of maturity (policies, records, KPIs, practices)
- Progress from general governance to specific operational detail
- Each question should map to a specific standard clause
- If organizational vision/mission/objectives are provided above, tailor questions to assess alignment with those strategic goals
- If document gaps or site findings are provided, probe deeper in those specific areas

Respond as JSON:
{
    "questions": [
        { "questionNumber": 1, "questionText": "..." },
        { "questionNumber": 2, "questionText": "..." },
        { "questionNumber": 3, "questionText": "..." },
        { "questionNumber": 4, "questionText": "..." },
        { "questionNumber": 5, "questionText": "..." }
    ]
}`;

        const raw = await this.callGemini(prompt);
        const fallback = this.getFallbackQuestions(dimension);
        const parsed = this.parseJSON<{ questions?: DimensionQuestion[]; error?: string }>(raw, {
            questions: fallback,
        });

        // If API returned an error message, throw so the UI can display it
        if (parsed.error) {
            throw new Error(parsed.error);
        }

        // Validate we got a real questions array; if not, use fallback
        if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
            return fallback;
        }
        return parsed.questions;
    }

    /**
     * Score a single answer within a dimension
     */
    async scoreAnswer(
        dimension: SixMDimension,
        question: DimensionQuestion,
        answer: string,
        registration: AuditRegistration
    ): Promise<DimensionAnswer> {
        const contextBlock = buildContextBlock(this.auditContext || undefined);
        const orgContext = this.auditContext?.intake;
        const valueContext = orgContext?.orgVision
            ? `\n\nWhen scoring, consider alignment with the organization's stated vision: "${orgContext.orgVision}" and strategic objectives: "${orgContext.orgStrategicObjectives || 'Not specified'}". ISO 55001:2024 emphasizes VALUE REALIZATION — score higher when practices demonstrably connect to organizational value.`
            : '';

        const prompt = `You are assessing the "${dimension.code}: ${dimension.label}" dimension for ${registration.company} (${registration.industrySector}).
${contextBlock}
Question ${question.questionNumber}: "${question.questionText}"

User's answer: "${answer}"${valueContext}

Score this answer on the maturity scale (1-5) and provide constructive feedback with a specific standard reference.

Respond as JSON:
{
    "questionNumber": ${question.questionNumber},
    "questionText": "${question.questionText.replace(/"/g, '\\"')}",
    "answer": "${answer.replace(/"/g, '\\"').replace(/\n/g, '\\n')}",
    "score": <1-5>,
    "feedback": "<2-3 sentences of constructive, standards-referenced feedback. Reference the organization's specific goals where relevant.>",
    "standardRef": "<specific standard clause, e.g. 'ISO 55001 §7.2.1'>"
}`;

        const raw = await this.callGemini(prompt);
        const fallback: DimensionAnswer = {
            questionNumber: question.questionNumber,
            questionText: question.questionText,
            answer,
            score: 2,
            feedback: 'Unable to generate feedback at this time.',
            standardRef: dimension.standards[0] || 'N/A',
        };
        const parsed = this.parseJSON<DimensionAnswer & { error?: string }>(raw, fallback);
        if (parsed.error || typeof parsed.score !== 'number') return fallback;
        return parsed;
    }

    /**
     * Generate a summary for a completed dimension
     */
    async summarizeDimension(
        dimension: SixMDimension,
        answers: DimensionAnswer[],
        registration: AuditRegistration
    ): Promise<{ summary: string; keyStrengths: string[]; keyGaps: string[] }> {
        const avgScore = answers.reduce((sum, a) => sum + a.score, 0) / answers.length;

        const orgContext = this.auditContext?.intake;
        const stratBlock = orgContext?.orgVision
            ? `\nOrganization Vision: "${orgContext.orgVision}"\nStrategic Objectives: "${orgContext.orgStrategicObjectives || 'Not specified'}"\n`
            : '';

        const prompt = `Summarize the assessment results for "${dimension.code}: ${dimension.label}" at ${registration.company} (${registration.industrySector}).
${stratBlock}
Average score: ${avgScore.toFixed(1)}/5

Individual scores:
${answers.map(a => `Q${a.questionNumber}: Score ${a.score}/5 — "${a.questionText}" → Response: "${a.answer}"`).join('\n')}

Provide a concise summary paragraph (referencing how findings align or misalign with the organization's stated strategic objectives), up to 3 key strengths, and up to 3 key gaps.

Respond as JSON:
{
    "summary": "<1-2 paragraph summary>",
    "keyStrengths": ["strength1", "strength2"],
    "keyGaps": ["gap1", "gap2", "gap3"]
}`;

        const raw = await this.callGemini(prompt);
        const fallback = {
            summary: `Assessment of ${dimension.label} yielded an average maturity score of ${avgScore.toFixed(1)}/5.`,
            keyStrengths: [] as string[],
            keyGaps: [] as string[],
        };
        const parsed = this.parseJSON<typeof fallback & { error?: string }>(raw, fallback);
        if (parsed.error || typeof parsed.summary !== 'string') return fallback;
        return parsed;
    }

    /**
     * Generate the complete maturity report after all 6 dimensions are assessed
     */
    async generateReport(
        dimensionResults: DimensionResult[],
        registration: AuditRegistration
    ): Promise<AuditReport> {
        // Score and band are DETERMINISTIC (sixmScoring): the same answers always
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
                priorityRecommendations: ['Complete the 6M checklist (Step 3) to score the assessment.'],
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

For each action, specify: action, dimension (M1-M6), priority (critical/high/medium/low), suggested owner role, and expected outcome.

Also estimate total investment range and expected ROI.

Respond as JSON:
{
    "thirtyDayActions": [{ "action": "...", "dimension": "M1", "priority": "high", "owner": "...", "expectedOutcome": "..." }],
    "ninetyDayActions": [{ "action": "...", "dimension": "M2", "priority": "medium", "owner": "...", "expectedOutcome": "..." }],
    "yearActions": [{ "action": "...", "dimension": "M3", "priority": "medium", "owner": "...", "expectedOutcome": "..." }],
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

    private getFallbackQuestions(dimension: SixMDimension): DimensionQuestion[] {
        // Hardcoded fallback in case AI fails
        const fallbacks: Record<string, string[]> = {
            man: [
                'Does your organization have a formal competency framework for maintenance and reliability personnel?',
                'How do you assess and verify the competence of personnel performing safety-critical maintenance tasks?',
                'What training programs exist for developing asset management capabilities across your workforce?',
                'How does your organization promote and measure safety culture within maintenance operations?',
                'Do you have a succession plan for key technical and leadership roles in asset management?',
            ],
            machine: [
                'How complete and accurate is your asset register, and what percentage of physical assets are captured in your CMMS?',
                'Do you have a formal criticality ranking system applied to all assets, and how does it drive your maintenance strategy?',
                'What condition monitoring technologies are deployed, and how is the data integrated into maintenance decision-making?',
                'Do you operate a Risk-Based Inspection (RBI) program for static equipment, and what standards guide your inspection intervals?',
                'How do you manage mechanical integrity for pressure-containing equipment (vessels, piping, relief devices)?',
            ],
            method: [
                'Describe your work management process from work identification through to closeout and feedback.',
                'How mature is your Permit to Work (PTW) system, and how does it integrate with your maintenance planning?',
                'Do you have a formal Management of Change (MOC) process, and how consistently is it applied?',
                'What maintenance strategy optimization tools do you use (RCM, FMEA, PMO)?',
                'How are Standard Operating Procedures (SOPs) managed, versioned, and made accessible to frontline workers?',
            ],
            material: [
                'How do you identify and manage critical spares to ensure equipment availability?',
                'What is your process for setting min/max stock levels and reorder points for MRO inventory?',
                'Do you have a formal preservation management program for stored equipment and spares?',
                'How do you evaluate and manage vendor/supplier performance for maintenance services and parts?',
                'What percentage of your maintenance materials are procured through managed contracts versus spot buys?',
            ],
            measurement: [
                'What key performance indicators (KPIs) do you track for maintenance and reliability, and how are they reported?',
                'Do you measure and track MTBF, MTTR, and OEE, and how do you use this data to drive improvement?',
                'How would you rate the data quality in your CMMS/EAM system (completeness, accuracy, timeliness)?',
                'Do you conduct regular benchmarking of your maintenance performance against industry standards?',
                'How do you use data analytics to identify trends, predict failures, and optimize maintenance strategies?',
            ],
            mother_nature: [
                'How does your organization assess and manage environmental risks related to asset operations?',
                'What regulatory compliance management system do you use, and how do you track inspection deadlines?',
                'Do you assess climate-related risks (extreme weather, temperature, corrosion) in your asset management planning?',
                'How do you manage corrosion in your operating environment, and what mitigation strategies are in place?',
                'Does your organization have sustainability targets that are integrated into asset lifecycle decisions?',
            ],
        };
        return (fallbacks[dimension.key] || fallbacks.man).map((q, i) => ({
            questionNumber: i + 1,
            questionText: q,
        }));
    }
}

// Singleton export
export const auditAssessor = new AuditAssessor();
