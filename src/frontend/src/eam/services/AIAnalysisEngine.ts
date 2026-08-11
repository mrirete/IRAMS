/**
 * AIAnalysisEngine — Gemini-powered reliability analysis advisor
 * 
 * HITL Principle: All outputs are SUGGESTIONS. The AI cannot authorize
 * shutdowns, create POs, or close investigations without human validation.
 *
 * SECURITY: In production, ALL AI calls route through the backend proxy
 * (VITE_AI_PROXY_URL). The direct Gemini client is a DEV-ONLY fallback.
 * @google/genai is loaded lazily via dynamic import() — zero cost if proxy is used.
 */
import { RELANTERN_SYSTEM_INSTRUCTION } from '../constants';
import { proxyAIAnalyze, isAIProxyEnabled } from './geminiService';
import type { DiagnosisResult } from '../../lib/predict/diagnosisRules';

// ── AI Client Initialization ─────────────────────────────────
// SECURITY: When the proxy is configured, NEVER initialize the direct client.
// This prevents the Gemini API key from being bundled into the browser JS.
// DEV-only fallback (risk R-05 / finding F-007): a VITE_ var is inlined into
// the shipped bundle, so the key must be unreachable in production builds —
// prod uses the server-side ai-proxy exclusively.
const _devApiKey = import.meta.env.DEV ? (import.meta.env.VITE_GEMINI_API_KEY || '') : '';
const _proxyConfigured = !!import.meta.env.VITE_AI_PROXY_URL;

// Cached module + client instance — populated on first AI use
let _genaiModule: typeof import('@google/genai') | null = null;
let _ai: any = null;

const getAI = async () => {
  if (!_ai && !_proxyConfigured && _devApiKey) {
    if (!_genaiModule) {
      _genaiModule = await import('@google/genai');
    }
    const { GoogleGenAI } = _genaiModule;
    console.warn(
        '[AIAnalysisEngine] ⚠️ Using DIRECT Gemini client (dev mode). ' +
        'For production, set VITE_AI_PROXY_URL to route through the backend proxy.'
    );
    _ai = new GoogleGenAI({ apiKey: _devApiKey });
  }
  return _ai;
};

// ─── Response Types ─────────────────────────────────────────

export interface ToolRecommendation {
    tool: 'rca' | 'fmea' | 'pareto' | 'rbd' | 'fault_tree' | 'monte_carlo';
    confidence: number; // 0-1
    reasoning: string;
    suggestedSteps: string[];
}

export interface RCAHypothesis {
    hypotheses: { description: string; category: 'physical' | 'human' | 'latent'; likelihood: 'high' | 'medium' | 'low' }[];
    fishboneCategories: Record<string, string[]>; // e.g. { Man: [...], Machine: [...] }
    suggestedEvidence: string[];
}

export interface CorrectiveActionSuggestion {
    actions: { description: string; type: 'immediate' | 'short_term' | 'long_term'; requiresMoC: boolean; estimatedCost?: string }[];
    riskOfInaction: string;
}

export interface DefectPattern {
    patternDetected: boolean;
    recurrenceRate: number; // failures per year
    failureMode: string;
    recommendation: string;
    estimatedAnnualCost: number;
}

export interface EliminationPlanDraft {
    title: string;
    scope: string;
    rootCauseSummary: string;
    proposedSolution: string;
    estimatedSavingsPerYear: number;
    estimatedImplementationCost: number;
    priority: 'critical' | 'high' | 'medium' | 'low';
    paybackMonths: number;
}

export interface RBDConfigSuggestion {
    currentAvailability: number;
    suggestedConfig: string;
    expectedAvailability: number;
    costBenefitRatio: number;
    reasoning: string;
}

export interface RCAMethodRecommendation {
    method: 'five_why' | 'fishbone' | 'fault_tree' | 'taproot' | 'apollo';
    confidence: number; // 0-1
    reasoning: string;
    alternatives: { method: string; label: string; reason: string }[];
}

export interface JSAHazardSuggestion {
    hazard: string;
    consequence: number;  // 1-5
    likelihood: number;   // 1-5
    controlHierarchy: ('Elimination' | 'Substitution' | 'Engineering' | 'Admin' | 'PPE')[];
    controls: string;
    rationale: string;    // Why this hazard is relevant
}

// ─── Phase 2: Structured Analysis Response Types ────────────

export interface PMEffectivenessResult {
    pmId: string;
    executionCount: number;
    failuresPreventedEstimate: number;
    costPerCycle: number;
    valueRatio: number;
    recommendation: 'continue' | 'adjust_interval' | 'suspend' | 'convert_to_pdm';
    reasoning: string;
    suggestedInterval?: string;
}

export interface PMIntervalSuggestion {
    currentInterval: string;
    suggestedInterval: string;
    basis: 'mtbf' | 'oreda' | 'oem' | 'pf_interval' | 'weibull';
    mtbfHours?: number;
    pfIntervalDays?: number;
    oredaBenchmark?: string;
    confidenceLevel: number;
    reasoning: string;
    riskIfExtended: string;
    costSavingsPerYear?: number;
}

export interface SRTriageResult {
    suggestedPriority: 'emergency' | 'urgent' | 'normal' | 'low';
    rpn: number;
    assetCriticalityFactor: number;
    impactFactor: number;
    suggestedCategory: string;
    suggestedCraft: string;
    reasoning: string;
    autoEscalate: boolean;
}

export interface DuplicateDetectionResult {
    isDuplicate: boolean;
    confidence: number;
    matchedItems: { id: string; title: string; similarity: number }[];
    recommendation: 'merge' | 'proceed' | 'review';
    reasoning: string;
}

export interface EOQResult {
    economicOrderQuantity: number;
    annualDemand: number;
    orderingCost: number;
    holdingCostPerUnit: number;
    reorderPoint: number;
    safetyStock: number;
    totalAnnualCost: number;
    reasoning: string;
}

export interface MoCImpactResult {
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    technicalImpact: string;
    financialImpact: string;
    affectedAssets: string[];
    affectedDocuments: string[];
    affectedTraining: string[];
    affectedPMs: string[];
    requiredApprovals: string[];
    rollbackPlan: string;
    reasoning: string;
}

export interface ExecutiveBriefing {
    summary: string;
    criticalAlerts: string[];
    topRisks: { risk: string; impact: string; action: string }[];
    costHighlights: string[];
    kpiTrends: { kpi: string; trend: 'improving' | 'stable' | 'declining'; value: string }[];
    actionItems: { item: string; owner: string; deadline: string }[];
}

export interface TCOBenchmark {
    assetTag: string;
    totalCostOfOwnership: number;
    acquisitionCost: number;
    operatingCostPerYear: number;
    maintenanceCostPerYear: number;
    projectedReplacementYear: number;
    oredaBenchmarkTCO?: number;
    deviationPercent: number;
    recommendation: 'keep' | 'overhaul' | 'replace' | 'decommission';
    reasoning: string;
}

export interface VendorScorecard {
    overallScore: number;
    deliveryScore: number;
    qualityScore: number;
    priceScore: number;
    complianceScore: number;
    responsiveness: number;
    risks: string[];
    strengths: string[];
    recommendation: string;
}

export interface NLQueryResult {
    interpretedIntent: string;
    sqlQuery: string;
    explanation: string;
    suggestedFilters: { field: string; operator: string; value: string }[];
    confidence: number;
}

// ─── Phase 5: Futuristic Capabilities Response Types ────────

export interface WorkPlanDraft {
    title: string;
    description: string;
    workType: 'PM' | 'CM' | 'PdM' | 'EM' | 'OVHL';
    priority: 'routine' | 'urgent' | 'emergency';
    estimatedDuration: number;
    estimatedCost: number;
    tasks: { sequence: number; description: string; craft: string; estHours: number; safetyNote?: string }[];
    billOfMaterials: { partNumber: string; description: string; qty: number; unitCost?: number }[];
    labourRequirements: { craft: string; headcount: number; hours: number }[];
    isolationRequirements: { isolationType: string; isolationPoint: string; method: string }[];
    jsaHazards: { hazard: string; controls: string; riskLevel: string }[];
    permitRequirements: string[];
    failureMode?: string;
    failureCause?: string;
    rpnRationale: string;
    aiConfidence: number;
}

export interface VisionAnalysisResult {
    defectsDetected: {
        type: string;
        severity: 'minor' | 'moderate' | 'severe' | 'critical';
        location: string;
        description: string;
        suggestedFailureMode?: string;
        suggestedAction: string;
    }[];
    overallCondition: 'good' | 'fair' | 'poor' | 'critical';
    recommendedFollowUp: string;
    aiConfidence: number;
}

export interface DigitalThreadNode {
    nodeType: 'failure_event' | 'work_order' | 'service_request' | 'pm_program' |
              'design_basis' | 'oem_bulletin' | 'moc' | 'rca' | 'fmea';
    nodeId: string;
    title: string;
    date: string;
    summary: string;
    linkedNodes: string[];
}

export interface DigitalThreadTrace {
    assetId: string;
    assetName: string;
    traceNodes: DigitalThreadNode[];
    narrative: string;
    recommendations: string[];
    aiConfidence: number;
}

export interface PartsDemandForecast {
    forecasts: { partNumber: string; description: string; demand30d: number; demand90d: number; basis: string; confidence: number }[];
    trendAnalysis: string;
    seasonalFactors?: string;
    totalEstimatedSpend: number;
}

export interface KPIAnnotationData {
    kpiName: string;
    currentValue: string;
    trend: 'improving' | 'stable' | 'declining';
    commentary: string;
    actionRequired: boolean;
    suggestedAction?: string;
}

// ─── Helper ─────────────────────────────────────────────────

async function callGemini(prompt: string, temperature: number = 0.3): Promise<string> {
    // ── Path 1: Backend AI Proxy (production) ─────────────────
    if (isAIProxyEnabled()) {
        try {
            return await proxyAIAnalyze(prompt, 'analysis_engine', 'analyze', undefined, undefined, temperature);
        } catch (proxyError: unknown) {
            const msg = proxyError instanceof Error ? proxyError.message : String(proxyError);
            console.warn('[AIAnalysisEngine] Proxy call failed, falling back to direct:', msg);
            // If proxy fails AND we have a direct API key, fall through
            const ai = await getAI();
            if (!ai) {
                return JSON.stringify({ error: msg });
            }
        }
    }

    // ── Path 2: Direct Gemini Client (development/fallback) ──
    const ai = await getAI();
    if (!ai) return JSON.stringify({ error: 'AI not configured. Set VITE_AI_PROXY_URL or VITE_GEMINI_API_KEY in .env' });
    try {
        const sysInstruction = (RELANTERN_SYSTEM_INSTRUCTION || '') +
            '\n\nIMPORTANT: Always respond with valid JSON only. No markdown, no code fences, just raw JSON.';
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                systemInstruction: sysInstruction,
                temperature,
            },
        });
        // response.text is a GETTER that can throw if candidates are empty or content is blocked
        let text: string | undefined;
        try { text = response?.text; } catch { text = undefined; }
        if (!text) {
            // Fallback: try to extract from candidates manually
            try {
                const part = response?.candidates?.[0]?.content?.parts?.[0];
                text = (part as { text?: string })?.text;
            } catch { /* ignore */ }
        }
        return text || '{}';
    } catch (error: unknown) {
        const raw = error instanceof Error ? error.message : String(error);
        console.error('[AIAnalysisEngine] Gemini call failed:', raw);
        // Extract a user-friendly message
        let friendly = 'AI analysis temporarily unavailable. Please try again later.';
        if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('quota')) {
            friendly = '⚠️ Gemini API quota exceeded. The free-tier limit has been reached. Please wait a few minutes or upgrade your API plan at https://ai.google.dev/pricing';
        } else if (raw.includes('API_KEY') || raw.includes('401') || raw.includes('403')) {
            friendly = '⚠️ Invalid or missing Gemini API key. Please check VITE_GEMINI_API_KEY in your .env.local file.';
        } else if (raw.includes('NETWORK') || raw.includes('fetch') || raw.includes('Failed to fetch')) {
            friendly = '⚠️ Network error — unable to reach the Gemini API. Please check your internet connection.';
        }
        return JSON.stringify({ error: friendly });
    }
}

