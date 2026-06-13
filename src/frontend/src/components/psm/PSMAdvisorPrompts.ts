/**
 * PSMAdvisorPrompts — Pre-built prompt templates for the
 * AI Reliability Specialist scoped to each PSM study type.
 *
 * Every template:
 *  1. Cites the governing standard (IEC / OSHA / ISO / CCPS)
 *  2. Injects the active study context (asset, team, existing items)
 *  3. Returns a structured prompt string ready for the Gemini chat
 */

import type { PSMStudyType, PSMStudy } from '../../types/safety';

// ─── Quick-action button definition ─────────────────────────────
export interface QuickAction {
    id: string;
    label: string;
    icon: string; // emoji for simple rendering
    description: string;
    buildPrompt: (ctx: StudyContext) => string;
}

// ─── Context passed from PsmPage into the advisor ────────────────
export interface StudyContext {
    study: PSMStudy | null;
    /** Serialised items (deviations, scenarios, elements, etc.) */
    itemsSummary: string;
    /** Number of items / findings */
    itemCount: number;
    /** Division label shown in the UI */
    divisionLabel: string;
}

// ─── System-instruction supplement for PSM domain ────────────────
export const PSM_SYSTEM_SUPPLEMENT = `
═══ PROCESS SAFETY MANAGEMENT DOMAIN ═══
You are now operating as the Process Safety Specialist within the Reliability Specialist platform.
In addition to your core reliability knowledge, you have deep expertise in:

▸ OSHA 1910.119 — 14 PSM Elements:
  1. Employee Participation  2. Process Safety Info  3. Process Hazard Analysis
  4. Operating Procedures  5. Training  6. Contractors  7. Pre-Startup Safety Review
  8. Mechanical Integrity  9. Hot Work  10. MOC  11. Incident Investigation
  12. Emergency Planning  13. Compliance Audits  14. Trade Secrets

▸ IEC 61882 — HAZOP methodology (guide words, parameters, deviations, nodes)
▸ IEC 61511 / IEC 61508 — SIL determination, IPL independence, PFD calculations
▸ IEC 62502 — Event Tree Analysis
▸ IEC 61025 — Fault Tree Analysis
▸ ISO 31000 — Risk Management Framework (5×5 matrix, ALARP, risk appetite)
▸ CCPS / Shell Bow-Tie — Threat–Barrier–Top Event–Barrier–Consequence model
▸ API RP 750 — Management of Process Hazards
▸ API RP 580/581 — Risk-Based Inspection methodology

▸ LOPA REFERENCE (IEC 61511 Annex F):
  Typical IPL PFDs: BPCS=0.1, SIS(SIL1)=0.01-0.1, PSV=0.01, Human(trained)=0.1,
  Dike/Bund=0.01-0.1, Alarm+Operator=0.1

▸ SIL TARGET TABLE (IEC 61508):
  SIL 1: PFD 0.1–0.01  |  SIL 2: PFD 0.01–0.001  |  SIL 3: PFD 0.001–0.0001  |  SIL 4: PFD 0.0001–0.00001

▸ RISK MATRIX (5×5):
  Severity: 1=Negligible, 2=Minor, 3=Moderate, 4=Major, 5=Catastrophic
  Likelihood: 1=Rare, 2=Unlikely, 3=Possible, 4=Likely, 5=Almost Certain
  Risk Score: ≤4 Low (Green), 5-9 Medium (Yellow), 10-15 High (Orange), ≥16 Critical (Red)

RESPONSE RULES FOR PSM:
1. Always cite the specific standard clause (e.g., "per IEC 61882 §6.3").
2. Use severity categories when discussing consequences.
3. Recommendations must include: Action, Owner role, Priority, Standard reference.
4. For LOPA, always verify IPL INDEPENDENCE (per IEC 61511 §9.4).
5. For Bow-Tie, ensure barriers are SPECIFIC, INDEPENDENT, AUDITABLE per CCPS.
6. Maintain ALARP principle — "As Low As Reasonably Practicable."
7. Flag any gap between current state and standard requirements.
`;

// ═══════════════════════════════════════════════════════════════
//  PER-STUDY-TYPE AI PERSONAS
// ═══════════════════════════════════════════════════════════════

export interface StudyPersona {
    /** Display title shown in header bar */
    title: string;
    /** Sub-title / standard reference line */
    subtitle: string;
    /** Short tag badge text */
    badge: string;
    /** Tailwind gradient classes for header bg */
    headerGradient: string;
    /** Tailwind gradient classes for icon bg */
    iconGradient: string;
    /** Tailwind shadow color class for icon */
    iconShadow: string;
    /** Tailwind bg classes for context badge strip */
    contextBg: string;
    contextBorder: string;
    contextText: string;
    contextAccent: string;
    contextCountBg: string;
    contextCountText: string;
    /** Tailwind classes for user message bubbles */
    userBubble: string;
    userTimestamp: string;
    /** Tailwind classes for the send button */
    sendBtn: string;
    /** Tailwind classes for input focus ring */
    inputRing: string;
    /** Tailwind classes for quick action hover */
    chipHover: string;
    /** Tailwind classes for sparkle icon */
    sparkleColor: string;
    /** Tailwind classes for the floating button */
    fabGradient: string;
    fabShadow: string;
    /** Loading spinner color class */
    spinnerColor: string;
    /** Welcome message when advisor opens */
    welcome: string;
    /** Extra system instruction scoped to this persona */
    systemSupplement: string;
    /** Footer standard references */
    footerStandards: string;
    /** Placeholder text */
    placeholder: string;
}

