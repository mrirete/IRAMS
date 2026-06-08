/**
 * PSMService — Process Safety Management Analytical Tools
 *
 * CRUD operations + domain calculations for:
 *   PHA, HAZOP, LOPA, Bow-Tie, FTA, ETA, SIL, PSSR, Risk Register
 *
 * Standards: OSHA 1910.119, IEC 61882, IEC 61511, IEC 61508,
 *            IEC 61025, IEC 62502, ISO 31000, CCPS, API 752/753
 */
import { supabase } from '../lib/supabase';
import type {
    PSMStudy, PSMStudyType, PSMStudyStatus,
    HAZOPNode, HAZOPDeviation,
    LOPAScenario, IPL, LOPAConditionalModifiers,
    BowTieElement,
    EventTreeBranch, EventTreeHeader,
    SILAssessment,
    RiskRegisterEntry, RiskCategory, RiskStatus,
    PSSRCheckItem,
    PHAItem,
} from '../../types/safety';

// ═══════════════════════════════════════════════════════════════
//  LOPA Calculation Helpers (IEC 61511)
// ═══════════════════════════════════════════════════════════════

/** Calculate mitigated event frequency per CCPS LOPA methodology */
export function calcMitigatedFrequency(
    ieFrequency: number,
    ipls: IPL[],
    modifiers: LOPAConditionalModifiers = {},
): number {
    let freq = ieFrequency;

    // Apply IPL PFDs
    for (const ipl of ipls) {
        freq *= ipl.pfd;
    }

    // Apply conditional modifiers
    if (modifiers.p_ignition != null)  freq *= modifiers.p_ignition;
    if (modifiers.p_occupancy != null) freq *= modifiers.p_occupancy;
    if (modifiers.p_direction != null) freq *= modifiers.p_direction;
    if (modifiers.p_weather != null)   freq *= modifiers.p_weather;

    return freq;
}

/** Determine required SIL from risk gap (IEC 61511 Table 3) */
export function calcRequiredSIL(
    mitigatedFrequency: number,
    targetFrequency: number,
): number {
    if (targetFrequency <= 0) return 0;
    const riskReductionNeeded = mitigatedFrequency / targetFrequency;

    if (riskReductionNeeded <= 1)     return 0; // Already acceptable
    if (riskReductionNeeded <= 10)    return 1; // SIL 1: PFD 0.1–0.01
    if (riskReductionNeeded <= 100)   return 2; // SIL 2: PFD 0.01–0.001
    if (riskReductionNeeded <= 1000)  return 3; // SIL 3: PFD 0.001–0.0001
    return 4;                                   // SIL 4: PFD < 0.0001
}

// ═══════════════════════════════════════════════════════════════
//  SIL Verification Helpers (IEC 61508)
// ═══════════════════════════════════════════════════════════════

/** PFD average for a 1oo1 architecture (simplified) */
export function calcPFDavg_1oo1(
    lambdaDU: number,  // dangerous undetected failure rate (/hr)
    proofTestHours: number,
): number {
    return (lambdaDU * proofTestHours) / 2;
}

/** PFD average for a 1oo2 architecture (simplified) */
export function calcPFDavg_1oo2(
    lambdaDU: number,
    proofTestHours: number,
    beta: number = 0.1,  // common cause factor
): number {
    const independent = (lambdaDU * proofTestHours) ** 2 / 3;
    const commonCause  = beta * lambdaDU * proofTestHours / 2;
    return independent + commonCause;
}

/** Check if achieved PFD meets target SIL */
export function verifySIL(achievedPFD: number, targetSIL: number): boolean {
    const silBands: Record<number, [number, number]> = {
        1: [1e-2, 1e-1],
        2: [1e-3, 1e-2],
        3: [1e-4, 1e-3],
        4: [1e-5, 1e-4],
    };
    const band = silBands[targetSIL];
    if (!band) return targetSIL === 0;
    return achievedPFD >= band[0] && achievedPFD < band[1];
}

// ═══════════════════════════════════════════════════════════════
//  Event Tree Calculation (IEC 62502)
// ═══════════════════════════════════════════════════════════════

