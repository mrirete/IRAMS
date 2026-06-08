/**
 * IntegrityService — Supabase CRUD for ERS Integrity domain
 *
 * Tables: ers_cmls, ers_thickness_readings, ers_corrosion_rates,
 *         ers_rbi_assessments, ers_iow_parameters, ers_inspections,
 *         ers_damage_mechanisms, ers_ffs_assessments
 */
import { supabase } from '../lib/supabase';

// ─── Types ───────────────────────────────────────────────────
export interface CML {
    id: string;
    asset_id: string;
    cml_number: string;
    component_type: string;
    nominal_thickness_mm: number;
    tmin_mm: number;
    orientation: string | null;
    created_at: string;
    updated_at: string;
}

export interface ThicknessReading {
    id: string;
    cml_id: string;
    reading_date: string;
    measured_thickness_mm: number;
    ut_method: 'ut_contact' | 'paut' | 'tofd' | 'ut_compression' | 'scan' | null;
    technician: string | null;
    created_at: string;
}

export interface CorrosionRate {
    id: string;
    cml_id: string;
    asset_id: string;
    short_term_rate_mmpy: number;
    long_term_rate_mmpy: number;
    rate_type: 'general' | 'pitting' | 'erosion' | 'crevice' | 'galvanic' | null;
    is_accelerating: boolean;
    last_reading_date: string | null;
    created_at: string;
}

export interface RBIAssessment {
    id: string;
    asset_id: string;
    governing_code: string;
    pof_score: number;
    cof_score: string;
    risk_rank: 'Very High' | 'High' | 'Medium-High' | 'Medium' | 'Low';
    next_inspection_interval_months: number | null;
    next_inspection_due: string | null;
    assessor: string | null;
    assessed_date: string | null;
    created_at: string;
    updated_at: string;
}

export interface IOWParameter {
    id: string;
    asset_id: string;
    parameter_name: string;
    iow_type: 'critical' | 'standard' | 'informational';
    unit: string;
    low_limit: number | null;
    high_limit: number | null;
    current_value: number | null;
    breach_status: 'normal' | 'alert' | 'breach' | null;
    last_breach_date: string | null;
    created_at: string;
    updated_at: string;
}

export interface InspectionEvent {
    id: string;
    asset_id: string;
    inspection_type: string;
    scheduled_date: string;
    status: 'scheduled' | 'in_progress' | 'completed' | 'overdue' | 'cancelled';
    findings_count: number;
    inspector: string | null;
    report_url: string | null;
    created_at: string;
    updated_at: string;
}

export interface DamageMechanism {
    id: string;
    api_571_code: string;
    mechanism_name: string;
    description: string | null;
    status: 'active' | 'susceptible' | 'latent' | 'mitigated';
    source: 'engineer_confirmed' | 'historical' | 'ai_suggested' | 'rbi_driven' | null;
    affected_asset_ids: string[];
    created_at: string;
    updated_at: string;
}

export interface FFSAssessment {
    id: string;
    asset_id: string;
    api_579_part: string;
    level: 'Level 1' | 'Level 2' | 'Level 3';
    status: 'passed' | 'failed' | 'monitoring';
    rsf: number | null;
    remaining_life_years: number | null;
    assessor: string | null;
    assessed_date: string | null;
    recommended_action: string | null;
    created_at: string;
    updated_at: string;
}

// ─── Service ─────────────────────────────────────────────────
class IntegrityService {
    private static instance: IntegrityService;
    private constructor() { }

    static getInstance(): IntegrityService {
        if (!IntegrityService.instance) {
            IntegrityService.instance = new IntegrityService();
        }
        return IntegrityService.instance;
    }

    // ── CMLs ───────────────────────────────────────────────────
    async getCMLs(assetId?: string): Promise<CML[]> {
        try {
            let query = supabase.from('ers_cmls').select('*');
            if (assetId) query = query.eq('asset_id', assetId);
            const { data, error } = await query.order('cml_number');
            if (error) { console.error('IntegrityService.getCMLs:', error); throw error; }
            return (data || []) as CML[];
        } catch (e) {
            console.error('Error fetching CMLs:', e);
            return [];
        }
    }

    async createCML(cml: Omit<CML, 'id' | 'created_at' | 'updated_at'>): Promise<CML | null> {
        try {
            const { data, error } = await supabase.from('ers_cmls').insert(cml).select().single();
            if (error) { console.error('IntegrityService.createCML:', error); throw error; }
            return data as CML;
        } catch (e) {
            console.error('Error creating CML:', e);
            return null;
        }
    }

    async updateCML(id: string, updates: Partial<CML>): Promise<CML | null> {
        try {
            const { data, error } = await supabase
                .from('ers_cmls')
                .update({ ...updates, updated_at: new Date().toISOString() })
                .eq('id', id)
                .select()
                .single();
            if (error) { console.error('IntegrityService.updateCML:', error); throw error; }
            return data as CML;
        } catch (e) {
            console.error('Error updating CML:', e);
            return null;
        }
    }

