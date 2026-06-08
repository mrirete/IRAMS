import { useState, useMemo, useCallback } from 'react';
import type { MaintenancePlan, ScheduleEntry, BacklogItem, PlanningSummary, MaintenanceStrategy } from '../types/plan';
import { MOCK_ASSETS } from './useIntelligence';

// ═══════════════════════════════════════════════════════════════════════
//  MOCK DATA — Planning & Scheduling
// ═══════════════════════════════════════════════════════════════════════

const d = (daysOff: number) => new Date(Date.now() + daysOff * 86400000).toISOString();

const MOCK_PLANS: MaintenancePlan[] = [
    {
        id: 'pm-001',
        plan_number: 'PM-10024',
        title: 'Quarterly Vibration & Oil Analysis',
        asset_id: 'ast-k601',
        strategy: 'Condition-Based (PdM)',
        frequency_days: 90,
        required_craft: 'Reliability Tech',
        estimated_hours: 4,
        last_completed_date: d(-85),
        next_due_date: d(5), // Due Soon
        compliance_status: 'due_soon',
        is_active: true
    },
    {
        id: 'pm-002',
        plan_number: 'PM-10025',
        title: 'Annual Turbine Hot Gas Path Inspection',
        asset_id: 'ast-gt301',
        strategy: 'Time-Based (PM)',
        frequency_days: 365,
        required_craft: 'Turbine Specialist',
        estimated_hours: 120,
        last_completed_date: d(-400),
        next_due_date: d(-35), // Overdue
        compliance_status: 'overdue',
        is_active: true
    },
    {
        id: 'pm-003',
        plan_number: 'PM-10026',
        title: 'Weekly Lube Oil Top-up',
        asset_id: 'ast-p102',
        strategy: 'Time-Based (PM)',
        frequency_days: 7,
        required_craft: 'Operator',
        estimated_hours: 1,
        last_completed_date: d(-2),
        next_due_date: d(5), // Compliant
        compliance_status: 'compliant',
        is_active: true
    },
    {
        id: 'pm-004',
        plan_number: 'PM-10027',
        title: 'Monthly ESD Valve Stroke Test',
        asset_id: 'ast-esd990',
        strategy: 'Statutory (Compliance)',
        frequency_days: 30,
        required_craft: 'Instrument Tech',
        estimated_hours: 2,
        last_completed_date: d(-28),
        next_due_date: d(2),
        compliance_status: 'due_soon',
        is_active: true
    }
];

const MOCK_SCHEDULE: ScheduleEntry[] = [
    {
        id: 'sch-001',
        reference_id: 'wo-101', // Linked to the CM WO from useWork
        title: 'Replace High Vibration Bearing',
        asset_id: 'ast-k601',
        planned_date: d(1),
        assigned_crew: 'Mech-Crew-B',
        required_craft: 'Millwright',
        estimated_hours: 24,
        status: 'scheduled'
    },
    {
        id: 'sch-002',
        reference_id: 'pm-001',
        title: 'Quarterly Vibration & Oil Analysis',
        asset_id: 'ast-k601',
        planned_date: d(2),
        assigned_crew: 'Rel-Team-A',
        required_craft: 'Reliability Tech',
        estimated_hours: 4,
        status: 'scheduled'
    },
    {
        id: 'sch-003',
        reference_id: 'pm-004',
        title: 'Monthly ESD Valve Stroke Test',
        asset_id: 'ast-esd990',
        planned_date: d(3),
        assigned_crew: null, // Unassigned
        required_craft: 'Instrument Tech',
        estimated_hours: 2,
        status: 'scheduled'
    },
    {
        id: 'sch-004',
        reference_id: 'pm-002',
        title: 'Annual Turbine Inspection',
        asset_id: 'ast-gt301',
        planned_date: d(-1),
        assigned_crew: 'Contractor-GE',
        required_craft: 'Turbine Specialist',
        estimated_hours: 120,
        status: 'deferred',
        deferral_reason: 'Waiting on specialized tools from vendor'
    }
];

