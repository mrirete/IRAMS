import { useState, useMemo } from 'react';
import type {
    LOTOPermit, PSMElement, Audit, RegulatoryRequirement,
    ReadinessScore, SafetySummary
} from '../types/safety';

const d = (off: number) => new Date(Date.now() + off * 86400000).toISOString();

// ═══════════════════════════════════════════════════════════════════════
//  MOCK DATA
// ═══════════════════════════════════════════════════════════════════════

const MOCK_LOTO: LOTOPermit[] = [
    { id: 'loto-001', permit_number: 'LOTO-2026-041', asset_id: 'ast-k601', asset_name: 'Gas Compressor K-601', isolation_type: 'electrical', status: 'active', blind_list: ['BL-001 (24" suction)', 'BL-002 (16" discharge)'], padlocks: [{ padlock_id: 'PL-101', assigned_to: 'J. Martinez', locked_date: d(-2), unlocked_date: null }, { padlock_id: 'PL-102', assigned_to: 'D. Chen', locked_date: d(-2), unlocked_date: null }], authorized_by: 'S. Jenkins', issued_date: d(-2), cleared_date: null, work_description: 'Motor replacement — K-601 main drive' },
    { id: 'loto-002', permit_number: 'LOTO-2026-040', asset_id: 'ast-v205', asset_name: 'Separator V-205', isolation_type: 'process', status: 'active', blind_list: ['BL-003 (8" inlet)', 'BL-004 (6" gas outlet)', 'BL-005 (4" drain)'], padlocks: [{ padlock_id: 'PL-103', assigned_to: 'M. Okafor', locked_date: d(-1), unlocked_date: null }], authorized_by: 'N. Nagata', issued_date: d(-1), cleared_date: null, work_description: 'Internal inspection — UT survey of shell CMLs' },
    { id: 'loto-003', permit_number: 'LOTO-2026-039', asset_id: 'ast-p102', asset_name: 'Transfer Pump P-102', isolation_type: 'mechanical', status: 'cleared', blind_list: ['BL-006 (4" suction)'], padlocks: [{ padlock_id: 'PL-104', assigned_to: 'A. Burton', locked_date: d(-10), unlocked_date: d(-7) }], authorized_by: 'S. Jenkins', issued_date: d(-10), cleared_date: d(-7), work_description: 'Seal replacement — mechanical seal overhaul' },
    { id: 'loto-004', permit_number: 'LOTO-2026-042', asset_id: 'ast-hx405', asset_name: 'Heat Exchanger HX-405', isolation_type: 'process', status: 'draft', blind_list: [], padlocks: [], authorized_by: '', issued_date: d(0), cleared_date: null, work_description: 'Tube bundle pull — planned turnaround activity' },
    { id: 'loto-005', permit_number: 'LOTO-2026-038', asset_id: 'ast-gt301', asset_name: 'Gas Turbine GT-301', isolation_type: 'pneumatic', status: 'cleared', blind_list: ['BL-007 (fuel gas)', 'BL-008 (instrument air)'], padlocks: [{ padlock_id: 'PL-105', assigned_to: 'J. Martinez', locked_date: d(-15), unlocked_date: d(-12) }, { padlock_id: 'PL-106', assigned_to: 'D. Chen', locked_date: d(-15), unlocked_date: d(-12) }], authorized_by: 'N. Nagata', issued_date: d(-15), cleared_date: d(-12), work_description: 'Fuel nozzle inspection and cleaning' },
];