/** Generate all outcome branches from headers */
export function generateEventTreeBranches(
    ieFrequency: number,
    headers: EventTreeHeader[],
): { path: boolean[]; outcome: string; frequency: number }[] {
    const outcomes: { path: boolean[]; outcome: string; frequency: number }[] = [];
    const n = headers.length;
    const total = 2 ** n;

    for (let mask = 0; mask < total; mask++) {
        let freq = ieFrequency;
        const path: boolean[] = [];

        for (let i = 0; i < n; i++) {
            const success = (mask & (1 << (n - 1 - i))) !== 0;
            path.push(success);
            freq *= success ? headers[i].success_prob : (1 - headers[i].success_prob);
        }

        const failCount = path.filter(p => !p).length;
        const outcome = failCount === 0 ? 'Safe' : `Outcome ${mask + 1} (${failCount} failure${failCount > 1 ? 's' : ''})`;

        outcomes.push({ path, outcome, frequency: freq });
    }

    return outcomes;
}

// ═══════════════════════════════════════════════════════════════
//  Risk Matrix Helpers (ISO 31000)
// ═══════════════════════════════════════════════════════════════

export type RiskLevel = 'low' | 'medium' | 'high' | 'extreme';

export function getRiskLevel(score: number): RiskLevel {
    if (score <= 4)  return 'low';
    if (score <= 9)  return 'medium';
    if (score <= 16) return 'high';
    return 'extreme';
}

export const RISK_COLORS: Record<RiskLevel, string> = {
    low: '#22c55e',
    medium: '#eab308',
    high: '#f97316',
    extreme: '#ef4444',
};

// ═══════════════════════════════════════════════════════════════
//  PSM Service Class
// ═══════════════════════════════════════════════════════════════

class PSMService {
    // ──────────────────────────────────────────────────────────
    //  Study CRUD (master container for all tool types)
    // ──────────────────────────────────────────────────────────

    async getStudies(type?: PSMStudyType): Promise<PSMStudy[]> {
        let query = supabase
            .from('ers_psm_studies')
            .select('*')
            .order('updated_at', { ascending: false });

        if (type) query = query.eq('study_type', type);

        const { data, error } = await query;
        if (error) { console.error('[PSMService] getStudies:', error); return []; }
        return (data || []) as PSMStudy[];
    }

    async getStudy(id: string): Promise<PSMStudy | null> {
        const { data, error } = await supabase
            .from('ers_psm_studies')
            .select('*')
            .eq('id', id)
            .single();
        if (error) { console.error('[PSMService] getStudy:', error); return null; }
        return data as PSMStudy;
    }

    async createStudy(study: Partial<PSMStudy>): Promise<PSMStudy | null> {
        const { data, error } = await supabase
            .from('ers_psm_studies')
            .insert(study)
            .select()
            .single();
        if (error) { console.error('[PSMService] createStudy:', error); return null; }
        return data as PSMStudy;
    }

    async updateStudy(id: string, updates: Partial<PSMStudy>): Promise<PSMStudy | null> {
        const { data, error } = await supabase
            .from('ers_psm_studies')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        if (error) { console.error('[PSMService] updateStudy:', error); return null; }
        return data as PSMStudy;
    }

    async deleteStudy(id: string): Promise<boolean> {
        // CASCADE takes care of child records
        const { error } = await supabase
            .from('ers_psm_studies')
            .delete()
            .eq('id', id);
        if (error) { console.error('[PSMService] deleteStudy:', error); return false; }
        return true;
    }

    // ──────────────────────────────────────────────────────────
    //  HAZOP — Nodes (IEC 61882)
    // ──────────────────────────────────────────────────────────

    async getHazopNodes(studyId: string): Promise<HAZOPNode[]> {
        const { data, error } = await supabase
            .from('ers_hazop_nodes')
            .select('*')
            .eq('study_id', studyId)
            .order('sort_order');
        if (error) { console.error('[PSMService] getHazopNodes:', error); return []; }
        return (data || []) as HAZOPNode[];
    }

    async createHazopNode(node: Partial<HAZOPNode>): Promise<HAZOPNode | null> {
        const { data, error } = await supabase
            .from('ers_hazop_nodes')
            .insert(node)
            .select()
            .single();
        if (error) { console.error('[PSMService] createHazopNode:', error); return null; }
        return data as HAZOPNode;
    }

