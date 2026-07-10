/**
 * Labour rate resolution — one cascade for estimates AND actuals so
 * plan-vs-actual variance reflects hours, never a rate-basis mismatch.
 *
 * Most specific source wins:
 *   1. person   — the contact's own rate (Admin › Financials override)
 *   2. role     — the craft/role standard rate (CONTACT_TYPE dictionary)
 *   3. work-center — blended crew rate (operation plannedRate ?? activityRate)
 *   4. default  — last resort so labour never posts at $0
 */

export const DEFAULT_LABOUR_RATE = 75;

export type LabourRateSource = 'person' | 'role' | 'work-center' | 'default';

export interface RateContact {
    id: string;
    hourlyRate?: number | string | null;
}

export interface RateRoleEntry {
    type: string;
    code: string;
    active: boolean;
    hourlyRate?: number | string | null;
}

export interface ResolveLabourRateInput {
    contactId?: string;
    roleCode?: string;
    contacts: RateContact[];
    dictionaries: RateRoleEntry[];
    /** Operation costing rate: task.plannedRate ?? workCenter.activityRate */
    workCenterRate?: number | null;
}

export interface ResolvedLabourRate {
    rate: number;
    source: LabourRateSource;
}

const asRate = (v: number | string | null | undefined): number | null => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
};

export function resolveLabourRate(input: ResolveLabourRateInput): ResolvedLabourRate {
    const { contactId, roleCode, contacts, dictionaries, workCenterRate } = input;

    if (contactId) {
        const personRate = asRate(contacts.find(c => c.id === contactId)?.hourlyRate);
        if (personRate != null) return { rate: personRate, source: 'person' };
    }

    if (roleCode) {
        const entry = dictionaries.find(d => d.type === 'CONTACT_TYPE' && d.code === roleCode && d.active);
        const roleRate = asRate(entry?.hourlyRate);
        if (roleRate != null) return { rate: roleRate, source: 'role' };
    }

    const wcRate = asRate(workCenterRate);
    if (wcRate != null) return { rate: wcRate, source: 'work-center' };

    return { rate: DEFAULT_LABOUR_RATE, source: 'default' };
}

/** Human label for where a rate came from (tooltips, confirmation preview). */
export const labourRateSourceLabel: Record<LabourRateSource, string> = {
    'person': 'person rate',
    'role': 'craft rate',
    'work-center': 'work-centre rate',
    'default': 'default rate',
};