const MOCK_PSM: PSMElement[] = [
    { id: 'psm-01', element_name: 'Employee Participation', osha_reference: '1910.119(c)', compliance_pct: 95, last_review_date: d(-60), next_review_due: d(305), open_findings: 0, owner: 'HR Director' },
    { id: 'psm-02', element_name: 'Process Safety Information', osha_reference: '1910.119(d)', compliance_pct: 88, last_review_date: d(-90), next_review_due: d(275), open_findings: 2, owner: 'Process Engineer' },
    { id: 'psm-03', element_name: 'Process Hazard Analysis (PHA)', osha_reference: '1910.119(e)', compliance_pct: 72, last_review_date: d(-180), next_review_due: d(-15), open_findings: 5, owner: 'Safety Manager' },
    { id: 'psm-04', element_name: 'Operating Procedures', osha_reference: '1910.119(f)', compliance_pct: 91, last_review_date: d(-45), next_review_due: d(320), open_findings: 1, owner: 'Operations Sup.' },
    { id: 'psm-05', element_name: 'Training', osha_reference: '1910.119(g)', compliance_pct: 85, last_review_date: d(-30), next_review_due: d(335), open_findings: 3, owner: 'Training Coord.' },
    { id: 'psm-06', element_name: 'Contractors', osha_reference: '1910.119(h)', compliance_pct: 78, last_review_date: d(-120), next_review_due: d(245), open_findings: 2, owner: 'Contracts Manager' },
    { id: 'psm-07', element_name: 'Pre-Startup Safety Review (PSSR)', osha_reference: '1910.119(i)', compliance_pct: 100, last_review_date: d(-20), next_review_due: d(345), open_findings: 0, owner: 'Plant Manager' },
    { id: 'psm-08', element_name: 'Mechanical Integrity', osha_reference: '1910.119(j)', compliance_pct: 82, last_review_date: d(-75), next_review_due: d(290), open_findings: 4, owner: 'Reliability Engineer' },
    { id: 'psm-09', element_name: 'Hot Work Permit', osha_reference: '1910.119(k)', compliance_pct: 97, last_review_date: d(-10), next_review_due: d(355), open_findings: 0, owner: 'Safety Manager' },
    { id: 'psm-10', element_name: 'Management of Change (MOC)', osha_reference: '1910.119(l)', compliance_pct: 68, last_review_date: d(-100), next_review_due: d(265), open_findings: 6, owner: 'Plant Manager' },
    { id: 'psm-11', element_name: 'Incident Investigation', osha_reference: '1910.119(m)', compliance_pct: 90, last_review_date: d(-50), next_review_due: d(315), open_findings: 1, owner: 'Safety Manager' },
    { id: 'psm-12', element_name: 'Emergency Planning', osha_reference: '1910.119(n)', compliance_pct: 93, last_review_date: d(-40), next_review_due: d(325), open_findings: 0, owner: 'HSE Director' },
    { id: 'psm-13', element_name: 'Compliance Audits', osha_reference: '1910.119(o)', compliance_pct: 80, last_review_date: d(-150), next_review_due: d(215), open_findings: 3, owner: 'QA Manager' },
    { id: 'psm-14', element_name: 'Trade Secrets', osha_reference: '1910.119(p)', compliance_pct: 100, last_review_date: d(-200), next_review_due: d(165), open_findings: 0, owner: 'Legal Counsel' },
];