/**
 * When callGemini can't reach the model it returns `{"error": "..."}` as its payload.
 * That is valid JSON, so a bare JSON.parse used to hand the error envelope straight
 * back as if it were a result — callers then read `.tool` / `.reasoning` off it and
 * rendered "Recommended: undefined" instead of reporting the failure. Reject the
 * envelope so a failed engine call fails loudly at the call site.
 */
function parseJSON<T>(raw: string, fallback: T): T {
    let parsed: unknown;
    try {
        // Strip markdown fences if present
        const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        parsed = JSON.parse(cleaned);
    } catch {
        console.warn('[AIAnalysisEngine] Failed to parse AI response:', raw.substring(0, 200));
        return fallback;
    }

    if (parsed && typeof parsed === 'object' && 'error' in parsed && !('tool' in parsed)) {
        const msg = String((parsed as { error: unknown }).error);
        console.warn('[AIAnalysisEngine] Engine call failed:', msg);
        throw new Error(msg);
    }

    return parsed as T;
}

// ─── Engine ─────────────────────────────────────────────────

class AIAnalysisEngine {
    private static instance: AIAnalysisEngine;
    private constructor() { }

    static getInstance(): AIAnalysisEngine {
        if (!AIAnalysisEngine.instance) AIAnalysisEngine.instance = new AIAnalysisEngine();
        return AIAnalysisEngine.instance;
    }

    /**
     * Recommend the best analysis tool based on the problem context.
     */
    async recommendTool(context: {
        problemDescription: string;
        assetCriticality?: string;
        failureCount?: number;
        totalCost?: number;
        hasRecurrence?: boolean;
    }): Promise<ToolRecommendation> {
        const prompt = `You are an ISO 55000 reliability engineer. Based on this context, recommend the SINGLE best analysis tool:

Context:
- Problem: ${context.problemDescription}
- Asset Criticality: ${context.assetCriticality || 'Unknown'}
- Failure Count (YTD): ${context.failureCount ?? 'Unknown'}
- Total Cost Impact: ${context.totalCost ? `$${context.totalCost.toLocaleString()}` : 'Unknown'}
- Recurrence Detected: ${context.hasRecurrence ?? 'Unknown'}

Available tools:
1. "rca" — Root Cause Analysis (5-Why / Fishbone / Apollo) — for investigating specific failure events
2. "fmea" — Failure Mode & Effects Analysis — for proactive risk assessment of components
3. "pareto" — Pareto Analysis — for identifying worst offenders (cost/downtime/frequency)
4. "rbd" — Reliability Block Diagram — for system-level availability modeling
5. "fault_tree" — Fault Tree Analysis — for safety-critical event probability
6. "monte_carlo" — Monte Carlo Simulation — for probabilistic lifecycle costing

Respond as JSON: { "tool": "<tool_id>", "confidence": <0-1>, "reasoning": "<why>", "suggestedSteps": ["step1", "step2", ...] }`;

        const raw = await callGemini(prompt);
        return parseJSON<ToolRecommendation>(raw, {
            tool: 'rca', confidence: 0.5, reasoning: 'Default recommendation', suggestedSteps: ['Start an investigation']
        });
    }

    /**
     * Generate RCA hypotheses from investigation context (3W2H + failure data).
     */
    async generateRCAHypothesis(context: {
        problemStatement: string;
        eventWhat?: string;
        eventWhen?: string;
        eventWhere?: string;
        eventHow?: string;
        assetType?: string;
        failureCoding?: { mode?: string; cause?: string; remedy?: string };
        existingCauses?: string[];
    }): Promise<RCAHypothesis> {
        const prompt = `You are conducting Root Cause Analysis per PROACT and Apollo methodologies.

Event context (3W2H):
- Problem: ${context.problemStatement}
- What: ${context.eventWhat || 'Not specified'}
- When: ${context.eventWhen || 'Not specified'}
- Where: ${context.eventWhere || 'Not specified'}
- How: ${context.eventHow || 'Not specified'}
- Asset Type: ${context.assetType || 'Not specified'}
- WO Failure Coding: ${context.failureCoding ? JSON.stringify(context.failureCoding) : 'None'}
- Already identified causes: ${context.existingCauses?.join(', ') || 'None yet'}

Generate hypotheses using PROACT 3-layer model and organize for Ishikawa (6M) fishbone.

Respond as JSON:
{
  "hypotheses": [{ "description": "...", "category": "physical|human|latent", "likelihood": "high|medium|low" }],
  "fishboneCategories": { "Man": [...], "Machine": [...], "Method": [...], "Material": [...], "Measurement": [...], "Environment": [...] },
  "suggestedEvidence": ["Evidence to collect..."]
}`;

        const raw = await callGemini(prompt);
        return parseJSON<RCAHypothesis>(raw, {
            hypotheses: [], fishboneCategories: {}, suggestedEvidence: []
        });
    }

    /**
     * Suggest corrective actions from identified root causes.
     */
    async suggestCorrectiveActions(context: {
        rootCauses: { description: string; category: string; causeCode?: string }[];
        assetCriticality?: string;
        industry?: string;
    }): Promise<CorrectiveActionSuggestion> {
        const prompt = `You are an ISO 55000 reliability engineer. Suggest corrective actions for these root causes:

Root Causes:
${context.rootCauses.map((c, i) => `${i + 1}. [${c.category}] ${c.description} (ISO 14224: ${c.causeCode || 'N/A'})`).join('\n')}

Asset Criticality: ${context.assetCriticality || 'B'}
Industry: ${context.industry || 'Oil & Gas'}

For each action, specify if a Management of Change (MoC) is required.

Respond as JSON:
{
  "actions": [{ "description": "...", "type": "immediate|short_term|long_term", "requiresMoC": true|false, "estimatedCost": "$X" }],
  "riskOfInaction": "..."
}`;

        const raw = await callGemini(prompt);
        return parseJSON<CorrectiveActionSuggestion>(raw, { actions: [], riskOfInaction: '' });
    }

    /**
     * Analyze defect pattern from work order history.
     */
    async assessDefectPattern(context: {
        assetName: string;
        assetType?: string;
        workOrders: { type: string; title: string; cost: number; date: string; failureMode?: string }[];
    }): Promise<DefectPattern> {
        const prompt = `Analyze the failure pattern for asset "${context.assetName}" (${context.assetType || 'Equipment'}).

Work Order History (most recent first):
${context.workOrders.slice(0, 20).map(wo =>
            `- [${wo.type}] ${wo.title} | Cost: $${wo.cost} | Date: ${wo.date} | Failure: ${wo.failureMode || 'N/A'}`
        ).join('\n')}

Identify repeat failure patterns, estimate recurrence rate, and recommend elimination strategy.

Respond as JSON:
{
  "patternDetected": true|false,
  "recurrenceRate": <failures_per_year>,
  "failureMode": "dominant failure mode",
  "recommendation": "...",
  "estimatedAnnualCost": <number>
}`;

        const raw = await callGemini(prompt);
        return parseJSON<DefectPattern>(raw, {
            patternDetected: false, recurrenceRate: 0, failureMode: '', recommendation: '', estimatedAnnualCost: 0
        });
    }

    /**
     * Draft a defect elimination plan for a bad-actor asset.
     */
    async draftEliminationPlan(context: {
        assetName: string;
        assetCriticality: string;
        annualFailureCost: number;
        failureCount: number;
        dominantFailureMode: string;
        existingRCAs?: string[];
    }): Promise<EliminationPlanDraft> {
        const prompt = `Draft a Defect Elimination plan for this bad-actor asset:

Asset: ${context.assetName}
Criticality: ${context.assetCriticality}
Annual Failure Cost: $${context.annualFailureCost.toLocaleString()}
Failures (YTD): ${context.failureCount}
Dominant Failure Mode: ${context.dominantFailureMode}
Existing RCAs: ${context.existingRCAs?.join(', ') || 'None'}

Calculate payback period (months) = implementationCost / (estimatedSavingsPerYear / 12).

Respond as JSON:
{
  "title": "...",
  "scope": "...",
  "rootCauseSummary": "...",
  "proposedSolution": "...",
  "estimatedSavingsPerYear": <number>,
  "estimatedImplementationCost": <number>,
  "priority": "critical|high|medium|low",
  "paybackMonths": <number>
}`;

        const raw = await callGemini(prompt);
        return parseJSON<EliminationPlanDraft>(raw, {
            title: '', scope: '', rootCauseSummary: '', proposedSolution: '',
            estimatedSavingsPerYear: 0, estimatedImplementationCost: 0, priority: 'medium', paybackMonths: 0
        });
    }

    /**
     * Suggest optimal RBD configuration from component failure rates.
     */
    async analyzeRBDConfiguration(context: {
        systemName: string;
        blocks: { name: string; failureRate: number; mtbf: number; mttr: number; currentConfig: string }[];
        targetAvailability: number;
    }): Promise<RBDConfigSuggestion> {
        const prompt = `Analyze this system reliability model and suggest improvements:

System: ${context.systemName}
Target Availability: ${(context.targetAvailability * 100).toFixed(1)}%

Current Configuration:
${context.blocks.map(b =>
            `- ${b.name}: λ=${b.failureRate}/yr, MTBF=${b.mtbf}h, MTTR=${b.mttr}h, Config: ${b.currentConfig}`
        ).join('\n')}

Suggest optimal redundancy configuration to meet target availability.

Respond as JSON:
{
  "currentAvailability": <0-1>,
  "suggestedConfig": "description of suggested configuration",
  "expectedAvailability": <0-1>,
  "costBenefitRatio": <number>,
  "reasoning": "..."
}`;

        const raw = await callGemini(prompt);
        return parseJSON<RBDConfigSuggestion>(raw, {
            currentAvailability: 0.9, suggestedConfig: '', expectedAvailability: 0.95,
            costBenefitRatio: 0, reasoning: ''
        });
    }