    async updateHazopNode(id: string, updates: Partial<HAZOPNode>): Promise<HAZOPNode | null> {
        const { data, error } = await supabase
            .from('ers_hazop_nodes')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        if (error) { console.error('[PSMService] updateHazopNode:', error); return null; }
        return data as HAZOPNode;
    }

    async deleteHazopNode(id: string): Promise<boolean> {
        const { error } = await supabase.from('ers_hazop_nodes').delete().eq('id', id);
        if (error) { console.error('[PSMService] deleteHazopNode:', error); return false; }
        return true;
    }

    // ──────────────────────────────────────────────────────────
    //  HAZOP — Deviations (worksheet rows)
    // ──────────────────────────────────────────────────────────

    async getDeviations(nodeId: string): Promise<HAZOPDeviation[]> {
        const { data, error } = await supabase
            .from('ers_hazop_deviations')
            .select('*')
            .eq('node_id', nodeId)
            .order('sort_order');
        if (error) { console.error('[PSMService] getDeviations:', error); return []; }
        return (data || []) as HAZOPDeviation[];
    }

    async createDeviation(dev: Partial<HAZOPDeviation>): Promise<HAZOPDeviation | null> {
        const { data, error } = await supabase
            .from('ers_hazop_deviations')
            .insert(dev)
            .select()
            .single();
        if (error) { console.error('[PSMService] createDeviation:', error); return null; }
        return data as HAZOPDeviation;
    }

    async updateDeviation(id: string, updates: Partial<HAZOPDeviation>): Promise<HAZOPDeviation | null> {
        const { data, error } = await supabase
            .from('ers_hazop_deviations')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        if (error) { console.error('[PSMService] updateDeviation:', error); return null; }
        return data as HAZOPDeviation;
    }

    async deleteDeviation(id: string): Promise<boolean> {
        const { error } = await supabase.from('ers_hazop_deviations').delete().eq('id', id);
        if (error) { console.error('[PSMService] deleteDeviation:', error); return false; }
        return true;
    }

    // ──────────────────────────────────────────────────────────
    //  LOPA Scenarios (IEC 61511)
    // ──────────────────────────────────────────────────────────

    async getLOPAScenarios(studyId: string): Promise<LOPAScenario[]> {
        const { data, error } = await supabase
            .from('ers_lopa_scenarios')
            .select('*')
            .eq('study_id', studyId)
            .order('sort_order');
        if (error) { console.error('[PSMService] getLOPAScenarios:', error); return []; }
        return (data || []) as LOPAScenario[];
    }

    async createLOPAScenario(scenario: Partial<LOPAScenario>): Promise<LOPAScenario | null> {
        // Auto-calc mitigated frequency if inputs present
        if (scenario.ie_frequency && scenario.ipls) {
            scenario.mitigated_frequency = calcMitigatedFrequency(
                scenario.ie_frequency,
                scenario.ipls,
                scenario.conditional_modifiers,
            );
            if (scenario.target_frequency) {
                scenario.risk_gap = scenario.mitigated_frequency - scenario.target_frequency;
                scenario.sil_required = calcRequiredSIL(
                    scenario.mitigated_frequency,
                    scenario.target_frequency,
                );
            }
        }

        const { data, error } = await supabase
            .from('ers_lopa_scenarios')
            .insert(scenario)
            .select()
            .single();
        if (error) { console.error('[PSMService] createLOPAScenario:', error); return null; }
        return data as LOPAScenario;
    }

    async updateLOPAScenario(id: string, updates: Partial<LOPAScenario>): Promise<LOPAScenario | null> {
        const { data, error } = await supabase
            .from('ers_lopa_scenarios')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        if (error) { console.error('[PSMService] updateLOPAScenario:', error); return null; }
        return data as LOPAScenario;
    }

    async deleteLOPAScenario(id: string): Promise<boolean> {
        const { error } = await supabase.from('ers_lopa_scenarios').delete().eq('id', id);
        if (error) { console.error('[PSMService] deleteLOPAScenario:', error); return false; }
        return true;
    }