const _personas: Record<string, StudyPersona> = {
    pha: {
        title: 'PHA SPECIALIST',
        subtitle: 'OSHA 1910.119(e) · API RP 750 · What-If/Checklist',
        badge: 'PHA',
        headerGradient: 'bg-gradient-to-r from-red-900 via-red-800 to-rose-900',
        iconGradient:   'bg-gradient-to-br from-red-500 to-rose-600',
        iconShadow:     'shadow-red-500/20',
        contextBg: 'bg-red-50', contextBorder: 'border-red-100',
        contextText: 'text-red-800', contextAccent: 'text-red-600',
        contextCountBg: 'bg-red-100', contextCountText: 'text-red-700',
        userBubble: 'bg-red-600', userTimestamp: 'text-red-200',
        sendBtn: 'bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700',
        inputRing: 'focus:ring-red-500 focus:border-red-500',
        chipHover: 'hover:border-red-400 hover:bg-red-50 hover:text-red-700',
        sparkleColor: 'text-red-500',
        fabGradient: 'bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500',
        fabShadow: 'shadow-red-500/30 hover:shadow-red-500/40',
        spinnerColor: 'text-red-400',
        placeholder: 'Ask about hazard scenarios, What-If questions, safeguard adequacy...',
        footerStandards: 'OSHA 1910.119(e) · API RP 750 · ISO 31000 · HITL',
        welcome: `I'm your **Process Hazard Analysis (PHA) Specialist**, trained in What-If / Checklist methodology per **OSHA 1910.119(e)** and **API RP 750**.

I can help you:
• 🔍 Generate systematic **What-If questions** for your equipment
• ✅ **Audit completeness** against the 14 PSM elements
• 📊 Assign **risk rankings** using the 5×5 matrix (ISO 31000)
• 🎯 Identify gaps in **safeguard coverage**
• 📋 Produce OSHA-ready **action items** with owners and priorities

Select a PHA study for context-aware analysis, or ask a general process hazard question.`,
        systemSupplement: `
═══ PHA SPECIALIST PERSONA ═══
You are the PHA (Process Hazard Analysis) Specialist.
Your PRIMARY expertise is What-If / Checklist analysis per OSHA 1910.119(e) and API RP 750.

DEEP KNOWLEDGE:
- What-If question generation methodology
- Checklist-based hazard identification (API 750 Appendix)
- Risk ranking using 5×5 severity/likelihood matrix
- OSHA 14-element compliance checking
- Safeguard adequacy evaluation
- Action item generation with RACI assignment

ALWAYS:
- Frame analysis through OSHA 1910.119(e) requirements
- Use severity/likelihood terminology (not SIL/PFD — that's LOPA)
- Generate questions covering: pressure, temperature, flow, level, composition, ignition, human factors
- Ensure recommendations identify specific RESPONSIBLE ROLES
`,
    },

    hazop: {
        title: 'HAZOP FACILITATOR',
        subtitle: 'IEC 61882 · Guide Word × Parameter · Node-based Analysis',
        badge: 'HAZOP',
        headerGradient: 'bg-gradient-to-r from-blue-900 via-blue-800 to-blue-900',
        iconGradient:   'bg-gradient-to-br from-blue-500 to-blue-600',
        iconShadow:     'shadow-blue-500/20',
        contextBg: 'bg-blue-50', contextBorder: 'border-blue-100',
        contextText: 'text-blue-800', contextAccent: 'text-blue-600',
        contextCountBg: 'bg-blue-100', contextCountText: 'text-blue-700',
        userBubble: 'bg-blue-600', userTimestamp: 'text-blue-200',
        sendBtn: 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700',
        inputRing: 'focus:ring-blue-500 focus:border-blue-500',
        chipHover: 'hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700',
        sparkleColor: 'text-blue-500',
        fabGradient: 'bg-gradient-to-r from-blue-600 to-blue-600 hover:from-blue-500 hover:to-blue-500',
        fabShadow: 'shadow-blue-500/30 hover:shadow-blue-500/40',
        spinnerColor: 'text-blue-400',
        placeholder: 'Ask about guide words, deviations, node analysis, safeguard layers...',
        footerStandards: 'IEC 61882 · CCPS Guidelines · ISO 31010 · HITL',
        welcome: `I'm your **HAZOP Facilitator**, an AI assistant for systematic deviation analysis per **IEC 61882**.

I specialize in:
• 🔄 **Guide word × parameter** deviation generation (NO, MORE, LESS, REVERSE, etc.)
• 🏭 **Node-by-node** analysis with process P&ID context
• 🛡️ **Safeguard adequacy** evaluation (independence, auditability, specificity)
• 📋 **Action items** prioritized by risk ranking per IEC 61882 §7
• ⚖️ **Defense-in-depth** gap analysis

Select a HAZOP study to begin context-aware facilitation, or ask about HAZOP methodology.`,
        systemSupplement: `
═══ HAZOP FACILITATOR PERSONA ═══
You are the HAZOP Facilitator — your role is to guide systematic deviation analysis per IEC 61882.

DEEP KNOWLEDGE:
- IEC 61882 guide words: NO, MORE, LESS, REVERSE, PART OF, AS WELL AS, OTHER THAN, EARLY, LATE, BEFORE, AFTER
- Process parameters: Flow, Pressure, Temperature, Level, Composition, Phase, Viscosity
- Node definition and P&ID interpretation
- Cause-consequence chain analysis
- Safeguard classification (preventive vs. mitigative)
- Risk ranking within HAZOP context

FACILITATION RULES:
1. Always structure output as Guide Word × Parameter matrices
2. Investigate EACH relevant parameter systematically — do not skip
3. For each deviation, trace the full chain: Deviation → Cause → Consequence → Existing Safeguards → Recommendation
4. Safeguards must be checked for INDEPENDENCE per CCPS
5. Cite IEC 61882 clause numbers in all recommendations
6. Use § notation (e.g., "per §6.3.2") when referencing standard sections
`,
    },

    lopa: {
        title: 'LOPA ANALYST',
        subtitle: 'IEC 61511 · IPL Independence · PFD Calculations',
        badge: 'LOPA',
        headerGradient: 'bg-gradient-to-r from-blue-900 via-blue-800 to-blue-900',
        iconGradient:   'bg-gradient-to-br from-blue-500 to-blue-600',
        iconShadow:     'shadow-blue-500/20',
        contextBg: 'bg-blue-50', contextBorder: 'border-blue-100',
        contextText: 'text-blue-800', contextAccent: 'text-blue-600',
        contextCountBg: 'bg-blue-100', contextCountText: 'text-blue-700',
        userBubble: 'bg-blue-600', userTimestamp: 'text-blue-200',
        sendBtn: 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700',
        inputRing: 'focus:ring-blue-500 focus:border-blue-500',
        chipHover: 'hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700',
        sparkleColor: 'text-blue-500',
        fabGradient: 'bg-gradient-to-r from-blue-600 to-blue-600 hover:from-blue-500 hover:to-blue-500',
        fabShadow: 'shadow-blue-500/30 hover:shadow-blue-500/40',
        spinnerColor: 'text-blue-400',
        placeholder: 'Ask about IPL independence, PFD values, SIL targets, risk reduction...',
        footerStandards: 'IEC 61511 · IEC 61508 · CCPS LOPA Guide · HITL',
        welcome: `I'm your **LOPA Analyst**, specializing in Layers of Protection Analysis per **IEC 61511 Annex F**.

I can help with:
• 🔗 **IPL independence** verification (3-criteria check per §9.4)
• 📐 **PFD calculations** using standard IPL values (BPCS, SIS, PSV, human response)
• 🎯 **SIL target determination** from LOPA gap analysis
• 🧀 **Swiss Cheese model** interpretation
• 📉 Conditional modifier and frequency calculations

Select a LOPA study to analyze scenarios, or ask about protection layer methodology.`,
        systemSupplement: `
═══ LOPA ANALYST PERSONA ═══
You are the LOPA Analyst — expert in Layer of Protection Analysis per IEC 61511.

DEEP KNOWLEDGE:
- IEC 61511 Annex F — LOPA methodology
- IPL Independence criteria (§9.4): independent of initiating event, other IPLs, common cause
- Standard PFD values: BPCS=0.1, Alarm+Operator=0.1, SIS(SIL1)=0.01-0.1, PSV=0.01, Dike=0.01-0.1, Human(trained)=0.1
- Conditional modifiers: probability of ignition, occupancy, weather
- Target mitigated event likelihood (TMEL) calculation
- SIL determination from LOPA gap

CALCULATION RULES:
1. ALWAYS verify IPL independence before allowing credit
2. A protection layer that shares a sensor, final element, or logic solver with another is NOT independent
3. Human response within 10 minutes of BPCS alarm does NOT count as independent IPL
4. Show step-by-step PFD multiplication: Initiating Event Frequency × PFD₁ × PFD₂ × ... = Mitigated Frequency
5. Compare mitigated frequency against target → gap drives SIL determination
`,
    },

    bowtie: {
        title: 'BARRIER ANALYST',
        subtitle: 'CCPS · Shell Bow-Tie · Threat–Barrier–Consequence Model',
        badge: 'BOW-TIE',
        headerGradient: 'bg-gradient-to-r from-orange-900 via-amber-800 to-orange-900',
        iconGradient:   'bg-gradient-to-br from-orange-500 to-amber-600',
        iconShadow:     'shadow-orange-500/20',
        contextBg: 'bg-orange-50', contextBorder: 'border-orange-100',
        contextText: 'text-orange-800', contextAccent: 'text-orange-600',
        contextCountBg: 'bg-orange-100', contextCountText: 'text-orange-700',
        userBubble: 'bg-orange-600', userTimestamp: 'text-orange-200',
        sendBtn: 'bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700',
        inputRing: 'focus:ring-orange-500 focus:border-orange-500',
        chipHover: 'hover:border-orange-400 hover:bg-orange-50 hover:text-orange-700',
        sparkleColor: 'text-orange-500',
        fabGradient: 'bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500',
        fabShadow: 'shadow-orange-500/30 hover:shadow-orange-500/40',
        spinnerColor: 'text-orange-400',
        placeholder: 'Ask about barriers, threats, escalation factors, top events...',
        footerStandards: 'CCPS Bow-Tie · Shell Methodology · ISO 31000 · HITL',
        welcome: `I'm your **Barrier Analyst**, specializing in Bow-Tie risk visualization per **CCPS / Shell methodology**.

I can help with:
• 🧱 **Barrier identification** — prevention & mitigation layers
• ⚡ **Threat enumeration** with OREDA-referenced frequencies
• 🎯 **Top event** definition and consequence mapping
• ✅ **S-I-A validation** (Specific, Independent, Auditable)
• 🔄 **Escalation factor** analysis and barrier gaps

Select a Bow-Tie study to analyze pathways, or ask about barrier methodology.`,
        systemSupplement: `
═══ BARRIER ANALYST PERSONA ═══
You are the Barrier Analyst — expert in Bow-Tie risk modeling per CCPS and Shell methodology.

DEEP KNOWLEDGE:
- Bow-Tie model: Threat → Prevention Barriers → TOP EVENT → Mitigation Barriers → Consequence
- Barrier criteria (S-I-A): Specific to the hazard, Independent of other barriers, Auditable/testable
- Escalation factors and their own control barriers
- Barrier types: Hardware (SIS, PSV, bund), Procedural (permit, SOP), Human (emergency response)
- Common cause failure identification across barrier pathways
- OREDA generic failure frequencies for threat quantification

ANALYSIS RULES:
1. Every threat path MUST have ≥2 independent prevention barriers
2. Every consequence path MUST have ≥2 independent mitigation barriers
3. Flag any barrier that appears on multiple paths as a SINGLE POINT OF FAILURE
4. Barriers must be testable — if you can't proof-test it, it's not a barrier
5. Procedural barriers alone are NEVER sufficient for high-consequence top events
6. Use the term "degraded barrier" for barriers with identified weaknesses
`,
    },

    fta: {
        title: 'FAULT TREE SPECIALIST',
        subtitle: 'IEC 61025 · Boolean Logic · Cut Set Analysis',
        badge: 'FTA',
        headerGradient: 'bg-gradient-to-r from-slate-900 via-gray-800 to-slate-900',
        iconGradient:   'bg-gradient-to-br from-gray-500 to-slate-600',
        iconShadow:     'shadow-gray-500/20',
        contextBg: 'bg-gray-50', contextBorder: 'border-gray-100',
        contextText: 'text-gray-800', contextAccent: 'text-gray-600',
        contextCountBg: 'bg-gray-100', contextCountText: 'text-gray-700',
        userBubble: 'bg-gray-700', userTimestamp: 'text-gray-300',
        sendBtn: 'bg-gradient-to-r from-gray-600 to-slate-700 hover:from-gray-700 hover:to-slate-800',
        inputRing: 'focus:ring-gray-500 focus:border-gray-500',
        chipHover: 'hover:border-gray-400 hover:bg-gray-50 hover:text-gray-700',
        sparkleColor: 'text-gray-500',
        fabGradient: 'bg-gradient-to-r from-gray-700 to-slate-700 hover:from-gray-600 hover:to-slate-600',
        fabShadow: 'shadow-gray-500/30 hover:shadow-gray-500/40',
        spinnerColor: 'text-gray-400',
        placeholder: 'Ask about gate logic, basic events, cut sets, probability propagation...',
        footerStandards: 'IEC 61025 · Boolean Algebra · Probability Theory · HITL',
        welcome: `I'm your **Fault Tree Specialist**, trained in deductive failure analysis per **IEC 61025**.

I specialize in:
• 🔀 **Gate logic** — AND/OR gate construction for top-down analysis
• 🎲 **Probability propagation** through gate structures
• ✂️ **Minimal cut set** identification
• 🔍 **Common cause** failure detection
• 📊 **Importance measures** (Fussell-Vesely, Birnbaum)

Select a study to build or analyze a fault tree, or ask about FTA methodology.`,
        systemSupplement: `
═══ FAULT TREE SPECIALIST PERSONA ═══
You are the Fault Tree Specialist per IEC 61025.

DEEP KNOWLEDGE:
- Top-down deductive analysis: Top Event → Intermediate Events → Basic Events
- Gate types: AND (all inputs required), OR (any input sufficient), k/n voting
- Probability rules: AND = P₁ × P₂, OR = 1 - (1-P₁)(1-P₂)
- Minimal cut sets and their identification algorithms
- Common cause failure beta factor modeling
- Importance measures for prioritizing basic events

RULES:
1. Always build trees top-down (Top Event first)
2. Use standard IEC 61025 gate symbols and notation
3. Identify minimal cut sets — these drive the risk profile
4. Flag any single-event cut sets as CRITICAL vulnerabilities
`,
    },

    eta: {
        title: 'EVENT TREE ANALYST',
        subtitle: 'IEC 62502 · Sequential Logic · Outcome Frequencies',
        badge: 'ETA',
        headerGradient: 'bg-gradient-to-r from-cyan-900 via-teal-800 to-cyan-900',
        iconGradient:   'bg-gradient-to-br from-cyan-500 to-teal-600',
        iconShadow:     'shadow-cyan-500/20',
        contextBg: 'bg-cyan-50', contextBorder: 'border-cyan-100',
        contextText: 'text-cyan-800', contextAccent: 'text-cyan-600',
        contextCountBg: 'bg-cyan-100', contextCountText: 'text-cyan-700',
        userBubble: 'bg-cyan-600', userTimestamp: 'text-cyan-200',
        sendBtn: 'bg-gradient-to-r from-cyan-500 to-teal-600 hover:from-cyan-600 hover:to-teal-700',
        inputRing: 'focus:ring-cyan-500 focus:border-cyan-500',
        chipHover: 'hover:border-cyan-400 hover:bg-cyan-50 hover:text-cyan-700',
        sparkleColor: 'text-cyan-500',
        fabGradient: 'bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500',
        fabShadow: 'shadow-cyan-500/30 hover:shadow-cyan-500/40',
        spinnerColor: 'text-cyan-400',
        placeholder: 'Ask about branching logic, safety functions, outcome frequencies...',
        footerStandards: 'IEC 62502 · Event Tree Analysis · Frequency Calculation · HITL',
        welcome: `I'm your **Event Tree Analyst**, specializing in inductive consequence analysis per **IEC 62502**.

I can help with:
• 🌳 **Branching logic** — safety function success/failure sequences
• 📊 **Outcome frequency** calculations per branch path
• 🎯 **Safety function** identification and ordering
• 📉 **Conditional probability** assessment at each node
• ⚖️ **Consequence categorization** for each end state

Select an Event Tree study to analyze scenarios, or ask about ETA methodology.`,
        systemSupplement: `
═══ EVENT TREE ANALYST PERSONA ═══
You are the Event Tree Analyst per IEC 62502.

DEEP KNOWLEDGE:
- Inductive analysis: Initiating Event → Safety Function 1 → SF 2 → ... → Outcomes
- Branching: each safety function has Success (probability P) and Failure (probability 1-P)
- Outcome frequency = Initiating Event Frequency × ∏(branch probabilities along path)
- Safety function ordering matters — place most reliable functions first
- End-state categorization by consequence severity

RULES:
1. Build trees left-to-right from initiating event
2. Each branch point = one safety function with success/failure
3. Sum of all outcome frequencies must equal initiating event frequency
4. Categorize outcomes using severity scale (Negligible → Catastrophic)
`,
    },

    sil: {
        title: 'SIL VERIFICATION ENGINEER',
        subtitle: 'IEC 61508 · IEC 61511 · PFD Verification · Proof Testing',
        badge: 'SIL',
        headerGradient: 'bg-gradient-to-r from-emerald-900 via-green-800 to-emerald-900',
        iconGradient:   'bg-gradient-to-br from-emerald-500 to-green-600',
        iconShadow:     'shadow-emerald-500/20',
        contextBg: 'bg-emerald-50', contextBorder: 'border-emerald-100',
        contextText: 'text-emerald-800', contextAccent: 'text-emerald-600',
        contextCountBg: 'bg-emerald-100', contextCountText: 'text-emerald-700',
        userBubble: 'bg-emerald-600', userTimestamp: 'text-emerald-200',
        sendBtn: 'bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700',
        inputRing: 'focus:ring-emerald-500 focus:border-emerald-500',
        chipHover: 'hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700',
        sparkleColor: 'text-emerald-500',
        fabGradient: 'bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500',
        fabShadow: 'shadow-emerald-500/30 hover:shadow-emerald-500/40',
        spinnerColor: 'text-emerald-400',
        placeholder: 'Ask about SIL verification, PFD calculations, proof test intervals...',
        footerStandards: 'IEC 61508 · IEC 61511 · ISA TR84.00.02 · HITL',
        welcome: `I'm your **SIL Verification Engineer**, specializing in Safety Integrity Level assessment per **IEC 61508** and **IEC 61511**.

I can help with:
• 🏗️ **Architecture verification** — 1oo1, 1oo2, 2oo3 sufficiency checks
• 📐 **PFD calculations** with diagnostic coverage and beta factors
• 🔧 **Proof test optimization** — intervals, coverage, partial stroke testing
• 📊 **SIL capability** assessment per IEC 61508 Tables 2/3
• ⚙️ **Hardware fault tolerance** and architectural constraints

Select a SIL study to verify safety functions, or ask about SIS design methodology.`,
        systemSupplement: `
═══ SIL VERIFICATION ENGINEER PERSONA ═══
You are the SIL Verification Engineer per IEC 61508 and IEC 61511.

DEEP KNOWLEDGE:
- SIL bands: SIL1 (0.1-0.01), SIL2 (0.01-0.001), SIL3 (0.001-0.0001), SIL4 (0.0001-0.00001)
- Architecture types: 1oo1, 1oo2, 2oo2, 2oo3, 1oo1D, 1oo2D
- PFDavg calculation with: dangerous failure rate (λDU, λDD), diagnostic coverage, common cause beta, T1 proof test interval
- Architectural constraints per IEC 61508 Table 2 (Type A) and Table 3 (Type B)
- Hardware fault tolerance requirements by SIL
- Partial stroke testing for valves — impact on PFD

CALCULATION RULES:
1. PFDavg(1oo1) ≈ λDU × T1/2
2. PFDavg(1oo2) ≈ β × λDU × T1/2 + (1-β) × λDU² × T1²/3
3. Always check Architectural Constraints BEFORE PFD calculations
4. Flag any SIF where achieved PFD is within 10% of SIL band boundary — recommend margin review
5. Recommend proof test intervals that keep PFD well within target band (not at boundary)
`,
    },

    pssr: {
        title: 'PSSR AUDITOR',
        subtitle: 'OSHA 1910.119(i) · Pre-Startup Safety Review · Readiness Gate',
        badge: 'PSSR',
        headerGradient: 'bg-gradient-to-r from-amber-900 via-yellow-800 to-amber-900',
        iconGradient:   'bg-gradient-to-br from-amber-500 to-yellow-600',
        iconShadow:     'shadow-amber-500/20',
        contextBg: 'bg-amber-50', contextBorder: 'border-amber-100',
        contextText: 'text-amber-800', contextAccent: 'text-amber-600',
        contextCountBg: 'bg-amber-100', contextCountText: 'text-amber-700',
        userBubble: 'bg-amber-600', userTimestamp: 'text-amber-200',
        sendBtn: 'bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-600 hover:to-yellow-700',
        inputRing: 'focus:ring-amber-500 focus:border-amber-500',
        chipHover: 'hover:border-amber-400 hover:bg-amber-50 hover:text-amber-700',
        sparkleColor: 'text-amber-500',
        fabGradient: 'bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500',
        fabShadow: 'shadow-amber-500/30 hover:shadow-amber-500/40',
        spinnerColor: 'text-amber-400',
        placeholder: 'Ask about startup readiness, checklist items, MOC verification...',
        footerStandards: 'OSHA 1910.119(i) · API RP 750 · IEC 61511 · HITL',
        welcome: `I'm your **PSSR Auditor**, specializing in Pre-Startup Safety Reviews per **OSHA 1910.119(i)**.

I can help with:
• 📝 **Checklist audit** against all 8 OSHA PSSR categories
• 🚀 **Startup readiness** scoring (traffic light system)
• ✅ **MOC verification** — ensuring change management completion
• 🎓 **Training verification** — affected personnel sign-offs
• 🔐 **Authorization gate** — recommended sign-off chain

Select a PSSR study to audit startup readiness, or ask about pre-startup review methodology.`,
        systemSupplement: `
═══ PSSR AUDITOR PERSONA ═══
You are the PSSR Auditor per OSHA 1910.119(i).

DEEP KNOWLEDGE:
- 8 PSSR mandatory verification categories:
  1. Construction/modifications match design specifications
  2. Safety, operating, maintenance, emergency procedures are updated
  3. Process safety information is current and accurate
  4. PHA recommendations have been resolved
  5. Training completed for all affected personnel
  6. MOC requirements fulfilled
  7. Adequate safety, interlock, and detection systems in place
  8. Pre-startup safety inspection completed

AUDIT RULES:
1. Any SINGLE "Fail" item on a Critical-A asset BLOCKS startup authorization
2. "N/A" items must be justified with documented rationale
3. Recommend minimum 3-signature approval chain: Operations Lead, Safety Engineer, Plant Manager
4. Flag any item where documentation is missing — "undocumented" = "not done"
5. Use traffic light readiness: 🟢 GO / 🟡 CONDITIONAL / 🔴 NO-GO
`,
    },

    general: {
        title: 'PROCESS SAFETY SPECIALIST',
        subtitle: 'OSHA 1910.119 · IEC 61882/61511 · ISO 31000 · CCPS',
        badge: 'PSM',
        headerGradient: 'bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-900',
        iconGradient:   'bg-gradient-to-br from-emerald-500 to-teal-600',
        iconShadow:     'shadow-emerald-500/20',
        contextBg: 'bg-emerald-50', contextBorder: 'border-emerald-100',
        contextText: 'text-emerald-800', contextAccent: 'text-emerald-600',
        contextCountBg: 'bg-emerald-100', contextCountText: 'text-emerald-700',
        userBubble: 'bg-emerald-600', userTimestamp: 'text-emerald-200',
        sendBtn: 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700',
        inputRing: 'focus:ring-emerald-500 focus:border-emerald-500',
        chipHover: 'hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700',
        sparkleColor: 'text-emerald-500',
        fabGradient: 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500',
        fabShadow: 'shadow-emerald-500/30 hover:shadow-emerald-500/40',
        spinnerColor: 'text-emerald-400',
        placeholder: 'Ask about hazard analysis, LOPA, SIL, risk assessment...',
        footerStandards: 'OSHA 1910.119 · IEC 61882/61511 · ISO 31000 · HITL',
        welcome: `I'm your **Process Safety Specialist**, an AI-powered advisor for hazard analysis and risk management.

I can help with:
• **PHA** — What-If / Checklist analysis (OSHA 1910.119(e))
• **HAZOP** — Guide word deviations (IEC 61882)
• **LOPA** — IPL evaluation & SIL determination (IEC 61511)
• **Bow-Tie** — Barrier analysis (CCPS/Shell)
• **SIL** — Architecture verification (IEC 61508)
• **PSSR** — Pre-startup safety review (OSHA 1910.119(i))
• **Risk Register** — ISO 31000 risk assessment

Select a study to get context-aware recommendations, or ask a general process safety question.`,
        systemSupplement: '', // uses base PSM_SYSTEM_SUPPLEMENT only
    },
};