    /**
     * Suggest JSA hazards based on work order context (HITL: suggestions only).
     */
    async suggestJSAHazards(context: {
        assetName?: string;
        assetType?: string;
        equipmentClass?: string;
        workDescription: string;
        workType?: string;
        location?: string;
    }): Promise<{ hazards: JSAHazardSuggestion[] }> {
        const prompt = `You are an HSE (Health, Safety & Environment) engineer performing a Job Safety Analysis per ISO 45001.

Work Context:
- Work Description: ${context.workDescription}
- Asset: ${context.assetName || 'Not specified'} (Type: ${context.assetType || 'N/A'}, Class: ${context.equipmentClass || 'N/A'})
- Work Type: ${context.workType || 'Corrective Maintenance'}
- Location: ${context.location || 'Not specified'}

Identify 3-6 realistic hazards for this specific job. For each hazard:
- Rate consequence (1-5: 1=Insignificant, 2=Minor, 3=Moderate, 4=Major, 5=Catastrophic)
- Rate likelihood (1-5: 1=Rare, 2=Unlikely, 3=Possible, 4=Likely, 5=Almost Certain)
- Suggest controls from ISO 45001 hierarchy: Elimination, Substitution, Engineering, Admin, PPE
- Describe specific control measures

Focus on industry-specific hazards for Oil & Gas / heavy industrial equipment.

Respond as JSON:
{
  "hazards": [
    {
      "hazard": "Description of the hazard",
      "consequence": 3,
      "likelihood": 2,
      "controlHierarchy": ["Engineering", "PPE"],
      "controls": "Specific control measures...",
      "rationale": "Why this hazard is relevant to this job"
    }
  ]
}`;

        const raw = await callGemini(prompt);
        return parseJSON<{ hazards: JSAHazardSuggestion[] }>(raw, { hazards: [] });
    }

    /**
     * Recommend the best RCA method based on investigation context.
     * HITL: Suggestion only — the engineer selects the final method.
     */
    async recommendRCAMethod(context: {
        problemDescription: string;
        assetCriticality?: string; // A, B, C
        rcaCategory?: string; // safety, production, process, asset_failure
        investigationType?: string; // reactive, proactive
        triggerType?: string; // cost, recurrence, criticality, safety, pareto, downtime, near_miss, manual
        failureCount?: number;
        failureModeCount?: number;
        totalCost?: number;
        downtimeHours?: number;
        mtbf?: number;
        priorRCACount?: number;
    }): Promise<RCAMethodRecommendation> {
        const prompt = `You are an ISO 55000 / IEC 61025 reliability engineer. Based on the investigation context below, recommend the SINGLE best Root Cause Analysis method.

Investigation Context:
- Problem: ${context.problemDescription || 'Not specified'}
- Asset Criticality: ${context.assetCriticality || 'Unknown'} (A=Safety Critical, B=Production Critical, C=General)
- RCA Category: ${context.rcaCategory || 'Unknown'}
- Investigation Type: ${context.investigationType || 'reactive'}
- Trigger: ${context.triggerType || 'manual'}
- Failure Count (YTD): ${context.failureCount ?? 'Unknown'}
- Distinct Failure Modes: ${context.failureModeCount ?? 'Unknown'}
- Cost Impact: ${context.totalCost ? '$' + context.totalCost.toLocaleString() : 'Unknown'}
- Downtime: ${context.downtimeHours ? context.downtimeHours + ' hours' : 'Unknown'}
- MTBF: ${context.mtbf ? context.mtbf + ' hours' : 'Unknown'}
- Prior RCA Investigations on this Asset: ${context.priorRCACount ?? 'Unknown'}

Available RCA Methods:
1. "five_why" (5-Why Analysis) — Linear cause chain, best for simple single-thread failures. Quick and effective when one dominant cause is suspected.
2. "fishbone" (Fishbone / Ishikawa) — 6M category brainstorming (Man, Machine, Method, Material, Measurement, Environment). Best when multiple contributing factors interact.
3. "fault_tree" (Fault Tree Analysis) — Boolean logic gates (AND/OR) with probability propagation per IEC 61025. Required for safety-critical / high-consequence events.
4. "taproot" (TapRooT®) — Structured SnapCharT® and Root Cause Tree. Best for incident/near-miss investigations with organizational/systemic factors.
5. "apollo" (Apollo RCA) — Evidence-based causal mapping of causes, effects, and solutions. Best for complex multi-factor events with recurrence patterns.

Selection Guidelines:
- Safety-critical (Criticality A) + safety category → prefer fault_tree
- Safety incident or near-miss trigger → prefer taproot
- Recurrence on critical asset → prefer apollo
- Multiple failure modes (>=4) → prefer fishbone
- Proactive investigation → prefer fishbone
- Simple single-cause failure → prefer five_why
- High cost (>$100k) on critical asset → prefer fault_tree

Respond as JSON:
{
  "method": "<method_id>",
  "confidence": <0.0-1.0>,
  "reasoning": "<2-3 sentence engineering rationale>",
  "alternatives": [
    { "method": "<method_id>", "label": "<display name>", "reason": "<when to use instead>" },
    { "method": "<method_id>", "label": "<display name>", "reason": "<when to use instead>" }
  ]
}`;

        const raw = await callGemini(prompt);
        return parseJSON<RCAMethodRecommendation>(raw, {
            method: 'five_why',
            confidence: 0.5,
            reasoning: 'Default recommendation — insufficient context for AI analysis.',
            alternatives: [
                { method: 'fishbone', label: 'Fishbone (Ishikawa)', reason: 'Use if multiple contributing factors are suspected' },
                { method: 'fault_tree', label: 'Fault Tree Analysis', reason: 'Use for safety-critical or high-consequence events' },
            ],
        });
    }

    /**
     * Open-ended reliability question — freeform Gemini call with full context.
     */
    async askFreeform(question: string, context?: {
        assetName?: string;
        assetTag?: string;
        assetCriticality?: string;
        assetType?: string;
        activeDivision?: string;
        paretoSummary?: string;
    }): Promise<{ answer: string; suggestedActions?: string[] }> {
        const ctxBlock = context ? `\nContext:\n- Asset: ${context.assetTag || 'N/A'} — ${context.assetName || 'No asset selected'}\n- Criticality: ${context.assetCriticality || 'Unknown'}\n- Type: ${context.assetType || 'Unknown'}\n- Active Analysis Tab: ${context.activeDivision || 'General'}\n- Pareto Summary: ${context.paretoSummary || 'No Pareto data'}\n` : '';

        const prompt = `You are the "Reliability Specialist" — an AI-powered advisor embedded in an Enterprise Asset Management system.
You follow ISO 55000, ISO 14224, IEC 60812, and OREDA standards.
You think like an experienced asset manager, act like an operations manager, and learn like a data scientist.

HITL Principle: All your outputs are SUGGESTIONS — you cannot authorize shutdowns, create POs, or close investigations.
${ctxBlock}
User Question: ${question}

Respond as JSON:
{
  "answer": "<your detailed, actionable response in markdown format>",
  "suggestedActions": ["action1", "action2"]
}`;

        const raw = await callGemini(prompt);
        const parsed = parseJSON<{ answer?: string; error?: string; suggestedActions?: string[] }>(raw, {
            answer: 'Unable to process your question at this time. Please check the AI configuration.',
            suggestedActions: [],
        });
        // Guard: callGemini error returns { error: '...' } which parseJSON parses successfully
        // but has no `answer` field — ensure we always return a string answer
        return {
            answer: parsed.answer || parsed.error || 'Unable to process your question at this time.',
            suggestedActions: parsed.suggestedActions || [],
        };
    }
    /**
     * Suggest failure effects (local + plant-wide) for a given failure mode and asset context.
     * HITL: These are SUGGESTIONS — the engineer reviews and accepts/modifies.
     */
    async suggestFailureEffects(context: {
        failureMode: string;
        failureModeDescription?: string;
        assetName?: string;
        assetType?: string;
        equipmentClass?: string;
        serviceMedium?: string;
    }): Promise<{ localEffect: string; plantWideEffect: string; localEffectCode?: string; plantWideEffectCode?: string; reasoning: string }> {
        const prompt = `You are an ISO 14224 reliability engineer. Given the failure mode and asset context below, suggest the most likely LOCAL and PLANT-WIDE failure effects.

Failure Mode: ${context.failureMode} ${context.failureModeDescription ? `(${context.failureModeDescription})` : ''}
Asset: ${context.assetName || 'Not specified'}
Asset Type: ${context.assetType || 'Not specified'}
Equipment Class: ${context.equipmentClass || 'Not specified'}
Service Medium: ${context.serviceMedium || 'Not specified'}

LOCAL EFFECT = What happens to the equipment itself (performance degradation, secondary damage, containment loss, etc.)
PLANT-WIDE EFFECT = What happens to the plant (production loss, safety hazard, environmental release, etc.)

Available local effect codes: LOF(Loss of Function), DEG(Degraded Performance), INT(Intermittent), RES(Restricted/Derated), SDM(Secondary Damage), OVH(Overheating), VIB(Excessive Vibration), CTM(Contamination), COR(Accelerated Corrosion), LOC(Loss of Containment), PRB(Pressure Breach), FLD(Fluid Loss), LPC(Loss of Process Control), SPR(Spurious Trip), LMO(Loss of Monitoring), HDF(Hidden Failure), STR(Structural Compromise), MSA(Misalignment), NOE(No Observable Effect)
Available plant effect codes: PSD(Partial Shutdown), FSD(Full Shutdown), PLR(Production Loss), QTY(Quality Deviation), FLR(Flaring), RDN(Redundancy Consumed), PIJ(Personnel Injury), FIR(Fire/Explosion), TOX(Toxic Release), EVA(Evacuation), REG(Non-Compliance), SPL(Spill), EMI(Emissions), WCD(Water Contamination), DEF(Deferred Revenue), PEN(Penalty), REP(Reputational), NIL(No Plant Impact)

Respond as JSON:
{
  "localEffect": "Descriptive text of local effect (1-2 sentences)",
  "plantWideEffect": "Descriptive text of plant-wide effect (1-2 sentences)",
  "localEffectCode": "Best matching code from local list",
  "plantWideEffectCode": "Best matching code from plant list",
  "reasoning": "Brief engineering rationale"
}`;

        const raw = await callGemini(prompt);
        return parseJSON(raw, {
            localEffect: '',
            plantWideEffect: '',
            localEffectCode: '',
            plantWideEffectCode: '',
            reasoning: 'AI suggestion unavailable'
        });
    }

    // ═══════════════════════════════════════════════════════════
    //  Agentic Intelligence Methods (HITL: drafts only)
    // ═══════════════════════════════════════════════════════════

