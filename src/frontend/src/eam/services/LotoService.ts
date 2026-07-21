/**
 * LotoService — Supabase CRUD for LOTO (lockout/tagout) permits
 *
 * Table: loto_permits (migration 0213)
 * Lifecycle: draft → issued → active → cleared, cancellable while non-cleared.
 */
import { supabase } from '../lib/supabase';

// ─── Types ───────────────────────────────────────────────────
export type LotoStatus = 'draft' | 'issued' | 'active' | 'cleared' | 'cancelled';

export interface IsolationPoint {
    energy_type: string;   // electrical | mechanical | process | pneumatic | hydraulic
    point?: string;        // optional physical point description
}

export interface LotoPadlock {
    padlock_id: string;
    assigned_to: string;
    locked_date: string | null;
    unlocked_date: string | null;
}

export interface LotoPermit {
    id: string;
    permit_number: string;
    asset_id: string | null;
    description: string | null;
    isolation_points: IsolationPoint[];
    padlocks: LotoPadlock[];
    blind_list: string[];
    status: LotoStatus;
    requested_by: string | null;
    authorized_by: string | null;
    issued_at: string | null;
    activated_at: string | null;
    cleared_at: string | null;
    created_at: string;
    updated_at: string;
}

// ─── Service ─────────────────────────────────────────────────
class LotoService {
    private static instance: LotoService;
    private constructor() { }

    static getInstance(): LotoService {
        if (!LotoService.instance) {
            LotoService.instance = new LotoService();
        }
        return LotoService.instance;
    }

    async getPermits(): Promise<LotoPermit[]> {
        try {
            const { data, error } = await supabase
                .from('loto_permits')
                .select('*')
                .order('created_at', { ascending: false });
            if (error) { console.error('LotoService.getPermits:', error); throw error; }
            return (data || []) as LotoPermit[];
        } catch (e) {
            console.error('Error fetching LOTO permits:', e);
            return [];
        }
    }

    async createPermit(permit: Omit<LotoPermit, 'id' | 'created_at' | 'updated_at'>): Promise<LotoPermit | null> {
        try {
            const { data, error } = await supabase.from('loto_permits').insert(permit).select().single();
            if (error) { console.error('LotoService.createPermit:', error); throw error; }
            return data as LotoPermit;
        } catch (e) {
            console.error('Error creating LOTO permit:', e);
            return null;
        }
    }

    async updatePermit(id: string, updates: Partial<LotoPermit>): Promise<LotoPermit | null> {
        try {
            const { data, error } = await supabase
                .from('loto_permits')
                .update({ ...updates, updated_at: new Date().toISOString() })
                .eq('id', id)
                .select()
                .single();
            if (error) { console.error('LotoService.updatePermit:', error); throw error; }
            return data as LotoPermit;
        } catch (e) {
            console.error('Error updating LOTO permit:', e);
            return null;
        }
    }
}

export const lotoService = LotoService.getInstance();
export default lotoService;