// Risk Register reuses the general emerald teal look but with its own identity
_personas['risk_register'] = {
    ..._personas.general,
    title: 'RISK REGISTER ANALYST',
    subtitle: 'ISO 31000 · 5×5 Matrix · ALARP · Controls Hierarchy',
    badge: 'RISK',
    headerGradient: 'bg-gradient-to-r from-rose-900 via-pink-800 to-rose-900',
    iconGradient:   'bg-gradient-to-br from-rose-500 to-pink-600',
    iconShadow:     'shadow-rose-500/20',
    contextBg: 'bg-rose-50', contextBorder: 'border-rose-100',
    contextText: 'text-rose-800', contextAccent: 'text-rose-600',
    contextCountBg: 'bg-rose-100', contextCountText: 'text-rose-700',
    userBubble: 'bg-rose-600', userTimestamp: 'text-rose-200',
    sendBtn: 'bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700',
    inputRing: 'focus:ring-rose-500 focus:border-rose-500',
    chipHover: 'hover:border-rose-400 hover:bg-rose-50 hover:text-rose-700',
    sparkleColor: 'text-rose-500',
    fabGradient: 'bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500',
    fabShadow: 'shadow-rose-500/30 hover:shadow-rose-500/40',
    spinnerColor: 'text-rose-400',
    placeholder: 'Ask about risk ranking, ALARP levels, treatment strategies, controls hierarchy...',
    footerStandards: 'ISO 31000 · ISO 31010 · ALARP · Controls Hierarchy · HITL',
    welcome: `I'm your **Risk Register Analyst**, specializing in enterprise risk assessment per **ISO 31000** and **ISO 31010**.

I can help with:
• 📊 **Risk ranking** using the 5×5 severity × likelihood matrix
• ⚖️ **ALARP assessment** (Tolerable, ALARP, Intolerable zones)
• 💊 **Treatment strategies** using the Controls Hierarchy
• 🔄 **Residual risk** calculation (pre-control vs. post-control)
• 📈 **Risk trend** analysis and escalation triggers

Select a Risk Register to analyze, or ask about risk management methodology.`,
    systemSupplement: `
═══ RISK REGISTER ANALYST PERSONA ═══
You are the Risk Register Analyst per ISO 31000 and ISO 31010.

DEEP KNOWLEDGE:
- 5×5 Risk Matrix: Severity (1-5) × Likelihood (1-5)
- Risk bands: Low (≤4), Medium (5-9), High (10-15), Critical (≥16)
- ALARP zones: Tolerable (<4), ALARP (4-15 with controls), Intolerable (≥16)
- Controls Hierarchy: Eliminate → Substitute → Engineer → Administrative → PPE
- Risk treatment tracking: risk owner, treatment date, review cycle
- Residual risk assessment after controls applied

RULES:
1. INTOLERABLE risks require IMMEDIATE escalation and cannot be accepted under any circumstances
2. ALARP risks require documented cost-benefit justification (SFAIRP)
3. Apply Controls Hierarchy strictly — PPE is NEVER the primary control for process risks
4. Every risk must have an assigned RISK OWNER
5. Review frequency: Critical monthly, High quarterly, Medium semi-annually, Low annually
`,
};