    // ──────────────────────────────────────────────────────────
    //  Bow-Tie Elements
    // ──────────────────────────────────────────────────────────

    async getBowTieElements(studyId: string): Promise<BowTieElement[]> {
        const { data, error } = await supabase
            .from('ers_bowtie_elements')
            .select('*')
            .eq('study_id', studyId)
            .order('sort_order');
        if (error) { console.error('[PSMService] getBowTieElements:', error); return []; }
        return (data || []) as BowTieElement[];
    }

    async createBowTieElement(el: Partial<BowTieElement>): Promise<BowTieElement | null> {
        const { data, error } = await supabase
            .from('ers_bowtie_elements')
            .insert(el)
            .select()
            .single();
        if (error) { console.error('[PSMService] createBowTieElement:', error); return null; }
        return data as BowTieElement;
    }

    async updateBowTieElement(id: string, updates: Partial<BowTieElement>): Promise<BowTieElement | null> {
        const { data, error } = await supabase
            .from('ers_bowtie_elements')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        if (error) { console.error('[PSMService] updateBowTieElement:', error); return null; }
        return data as BowTieElement;
    }

    async deleteBowTieElement(id: string): Promise<boolean> {
        const { error } = await supabase.from('ers_bowtie_elements').delete().eq('id', id);
        if (error) { console.error('[PSMService] deleteBowTieElement:', error); return false; }
        return true;
    }

    // ──────────────────────────────────────────────────────────
    //  Event Tree (IEC 62502)
    // ──────────────────────────────────────────────────────────

    async getEventTrees(studyId: string): Promise<EventTreeBranch[]> {
        const { data, error } = await supabase
            .from('ers_event_tree_branches')
            .select('*')
            .eq('study_id', studyId);
        if (error) { console.error('[PSMService] getEventTrees:', error); return []; }
        return (data || []) as EventTreeBranch[];
    }

    async createEventTree(tree: Partial<EventTreeBranch>): Promise<EventTreeBranch | null> {
        // Auto-generate branches if headers + frequency provided
        if (tree.ie_frequency && tree.headers && tree.headers.length > 0) {
            tree.branches = generateEventTreeBranches(
                tree.ie_frequency,
                tree.headers as EventTreeHeader[],
            );
        }

        const { data, error } = await supabase
            .from('ers_event_tree_branches')
            .insert(tree)
            .select()
            .single();
        if (error) { console.error('[PSMService] createEventTree:', error); return null; }
        return data as EventTreeBranch;
    }

    async updateEventTree(id: string, updates: Partial<EventTreeBranch>): Promise<EventTreeBranch | null> {
        const { data, error } = await supabase
            .from('ers_event_tree_branches')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        if (error) { console.error('[PSMService] updateEventTree:', error); return null; }
        return data as EventTreeBranch;
    }

    async deleteEventTree(id: string): Promise<boolean> {
        const { error } = await supabase.from('ers_event_tree_branches').delete().eq('id', id);
        if (error) { console.error('[PSMService] deleteEventTree:', error); return false; }
        return true;
    }

    // ──────────────────────────────────────────────────────────
    //  SIL Assessment (IEC 61508 / IEC 61511)
    // ──────────────────────────────────────────────────────────

    async getSILAssessments(studyId: string): Promise<SILAssessment[]> {
        const { data, error } = await supabase
            .from('ers_sil_assessments')
            .select('*')
            .eq('study_id', studyId)
            .order('sort_order');
        if (error) { console.error('[PSMService] getSILAssessments:', error); return []; }
        return (data || []) as SILAssessment[];
    }

    async createSILAssessment(sil: Partial<SILAssessment>): Promise<SILAssessment | null> {
        const { data, error } = await supabase
            .from('ers_sil_assessments')
            .insert(sil)
            .select()
            .single();
        if (error) { console.error('[PSMService] createSILAssessment:', error); return null; }
        return data as SILAssessment;
    }

    async updateSILAssessment(id: string, updates: Partial<SILAssessment>): Promise<SILAssessment | null> {
        const { data, error } = await supabase
            .from('ers_sil_assessments')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        if (error) { console.error('[PSMService] updateSILAssessment:', error); return null; }
        return data as SILAssessment;
    }