    /**
     * Draft a Work Request from a prediction alert context.
     * HITL: Returns a DRAFT — human must approve before WR is persisted.
     */
    async draftWorkRequestFromAlert(context: {
        alertTitle: string;
        alertDescription: string;
        alertSeverity: string;
        alertType: string;
        assetName: string;
        assetTag?: string;
        assetCriticality?: string;
        assetType?: string;
        confidence?: number;
        /** Deterministic diagnosis (diagnosis-rules-v1) — when present the LLM narrates it, never invents codes. */
        diagnosis?: DiagnosisResult | null;
    }): Promise<WorkRequestDraft> {
        // Grounding (gap-closeout slice 4): the rules engine's ranked hypotheses
        // are the source of truth; Gemini selects and narrates from them.
        const topHypothesis = context.diagnosis?.hypotheses?.[0];
        const diagnosisSection = context.diagnosis?.hypotheses?.length
            ? `
Deterministic Diagnosis (rules engine — ranked failure-mode hypotheses with evidence):
${context.diagnosis.hypotheses.map((h, i) =>
                `${i + 1}. [${h.failure_mode_code}] ${h.failure_mode_label} — confidence ${(h.confidence * 100).toFixed(0)}% (${h.basis})
   Evidence: ${h.evidence.map(e => e.summary).join('; ')}
   Recommended action: ${h.recommended_action}`).join('\n')}

IMPORTANT: suggested_failure_mode MUST be one of the codes listed above (prefer the top-ranked unless the evidence clearly favors another). Base the description and inspection scope on the cited evidence — do not invent failure modes or evidence.`
            : `
No deterministic diagnosis is available for this alert — suggest failure mode and cause codes per ISO 14224 from the alert context, and say they are unconfirmed.`;

        const prompt = `You are an ISO 55000 maintenance planner. A predictive alert has been raised. Draft a Work Request.

Alert Context:
- Title: ${context.alertTitle}
- Description: ${context.alertDescription}
- Severity: ${context.alertSeverity}
- Type: ${context.alertType}
- AI Confidence: ${context.confidence ? `${(context.confidence * 100).toFixed(0)}%` : 'N/A'}

Asset Context:
- Name: ${context.assetName} (Tag: ${context.assetTag || 'N/A'})
- Criticality: ${context.assetCriticality || 'B'}
- Type: ${context.assetType || 'Equipment'}
${diagnosisSection}

Draft a Work Request with:
1. A clear, actionable title (max 80 chars)
2. A detailed description including the alert context, the diagnostic evidence, and recommended inspection scope
3. Suggested work type (PM, CM, PdM, EM)
4. Priority (routine, urgent, emergency) based on criticality × severity
5. Suggested failure mode and cause codes per ISO 14224
6. Estimated hours for the work

Respond as JSON:
{
  "title": "...",
  "description": "...",
  "work_type": "PM|CM|PdM|EM",
  "priority": "routine|urgent|emergency",
  "suggested_failure_mode": "...",
  "suggested_failure_cause": "...",
  "estimated_hours": 0,
  "rpn_rationale": "...",
  "recommended_craft": "..."
}`;

        const raw = await callGemini(prompt);
        // Fallback = top deterministic hypothesis verbatim: works with no API key.
        return parseJSON<WorkRequestDraft>(raw, {
            title: `Investigate: ${context.alertTitle}`,
            description: topHypothesis
                ? `${context.alertDescription || ''}\n\nProbable cause (rules engine): [${topHypothesis.failure_mode_code}] ${topHypothesis.failure_mode_label} — ${(topHypothesis.confidence * 100).toFixed(0)}%. Evidence: ${topHypothesis.evidence.map(e => e.summary).join('; ')}. ${topHypothesis.recommended_action}`
                : context.alertDescription || '',
            work_type: 'PdM',
            priority: 'urgent',
            suggested_failure_mode: topHypothesis?.failure_mode_code ?? '',
            suggested_failure_cause: '',
            estimated_hours: 4,
            rpn_rationale: topHypothesis
                ? `Top hypothesis ${topHypothesis.failure_mode_code} @ ${(topHypothesis.confidence * 100).toFixed(0)}% (${topHypothesis.basis})`
                : 'Default — manual assessment required',
            recommended_craft: 'Mechanical',
        });
    }

    /**
     * Generate a pre-populated RCA summary for a Pareto bad-actor asset.
     * HITL: Returns a DRAFT template — human reviews before investigation is created.
     */
    async generateBadActorRCASummary(context: {
        assetName: string;
        assetCriticality?: string;
        metricValue: number;
        metricUnit: string;
        failureCount: number;
        recentWorkOrders: { type: string; title: string; cost: number; date: string; failureMode?: string }[];
    }): Promise<BadActorRCASummary> {
        const prompt = `You are a reliability engineer conducting a preliminary RCA for a Pareto bad-actor asset.

Asset: ${context.assetName} (Criticality: ${context.assetCriticality || 'B'})
Performance: ${context.metricValue} ${context.metricUnit} | ${context.failureCount} failures

Recent Work Orders:
${context.recentWorkOrders.slice(0, 15).map(wo =>
            `- [${wo.type}] ${wo.title} | $${wo.cost} | ${wo.date} | Failure: ${wo.failureMode || 'N/A'}`
        ).join('\n')}

Generate a pre-populated RCA investigation template with:
1. A clear problem statement synthesized from WO history
2. 3-5 initial "Why" branches for a 5-Why analysis
3. Fishbone (6M) category suggestions with specific causes
4. Evidence collection checklist
5. Suggested investigation priority

Respond as JSON:
{
  "problem_statement": "...",
  "why_branches": ["Why 1...", "Why 2..."],
  "fishbone_categories": { "Man": [...], "Machine": [...], "Method": [...], "Material": [...], "Measurement": [...], "Environment": [...] },
  "evidence_checklist": ["Item 1...", "Item 2..."],
  "priority": "critical|high|medium|low",
  "dominant_failure_mode": "...",
  "estimated_annual_impact": 0
}`;

        const raw = await callGemini(prompt);
        return parseJSON<BadActorRCASummary>(raw, {
            problem_statement: `Recurring failures on ${context.assetName}`,
            why_branches: [],
            fishbone_categories: {},
            evidence_checklist: [],
            priority: 'high',
            dominant_failure_mode: '',
            estimated_annual_impact: 0,
        });
    }

    /**
     * Draft a Work Request from a Vision inspection finding.
     * HITL: Returns a DRAFT — human must approve before WR is persisted.
     */
    async draftWorkRequestFromVisionFinding(context: {
        analysisType: string;
        severity: string;
        detectedItems: number;
        imageName: string;
        assetName: string;
        assetTag?: string;
        assetCriticality?: string;
        assetType?: string;
    }): Promise<WorkRequestDraft> {
        const prompt = `You are an ISO 55000 maintenance planner. An AI-powered visual inspection has detected anomalies. Draft a Work Request.

Vision Finding Context:
- Analysis Type: ${context.analysisType}
- Severity: ${context.severity}
- Detected Anomalies: ${context.detectedItems}
- Source Image: ${context.imageName}

Asset Context:
- Name: ${context.assetName} (Tag: ${context.assetTag || 'N/A'})
- Criticality: ${context.assetCriticality || 'B'}
- Type: ${context.assetType || 'Equipment'}

Draft a Work Request with:
1. A clear, actionable title referencing the visual finding (max 80 chars)
2. A detailed description including the inspection results and recommended follow-up scope
3. Work type: use "PdM" for thermal, "CM" for critical corrosion, "PM" for condition/tagging
4. Priority based on criticality × severity
5. Suggested failure mode and cause codes per ISO 14224
6. Estimated hours for verification and remediation

Respond as JSON:
{
  "title": "...",
  "description": "...",
  "work_type": "PM|CM|PdM|EM",
  "priority": "routine|urgent|emergency",
  "suggested_failure_mode": "...",
  "suggested_failure_cause": "...",
  "estimated_hours": 0,
  "rpn_rationale": "...",
  "recommended_craft": "..."
}`;

        const raw = await callGemini(prompt);
        return parseJSON<WorkRequestDraft>(raw, {
            title: `Vision: ${context.analysisType} anomaly — ${context.assetName}`,
            description: `AI vision detected ${context.detectedItems} ${context.analysisType} anomalie(s) at severity "${context.severity}" on image ${context.imageName}. Requires field verification.`,
            work_type: context.analysisType === 'thermal' ? 'PdM' : 'CM',
            priority: context.severity === 'critical' ? 'emergency' : 'urgent',
            suggested_failure_mode: '',
            suggested_failure_cause: '',
            estimated_hours: 4,
            rpn_rationale: 'Vision-based — field verification required',
            recommended_craft: context.analysisType === 'corrosion' ? 'Inspection' : 'Mechanical',
        });
    }

    /**
     * Draft a Work Request from a physical inspection finding.
     * HITL: Returns a DRAFT — human must approve before WR is persisted.
     */
    async draftWorkRequestFromInspectionFinding(context: {
        findingDescription: string;
        severity: string;
        ndeMethod: string;
        inspectionType: string;
        governingCode?: string;
        damageMechanism?: string;
        cmlReference?: string;
        assetName: string;
        assetTag?: string;
        assetCriticality?: string;
        assetType?: string;
    }): Promise<WorkRequestDraft> {
        const prompt = `You are an ISO 55000 maintenance planner. A physical field inspection has identified a finding that requires follow-up action. Draft a Work Request.

Inspection Finding Context:
- Description: ${context.findingDescription}
- Severity: ${context.severity}
- NDE Method Used: ${context.ndeMethod}
- Inspection Type: ${context.inspectionType}
- Governing Code: ${context.governingCode || 'N/A'}
- Damage Mechanism: ${context.damageMechanism || 'Not specified'}
- CML Reference: ${context.cmlReference || 'N/A'}

Asset Context:
- Name: ${context.assetName} (Tag: ${context.assetTag || 'N/A'})
- Criticality: ${context.assetCriticality || 'B'}
- Type: ${context.assetType || 'Equipment'}

Draft a Work Request with:
1. A clear, actionable title referencing the inspection finding (max 80 chars)
2. A detailed description including the inspection results, governing code reference, and recommended remediation scope
3. Work type: use "CM" for critical/major findings, "PM" for moderate monitoring, "PdM" for predictive follow-up
4. Priority based on criticality × severity
5. Suggested failure mode and cause codes per ISO 14224
6. Estimated hours for remediation

Respond as JSON:
{
  "title": "...",
  "description": "...",
  "work_type": "PM|CM|PdM|EM",
  "priority": "routine|urgent|emergency",
  "suggested_failure_mode": "...",
  "suggested_failure_cause": "...",
  "estimated_hours": 0,
  "rpn_rationale": "...",
  "recommended_craft": "..."
}`;

        const raw = await callGemini(prompt);
        return parseJSON<WorkRequestDraft>(raw, {
            title: `Insp Finding: ${context.severity} ${context.ndeMethod} — ${context.assetName}`,
            description: `Physical inspection (${context.inspectionType}) via ${context.ndeMethod} identified: "${context.findingDescription}". Governing code: ${context.governingCode || 'N/A'}. ${context.damageMechanism ? `Suspected damage mechanism: ${context.damageMechanism}.` : ''} Requires follow-up remediation.`,
            work_type: context.severity === 'critical' || context.severity === 'major' ? 'CM' : 'PM',
            priority: context.severity === 'critical' ? 'emergency' : context.severity === 'major' ? 'urgent' : 'routine',
            suggested_failure_mode: '',
            suggested_failure_cause: '',
            estimated_hours: context.severity === 'critical' ? 8 : 4,
            rpn_rationale: `${context.ndeMethod} inspection finding (${context.severity}) — ${context.governingCode || 'field inspection'}`,
            recommended_craft: 'Inspection',
        });
    }

    // ═══════════════════════════════════════════════════════════
    //  Phase 2: Structured Analysis Methods (typed JSON output)
    // ═══════════════════════════════════════════════════════════