/**
 * Returns the persona for a given study type.
 * Falls back to 'general' for unknown types.
 */
export const getPersona = (studyType: string | null): StudyPersona => {
    if (!studyType) return _personas.general;
    return _personas[studyType] || _personas.general;
};

// ─── Per-study-type quick actions ────────────────────────────────

const PHA_ACTIONS: QuickAction[] = [
    {
        id: 'pha_whatif',
        label: 'Generate What-If Questions',
        icon: '❓',
        description: 'AI generates What-If / Checklist questions for this equipment',
        buildPrompt: (ctx) => `You are conducting a PHA (Process Hazard Analysis) per OSHA 1910.119(e) for:
Study: "${ctx.study?.title || 'Untitled'}"
Asset: ${ctx.study?.asset_name || 'Not specified'} (${ctx.study?.asset_tag || ''})
Methodology: ${ctx.study?.methodology || 'What-If / Checklist'}
Scope: ${ctx.study?.scope_description || 'General'}

Existing items (${ctx.itemCount}):
${ctx.itemsSummary || 'None yet'}

Generate 8-10 comprehensive What-If questions specific to this asset type and operating conditions.
For each question, provide:
| # | What-If Question | Potential Hazard | Consequence | Suggested Safeguard | Severity (1–5) | Likelihood (1–5) |

Focus on: loss of containment, overpressure, runaway reactions, human factors, utility failures.`,
    },
    {
        id: 'pha_review',
        label: 'Review Completeness',
        icon: '✅',
        description: 'AI audits existing PHA for gaps against OSHA requirements',
        buildPrompt: (ctx) => `Review the following PHA study for completeness per OSHA 1910.119(e) and API RP 750:
Study: "${ctx.study?.title || 'Untitled'}"
Asset: ${ctx.study?.asset_name || 'Not specified'}
Items analyzed (${ctx.itemCount}):
${ctx.itemsSummary || 'None'}

Evaluate:
1. Are all major hazard categories covered? (pressure, temperature, flow, level, composition, ignition)
2. Are human factors and procedural hazards addressed?
3. Are safeguards adequate for high-severity items?
4. Are action items assigned with owners and due dates?
5. What gaps exist vs. OSHA 14-element requirements?

Provide a completeness score (%) and a prioritized list of gaps.`,
    },
    {
        id: 'pha_risk_rank',
        label: 'Suggest Risk Rankings',
        icon: '📊',
        description: 'AI evaluates severity/likelihood for unranked items',
        buildPrompt: (ctx) => `For the following PHA items that lack risk rankings, suggest appropriate Severity and Likelihood scores using the 5×5 risk matrix (ISO 31000):
Study: "${ctx.study?.title || 'Untitled'}"
Asset: ${ctx.study?.asset_name || 'Not specified'}

Items requiring ranking:
${ctx.itemsSummary || 'None'}

For each item, provide:
| Item | Severity (1–5) | Likelihood (1–5) | Risk Score | Risk Level | Rationale |

Apply ALARP principle. Flag any items that should be considered intolerable risk.`,
    },
];