    async deleteSILAssessment(id: string): Promise<boolean> {
        const { error } = await supabase.from('ers_sil_assessments').delete().eq('id', id);
        if (error) { console.error('[PSMService] deleteSILAssessment:', error); return false; }
        return true;
    }

    // ──────────────────────────────────────────────────────────
    //  Risk Register (ISO 31000)
    // ──────────────────────────────────────────────────────────

    async getRiskRegisterEntries(filters?: {
        category?: RiskCategory;
        status?: RiskStatus;
        assetId?: string;
    }): Promise<RiskRegisterEntry[]> {
        let query = supabase
            .from('ers_risk_register')
            .select('*')
            .order('updated_at', { ascending: false });

        if (filters?.category) query = query.eq('category', filters.category);
        if (filters?.status)   query = query.eq('status', filters.status);
        if (filters?.assetId)  query = query.eq('asset_id', filters.assetId);

        const { data, error } = await query;
        if (error) { console.error('[PSMService] getRiskRegisterEntries:', error); return []; }
        return (data || []) as RiskRegisterEntry[];
    }

    async createRiskEntry(entry: Partial<RiskRegisterEntry>): Promise<RiskRegisterEntry | null> {
        const { data, error } = await supabase
            .from('ers_risk_register')
            .insert(entry)
            .select()
            .single();
        if (error) { console.error('[PSMService] createRiskEntry:', error); return null; }
        return data as RiskRegisterEntry;
    }

    async updateRiskEntry(id: string, updates: Partial<RiskRegisterEntry>): Promise<RiskRegisterEntry | null> {
        const { data, error } = await supabase
            .from('ers_risk_register')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        if (error) { console.error('[PSMService] updateRiskEntry:', error); return null; }
        return data as RiskRegisterEntry;
    }

    async deleteRiskEntry(id: string): Promise<boolean> {
        const { error } = await supabase.from('ers_risk_register').delete().eq('id', id);
        if (error) { console.error('[PSMService] deleteRiskEntry:', error); return false; }
        return true;
    }

    /** Get 5×5 risk matrix heatmap data */
    async getRiskHeatmap(): Promise<{ pre: number[][]; post: number[][] }> {
        const entries = await this.getRiskRegisterEntries();
        const pre:  number[][] = Array.from({ length: 5 }, () => Array(5).fill(0));
        const post: number[][] = Array.from({ length: 5 }, () => Array(5).fill(0));

        for (const e of entries) {
            if (e.pre_severity && e.pre_likelihood)
                pre[e.pre_severity - 1][e.pre_likelihood - 1]++;
            if (e.post_severity && e.post_likelihood)
                post[e.post_severity - 1][e.post_likelihood - 1]++;
        }

        return { pre, post };
    }

    // ──────────────────────────────────────────────────────────
    //  PSSR Checklists (OSHA 1910.119(i))
    // ──────────────────────────────────────────────────────────

    async getPSSRItems(studyId: string): Promise<PSSRCheckItem[]> {
        const { data, error } = await supabase
            .from('ers_pssr_checklists')
            .select('*')
            .eq('study_id', studyId)
            .order('sort_order');
        if (error) { console.error('[PSMService] getPSSRItems:', error); return []; }
        return (data || []) as PSSRCheckItem[];
    }

    async createPSSRItem(item: Partial<PSSRCheckItem>): Promise<PSSRCheckItem | null> {
        const { data, error } = await supabase
            .from('ers_pssr_checklists')
            .insert(item)
            .select()
            .single();
        if (error) { console.error('[PSMService] createPSSRItem:', error); return null; }
        return data as PSSRCheckItem;
    }

    async updatePSSRItem(id: string, updates: Partial<PSSRCheckItem>): Promise<PSSRCheckItem | null> {
        const { data, error } = await supabase
            .from('ers_pssr_checklists')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        if (error) { console.error('[PSMService] updatePSSRItem:', error); return null; }
        return data as PSSRCheckItem;
    }

    async deletePSSRItem(id: string): Promise<boolean> {
        const { error } = await supabase.from('ers_pssr_checklists').delete().eq('id', id);
        if (error) { console.error('[PSMService] deletePSSRItem:', error); return false; }
        return true;
    }