    /**
     * Evaluate PM effectiveness using SAE JA1011 value-ratio methodology.
     * HITL: Returns analysis — human decides whether to adjust/suspend PM.
     */
    async evaluatePMEffectiveness(context: {
        pmId: string;
        pmTitle: string;
        assetName: string;
        assetCriticality?: string;
        intervalDays: number;
        executionCount: number;
        totalCost: number;
        failuresFoundCount: number;
        failuresBetweenPMs: number;
        lastExecutionDate?: string;
    }): Promise<PMEffectivenessResult> {
        const prompt = `You are a reliability engineer evaluating Preventive Maintenance effectiveness per SAE JA1011 (RCM) criteria.

PM Program:
- PM ID: ${context.pmId}
- Title: ${context.pmTitle}
- Asset: ${context.assetName} (Criticality: ${context.assetCriticality || 'B'})
- Interval: Every ${context.intervalDays} days
- Executions: ${context.executionCount}
- Total Cost: $${context.totalCost.toLocaleString()}
- Failures Found During PM: ${context.failuresFoundCount}
- Failures Between PMs (functional failures): ${context.failuresBetweenPMs}
- Last Executed: ${context.lastExecutionDate || 'Unknown'}

Evaluate using SAE JA1011 criteria:
1. Value Ratio = Failures Prevented (estimated) / Total PM Cost — is this PM adding value?
2. If failures between PMs > 0, the interval may be too long
3. If failures found = 0 consistently, the PM may be unnecessary or interval too short
4. Consider converting to condition-based monitoring (PdM) if applicable

Respond as JSON:
{
  "pmId": "${context.pmId}",
  "executionCount": ${context.executionCount},
  "failuresPreventedEstimate": <number>,
  "costPerCycle": <number>,
  "valueRatio": <number>,
  "recommendation": "continue|adjust_interval|suspend|convert_to_pdm",
  "reasoning": "2-3 sentence engineering rationale",
  "suggestedInterval": "optional new interval if adjusting"
}`;

        const raw = await callGemini(prompt, 0.3);
        return parseJSON<PMEffectivenessResult>(raw, {
            pmId: context.pmId, executionCount: context.executionCount,
            failuresPreventedEstimate: 0, costPerCycle: 0, valueRatio: 0,
            recommendation: 'continue', reasoning: 'Insufficient data for AI analysis.'
        });
    }

    /**
     * Suggest optimal PM interval based on MTBF, OREDA benchmarks, and P-F interval theory.
     * HITL: Suggestion only — engineer reviews and approves interval change via MoC.
     */
    async suggestPMInterval(context: {
        assetName: string;
        assetTag?: string;
        assetCriticality?: string;
        equipmentClass?: string;
        currentIntervalDays: number;
        mtbfHours?: number;
        failureHistory: { date: string; mode: string; downtime?: number }[];
        operatingHoursPerDay?: number;
    }): Promise<PMIntervalSuggestion> {
        const prompt = `You are a reliability engineer optimizing PM intervals using OREDA (6th Ed), ISO 14224 failure data, and P-F interval theory.

Asset Context:
- Asset: ${context.assetName} (Tag: ${context.assetTag || 'N/A'})
- Criticality: ${context.assetCriticality || 'B'}
- Equipment Class: ${context.equipmentClass || 'General rotating equipment'}
- Current PM Interval: Every ${context.currentIntervalDays} days
- MTBF: ${context.mtbfHours ? context.mtbfHours + ' hours' : 'Not calculated'}
- Operating Hours/Day: ${context.operatingHoursPerDay || 24}

Failure History (recent):
${context.failureHistory.slice(0, 15).map(f => `- ${f.date}: ${f.mode}${f.downtime ? ` (${f.downtime}h downtime)` : ''}`).join('\n') || 'No failures recorded'}

Analysis required:
1. Calculate optimal interval using P-F interval theory (inspection interval = P-F interval / 2-3)
2. Cross-reference with OREDA benchmark for this equipment class
3. Factor in asset criticality (Criticality A needs shorter intervals)
4. Quantify risk if interval is extended vs. cost savings

Respond as JSON:
{
  "currentInterval": "${context.currentIntervalDays} days",
  "suggestedInterval": "<new interval with units>",
  "basis": "mtbf|oreda|oem|pf_interval|weibull",
  "mtbfHours": <number or null>,
  "pfIntervalDays": <number or null>,
  "oredaBenchmark": "<OREDA reference if applicable>",
  "confidenceLevel": <0-1>,
  "reasoning": "Engineering rationale",
  "riskIfExtended": "Risk description if interval is increased",
  "costSavingsPerYear": <number or null>
}`;

        const raw = await callGemini(prompt, 0.3);
        return parseJSON<PMIntervalSuggestion>(raw, {
            currentInterval: `${context.currentIntervalDays} days`,
            suggestedInterval: `${context.currentIntervalDays} days`,
            basis: 'mtbf', confidenceLevel: 0.5,
            reasoning: 'Insufficient data for AI analysis.',
            riskIfExtended: 'Unable to assess without failure data.'
        });
    }

    /**
     * Auto-triage a Service Request using RPN (Criticality × Severity).
     * HITL: Suggestion only — planner confirms priority before conversion to WO.
     * Temperature: 0.2 (safety-critical decision)
     */
    async triageServiceRequest(context: {
        title: string;
        description: string;
        assetName?: string;
        assetTag?: string;
        assetCriticality?: string;
        isBreakdown: boolean;
        reportedBy?: string;
        location?: string;
        functionalFailure?: string;
    }): Promise<SRTriageResult> {
        const prompt = `You are an ISO 55000 maintenance planner performing Risk-Based Prioritization on a new Service Request.

Service Request:
- Title: ${context.title}
- Description: ${context.description}
- Asset: ${context.assetName || 'Not specified'} (Tag: ${context.assetTag || 'N/A'})
- Asset Criticality: ${context.assetCriticality || 'Unknown'} (A=Safety Critical, B=Production Critical, C=General)
- Is Breakdown: ${context.isBreakdown ? 'YES — equipment has failed' : 'No'}
- Functional Failure: ${context.functionalFailure || 'Not classified'}
- Location: ${context.location || 'Not specified'}
- Reported By: ${context.reportedBy || 'Unknown'}

Calculate Risk Priority Number (RPN):
- Asset Criticality Factor: A=5, B=3, C=1
- Impact Factor: Based on description severity (1-5)
- RPN = Criticality × Impact
- If RPN ≥ 20 or isBreakdown=true on Criticality A → autoEscalate = true

Also suggest: work category, craft/trade, and priority level.

Respond as JSON:
{
  "suggestedPriority": "emergency|urgent|normal|low",
  "rpn": <number>,
  "assetCriticalityFactor": <1-5>,
  "impactFactor": <1-5>,
  "suggestedCategory": "<work category>",
  "suggestedCraft": "<trade/craft>",
  "reasoning": "2-3 sentence rationale",
  "autoEscalate": true|false
}`;

        const raw = await callGemini(prompt, 0.2);
        return parseJSON<SRTriageResult>(raw, {
            suggestedPriority: 'normal', rpn: 0,
            assetCriticalityFactor: 1, impactFactor: 1,
            suggestedCategory: 'GENERAL', suggestedCraft: 'Mechanical',
            reasoning: 'Default — AI triage unavailable.', autoEscalate: false
        });
    }

    /**
     * Detect duplicate or overlapping work across open SRs and WOs.
     * Temperature: 0.2 (precision-critical)
     */
    async detectDuplicateWork(context: {
        newDescription: string;
        newAssetId?: string;
        openItems: { id: string; title: string; description: string; assetId?: string; type: 'SR' | 'WO' }[];
    }): Promise<DuplicateDetectionResult> {
        const prompt = `You are an EAM system duplicate detection engine. Compare a new work request against existing open items and identify potential duplicates.

New Request:
"${context.newDescription}"
${context.newAssetId ? `Asset ID: ${context.newAssetId}` : ''}

Open Items (SRs and WOs):
${context.openItems.slice(0, 20).map(item => `- [${item.type}] ${item.id}: "${item.title}" — ${item.description.substring(0, 100)}${item.assetId ? ` (Asset: ${item.assetId})` : ''}`).join('\n')}

Rules:
- Same asset + similar description = high similarity
- Same failure mode description but different asset = medium similarity
- Only flag as duplicate if confidence > 0.7
- Recommend "merge" if clearly same issue, "review" if unsure, "proceed" if unique

Respond as JSON:
{
  "isDuplicate": true|false,
  "confidence": <0-1>,
  "matchedItems": [{ "id": "...", "title": "...", "similarity": <0-1> }],
  "recommendation": "merge|proceed|review",
  "reasoning": "Brief explanation"
}`;

        const raw = await callGemini(prompt, 0.2);
        return parseJSON<DuplicateDetectionResult>(raw, {
            isDuplicate: false, confidence: 0, matchedItems: [],
            recommendation: 'proceed', reasoning: 'No duplicates detected.'
        });
    }

    /**
     * Calculate Economic Order Quantity (EOQ) for inventory optimization.
     * Temperature: 0.2 (mathematical precision)
     */
    async calculateOptimalEOQ(context: {
        partNumber: string;
        description: string;
        currentUnitCost: number;
        annualUsage: number;
        orderingCost?: number;
        holdingCostPercent?: number;
        currentMinLevel: number;
        currentMaxLevel: number;
        leadTimeDays: number;
        isCritical: boolean;
    }): Promise<EOQResult> {
        const prompt = `You are an ISO 55000 inventory optimization specialist. Calculate the optimal Economic Order Quantity (EOQ) for this spare part.

Part Details:
- Part Number: ${context.partNumber}
- Description: ${context.description}
- Unit Cost: $${context.currentUnitCost.toFixed(2)}
- Annual Usage (units): ${context.annualUsage}
- Ordering Cost per Order: $${context.orderingCost || 50}
- Holding Cost: ${context.holdingCostPercent || 25}% of unit cost per year
- Current Min Level: ${context.currentMinLevel}
- Current Max Level: ${context.currentMaxLevel}
- Lead Time: ${context.leadTimeDays} days
- Critical Spare: ${context.isCritical ? 'YES' : 'No'}

Calculate:
1. EOQ = √(2 × Annual Demand × Ordering Cost / Holding Cost per Unit)
2. Reorder Point = (Daily Usage × Lead Time) + Safety Stock
3. Safety Stock = For critical spares, use 2σ service level (97.7%)
4. Total Annual Cost = (Demand/EOQ × Ordering Cost) + (EOQ/2 × Holding Cost)

Respond as JSON:
{
  "economicOrderQuantity": <number>,
  "annualDemand": ${context.annualUsage},
  "orderingCost": <number>,
  "holdingCostPerUnit": <number>,
  "reorderPoint": <number>,
  "safetyStock": <number>,
  "totalAnnualCost": <number>,
  "reasoning": "Brief explanation of calculations and recommendations"
}`;

        const raw = await callGemini(prompt, 0.2);
        return parseJSON<EOQResult>(raw, {
            economicOrderQuantity: 0, annualDemand: context.annualUsage,
            orderingCost: context.orderingCost || 50,
            holdingCostPerUnit: context.currentUnitCost * (context.holdingCostPercent || 25) / 100,
            reorderPoint: context.currentMinLevel, safetyStock: 0,
            totalAnnualCost: 0, reasoning: 'EOQ calculation unavailable.'
        });
    }