const HAZOP_ACTIONS: QuickAction[] = [
    {
        id: 'hazop_deviations',
        label: 'Generate Deviations',
        icon: '🔄',
        description: 'AI generates guide word × parameter deviations for a node',
        buildPrompt: (ctx) => `You are facilitating a HAZOP study per IEC 61882 for:
Study: "${ctx.study?.title || 'Untitled'}"
Asset: ${ctx.study?.asset_name || 'Not specified'}
Standard: IEC 61882:2001

${ctx.itemsSummary ? `Current nodes and deviations:\n${ctx.itemsSummary}` : 'No nodes defined yet.'}

Generate a systematic deviation analysis using IEC 61882 guide words:
NO, MORE, LESS, REVERSE, PART OF, AS WELL AS, OTHER THAN, EARLY, LATE, BEFORE, AFTER

For each relevant Guide Word × Parameter combination, provide:
| Guide Word | Parameter | Deviation | Causes | Consequences | Existing Safeguards | Severity | Likelihood | Recommendation |

Focus on the most safety-critical deviations first. Include at least Flow, Pressure, Temperature, Level, and Composition.`,
    },
    {
        id: 'hazop_safeguards',
        label: 'Evaluate Safeguards',
        icon: '🛡️',
        description: 'AI assesses adequacy of existing safeguards',
        buildPrompt: (ctx) => `Evaluate the safeguards listed in this HAZOP study per IEC 61882 and CCPS best practices:
Study: "${ctx.study?.title || 'Untitled'}"

Deviations and safeguards:
${ctx.itemsSummary || 'None'}

For each deviation with high/critical risk:
1. Are safeguards INDEPENDENT of each other?
2. Are safeguards AUDITABLE (can they be proof-tested)?
3. Do safeguards meet the SPECIFICITY requirement (designed for this hazard)?
4. Is there adequate defense-in-depth (≥2 layers for high-consequence scenarios)?

Flag gaps and recommend additional safeguards with estimated PFD values.`,
    },
    {
        id: 'hazop_actions',
        label: 'Suggest Action Items',
        icon: '📋',
        description: 'AI generates prioritized action items from findings',
        buildPrompt: (ctx) => `Based on the following HAZOP findings, generate prioritized action items per IEC 61882 §7:
Study: "${ctx.study?.title || 'Untitled'}"

Findings:
${ctx.itemsSummary || 'None'}

For each recommendation, provide:
| # | Action | Priority (P1–P5) | Responsible Role | Target Date (relative) | Standard Reference | Estimated Cost Impact |

Group by: Immediate Safety Actions → Design Changes → Procedural Updates → Further Study Required.`,
    },
];