    /** Get PSSR completion percentage */
    async getPSSRCompletionPct(studyId: string): Promise<number> {
        const items = await this.getPSSRItems(studyId);
        if (items.length === 0) return 0;
        const applicable = items.filter(i => i.status !== 'na');
        if (applicable.length === 0) return 100;
        const done = applicable.filter(i => i.status === 'pass').length;
        return Math.round((done / applicable.length) * 100);
    }

    /** Bulk-create standard PSSR checklist for a study */
    async initPSSRChecklist(studyId: string): Promise<PSSRCheckItem[]> {
        const STANDARD_ITEMS: { category: string; items: string[] }[] = [
            {
                category: 'Process',
                items: [
                    'Process Safety Information updated and available',
                    'Operating procedures reviewed and current',
                    'P&IDs verified against field',
                    'Process equipment installed per design',
                    'Relief devices tested and certified',
                ],
            },
            {
                category: 'Mechanical',
                items: [
                    'Equipment inspected per API / ASME standards',
                    'Piping pressure tested',
                    'Rotating equipment alignment verified',
                    'Gaskets and bolting per spec',
                    'Insulation and heat tracing complete',
                ],
            },
            {
                category: 'Electrical / Instrumentation',
                items: [
                    'Electrical systems tested and energized safely',
                    'Instrument calibrations complete',
                    'Safety instrumented systems (SIS) validated',
                    'Fire and gas detection tested',
                    'Interlock logic verified (cause & effect)',
                ],
            },
            {
                category: 'Training & Documentation',
                items: [
                    'Operators trained on procedures',
                    'Emergency procedures reviewed',
                    'MSDS / SDS available for all chemicals',
                    'Management of Change (MoC) closed out',
                    'Punch list items resolved or risk-accepted',
                ],
            },
            {
                category: 'Safety & Environment',
                items: [
                    'Fire protection systems operational',
                    'Environmental permits in place',
                    'Waste management plan active',
                    'Personal protective equipment available',
                    'Emergency response equipment inspected',
                ],
            },
        ];

        const rows: Partial<PSSRCheckItem>[] = [];
        let sortOrder = 0;
        for (const cat of STANDARD_ITEMS) {
            for (const item of cat.items) {
                rows.push({
                    study_id: studyId,
                    category: cat.category,
                    checklist_item: item,
                    status: 'not_checked',
                    sort_order: sortOrder++,
                });
            }
        }

        const { data, error } = await supabase
            .from('ers_pssr_checklists')
            .insert(rows)
            .select();
        if (error) { console.error('[PSMService] initPSSRChecklist:', error); return []; }
        return (data || []) as PSSRCheckItem[];
    }

    // ──────────────────────────────────────────────────────────
    //  PHA Items (What-If / Checklist)
    // ──────────────────────────────────────────────────────────

    async getPHAItems(studyId: string): Promise<PHAItem[]> {
        const { data, error } = await supabase
            .from('ers_pha_items')
            .select('*')
            .eq('study_id', studyId)
            .order('sort_order');
        if (error) { console.error('[PSMService] getPHAItems:', error); return []; }
        return (data || []) as PHAItem[];
    }

    async createPHAItem(item: Partial<PHAItem>): Promise<PHAItem | null> {
        const { data, error } = await supabase
            .from('ers_pha_items')
            .insert(item)
            .select()
            .single();
        if (error) { console.error('[PSMService] createPHAItem:', error); return null; }
        return data as PHAItem;
    }

    async updatePHAItem(id: string, updates: Partial<PHAItem>): Promise<PHAItem | null> {
        const { data, error } = await supabase
            .from('ers_pha_items')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        if (error) { console.error('[PSMService] updatePHAItem:', error); return null; }
        return data as PHAItem;
    }

    async deletePHAItem(id: string): Promise<boolean> {
        const { error } = await supabase.from('ers_pha_items').delete().eq('id', id);
        if (error) { console.error('[PSMService] deletePHAItem:', error); return false; }
        return true;
    }

}

// Singleton export
const psmService = new PSMService();
export default psmService;