    async deleteCML(id: string): Promise<boolean> {
        try {
            const { error } = await supabase.from('ers_cmls').delete().eq('id', id);
            if (error) { console.error('IntegrityService.deleteCML:', error); throw error; }
            return true;
        } catch (e) {
            console.error('Error deleting CML:', e);
            return false;
        }
    }

    // ── Thickness Readings ─────────────────────────────────────
    async getThicknessReadings(cmlId?: string): Promise<ThicknessReading[]> {
        try {
            let query = supabase.from('ers_thickness_readings').select('*');
            if (cmlId) query = query.eq('cml_id', cmlId);
            const { data, error } = await query.order('reading_date', { ascending: false });
            if (error) { console.error('IntegrityService.getThicknessReadings:', error); throw error; }
            return (data || []) as ThicknessReading[];
        } catch (e) {
            console.error('Error fetching thickness readings:', e);
            return [];
        }
    }

    async addThicknessReading(reading: Omit<ThicknessReading, 'id' | 'created_at'>): Promise<ThicknessReading | null> {
        try {
            const { data, error } = await supabase.from('ers_thickness_readings').insert(reading).select().single();
            if (error) { console.error('IntegrityService.addThicknessReading:', error); throw error; }
            return data as ThicknessReading;
        } catch (e) {
            console.error('Error adding thickness reading:', e);
            return null;
        }
    }

    // ── Corrosion Rates ────────────────────────────────────────
    async getCorrosionRates(assetId?: string): Promise<CorrosionRate[]> {
        try {
            let query = supabase.from('ers_corrosion_rates').select('*');
            if (assetId) query = query.eq('asset_id', assetId);
            const { data, error } = await query.order('created_at', { ascending: false });
            if (error) { console.error('IntegrityService.getCorrosionRates:', error); throw error; }
            return (data || []) as CorrosionRate[];
        } catch (e) {
            console.error('Error fetching corrosion rates:', e);
            return [];
        }
    }

    async upsertCorrosionRate(rate: Partial<CorrosionRate> & { cml_id: string; asset_id: string }): Promise<CorrosionRate | null> {
        try {
            const { data, error } = await supabase
                .from('ers_corrosion_rates')
                .upsert(rate)
                .select()
                .single();
            if (error) { console.error('IntegrityService.upsertCorrosionRate:', error); throw error; }
            return data as CorrosionRate;
        } catch (e) {
            console.error('Error upserting corrosion rate:', e);
            return null;
        }
    }

    // ── RBI Assessments ────────────────────────────────────────
    async getRBIAssessments(assetId?: string): Promise<RBIAssessment[]> {
        try {
            let query = supabase.from('ers_rbi_assessments').select('*');
            if (assetId) query = query.eq('asset_id', assetId);
            const { data, error } = await query.order('assessed_date', { ascending: false });
            if (error) { console.error('IntegrityService.getRBIAssessments:', error); throw error; }
            return (data || []) as RBIAssessment[];
        } catch (e) {
            console.error('Error fetching RBI assessments:', e);
            return [];
        }
    }

    async createRBIAssessment(assessment: Omit<RBIAssessment, 'id' | 'created_at' | 'updated_at'>): Promise<RBIAssessment | null> {
        try {
            const { data, error } = await supabase.from('ers_rbi_assessments').insert(assessment).select().single();
            if (error) { console.error('IntegrityService.createRBIAssessment:', error); throw error; }
            return data as RBIAssessment;
        } catch (e) {
            console.error('Error creating RBI assessment:', e);
            return null;
        }
    }

    async updateRBIAssessment(id: string, updates: Partial<RBIAssessment>): Promise<RBIAssessment | null> {
        try {
            const { data, error } = await supabase
                .from('ers_rbi_assessments')
                .update({ ...updates, updated_at: new Date().toISOString() })
                .eq('id', id)
                .select()
                .single();
            if (error) { console.error('IntegrityService.updateRBIAssessment:', error); throw error; }
            return data as RBIAssessment;
        } catch (e) {
            console.error('Error updating RBI assessment:', e);
            return null;
        }
    }

    // ── IOW Parameters ─────────────────────────────────────────
    async getIOWParameters(assetId?: string): Promise<IOWParameter[]> {
        try {
            let query = supabase.from('ers_iow_parameters').select('*');
            if (assetId) query = query.eq('asset_id', assetId);
            const { data, error } = await query.order('parameter_name');
            if (error) { console.error('IntegrityService.getIOWParameters:', error); throw error; }
            return (data || []) as IOWParameter[];
        } catch (e) {
            console.error('Error fetching IOW parameters:', e);
            return [];
        }
    }

    async createIOWParameter(param: Omit<IOWParameter, 'id' | 'created_at' | 'updated_at'>): Promise<IOWParameter | null> {
        try {
            const { data, error } = await supabase.from('ers_iow_parameters').insert(param).select().single();
            if (error) { console.error('IntegrityService.createIOWParameter:', error); throw error; }
            return data as IOWParameter;
        } catch (e) {
            console.error('Error creating IOW parameter:', e);
            return null;
        }
    }