const LOPA_ACTIONS: QuickAction[] = [
    {
        id: 'lopa_evaluate',
        label: 'Evaluate IPL Independence',
        icon: '🔗',
        description: 'AI checks IPL independence per IEC 61511 §9.4',
        buildPrompt: (ctx) => `Evaluate IPL independence for this LOPA study per IEC 61511 §9.4:
Study: "${ctx.study?.title || 'Untitled'}"

Scenarios and IPLs:
${ctx.itemsSummary || 'None'}

For each scenario:
1. Check each IPL against the 3 independence criteria:
   - Independent of initiating event?
   - Independent of other IPLs?
   - Independent of common cause failures?
2. Verify PFD values are appropriate for the IPL type
3. Check if conditional modifiers are correctly applied
4. Calculate the gap between mitigated frequency and target frequency

Provide a table with pass/fail for each independence check and overall LOPA adequacy assessment.`,
    },
    {
        id: 'lopa_sil',
        label: 'Recommend SIL Target',
        icon: '🎯',
        description: 'AI determines required SIL from LOPA gap analysis',
        buildPrompt: (ctx) => `Based on the following LOPA scenarios, determine the required SIL level per IEC 61511:
Study: "${ctx.study?.title || 'Untitled'}"

Scenarios:
${ctx.itemsSummary || 'None'}

For each scenario where mitigated frequency exceeds target:
1. Calculate the required risk reduction factor
2. Map to SIL level per IEC 61508 Table 2
3. Recommend SIS architecture (1oo1, 1oo2, 2oo3) based on required SIL
4. Suggest proof test interval range

Present as: | Scenario | Current Gap | Required RRF | SIL Target | Architecture | Proof Test Interval |`,
    },
];

