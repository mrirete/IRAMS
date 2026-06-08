import { useState, useMemo } from 'react';
import type { Person, WorkforceSummary } from '../types/people';

// Helper to generate dates relative to today
const d = (daysOff: number) => new Date(Date.now() + daysOff * 86400000).toISOString();

// ═══════════════════════════════════════════════════════════════════════
//  MOCK DATA — People & Workforce
// ═══════════════════════════════════════════════════════════════════════

const MOCK_PEOPLE: Person[] = [
    {
        id: 'usr-m101',
        employee_id: 'EMP-4001',
        first_name: 'David',
        last_name: 'Chen',
        role: 'Maintenance Technician',
        department: 'Mechanical',
        base_site: 'Offshore Platform Alpha',
        skills: [{ craft: 'Mechanic', level: 'Master', is_primary: true }, { craft: 'Pipefitter', level: 'Journeyman', is_primary: false }],
        certifications: [
            { id: 'c-1', name: 'BOSIET Offshore Survival', issuing_body: 'OPITO', issue_date: d(-400), expiry_date: d(330), status: 'valid' },
            { id: 'c-2', name: 'Flange Management', issuing_body: 'ECITB', issue_date: d(-1100), expiry_date: d(15), status: 'expiring_soon' }
        ],
        availability: 'active',
        weekly_capacity_hours: 40,
        current_utilization_pct: 85
    },
    {
        id: 'usr-m102',
        employee_id: 'EMP-4002',
        first_name: 'Sarah',
        last_name: 'Jenkins',
        role: 'Reliability Engineer',
        department: 'Engineering',
        base_site: 'Onshore Terminal',
        skills: [{ craft: 'Reliability Tech', level: 'Lead', is_primary: true }],
        certifications: [
            { id: 'c-3', name: 'Vibration Analysis ISO Cat III', issuing_body: 'Mobius', issue_date: d(-500), expiry_date: d(1200), status: 'valid' }
        ],
        availability: 'active',
        weekly_capacity_hours: 40,
        current_utilization_pct: 60
    },
    {
        id: 'usr-m103',
        employee_id: 'EMP-4003',
        first_name: 'Marcus',
        last_name: 'Okafor',
        role: 'E&I Technician',
        department: 'Electrical',
        base_site: 'Offshore Platform Alpha',
        skills: [{ craft: 'Electrician', level: 'Journeyman', is_primary: true }, { craft: 'Instrument Tech', level: 'Apprentice', is_primary: false }],
        certifications: [
            { id: 'c-4', name: 'Compex Ex01-Ex04', issuing_body: 'JTLimited', issue_date: d(-1400), expiry_date: d(-10), status: 'expired' },
            { id: 'c-1', name: 'BOSIET Offshore Survival', issuing_body: 'OPITO', issue_date: d(-800), expiry_date: d(600), status: 'valid' }
        ],
        availability: 'active',
        weekly_capacity_hours: 40,
        current_utilization_pct: 95
    },
    {
        id: 'usr-m104',
        employee_id: 'EMP-4004',
        first_name: 'Elena',
        last_name: 'Rostova',
        role: 'Maintenance Supervisor',
        department: 'Mechanical',
        base_site: 'Onshore Terminal',
        skills: [{ craft: 'Mechanic', level: 'Lead', is_primary: true }],
        certifications: [
            { id: 'c-5', name: 'Confined Space Entry Rescue', issuing_body: 'OSHA', issue_date: d(-300), expiry_date: d(50), status: 'valid' }
        ],
        availability: 'on_leave',
        weekly_capacity_hours: 0,
        current_utilization_pct: 0
    },
    {
        id: 'usr-m105',
        employee_id: 'EMP-4005',
        first_name: 'James',
        last_name: 'Holden',
        role: 'Operator',
        department: 'Operations',
        base_site: 'Offshore Platform Alpha',
        skills: [{ craft: 'Operator', level: 'Master', is_primary: true }],
        certifications: [
            { id: 'c-1', name: 'BOSIET Offshore Survival', issuing_body: 'OPITO', issue_date: d(-1000), expiry_date: d(100), status: 'valid' },
            { id: 'c-6', name: 'H2S Awareness', issuing_body: 'OPITO', issue_date: d(-700), expiry_date: d(20), status: 'expiring_soon' }
        ],
        availability: 'off_shift',
        weekly_capacity_hours: 40,
        current_utilization_pct: 100
    },
    {
        id: 'usr-m106',
        employee_id: 'EMP-4006',
        first_name: 'Naomi',
        last_name: 'Nagata',
        role: 'Automation Engineer',
        department: 'Engineering',
        base_site: 'Onshore Terminal',
        skills: [{ craft: 'Instrument Tech', level: 'Master', is_primary: true }],
        certifications: [
            { id: 'c-7', name: 'TUV Functional Safety', issuing_body: 'TUV Rheinland', issue_date: d(-800), expiry_date: d(600), status: 'valid' }
        ],
        availability: 'active',
        weekly_capacity_hours: 40,
        current_utilization_pct: 75
    },
    {
        id: 'usr-m107',
        employee_id: 'EMP-4007',
        first_name: 'Amos',
        last_name: 'Burton',
        role: 'Heavy Mechanic',
        department: 'Mechanical',
        base_site: 'Onshore Terminal',
        skills: [{ craft: 'Mechanic', level: 'Journeyman', is_primary: true }, { craft: 'Welder', level: 'Master', is_primary: false }],
        certifications: [
            { id: 'c-8', name: '6G Pipe Welding', issuing_body: 'AWS', issue_date: d(-300), expiry_date: d(5), status: 'expiring_soon' }
        ],
        availability: 'training',
        weekly_capacity_hours: 20,
        current_utilization_pct: 40
    },
    {
        id: 'usr-m108',
        employee_id: 'EMP-4008',
        first_name: 'Alex',
        last_name: 'Kamal',
        role: 'Crane Operator',
        department: 'Logistics',
        base_site: 'Offshore Platform Alpha',
        skills: [{ craft: 'Operator', level: 'Journeyman', is_primary: true }],
        certifications: [
            { id: 'c-1', name: 'BOSIET Offshore Survival', issuing_body: 'OPITO', issue_date: d(-800), expiry_date: d(600), status: 'valid' },
            { id: 'c-9', name: 'Stage 3 Crane Operator', issuing_body: 'Sparrows', issue_date: d(-1100), expiry_date: d(-2), status: 'expired' }
        ],
        availability: 'active',
        weekly_capacity_hours: 40,
        current_utilization_pct: 90
    }
];

// ═══════════════════════════════════════════════════════════════════════
//  HOOK
// ═══════════════════════════════════════════════════════════════════════

export function usePeople() {
    const [personnel] = useState<Person[]>(MOCK_PEOPLE);

    const summary = useMemo<WorkforceSummary>(() => {
        const total = personnel.length;
        const active = personnel.filter(p => p.availability === 'active').length;
        const leave = personnel.filter(p => p.availability === 'on_leave').length;

        let expiringCount = 0;
        let totalUtil = 0;
        let utilCount = 0;

        personnel.forEach(p => {
            if (p.certifications.some(c => c.status === 'expiring_soon' || c.status === 'expired')) {
                expiringCount++;
            }
            if (p.availability !== 'on_leave' && p.availability !== 'off_shift') {
                totalUtil += p.current_utilization_pct;
                utilCount++;
            }
        });

        return {
            total_headcount: total,
            active_now: active,
            on_leave: leave,
            expiring_certs: expiringCount,
            avg_utilization_pct: utilCount ? Math.round(totalUtil / utilCount) : 0
        };
    }, [personnel]);

    return {
        personnel,
        summary
    };
}