    async updateIOWParameter(id: string, updates: Partial<IOWParameter>): Promise<IOWParameter | null> {
        try {
            const { data, error } = await supabase
                .from('ers_iow_parameters')
                .update({ ...updates, updated_at: new Date().toISOString() })
                .eq('id', id)
                .select()
                .single();
            if (error) { console.error('IntegrityService.updateIOWParameter:', error); throw error; }
            return data as IOWParameter;
        } catch (e) {
            console.error('Error updating IOW parameter:', e);
            return null;
        }
    }

    // ── Inspections ────────────────────────────────────────────
    async getInspections(assetId?: string, status?: string): Promise<InspectionEvent[]> {
        try {
            let query = supabase.from('ers_inspections').select('*');
            if (assetId) query = query.eq('asset_id', assetId);
            if (status) query = query.eq('status', status);
            const { data, error } = await query.order('scheduled_date', { ascending: true });
            if (error) { console.error('IntegrityService.getInspections:', error); throw error; }
            return (data || []) as InspectionEvent[];
        } catch (e) {
            console.error('Error fetching inspections:', e);
            return [];
        }
    }

    async createInspection(inspection: Omit<InspectionEvent, 'id' | 'created_at' | 'updated_at'>): Promise<InspectionEvent | null> {
        try {
            const { data, error } = await supabase.from('ers_inspections').insert(inspection).select().single();
            if (error) { console.error('IntegrityService.createInspection:', error); throw error; }
            return data as InspectionEvent;
        } catch (e) {
            console.error('Error creating inspection:', e);
            return null;
        }
    }

    async updateInspection(id: string, updates: Partial<InspectionEvent>): Promise<InspectionEvent | null> {
        try {
            const { data, error } = await supabase
                .from('ers_inspections')
                .update({ ...updates, updated_at: new Date().toISOString() })
                .eq('id', id)
                .select()
                .single();
            if (error) { console.error('IntegrityService.updateInspection:', error); throw error; }
            return data as InspectionEvent;
        } catch (e) {
            console.error('Error updating inspection:', e);
            return null;
        }
    }

    // ── Damage Mechanisms ──────────────────────────────────────
    async getDamageMechanisms(): Promise<DamageMechanism[]> {
        try {
            const { data, error } = await supabase
                .from('ers_damage_mechanisms')
                .select('*')
                .order('mechanism_name');
            if (error) { console.error('IntegrityService.getDamageMechanisms:', error); throw error; }
            return (data || []) as DamageMechanism[];
        } catch (e) {
            console.error('Error fetching damage mechanisms:', e);
            return [];
        }
    }

    async createDamageMechanism(dm: Omit<DamageMechanism, 'id' | 'created_at' | 'updated_at'>): Promise<DamageMechanism | null> {
        try {
            const { data, error } = await supabase.from('ers_damage_mechanisms').insert(dm).select().single();
            if (error) { console.error('IntegrityService.createDamageMechanism:', error); throw error; }
            return data as DamageMechanism;
        } catch (e) {
            console.error('Error creating damage mechanism:', e);
            return null;
        }
    }

    async updateDamageMechanism(id: string, updates: Partial<DamageMechanism>): Promise<DamageMechanism | null> {
        try {
            const { data, error } = await supabase
                .from('ers_damage_mechanisms')
                .update({ ...updates, updated_at: new Date().toISOString() })
                .eq('id', id)
                .select()
                .single();
            if (error) { console.error('IntegrityService.updateDamageMechanism:', error); throw error; }
            return data as DamageMechanism;
        } catch (e) {
            console.error('Error updating damage mechanism:', e);
            return null;
        }
    }

    // ── FFS Assessments ────────────────────────────────────────
    async getFFSAssessments(assetId?: string): Promise<FFSAssessment[]> {
        try {
            let query = supabase.from('ers_ffs_assessments').select('*');
            if (assetId) query = query.eq('asset_id', assetId);
            const { data, error } = await query.order('assessed_date', { ascending: false });
            if (error) { console.error('IntegrityService.getFFSAssessments:', error); throw error; }
            return (data || []) as FFSAssessment[];
        } catch (e) {
            console.error('Error fetching FFS assessments:', e);
            return [];
        }
    }

    async createFFSAssessment(assessment: Omit<FFSAssessment, 'id' | 'created_at' | 'updated_at'>): Promise<FFSAssessment | null> {
        try {
            const { data, error } = await supabase.from('ers_ffs_assessments').insert(assessment).select().single();
            if (error) { console.error('IntegrityService.createFFSAssessment:', error); throw error; }
            return data as FFSAssessment;
        } catch (e) {
            console.error('Error creating FFS assessment:', e);
            return null;
        }
    }

    async updateFFSAssessment(id: string, updates: Partial<FFSAssessment>): Promise<FFSAssessment | null> {
        try {
            const { data, error } = await supabase
                .from('ers_ffs_assessments')
                .update({ ...updates, updated_at: new Date().toISOString() })
                .eq('id', id)
                .select()
                .single();
            if (error) { console.error('IntegrityService.updateFFSAssessment:', error); throw error; }
            return data as FFSAssessment;
        } catch (e) {
            console.error('Error updating FFS assessment:', e);
            return null;
        }
    }
}

export const integrityService = IntegrityService.getInstance();
export default integrityService;
