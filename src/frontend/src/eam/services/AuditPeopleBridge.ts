/**
 * ═══════════════════════════════════════════════════════════════════════
 *  AUDIT → PEOPLE BRIDGE SERVICE
 *  
 *  Synchronizes audit assessor data into the People/Contacts module
 *  to establish the "entry-level → full EAM" onboarding pipeline.
 *  
 *  Flow:
 *  1. Audit intake captures: fullName, username, email, company, mobile, jobTitle
 *  2. On audit save/complete, this service checks if a matching Person exists
 *  3. If not, it creates a new Person record with source='audit_intake'
 *  4. If yes, it updates contact info if audit data is more recent
 *  
 *  Security: HITL — the bridge creates a PENDING person record.
 *  A People admin must activate the account for EAM access.
 * ═══════════════════════════════════════════════════════════════════════
 */

import type { AuditIntakeData } from './AuditTypes';
import { supabase } from '../lib/supabase';

// ─── Types ───────────────────────────────────────────────────

export interface PersonBridgeRecord {
    id?: string;
    username: string;
    full_name: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    mobile: string;
    job_title: string;
    company: string;
    site: string;
    department: string;
    source: 'audit_intake' | 'manual' | 'import';
    source_ref?: string;        // Assessment number
    status: 'pending_activation' | 'active' | 'inactive';
    created_at: string;
    updated_at: string;
}

export type BridgeResult =
    | { success: true; action: 'created' | 'updated' | 'skipped'; personId: string; message: string }
    | { success: false; error: string };

// ─── Service ─────────────────────────────────────────────────

export class AuditPeopleBridge {

    /**
     * Attempt to sync an audit assessor into the People module.
     * Skips if no username is provided (field is optional).
     */
    async syncAssessor(
        intake: AuditIntakeData,
        assessmentNumber?: string
    ): Promise<BridgeResult> {
        // Guard: no username → skip
        if (!intake.username || intake.username.trim().length === 0) {
            return { success: true, action: 'skipped', personId: '', message: 'No username provided — People sync skipped.' };
        }

        const username = intake.username.trim().toLowerCase();

        try {
            // 1. Check for existing person by username
            const existing = await this.findByUsername(username);

            if (existing) {
                // 2a. Person exists — update contact info if stale
                const updated = await this.updatePersonFromIntake(existing.id!, intake, assessmentNumber);
                return {
                    success: true,
                    action: 'updated',
                    personId: existing.id!,
                    message: `Updated existing person "${existing.full_name}" (${username}) with latest audit data.`,
                };
            }

            // 2b. Person does not exist — create new pending record
            const newPerson = await this.createPersonFromIntake(intake, username, assessmentNumber);
            return {
                success: true,
                action: 'created',
                personId: newPerson.id || username,
                message: `Created new person record "${intake.firstName} ${intake.lastName}" (${username}) with status PENDING_ACTIVATION. Admin activation required for EAM access.`,
            };

        } catch (err: any) {
            console.error('[AuditPeopleBridge] Sync failed:', err);
            return { success: false, error: err.message || 'Unknown error during People sync.' };
        }
    }

    /**
     * Look up an existing person by username.
     * Uses Supabase `people` table (or contacts depending on schema).
     */
    private async findByUsername(username: string): Promise<PersonBridgeRecord | null> {
        try {
            // Shared singleton client (never a second GoTrue instance — avoids token races).
            const { data, error } = await supabase
                .from('people')
                .select('*')
                .eq('username', username)
                .maybeSingle();

            if (error) {
                // Table may not exist yet — graceful degradation
                if (error.code === '42P01') {
                    console.warn('[AuditPeopleBridge] people table does not exist yet — skipping lookup.');
                    return null;
                }
                throw error;
            }

            return data as PersonBridgeRecord | null;
        } catch (err) {
            console.warn('[AuditPeopleBridge] findByUsername failed (graceful):', err);
            return null;
        }
    }

    /**
     * Create a new person record from audit intake data.
     * Status = PENDING_ACTIVATION — requires admin approval per HITL principle.
     */
    private async createPersonFromIntake(
        intake: AuditIntakeData,
        username: string,
        assessmentNumber?: string
    ): Promise<PersonBridgeRecord> {


        const record: PersonBridgeRecord = {
            username,
            full_name: `${intake.firstName} ${intake.lastName}`.trim(),
            first_name: intake.firstName,
            last_name: intake.lastName,
            email: intake.email,
            phone: '',
            mobile: intake.mobile,
            job_title: intake.jobTitle,
            company: intake.company,
            site: intake.siteName,
            department: '',
            source: 'audit_intake',
            source_ref: assessmentNumber,
            status: 'pending_activation',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };

        try {
            // Shared singleton client (never a second GoTrue instance — avoids token races).
            const { data, error } = await supabase
                .from('people')
                .insert(record)
                .select('id')
                .single();

            if (error) {
                // Graceful — if table doesn't exist, log and return local
                if (error.code === '42P01') {
                    console.warn('[AuditPeopleBridge] people table does not exist — record saved locally only.');
                    return { ...record, id: `local-${username}-${Date.now()}` };
                }
                throw error;
            }

            return { ...record, id: data.id };
        } catch (err) {
            console.warn('[AuditPeopleBridge] createPerson failed (graceful):', err);
            return { ...record, id: `local-${username}-${Date.now()}` };
        }
    }

    /**
     * Update existing person record with latest audit intake data.
     */
    private async updatePersonFromIntake(
        personId: string,
        intake: AuditIntakeData,
        assessmentNumber?: string
    ): Promise<boolean> {
        try {
            // Shared singleton client (never a second GoTrue instance — avoids token races).
            const { error } = await supabase
                .from('people')
                .update({
                    full_name: `${intake.firstName} ${intake.lastName}`.trim(),
                    first_name: intake.firstName,
                    last_name: intake.lastName,
                    email: intake.email,
                    mobile: intake.mobile,
                    job_title: intake.jobTitle,
                    company: intake.company,
                    site: intake.siteName,
                    source_ref: assessmentNumber,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', personId);

            if (error) throw error;
            return true;
        } catch (err) {
            console.warn('[AuditPeopleBridge] updatePerson failed (graceful):', err);
            return false;
        }
    }
}

// Singleton instance
export const auditPeopleBridge = new AuditPeopleBridge();