const MOCK_BACKLOG: BacklogItem[] = [
    {
        id: 'bl-001',
        wo_number: 'WO-2024-1050',
        title: 'Repair seal leak on main pump',
        asset_id: 'ast-p102',
        priority: 'urgent',
        estimated_hours: 12,
        required_craft: 'Mechanic',
        ready_to_schedule: true,
        days_in_backlog: 4
    },
    {
        id: 'bl-002',
        wo_number: 'WO-2024-1051',
        title: 'Replace damaged insulation',
        asset_id: 'ast-hx405',
        priority: 'routine',
        estimated_hours: 16,
        required_craft: 'Scaffolder/Insulator',
        ready_to_schedule: false, // Waiting on materials
        days_in_backlog: 12
    },
    {
        id: 'bl-003',
        wo_number: 'WO-2024-1052',
        title: 'Calibrate pressure transmitter',
        asset_id: 'ast-v205',
        priority: 'routine',
        estimated_hours: 3,
        required_craft: 'Instrument Tech',
        ready_to_schedule: true,
        days_in_backlog: 2
    }
];

// ═══════════════════════════════════════════════════════════════════════
//  HOOK
// ═══════════════════════════════════════════════════════════════════════

export function usePlan() {
    const [plans, setPlans] = useState<MaintenancePlan[]>(MOCK_PLANS);
    const [schedule, setSchedule] = useState<ScheduleEntry[]>(MOCK_SCHEDULE);
    const [backlog, setBacklog] = useState<BacklogItem[]>(MOCK_BACKLOG);

    const summary = useMemo<PlanningSummary>(() => {
        const compliant = plans.filter(p => p.compliance_status === 'compliant' || p.compliance_status === 'due_soon').length;
        const total = plans.length || 1;

        const deferrals = schedule.filter(s => s.status === 'deferred').length;
        const schedTot = schedule.length || 1;

        return {
            pm_compliance_pct: Math.round((compliant / total) * 100),
            backlog_weeks: 3.2, // mock value
            planned_vs_reactive_ratio: 78, // 78% planned, 22% reactive
            schedule_adherence_pct: Math.round(((schedTot - deferrals) / schedTot) * 100),
            deferred_pms: deferrals
        };
    }, [plans, schedule]);

    // Create new PM Plan
    const createPlan = useCallback((title: string, assetId: string, strategy: MaintenanceStrategy, freq: number, craft: string, hrs: number) => {
        const asset = MOCK_ASSETS.find(a => a.id === assetId);
        if (!asset) return;

        const newPlan: MaintenancePlan = {
            id: `pm-${Date.now()}`,
            plan_number: `PM-10${Math.floor(Math.random() * 900) + 100}`,
            title,
            asset_id: asset.id,
            strategy,
            frequency_days: freq,
            required_craft: craft,
            estimated_hours: hrs,
            last_completed_date: null,
            next_due_date: new Date(Date.now() + freq * 86400000).toISOString(),
            compliance_status: 'compliant',
            is_active: true
        };
        setPlans(prev => [newPlan, ...prev]);
    }, []);

    // Drag from Backlog to Schedule (simplified)
    const scheduleBacklogItem = useCallback((blId: string, date: string, crew: string) => {
        const blItem = backlog.find(b => b.id === blId);
        if (!blItem) return;

        const newSch: ScheduleEntry = {
            id: `sch-${Date.now()}`,
            reference_id: blItem.wo_number,
            title: blItem.title,
            asset_id: blItem.asset_id,
            planned_date: date,
            assigned_crew: crew,
            required_craft: blItem.required_craft,
            estimated_hours: blItem.estimated_hours,
            status: 'scheduled'
        };

        setSchedule(prev => [...prev, newSch]);
        setBacklog(prev => prev.filter(b => b.id !== blId)); // Remove from backlog
    }, [backlog]);

    return {
        plans,
        schedule,
        backlog,
        summary,
        createPlan,
        scheduleBacklogItem
    };
}