    /**
     * Assess Management of Change (MoC) impact per ISO 31000.
     * Temperature: 0.2 (safety-critical risk assessment)
     */
    async assessMoCImpact(context: {
        mocTitle: string;
        changeType: string;
        description: string;
        justification?: string;
        affectedAssetNames: string[];
        currentPMs?: string[];
        currentProcedures?: string[];
    }): Promise<MoCImpactResult> {
        const prompt = `You are an ISO 31000 risk manager assessing a Management of Change (MoC) request.

MoC Details:
- Title: ${context.mocTitle}
- Change Type: ${context.changeType}
- Description: ${context.description}
- Justification: ${context.justification || 'Not provided'}

Affected Assets: ${context.affectedAssetNames.join(', ') || 'None specified'}
Current PMs on affected assets: ${context.currentPMs?.join(', ') || 'Unknown'}
Current Procedures: ${context.currentProcedures?.join(', ') || 'Unknown'}

Assess:
1. Overall risk level (low/medium/high/critical)
2. Technical impact on equipment integrity and reliability
3. Financial impact (cost of change, risk of not changing)
4. All affected documents, training, and PM programs that need updating
5. Required approval chain based on risk level
6. Rollback plan if change fails

Respond as JSON:
{
  "riskLevel": "low|medium|high|critical",
  "technicalImpact": "...",
  "financialImpact": "...",
  "affectedAssets": ["asset1", "asset2"],
  "affectedDocuments": ["doc1", "doc2"],
  "affectedTraining": ["training1"],
  "affectedPMs": ["PM program names"],
  "requiredApprovals": ["role1", "role2"],
  "rollbackPlan": "...",
  "reasoning": "Overall risk assessment rationale"
}`;

        const raw = await callGemini(prompt, 0.2);
        return parseJSON<MoCImpactResult>(raw, {
            riskLevel: 'medium', technicalImpact: '', financialImpact: '',
            affectedAssets: context.affectedAssetNames, affectedDocuments: [],
            affectedTraining: [], affectedPMs: [], requiredApprovals: [],
            rollbackPlan: '', reasoning: 'MoC impact assessment unavailable.'
        });
    }

    /**
     * Generate an executive KPI briefing from dashboard data.
     * Temperature: 0.4 (narrative/creative)
     */
    async generateExecutiveBriefing(context: {
        siteName?: string;
        totalAssets: number;
        openWorkOrders: number;
        overdueWorkOrders: number;
        openServiceRequests: number;
        pmCompliancePercent: number;
        mtbfHours?: number;
        mttrHours?: number;
        ytdMaintenanceCost?: number;
        ytdBudget?: number;
        criticalAlerts?: string[];
        badActors?: { name: string; failures: number; cost: number }[];
    }): Promise<ExecutiveBriefing> {
        const prompt = `You are an ISO 55000 asset management advisor generating an executive briefing for plant leadership.

Site: ${context.siteName || 'Main Facility'}
Date: ${new Date().toISOString().split('T')[0]}

Key Metrics:
- Total Assets: ${context.totalAssets}
- Open Work Orders: ${context.openWorkOrders} (${context.overdueWorkOrders} overdue)
- Open Service Requests: ${context.openServiceRequests}
- PM Compliance: ${context.pmCompliancePercent}%
- MTBF: ${context.mtbfHours ? context.mtbfHours + 'h' : 'N/A'}
- MTTR: ${context.mttrHours ? context.mttrHours + 'h' : 'N/A'}
- YTD Maintenance Cost: ${context.ytdMaintenanceCost ? '$' + context.ytdMaintenanceCost.toLocaleString() : 'N/A'}
- YTD Budget: ${context.ytdBudget ? '$' + context.ytdBudget.toLocaleString() : 'N/A'}

Critical Alerts: ${context.criticalAlerts?.join('; ') || 'None'}
Bad Actors: ${context.badActors?.map(b => `${b.name}: ${b.failures} failures, $${b.cost.toLocaleString()}`).join('; ') || 'None identified'}

Generate a concise executive briefing with:
1. 2-3 sentence summary (headline style)
2. Critical alerts requiring immediate attention
3. Top 3 risks with impact and recommended actions
4. Cost highlights and budget status
5. KPI trend indicators
6. Action items with suggested owners and deadlines

Respond as JSON:
{
  "summary": "...",
  "criticalAlerts": ["alert1", "alert2"],
  "topRisks": [{ "risk": "...", "impact": "...", "action": "..." }],
  "costHighlights": ["highlight1"],
  "kpiTrends": [{ "kpi": "PM Compliance", "trend": "improving|stable|declining", "value": "92%" }],
  "actionItems": [{ "item": "...", "owner": "Role/Title", "deadline": "YYYY-MM-DD" }]
}`;

        const raw = await callGemini(prompt, 0.4);
        return parseJSON<ExecutiveBriefing>(raw, {
            summary: 'Executive briefing generation unavailable.',
            criticalAlerts: [], topRisks: [], costHighlights: [],
            kpiTrends: [], actionItems: []
        });
    }

    /**
     * Benchmark asset Total Cost of Ownership against OREDA/industry data.
     * Temperature: 0.3 (analytical)
     */
    async benchmarkAssetTCO(context: {
        assetName: string;
        assetTag: string;
        assetCriticality?: string;
        equipmentClass?: string;
        acquisitionCost: number;
        installDate: string;
        yearsInService: number;
        totalMaintenanceCost: number;
        totalOperatingCost?: number;
        failureCount: number;
        plannedReplacementYear?: number;
    }): Promise<TCOBenchmark> {
        const prompt = `You are an ISO 55000 lifecycle cost analyst. Benchmark this asset's Total Cost of Ownership (TCO) against OREDA and industry standards.

Asset:
- Name: ${context.assetName} (Tag: ${context.assetTag})
- Criticality: ${context.assetCriticality || 'B'}
- Equipment Class: ${context.equipmentClass || 'General'}
- Acquisition Cost: $${context.acquisitionCost.toLocaleString()}
- Install Date: ${context.installDate}
- Years in Service: ${context.yearsInService}
- Total Maintenance Cost (lifetime): $${context.totalMaintenanceCost.toLocaleString()}
- Total Operating Cost: ${context.totalOperatingCost ? '$' + context.totalOperatingCost.toLocaleString() : 'N/A'}
- Failure Count (lifetime): ${context.failureCount}
- Planned Replacement: ${context.plannedReplacementYear || 'Not planned'}

Calculate:
1. TCO = Acquisition + Cumulative Maintenance + Cumulative Operating
2. Annual maintenance cost ratio = Maintenance/Year ÷ Acquisition Cost
3. Compare against OREDA benchmark for this equipment class
4. Recommend: keep, overhaul, replace, or decommission based on lifecycle position

Respond as JSON:
{
  "assetTag": "${context.assetTag}",
  "totalCostOfOwnership": <number>,
  "acquisitionCost": ${context.acquisitionCost},
  "operatingCostPerYear": <number>,
  "maintenanceCostPerYear": <number>,
  "projectedReplacementYear": <number>,
  "oredaBenchmarkTCO": <number or null>,
  "deviationPercent": <number>,
  "recommendation": "keep|overhaul|replace|decommission",
  "reasoning": "Engineering rationale"
}`;

        const raw = await callGemini(prompt, 0.3);
        return parseJSON<TCOBenchmark>(raw, {
            assetTag: context.assetTag,
            totalCostOfOwnership: context.acquisitionCost + context.totalMaintenanceCost,
            acquisitionCost: context.acquisitionCost,
            operatingCostPerYear: 0,
            maintenanceCostPerYear: context.yearsInService > 0 ? context.totalMaintenanceCost / context.yearsInService : 0,
            projectedReplacementYear: new Date().getFullYear() + 5,
            deviationPercent: 0, recommendation: 'keep',
            reasoning: 'TCO benchmark analysis unavailable.'
        });
    }

    /**
     * Generate a vendor performance scorecard from PO/delivery data.
     * Temperature: 0.3 (analytical)
     */
    async scorecardVendor(context: {
        vendorName: string;
        vendorCode?: string;
        category?: string;
        totalPOs: number;
        totalSpend: number;
        avgLeadTimeDays: number;
        onTimeDeliveryPercent: number;
        qualityRejectPercent: number;
        contractExpiry?: string;
        isSoleSource: boolean;
        criticalPartsSupplied?: string[];
    }): Promise<VendorScorecard> {
        const prompt = `You are an ISO 55000 procurement specialist generating a vendor performance scorecard.

Vendor Profile:
- Name: ${context.vendorName} (Code: ${context.vendorCode || 'N/A'})
- Category: ${context.category || 'General'}
- Total POs: ${context.totalPOs}
- Total Spend: $${context.totalSpend.toLocaleString()}
- Average Lead Time: ${context.avgLeadTimeDays} days
- On-Time Delivery: ${context.onTimeDeliveryPercent}%
- Quality Reject Rate: ${context.qualityRejectPercent}%
- Contract Expiry: ${context.contractExpiry || 'N/A'}
- Sole Source: ${context.isSoleSource ? 'YES — supply chain risk' : 'No'}
- Critical Parts Supplied: ${context.criticalPartsSupplied?.join(', ') || 'None flagged'}

Score each dimension 0-100:
- Delivery: Based on on-time %, lead time vs industry average
- Quality: Based on reject rate (0% = 100 score, >5% = poor)
- Price: Based on competitiveness (assume market average)
- Compliance: Contract adherence, documentation, certifications
- Responsiveness: Estimate from lead time and PO volume

Overall = weighted average (Delivery 30%, Quality 30%, Price 20%, Compliance 10%, Responsiveness 10%)

Respond as JSON:
{
  "overallScore": <0-100>,
  "deliveryScore": <0-100>,
  "qualityScore": <0-100>,
  "priceScore": <0-100>,
  "complianceScore": <0-100>,
  "responsiveness": <0-100>,
  "risks": ["risk1", "risk2"],
  "strengths": ["strength1"],
  "recommendation": "Overall assessment and action items"
}`;

        const raw = await callGemini(prompt, 0.3);
        return parseJSON<VendorScorecard>(raw, {
            overallScore: 50, deliveryScore: 50, qualityScore: 50,
            priceScore: 50, complianceScore: 50, responsiveness: 50,
            risks: [], strengths: [], recommendation: 'Vendor scorecard analysis unavailable.'
        });
    }