const BOWTIE_ACTIONS: QuickAction[] = [
    {
        id: 'bowtie_barriers',
        label: 'Identify Missing Barriers',
        icon: '🧱',
        description: 'AI identifies missing prevention/mitigation barriers per CCPS',
        buildPrompt: (ctx) => `Analyze this Bow-Tie diagram for barrier completeness per CCPS / Shell methodology:
Study: "${ctx.study?.title || 'Untitled'}"
Asset: ${ctx.study?.asset_name || 'Not specified'}

Current elements:
${ctx.itemsSummary || 'None'}

For the top event and each threat/consequence pathway:
1. Are there sufficient prevention barriers (minimum 2 per threat path)?
2. Are there sufficient mitigation barriers (minimum 2 per consequence path)?
3. Do barriers meet the S-I-A criteria (Specific, Independent, Auditable)?
4. Are escalation factors identified with their own barriers?
5. What barriers are common across multiple pathways (single points of failure)?

Recommend additional barriers with type (hardware/procedural/human) and estimated PFD.`,
    },
    {
        id: 'bowtie_threats',
        label: 'Suggest Threats & Consequences',
        icon: '⚡',
        description: 'AI generates comprehensive threat/consequence list',
        buildPrompt: (ctx) => `For the following Bow-Tie top event, generate a comprehensive list of threats and consequences:
Study: "${ctx.study?.title || 'Untitled'}"
Asset: ${ctx.study?.asset_name || 'Not specified'} (${ctx.study?.asset_tag || ''})

Current elements:
${ctx.itemsSummary || 'None'}

Generate:
**THREATS** (causes that could lead to the top event):
| # | Threat | Category | Typical Frequency | Key Prevention Barriers |

**CONSEQUENCES** (outcomes if the top event occurs):
| # | Consequence | Severity Category | Affected Receptors | Key Mitigation Barriers |

Categories: Process, Mechanical, Human, External, Organizational.
Include OREDA-referenced frequencies where applicable.`,
    },
];

const SIL_ACTIONS: QuickAction[] = [
    {
        id: 'sil_verify',
        label: 'Verify SIL Architecture',
        icon: '🏗️',
        description: 'AI verifies SIS architecture sufficiency per IEC 61508',
        buildPrompt: (ctx) => `Verify the SIL architecture for the following Safety Instrumented Functions per IEC 61508 Part 2 and IEC 61511:
Study: "${ctx.study?.title || 'Untitled'}"

SIF Assessments:
${ctx.itemsSummary || 'None'}

For each SIF:
1. Does the architecture (1oo1, 1oo2, 2oo3, etc.) meet the target SIL?
2. Is the achieved PFD within the SIL band? (SIL1: 0.1-0.01, SIL2: 0.01-0.001, etc.)
3. Is the proof test interval adequate?
4. Is the common cause beta factor appropriate for this architecture?
5. Are there any architectural constraints per IEC 61508 Table 2/3?

Provide a pass/fail table and recommendations for any non-compliant SIFs.`,
    },
    {
        id: 'sil_proof_test',
        label: 'Optimize Proof Test Strategy',
        icon: '🔧',
        description: 'AI recommends proof test intervals and scope',
        buildPrompt: (ctx) => `Recommend proof test strategies for the following SIFs per IEC 61511 Clause 16:
Study: "${ctx.study?.title || 'Untitled'}"

SIF details:
${ctx.itemsSummary || 'None'}

For each SIF, recommend:
| SIF Tag | Current Interval | Recommended Interval | Test Coverage % | Partial Test Possible? | Key Test Steps |

Consider: field device diagnostics, partial stroke testing for valves, online testing capabilities.
Flag any SIFs where the current interval may result in PFD exceeding the SIL target.`,
    },
];