const MOCK_AUDITS: Audit[] = [
    {
        id: 'aud-001', audit_number: 'AUD-2026-004', audit_type: 'routine', status: 'completed', scheduled_date: d(-30), lead_auditor: 'N. Nagata', scope: 'MI program compliance — vessels & exchangers', findings: [
            { id: 'f-001', finding_type: 'non_conformance', description: 'CML-HX405-02 inspection overdue by 45 days', ca_priority: 'high', ca_status: 'in_progress', due_date: d(10), assigned_to: 'D. Chen' },
            { id: 'f-002', finding_type: 'recommendation', description: 'Upgrade UT equipment to PAUT for complex geometries', ca_priority: 'medium', ca_status: 'open', due_date: d(60), assigned_to: 'M. Okafor' },
            { id: 'f-003', finding_type: 'observation', description: 'Excellent record-keeping on V-205 thickness trending', ca_priority: 'low', ca_status: 'verified', due_date: d(-15), assigned_to: 'D. Chen' },
        ]
    },
    {
        id: 'aud-002', audit_number: 'AUD-2026-003', audit_type: 'regulatory', status: 'in_progress', scheduled_date: d(-5), lead_auditor: 'External — DNV', scope: 'API 510 / API 653 compliance verification', findings: [
            { id: 'f-004', finding_type: 'critical', description: 'Tank TK-801 floor scan overdue — API 653 violation', ca_priority: 'immediate', ca_status: 'open', due_date: d(5), assigned_to: 'S. Jenkins' },
            { id: 'f-005', finding_type: 'non_conformance', description: 'Missing MDMT records for V-205', ca_priority: 'high', ca_status: 'open', due_date: d(20), assigned_to: 'Process Engineer' },
        ]
    },
    {
        id: 'aud-003', audit_number: 'AUD-2026-002', audit_type: 'management', status: 'closed', scheduled_date: d(-90), lead_auditor: 'S. Jenkins', scope: 'PSM program annual review', findings: [
            { id: 'f-006', finding_type: 'recommendation', description: 'Increase MOC turnaround time target from 30 to 14 days', ca_priority: 'medium', ca_status: 'completed', due_date: d(-30), assigned_to: 'Plant Manager' },
            { id: 'f-007', finding_type: 'observation', description: 'Emergency drills exceed frequency requirements', ca_priority: 'low', ca_status: 'verified', due_date: d(-60), assigned_to: 'HSE Director' },
        ]
    },
    { id: 'aud-004', audit_number: 'AUD-2026-005', audit_type: 'turnaround', status: 'planned', scheduled_date: d(45), lead_auditor: 'N. Nagata', scope: 'Pre-turnaround safety readiness check', findings: [] },
];

const MOCK_REGULATORY: RegulatoryRequirement[] = [
    { id: 'reg-001', regulation_name: 'API 510 — Pressure Vessel Inspection', authority: 'API', applicable_sites: ['Platform Alpha', 'Onshore Terminal'], compliance_status: 'compliant', next_submission: d(180), owner: 'S. Jenkins' },
    { id: 'reg-002', regulation_name: 'API 653 — Tank Inspection', authority: 'API', applicable_sites: ['Onshore Terminal'], compliance_status: 'non_compliant', next_submission: d(15), owner: 'S. Jenkins' },
    { id: 'reg-003', regulation_name: 'OSHA 1910.119 — PSM Standard', authority: 'OSHA', applicable_sites: ['Platform Alpha', 'Onshore Terminal'], compliance_status: 'partially_compliant', next_submission: d(90), owner: 'Safety Manager' },
    { id: 'reg-004', regulation_name: 'EPA SPCC — Oil Spill Prevention', authority: 'EPA', applicable_sites: ['Onshore Terminal'], compliance_status: 'compliant', next_submission: d(270), owner: 'Env. Manager' },
    { id: 'reg-005', regulation_name: 'BSEE SEMS II — Safety & Environmental', authority: 'BSEE', applicable_sites: ['Platform Alpha'], compliance_status: 'compliant', next_submission: d(365), owner: 'HSE Director' },
    { id: 'reg-006', regulation_name: 'DOT PHMSA — Pipeline Safety', authority: 'DOT', applicable_sites: ['Pipeline Corridor'], compliance_status: 'partially_compliant', next_submission: d(120), owner: 'Pipeline Manager' },
    { id: 'reg-007', regulation_name: 'OSHA 1910.147 — LOTO Standard', authority: 'OSHA', applicable_sites: ['Platform Alpha', 'Onshore Terminal'], compliance_status: 'compliant', next_submission: d(300), owner: 'Safety Manager' },
    { id: 'reg-008', regulation_name: 'Clean Air Act — Emissions Reporting', authority: 'EPA', applicable_sites: ['Onshore Terminal'], compliance_status: 'under_review', next_submission: d(60), owner: 'Env. Manager' },
    { id: 'reg-009', regulation_name: 'ASME B31.3 — Process Piping', authority: 'ASME', applicable_sites: ['Platform Alpha', 'Onshore Terminal'], compliance_status: 'compliant', next_submission: d(400), owner: 'Piping Engineer' },
    { id: 'reg-010', regulation_name: 'NFPA 70E — Electrical Safety', authority: 'NFPA', applicable_sites: ['Platform Alpha', 'Onshore Terminal'], compliance_status: 'compliant', next_submission: d(250), owner: 'Electrical Lead' },
];