    /**
     * Convert natural language query to SQL for EAM database querying.
     * Temperature: 0.2 (precision-critical)
     */
    async generateNLQuery(context: {
        naturalLanguage: string;
        availableTables: string[];
        sampleColumns?: Record<string, string[]>;
    }): Promise<NLQueryResult> {
        const prompt = `You are a database query generator for an Enterprise Asset Management (EAM) system. Convert the user's natural language question into a safe, read-only SQL query.

User Question: "${context.naturalLanguage}"

Available Tables: ${context.availableTables.join(', ')}
${context.sampleColumns ? `\nTable Columns:\n${Object.entries(context.sampleColumns).map(([table, cols]) => `- ${table}: ${cols.join(', ')}`).join('\n')}` : ''}

Rules:
1. Generate SELECT queries ONLY — no INSERT, UPDATE, DELETE, DROP
2. Use standard PostgreSQL syntax
3. Include appropriate WHERE clauses
4. Limit results to 100 rows maximum
5. Use meaningful column aliases
6. Explain the query in plain English

Respond as JSON:
{
  "interpretedIntent": "What the user is asking for",
  "sqlQuery": "SELECT ... FROM ... WHERE ... LIMIT 100",
  "explanation": "Plain English explanation of what the query does",
  "suggestedFilters": [{ "field": "column_name", "operator": "=|>|<|LIKE", "value": "..." }],
  "confidence": <0-1>
}`;

        const raw = await callGemini(prompt, 0.2);
        return parseJSON<NLQueryResult>(raw, {
            interpretedIntent: 'Unable to interpret query.',
            sqlQuery: '', explanation: '',
            suggestedFilters: [], confidence: 0
        });
    }

    // ═══════════════════════════════════════════════════════════
    //  Phase 5: Futuristic Capabilities
    // ═══════════════════════════════════════════════════════════

    /**
     * Conversational Work Planning — generate a full WO draft from natural language.
     * "Plan a pump overhaul for P-101" → tasks, BOM, labour, isolation, JSA.
     * HITL: Returns a DRAFT that auto-populates an editable WO form.
     */
    async planWorkOrder(context: {
        naturalLanguageRequest: string;
        assetName?: string;
        assetTag?: string;
        assetCriticality?: string;
        assetType?: string;
        equipmentClass?: string;
        operatingContext?: string;
        recentWOHistory?: { type: string; title: string; date: string }[];
    }): Promise<WorkPlanDraft> {
        const prompt = `You are an ISO 55000 maintenance planner and SAE JA1011 specialist. A user has made a natural-language work planning request. Generate a COMPLETE, executable Work Order plan.

User Request: "${context.naturalLanguageRequest}"

Asset Context:
- Asset: ${context.assetName || 'Not specified'} (Tag: ${context.assetTag || 'N/A'})
- Criticality: ${context.assetCriticality || 'B'} (A=Safety Critical, B=Production Critical, C=General)
- Type: ${context.assetType || 'Equipment'}
- Equipment Class: ${context.equipmentClass || 'General'}
- Operating Context: ${context.operatingContext || 'Continuous process operation'}

Recent WO History:
${context.recentWOHistory?.slice(0, 10).map(wo => `- [${wo.type}] ${wo.title} (${wo.date})`).join('\n') || 'No recent history'}

Generate a complete Work Order plan with:
1. Clear title (max 80 chars) and detailed scope description
2. Work type classification (PM, CM, PdM, EM, OVHL)
3. Priority based on asset criticality × work urgency
4. Step-by-step task breakdown with craft assignments and hour estimates
5. Bill of Materials (parts, consumables, special tools)
6. Labour requirements by craft/trade
7. Isolation requirements (LOTO points, energy types, methods)
8. JSA hazards with controls per ISO 45001 hierarchy
9. Permit requirements (hot work, confined space, working at height, etc.)
10. ISO 14224 failure mode/cause codes if applicable
11. Overall duration and cost estimate

Respond as JSON:
{
  "title": "...",
  "description": "Detailed scope of work...",
  "workType": "PM|CM|PdM|EM|OVHL",
  "priority": "routine|urgent|emergency",
  "estimatedDuration": <hours>,
  "estimatedCost": <number>,
  "tasks": [{ "sequence": 1, "description": "...", "craft": "Mechanical|Electrical|Instrument|Inspection|Operations", "estHours": <number>, "safetyNote": "optional" }],
  "billOfMaterials": [{ "partNumber": "...", "description": "...", "qty": <number>, "unitCost": <number> }],
  "labourRequirements": [{ "craft": "...", "headcount": <number>, "hours": <number> }],
  "isolationRequirements": [{ "isolationType": "Electrical|Mechanical|Process|Instrument", "isolationPoint": "...", "method": "Lockout|Tagout|Blank|Valve" }],
  "jsaHazards": [{ "hazard": "...", "controls": "...", "riskLevel": "High|Medium|Low" }],
  "permitRequirements": ["Hot Work", "Confined Space", ...],
  "failureMode": "ISO 14224 code or null",
  "failureCause": "ISO 14224 code or null",
  "rpnRationale": "...",
  "aiConfidence": <0-1>
}`;

        const raw = await callGemini(prompt, 0.3);
        return parseJSON<WorkPlanDraft>(raw, {
            title: `Work Plan: ${context.naturalLanguageRequest.substring(0, 60)}`,
            description: context.naturalLanguageRequest,
            workType: 'CM', priority: 'routine',
            estimatedDuration: 8, estimatedCost: 0,
            tasks: [{ sequence: 1, description: context.naturalLanguageRequest, craft: 'Mechanical', estHours: 8 }],
            billOfMaterials: [], labourRequirements: [{ craft: 'Mechanical', headcount: 1, hours: 8 }],
            isolationRequirements: [], jsaHazards: [], permitRequirements: [],
            rpnRationale: 'Manual assessment required — AI planning unavailable.', aiConfidence: 0,
        });
    }