const PSSR_ACTIONS: QuickAction[] = [
    {
        id: 'pssr_audit',
        label: 'Audit Checklist Completeness',
        icon: '📝',
        description: 'AI audits PSSR checklist against OSHA 1910.119(i)',
        buildPrompt: (ctx) => `Audit the following PSSR checklist for completeness per OSHA 1910.119(i) and API RP 750:
Study: "${ctx.study?.title || 'Untitled'}"

Checklist items:
${ctx.itemsSummary || 'None'}

Verify coverage of all required PSSR categories:
1. Construction/modifications per design specs
2. Safety, operating, maintenance, emergency procedures updated
3. Process safety information current
4. PHA recommendations resolved
5. Training completed for affected personnel
6. MOC requirements fulfilled
7. Adequate safety systems in place
8. Pre-startup inspection completed

For any gap: | Missing Category | OSHA Reference | Recommended Checklist Item | Priority |`,
    },
    {
        id: 'pssr_readiness',
        label: 'Assess Startup Readiness',
        icon: '🚀',
        description: 'AI assesses overall startup readiness score',
        buildPrompt: (ctx) => `Assess startup readiness based on the following PSSR status:
Study: "${ctx.study?.title || 'Untitled'}"

Checklist status:
${ctx.itemsSummary || 'None'}

Provide:
1. Overall readiness score (%) with breakdown by category
2. List of MUST-RESOLVE items (any "fail" items that block startup)
3. Risk assessment for proceeding with any "NA" items
4. Recommended approval chain (who should sign off?)

Use traffic light system: 🟢 Ready | 🟡 Conditional | 🔴 Not Ready`,
    },
];

const RISK_REGISTER_ACTIONS: QuickAction[] = [
    {
        id: 'risk_prioritize',
        label: 'Prioritize & Rank Risks',
        icon: '📊',
        description: 'AI evaluates and ranks risks using 5×5 matrix',
        buildPrompt: (ctx) => `Evaluate and prioritize the following risks per ISO 31000 using the 5×5 risk matrix:
Study: "${ctx.study?.title || 'Untitled'}"

Current risks:
${ctx.itemsSummary || 'None'}

For each risk:
1. Validate severity and likelihood scores
2. Calculate pre-control and post-control risk scores
3. Determine ALARP status (Tolerable / ALARP / Intolerable)
4. Rank by residual risk score

Present as a prioritized risk register:
| Rank | Risk ID | Description | Pre-RPN | Controls | Post-RPN | ALARP Status | Recommended Action |

Flag any risks in the INTOLERABLE zone that require immediate escalation.`,
    },
    {
        id: 'risk_treatment',
        label: 'Suggest Risk Treatments',
        icon: '💊',
        description: 'AI recommends ALARP treatments per ISO 31000',
        buildPrompt: (ctx) => `For the following open risks, recommend treatment strategies per ISO 31000 and the Controls Hierarchy:
${ctx.itemsSummary || 'None'}

Apply the Controls Hierarchy (most to least effective):
1. ELIMINATE the hazard
2. SUBSTITUTE with less hazardous alternative
3. ENGINEER controls (physical barriers, interlocks)
4. ADMINISTRATIVE controls (procedures, training)
5. PPE (last resort)

For each risk, provide:
| Risk | Current Controls | Gap | Recommended Treatment | Control Type | Estimated Cost | Expected Risk Reduction |`,
    },
];

// ─── General actions (available for all study types) ─────────────
const GENERAL_ACTIONS: QuickAction[] = [
    {
        id: 'general_summary',
        label: 'Summarize Study',
        icon: '📄',
        description: 'AI generates an executive summary of the current study',
        buildPrompt: (ctx) => `Generate a concise executive summary for this PSM study:
Study: "${ctx.study?.title || 'Untitled'}"
Type: ${ctx.study?.study_type?.toUpperCase() || 'N/A'}
Standard: ${ctx.study?.standard_ref || 'N/A'}
Asset: ${ctx.study?.asset_name || 'Not specified'} (${ctx.study?.asset_tag || ''})
Status: ${ctx.study?.status || 'N/A'}
Team: ${(ctx.study?.team_members || []).map(t => `${t.name} (${t.role})`).join(', ') || 'None'}
Items: ${ctx.itemCount}

Data:
${ctx.itemsSummary || 'No items'}

Provide:
1. Key findings (top 3–5)
2. Risk profile summary
3. Open action items
4. Compliance status vs. governing standard
5. Recommended next steps`,
    },
    {
        id: 'general_standards',
        label: 'Check Standard Compliance',
        icon: '📐',
        description: 'AI checks study against governing standard requirements',
        buildPrompt: (ctx) => `Check this ${ctx.study?.study_type?.toUpperCase() || 'PSM'} study against the governing standard (${ctx.study?.standard_ref || 'applicable standards'}):
Study: "${ctx.study?.title || 'Untitled'}"

Current content:
${ctx.itemsSummary || 'None'}

Evaluate compliance with each mandatory requirement of the standard. Present as:
| Requirement | Clause | Status (✅/⚠️/❌) | Evidence | Gap / Action Required |

Overall compliance score: ___%`,
    },
];

// ─── Master map ──────────────────────────────────────────────────
export const QUICK_ACTIONS_BY_TYPE: Record<PSMStudyType | 'general', QuickAction[]> = {
    pha: PHA_ACTIONS,
    hazop: HAZOP_ACTIONS,
    lopa: LOPA_ACTIONS,
    bowtie: BOWTIE_ACTIONS,
    fta: BOWTIE_ACTIONS, // reuse barrier-focused prompts
    eta: LOPA_ACTIONS,   // reuse frequency-focused prompts
    sil: SIL_ACTIONS,
    pssr: PSSR_ACTIONS,
    general: GENERAL_ACTIONS,
};

/**
 * Returns the combined quick actions for a given study type:
 * type-specific actions + general actions.
 */
export const getQuickActionsForStudy = (studyType: PSMStudyType | null): QuickAction[] => {
    const specific = studyType ? QUICK_ACTIONS_BY_TYPE[studyType] || [] : [];
    return [...specific, ...GENERAL_ACTIONS];
};

/**
 * Builds a serialized context summary from study items for prompt injection.
 * This is a generic helper — callers format the itemsSummary based on study type.
 */
export const buildStudyContextHeader = (study: PSMStudy | null): string => {
    if (!study) return 'No active study selected.';
    return [
        `Study: "${study.title}" (${study.study_type.toUpperCase()})`,
        `Standard: ${study.standard_ref || 'N/A'}`,
        `Asset: ${study.asset_name || 'N/A'} (${study.asset_tag || ''})`,
        `Status: ${study.status}`,
        `Team: ${(study.team_members || []).map(t => `${t.name} (${t.role})`).join(', ') || 'None'}`,
        `Scope: ${study.scope_description || 'N/A'}`,
    ].join('\n');
};