const MOCK_READINESS: ReadinessScore[] = [
    { id: 'rs-001', regulatory_area: 'Pressure Equipment', score_pct: 88, gap_count: 2, last_assessed: d(-30) },
    { id: 'rs-002', regulatory_area: 'Tank Integrity', score_pct: 52, gap_count: 5, last_assessed: d(-30) },
    { id: 'rs-003', regulatory_area: 'Process Safety', score_pct: 76, gap_count: 4, last_assessed: d(-30) },
    { id: 'rs-004', regulatory_area: 'Environmental', score_pct: 91, gap_count: 1, last_assessed: d(-45) },
    { id: 'rs-005', regulatory_area: 'Pipeline Safety', score_pct: 70, gap_count: 3, last_assessed: d(-60) },
    { id: 'rs-006', regulatory_area: 'Electrical Safety', score_pct: 95, gap_count: 0, last_assessed: d(-20) },
];

// ═══════════════════════════════════════════════════════════════════════
//  HOOK
// ═══════════════════════════════════════════════════════════════════════

export function useSafety() {
    const [lotoPermits, setLotoPermits] = useState(MOCK_LOTO);
    const [psmElements] = useState(MOCK_PSM);
    const [audits, setAudits] = useState(MOCK_AUDITS);
    const [regulations, setRegulations] = useState(MOCK_REGULATORY);
    const [readinessScores] = useState(MOCK_READINESS);

    const addLotoPermit = (l: LOTOPermit) => setLotoPermits(prev => [l, ...prev]);
    const addAudit = (a: Audit) => setAudits(prev => [a, ...prev]);
    const addRegulation = (r: RegulatoryRequirement) => setRegulations(prev => [r, ...prev]);

    const summary = useMemo<SafetySummary>(() => {
        const allFindings = audits.flatMap(a => a.findings);
        const psmTotal = psmElements.reduce((a, e) => a + e.compliance_pct, 0) / (psmElements.length || 1);
        const closedCA = allFindings.filter(f => f.ca_status === 'completed' || f.ca_status === 'verified').length;
        const avgReadiness = readinessScores.reduce((a, r) => a + r.score_pct, 0) / (readinessScores.length || 1);

        return {
            active_loto_permits: lotoPermits.filter(l => l.status === 'active').length,
            pending_clearance: lotoPermits.filter(l => l.status === 'issued').length,
            psm_overall_pct: Math.round(psmTotal),
            moc_open: psmElements.find(e => e.element_name.includes('MOC'))?.open_findings || 0,
            total_audits: audits.length,
            open_findings: allFindings.filter(f => f.ca_status === 'open' || f.ca_status === 'in_progress').length,
            critical_findings: allFindings.filter(f => f.finding_type === 'critical').length,
            overdue_cas: allFindings.filter(f => f.ca_status === 'overdue').length,
            ca_closure_rate_pct: allFindings.length ? Math.round((closedCA / allFindings.length) * 100) : 100,
            total_requirements: regulations.length,
            compliant_count: regulations.filter(r => r.compliance_status === 'compliant').length,
            non_compliant_count: regulations.filter(r => r.compliance_status === 'non_compliant').length,
            overall_readiness_pct: Math.round(avgReadiness),
            critical_gaps: readinessScores.filter(r => r.score_pct < 60).length,
        };
    }, [lotoPermits, psmElements, audits, regulations, readinessScores]);

    return { lotoPermits, psmElements, audits, regulations, readinessScores, summary, addLotoPermit, addAudit, addRegulation };
}
