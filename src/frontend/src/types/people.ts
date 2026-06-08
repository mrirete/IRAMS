// ═══════════════════════════════════════════════════════════════════════
//  Workforce & People Types — EAM Standards
// ═══════════════════════════════════════════════════════════════════════

export type AvailabilityStatus = 'active' | 'on_leave' | 'off_shift' | 'training';
export type SkillLevel = 'Apprentice' | 'Journeyman' | 'Master' | 'Lead';
export type CertComplianceStatus = 'valid' | 'expiring_soon' | 'expired';

export interface Certification {
    id: string;
    name: string;
    issuing_body: string;
    issue_date: string;
    expiry_date: string;
    status: CertComplianceStatus;
}

export interface Skill {
    craft: string;
    level: SkillLevel;
    is_primary: boolean;
}

export interface Person {
    id: string;
    employee_id: string;
    first_name: string;
    last_name: string;
    role: string; // e.g. "Maintenance Technician", "Reliability Engineer"

    // Org & Location
    department: string;
    base_site: string;

    // Skills & Compliance
    skills: Skill[];
    certifications: Certification[];

    // Status
    availability: AvailabilityStatus;
    weekly_capacity_hours: number;
    current_utilization_pct: number;
}

export interface WorkforceSummary {
    total_headcount: number;
    active_now: number;
    on_leave: number;
    expiring_certs: number;
    avg_utilization_pct: number;
}