    /**
     * Multi-Modal Vision — analyze equipment photo for defects.
     * Uses Gemini's image understanding to detect corrosion, cracks, leaks, thermal anomalies.
     * HITL: Findings are suggestions — engineer verifies in the field.
     */
    async analyzeEquipmentImage(context: {
        imageBase64: string;
        mimeType: string;
        assetName?: string;
        assetType?: string;
        inspectionContext?: string;
    }): Promise<VisionAnalysisResult> {
        const textPrompt = `You are an ISO 55000 inspection engineer analyzing an equipment photograph.

Asset Context:
- Asset: ${context.assetName || 'Unknown equipment'}
- Type: ${context.assetType || 'Not specified'}
- Inspection Context: ${context.inspectionContext || 'General condition assessment'}

Analyze this equipment image and identify ALL visible defects, degradation, or anomalies.
For each defect detected:
1. Classify the type (corrosion, crack, leak, vibration_damage, thermal_anomaly, erosion, fouling, misalignment, structural_damage, coating_failure)
2. Rate severity: minor (cosmetic), moderate (degraded function), severe (imminent failure risk), critical (immediate safety concern)
3. Describe the physical location on the equipment
4. Provide specific technical description with estimated extent
5. Suggest ISO 14224 failure mode code if applicable
6. Recommend immediate action

Also provide an overall condition assessment and follow-up recommendation.

Respond as JSON:
{
  "defectsDetected": [
    {
      "type": "corrosion|crack|leak|vibration_damage|thermal_anomaly|erosion|fouling|misalignment|structural_damage|coating_failure",
      "severity": "minor|moderate|severe|critical",
      "location": "Physical location on equipment",
      "description": "Detailed technical description",
      "suggestedFailureMode": "ISO 14224 code or null",
      "suggestedAction": "Recommended immediate action"
    }
  ],
  "overallCondition": "good|fair|poor|critical",
  "recommendedFollowUp": "Next steps for the asset owner",
  "aiConfidence": <0-1>
}`;

        // Multi-modal: use Gemini with inline image
        // The callGemini helper handles text-only. For vision, we need the direct SDK.
        if (isAIProxyEnabled()) {
            try {
                const { supabase } = await import('../lib/supabase');
                const { data: { session } } = await supabase.auth.getSession();
                const token = session?.access_token || '';
                const proxyUrl = import.meta.env.VITE_AI_PROXY_URL || '';
                const response = await fetch(`${proxyUrl}/ai/vision`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        image_base64: context.imageBase64,
                        mime_type: context.mimeType,
                        prompt: textPrompt,
                        module: 'vision',
                        temperature: 0.2,
                    }),
                });
                if (response.ok) {
                    const data = await response.json();
                    return parseJSON<VisionAnalysisResult>(data.text, {
                        defectsDetected: [], overallCondition: 'fair',
                        recommendedFollowUp: 'Manual inspection required.', aiConfidence: 0,
                    });
                }
            } catch (e) {
                console.warn('[AIAnalysisEngine] Vision proxy failed, trying direct:', e);
            }
        }

        // Direct path: use Gemini SDK with inline image parts
        const ai = await getAI();
        if (!ai) {
            return { defectsDetected: [], overallCondition: 'fair', recommendedFollowUp: 'AI not configured.', aiConfidence: 0 };
        }
        try {
            const sysInstruction = (RELANTERN_SYSTEM_INSTRUCTION || '') +
                '\n\nIMPORTANT: Always respond with valid JSON only. No markdown, no code fences, just raw JSON.';
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [{
                    role: 'user',
                    parts: [
                        { inlineData: { mimeType: context.mimeType, data: context.imageBase64 } },
                        { text: textPrompt },
                    ],
                }],
                config: { systemInstruction: sysInstruction, temperature: 0.2 },
            });
            let text: string | undefined;
            try { text = response?.text; } catch { text = undefined; }
            if (!text) {
                try {
                    const part = response?.candidates?.[0]?.content?.parts?.[0];
                    text = (part as { text?: string })?.text;
                } catch { /* ignore */ }
            }
            return parseJSON<VisionAnalysisResult>(text || '{}', {
                defectsDetected: [], overallCondition: 'fair',
                recommendedFollowUp: 'Analysis incomplete.', aiConfidence: 0,
            });
        } catch (error: unknown) {
            console.error('[AIAnalysisEngine] Vision analysis failed:', error);
            return { defectsDetected: [], overallCondition: 'fair', recommendedFollowUp: 'Vision analysis unavailable.', aiConfidence: 0 };
        }
    }

    /**
     * Digital Thread Tracing — trace an asset's full lifecycle from failure to design basis.
     * Connects WOs, SRs, PMs, RCAs, FMEAs into a coherent narrative.
     * HITL: Informational — no mutations.
     */
    async traceDigitalThread(context: {
        assetId: string;
        assetName: string;
        startingPoint: { type: string; id: string; title: string };
        workOrders: { id: string; title: string; type: string; date: string; failureMode?: string; status?: string }[];
        serviceRequests: { id: string; title: string; date: string; status?: string }[];
        pmPrograms: { id: string; title: string; interval: string; status?: string }[];
        rcaInvestigations: { id: string; title: string; rootCause?: string; date?: string }[];
        fmeaItems: { id: string; failureMode: string; rpn: number }[];
    }): Promise<DigitalThreadTrace> {
        const prompt = `You are an ISO 55000 asset lifecycle analyst. Analyze the complete "Digital Thread" for this asset — the chain of events, records, and relationships that connect failures to their root causes, maintenance strategies, and design basis.

Asset: ${context.assetName} (ID: ${context.assetId})
Starting Point: [${context.startingPoint.type}] ${context.startingPoint.title}

Work Orders (most recent first):
${context.workOrders.slice(0, 20).map(wo => `- [${wo.type}] ${wo.title} | ${wo.date} | Status: ${wo.status || 'N/A'} | Failure: ${wo.failureMode || 'N/A'}`).join('\n') || 'None'}

Service Requests:
${context.serviceRequests.slice(0, 10).map(sr => `- ${sr.title} | ${sr.date} | Status: ${sr.status || 'N/A'}`).join('\n') || 'None'}

PM Programs:
${context.pmPrograms.map(pm => `- ${pm.title} | Interval: ${pm.interval} | Status: ${pm.status || 'N/A'}`).join('\n') || 'None'}

RCA Investigations:
${context.rcaInvestigations.map(rca => `- ${rca.title} | Root Cause: ${rca.rootCause || 'Pending'}`).join('\n') || 'None'}

FMEA Items:
${context.fmeaItems.slice(0, 10).map(fm => `- ${fm.failureMode} | RPN: ${fm.rpn}`).join('\n') || 'None'}

Trace the connections between these records and generate:
1. A list of trace nodes (each record becomes a node with its connections)
2. A narrative that tells the "story" of this asset's maintenance journey
3. Recommendations for improving the asset's reliability strategy

For linkedNodes, reference the nodeId of connected records.

Respond as JSON:
{
  "assetId": "${context.assetId}",
  "assetName": "${context.assetName}",
  "traceNodes": [
    {
      "nodeType": "failure_event|work_order|service_request|pm_program|design_basis|oem_bulletin|moc|rca|fmea",
      "nodeId": "...",
      "title": "...",
      "date": "YYYY-MM-DD",
      "summary": "Brief description of this node's role in the thread",
      "linkedNodes": ["nodeId1", "nodeId2"]
    }
  ],
  "narrative": "A 2-3 paragraph narrative connecting all the dots...",
  "recommendations": ["Recommendation 1", "Recommendation 2"],
  "aiConfidence": <0-1>
}`;

        const raw = await callGemini(prompt, 0.3);
        return parseJSON<DigitalThreadTrace>(raw, {
            assetId: context.assetId, assetName: context.assetName,
            traceNodes: [], narrative: 'Digital thread analysis unavailable.',
            recommendations: [], aiConfidence: 0,
        });
    }

    /**
     * Predictive Procurement — forecast parts demand from PM schedule + failure trends.
     * HITL: Forecast only — planner approves PO drafts.
     */
    async forecastPartsDemand(context: {
        upcomingPMs: { pmTitle: string; nextDue: string; partsRequired: { partNumber: string; description: string; qty: number }[] }[];
        failureTrends: { failureMode: string; frequency: number; typicalParts: { partNumber: string; description: string; qtyPerEvent: number }[] }[];
        inventoryLevels: { partNumber: string; description: string; currentStock: number; minLevel: number; leadTimeDays: number; unitCost: number }[];
        horizonDays: number;
    }): Promise<PartsDemandForecast> {
        const prompt = `You are an ISO 55000 inventory optimization specialist. Forecast spare parts demand for the next ${context.horizonDays} days based on PM schedules, failure trends, and current inventory.

Upcoming PM Schedule (next ${context.horizonDays} days):
${context.upcomingPMs.slice(0, 15).map(pm =>
            `- ${pm.pmTitle} (due: ${pm.nextDue}): Requires ${pm.partsRequired.map(p => `${p.qty}x ${p.partNumber}`).join(', ')}`
        ).join('\n') || 'No upcoming PMs'}

Failure Trends (last 12 months):
${context.failureTrends.slice(0, 10).map(ft =>
            `- ${ft.failureMode}: ${ft.frequency} events/year → typically needs ${ft.typicalParts.map(p => `${p.qtyPerEvent}x ${p.partNumber}`).join(', ')}`
        ).join('\n') || 'No failure data'}

Current Inventory:
${context.inventoryLevels.slice(0, 20).map(inv =>
            `- ${inv.partNumber} (${inv.description}): ${inv.currentStock} in stock, min=${inv.minLevel}, lead=${inv.leadTimeDays}d, cost=$${inv.unitCost}`
        ).join('\n') || 'No inventory data'}

Forecast:
1. Calculate expected demand for each part (PM-driven + failure-driven)
2. Factor in seasonal patterns or turnaround cycles if applicable
3. Identify parts at risk of stockout within lead time
4. Calculate total estimated procurement spend

Respond as JSON:
{
  "forecasts": [
    { "partNumber": "...", "description": "...", "demand30d": <number>, "demand90d": <number>, "basis": "PM schedule|failure trend|combined", "confidence": <0-1> }
  ],
  "trendAnalysis": "Overall demand trend analysis...",
  "seasonalFactors": "Any seasonal or cyclical factors...",
  "totalEstimatedSpend": <number>
}`;

        const raw = await callGemini(prompt, 0.3);
        return parseJSON<PartsDemandForecast>(raw, {
            forecasts: [], trendAnalysis: 'Demand forecast unavailable.',
            totalEstimatedSpend: 0,
        });
    }

    /**
     * Autonomous KPI Commentary — generate "So What?" annotations for dashboard charts.
     * Temperature: 0.4 (narrative/creative style for executive audiences).
     */
    async generateKPICommentary(context: {
        kpiName: string;
        currentValue: number;
        previousValue: number;
        unit: string;
        benchmarkValue?: number;
        benchmarkSource?: string;
        relatedMetrics?: { name: string; value: number; unit: string }[];
        period?: string;
    }): Promise<KPIAnnotationData> {
        const changePercent = context.previousValue !== 0
            ? ((context.currentValue - context.previousValue) / Math.abs(context.previousValue)) * 100
            : 0;
        const trend: 'improving' | 'stable' | 'declining' =
            Math.abs(changePercent) < 2 ? 'stable' : changePercent > 0 ? 'improving' : 'declining';

        const prompt = `You are an ISO 55000 asset management executive advisor. Generate a brief, insightful "So What?" commentary for this KPI.

KPI: ${context.kpiName}
Current Value: ${context.currentValue}${context.unit}
Previous Period: ${context.previousValue}${context.unit} (${changePercent > 0 ? '+' : ''}${changePercent.toFixed(1)}% change)
Period: ${context.period || 'Month-over-Month'}
${context.benchmarkValue ? `Industry Benchmark: ${context.benchmarkValue}${context.unit} (${context.benchmarkSource || 'ISO 55000'})` : ''}
${context.relatedMetrics ? `Related Metrics:\n${context.relatedMetrics.map(m => `- ${m.name}: ${m.value}${m.unit}`).join('\n')}` : ''}

Generate:
1. A 1-2 sentence executive commentary explaining what this trend MEANS for the business (not just restating the number)
2. Whether action is required
3. If action is required, suggest a specific next step

Keep the tone authoritative but concise — this appears as a tooltip annotation.

Respond as JSON:
{
  "kpiName": "${context.kpiName}",
  "currentValue": "${context.currentValue}${context.unit}",
  "trend": "improving|stable|declining",
  "commentary": "Executive-level insight...",
  "actionRequired": true|false,
  "suggestedAction": "Specific action or null"
}`;

        const raw = await callGemini(prompt, 0.4);
        return parseJSON<KPIAnnotationData>(raw, {
            kpiName: context.kpiName,
            currentValue: `${context.currentValue}${context.unit}`,
            trend,
            commentary: `${context.kpiName} is ${trend} at ${context.currentValue}${context.unit}.`,
            actionRequired: trend === 'declining',
            suggestedAction: trend === 'declining' ? 'Review and investigate root cause.' : undefined,
        });
    }

    /**
     * Enhanced NL-to-SQL with full ERS schema awareness.
     * Extends the existing generateNLQuery with richer schema context
     * and visualization recommendations.
     */
    async generateEnhancedNLQuery(context: {
        naturalLanguage: string;
        userRole?: string;
        siteScope?: string;
    }): Promise<NLQueryResult & { suggestedVisualization?: 'table' | 'bar' | 'pie' | 'line' | 'gauge' }> {
        const fullSchema = `
Available ERS Tables & Key Columns:
- assets: id, tag, name, hierarchy_level, criticality(A/B/C), status, manufacturer, model, location, install_date, parent_id
- work_orders: id, title, status(OPEN/PLAN/EXEC/TECO/CLOSED), work_type(PM/CM/PdM/EM), priority, asset_id, assigned_to, est_cost, actual_cost, created_at, closed_at
- work_requests: id, title, status, priority, asset_id, reported_by, created_at
- recurring_work: id, code, title, status, asset_id, schedule_type, frequency_interval, frequency_unit, active
- inventory: id, part_number, description, qty_on_hand, min_level, max_level, unit_cost, warehouse, lead_time_days
- contacts: id, first_name, last_name, role, department, site, email, active
- dictionaries: id, type, code, description, active
- wo_failure_data: id, work_order_id, failure_mode_code, failure_cause_code, remedy_code
- ers_fmea_items: id, worksheet_id, failure_mode, failure_cause, severity, occurrence, detection, rpn
- ers_rcm_studies: id, asset_id, title, status, study_type
- ers_agent_actions: id, agent_type, status, asset_id, draft_payload, created_at`;

        const prompt = `You are a database query generator for the ERS Enterprise Asset Management system. Convert the user's question into a safe, read-only PostgreSQL query.

User Question: "${context.naturalLanguage}"
${context.userRole ? `User Role: ${context.userRole}` : ''}
${context.siteScope ? `Site Scope: ${context.siteScope}` : ''}

${fullSchema}

Rules:
1. ONLY generate SELECT queries — no INSERT, UPDATE, DELETE, DROP, ALTER
2. Use PostgreSQL syntax with proper JOINs
3. Always LIMIT 100 unless the user asks for a count/aggregate
4. Use meaningful column aliases
5. For time-based queries, use CURRENT_DATE and interval arithmetic
6. Suggest the best visualization type for the result shape
7. Explain the query in plain English

Respond as JSON:
{
  "interpretedIntent": "What the user is asking for",
  "sqlQuery": "SELECT ... FROM ... WHERE ... LIMIT 100",
  "explanation": "Plain English explanation",
  "suggestedFilters": [{ "field": "column_name", "operator": "=|>|<|LIKE|IN", "value": "..." }],
  "confidence": <0-1>,
  "suggestedVisualization": "table|bar|pie|line|gauge"
}`;

        const raw = await callGemini(prompt, 0.2);
        return parseJSON<NLQueryResult & { suggestedVisualization?: 'table' | 'bar' | 'pie' | 'line' | 'gauge' }>(raw, {
            interpretedIntent: 'Unable to interpret query.',
            sqlQuery: '', explanation: '',
            suggestedFilters: [], confidence: 0,
            suggestedVisualization: 'table',
        });
    }
}

// ─── Agentic Response Types ─────────────────────────────────

export interface WorkRequestDraft {
    title: string;
    description: string;
    work_type: string;
    priority: string;
    suggested_failure_mode: string;
    suggested_failure_cause: string;
    estimated_hours: number;
    rpn_rationale: string;
    recommended_craft: string;
}

export interface BadActorRCASummary {
    problem_statement: string;
    why_branches: string[];
    fishbone_categories: Record<string, string[]>;
    evidence_checklist: string[];
    priority: string;
    dominant_failure_mode: string;
    estimated_annual_impact: number;
}

export const aiEngine = AIAnalysisEngine.getInstance();
