/**
 * Module Registry — Central Source of Truth
 * ══════════════════════════════════════════
 * Defines every ERS module: id, tier, routes, sidebar items, dependencies.
 * Used by LicenseContext, Sidebar, App.tsx, and GlobalSettingsPage.
 */

import {
    Home, Wrench, Package,
    ShieldCheck, RefreshCcw, Users, DollarSign, Shield,
    FileBarChart, ClipboardCheck, HardHat, BrainCircuit,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ── Types ────────────────────────────────────────────────

export type ModuleId =
    | 'core'        // Always on — Home, Assets, Admin
    | 'specialist'  // Reliability Specialist — workspace, CMMS import, assessment (the hero product)
    | 'work'        // Work Orders + Service Requests
    | 'inventory'   // Inventory + BOM + PO
    | 'people'      // People, Contacts, OrgChart, Vendors
    | 'predict'     // ML Predictions
    | 'analyze'     // RCA, Bad Actors
    | 'plan'        // PM Planning & Scheduling
    | 'comply'      // Mechanical Integrity — RBI, Inspections, Thickness, FFS/IOW
    | 'safety'      // Process Safety — PSM, LOTO
    | 'audits'      // Standalone Audit Management (entry-level client system)
    | 'vision'      // Computer Vision / AR
    | 'sustain'     // Sustainability / ESG
    | 'intelligence' // Knowledge Graph, Data Quality, Digital Twin
    | 'finops'      // Financial Operations
    | 'scheduling'  // Visual Scheduler
    | 'reports'     // Enterprise analytics and interactive dashboards
    ;

export type ModuleTier = 'core' | 'reliability' | 'integrity' | 'intelligence' | 'sustainability' | 'financial';

/** Sidebar package sections */
export type ModuleSection = 'eam' | 'ers' | 'platform';

export interface SidebarChild {
    id: string;
    label: string;
    path: string;
}

export interface ModuleDefinition {
    id: ModuleId;
    label: string;
    description: string;
    tier: ModuleTier;
    icon: LucideIcon;
    /** Top-level sidebar entry path, or null if using children */
    path: string | null;
    /** Accordion children (e.g. Comply sub-pages) */
    children?: SidebarChild[];
    /** Routes this module owns — used for gating */
    routes: string[];
    /** Other modules this depends on */
    dependencies: ModuleId[];
    /** Sidebar section: 'eam' | 'ers' | 'platform' */
    section: ModuleSection;
    /** If false, module is hidden from default license (demo/mock data only). Admin can still enable manually. */
    launchReady?: boolean;
}

// ── Tier Metadata ────────────────────────────────────────

export const TIER_META: Record<ModuleTier, { label: string; color: string; bg: string; border: string }> = {
    core: { label: 'Core', color: 'text-accent-cyan', bg: 'bg-accent-cyan/10', border: 'border-accent-cyan/30' },
    reliability: { label: 'Reliability', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
    integrity: { label: 'Integrity', color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30' },
    intelligence: { label: 'Intelligence', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
    sustainability: { label: 'Sustainability', color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/30' },
    financial: { label: 'Financial', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
};

// ── Registry ─────────────────────────────────────────────

export const MODULE_REGISTRY: ModuleDefinition[] = [
    {
        id: 'core', label: 'Core Platform', description: 'Dashboard, Assets, Admin & Settings',
        tier: 'core', icon: Home, path: '/',
        routes: ['/', '/assets', '/admin', '/admin/companies', '/admin/migration', '/admin/connectors', '/admin/connectors/new', '/admin/connectors/:id', '/admin/settings', '/admin/error-logs', '/admin/activity-log', '/data-quality', '/login', '/eam-admin', '/system-health', '/notifications'],
        dependencies: [], section: 'eam',
    },
    {
        id: 'work', label: 'Work Management',
        description: 'Maintenance Requests, Work Orders, Recurring Work, Scheduling, Task Library, MoC',
        tier: 'core', icon: Wrench, path: null,
        children: [
            { id: 'my-work', label: 'My Work', path: '/my-work' },
            { id: 'requests', label: 'Maintenance Requests', path: '/requests' },
            { id: 'work-orders', label: 'Work Orders', path: '/work-orders' },
            { id: 'recurring-work', label: 'Recurring Work / PM', path: '/recurring-work' },
            { id: 'condition-data', label: 'Condition Data', path: '/readings' },
            { id: 'maintenance-strategies', label: 'Maintenance Strategies', path: '/maintenance-strategies' },
            { id: 'scheduling', label: 'Scheduling', path: '/scheduling' },
            { id: 'task-library', label: 'Task Library', path: '/task-library' },
            { id: 'moc', label: 'Management of Change', path: '/management-of-change' },
        ],
        routes: ['/my-work', '/requests', '/work-orders', '/recurring-work', '/readings', '/maintenance-strategies', '/scheduling', '/task-library', '/management-of-change'],
        dependencies: ['core'], section: 'eam',
    },
    {
        id: 'inventory', label: 'Inventory & Spares',
        description: 'Parts, BOM, Storerooms, Transactions, Purchase Orders',
        tier: 'core', icon: Package, path: null,
        children: [
            { id: 'inventory', label: 'Inventory', path: '/inventory' },
            { id: 'purchase-orders', label: 'Purchase Orders', path: '/purchase-orders' },
        ],
        routes: ['/inventory', '/purchase-orders'],
        dependencies: ['core'], section: 'eam',
    },
    {
        id: 'people', label: 'People & Org',
        description: 'Contacts, Vendors, Organization Chart',
        tier: 'core', icon: Users, path: null,
        children: [
            { id: 'contacts', label: 'Users', path: '/contacts' },
            { id: 'vendors', label: 'Vendors', path: '/vendors' },
        ],
        routes: ['/contacts', '/vendors'],
        dependencies: ['core'], section: 'eam',
    },
    {
        id: 'specialist', label: 'Reliability Specialist',
        description: 'Your AI reliability engineer — workspace, CMMS data import, assessment report',
        tier: 'intelligence', icon: BrainCircuit, path: null,
        children: [
            { id: 'specialist-home', label: 'Workspace', path: '/specialist' },
            { id: 'specialist-import', label: 'Import CMMS Data', path: '/specialist/import' },
            { id: 'specialist-assessment', label: 'Assessment Report', path: '/specialist/assessment' },
            { id: 'specialist-deliver', label: 'Deliver Work', path: '/specialist/deliver' },
            { id: 'specialist-manuals', label: 'Manuals', path: '/specialist/manuals' },
        ],
        routes: ['/specialist', '/specialist/import', '/specialist/assessment', '/specialist/deliver', '/specialist/manuals'],
        dependencies: ['core'], section: 'ers', launchReady: true,
    },
    {
        id: 'predict', label: 'Reliability Tier',
        description: 'Reliability loop — Measure → Diagnose → Model → Decide (+ Forecast preview)',
        tier: 'reliability', icon: Shield, path: null,
        // Ordered as the reliability loop so the tier reads as one workflow, not 5 flat tools.
        children: [
            { id: 'reliability-home', label: 'Start · Home', path: '/reliability' },
            { id: 'reliability-metrics', label: 'Measure · Metrics', path: '/reliability-metrics' },
            { id: 'analyze-dash', label: 'Diagnose · Analyze', path: '/analyze' },
            { id: 'reliability-modelling', label: 'Model · Reliability Modelling', path: '/reliability-modelling' },
            { id: 'rcm-dash', label: 'Decide · RCM', path: '/rcm' },
            { id: 'predict-dash', label: 'Forecast · Predict (preview)', path: '/predict' },
        ],
        routes: ['/reliability', '/reliability-metrics', '/analyze', '/analyze/rca', '/reliability-modelling', '/rcm', '/predict'],
        dependencies: ['core'], section: 'ers', launchReady: true,
    },

    {
        id: 'comply', label: 'Mechanical Integrity',
        description: 'The fixed-equipment integrity loop — Assess (RBI/damage), Plan (inspections), Measure (thickness/corrosion), Evaluate (FFS/IOW)',
        tier: 'integrity', icon: ShieldCheck, path: null,
        // Ordered as the integrity loop so the tier reads as one workflow.
        children: [
            { id: 'mi-assess', label: 'Assess · Risk & Damage', path: '/comply/assess' },
            { id: 'sched', label: 'Plan · Inspections', path: '/comply/inspection-schedule' },
            { id: 'mi-measure', label: 'Measure · Thickness & Corrosion', path: '/comply/measure' },
            { id: 'mi-evaluate', label: 'Evaluate · FFS & IOW', path: '/comply/evaluate' },
        ],
        // Legacy paths stay listed so gating still resolves their redirects.
        routes: ['/comply/assess', '/comply/inspection-schedule', '/comply/measure', '/comply/evaluate',
            '/comply/rbi', '/comply/thickness-data', '/comply/corrosion-rates',
            '/comply/damage-mechanisms', '/comply/ffs', '/comply/iow-dashboard'],
        dependencies: ['core'], section: 'ers',
    },
    {
        id: 'safety', label: 'Process Safety',
        description: 'PSM studies (HAZOP/LOPA/SIL/PSSR) and LOTO permit lifecycle',
        tier: 'integrity', icon: HardHat, path: null,
        children: [
            { id: 'psm', label: 'PSM', path: '/comply/psm' },
            { id: 'loto', label: 'LOTO', path: '/comply/loto' },
        ],
        routes: ['/comply/psm', '/comply/loto'],
        dependencies: ['core'], section: 'ers',
    },
    {
        id: 'audits', label: 'Compliance & Audits',
        description: 'ISO 55001 Audit Management — Assessments, Templates, Scheduling, Corrective Actions, Regulatory',
        tier: 'integrity', icon: ClipboardCheck, path: null,
        children: [
            { id: 'audit-assessments', label: 'Assessments', path: '/audits' },
            { id: 'audit-templates', label: 'Templates', path: '/audits/templates' },
            { id: 'audit-schedule', label: 'Schedule', path: '/audits/schedule' },
            { id: 'audit-ca', label: 'Corrective Actions', path: '/audits/corrective-actions' },
            { id: 'reg', label: 'Regulatory (preview)', path: '/comply/regulatory' },
        ],
        routes: ['/audits', '/audits/templates', '/audits/schedule', '/audits/corrective-actions', '/comply/regulatory'],
        dependencies: ['core'], section: 'ers',
    },
    {
        id: 'sustain', label: 'Sustain', description: 'Emissions tracking, ESG compliance',
        tier: 'sustainability', icon: RefreshCcw, path: '/sustain',
        routes: ['/sustain'],
        dependencies: ['core'], section: 'ers', launchReady: false,
    },
    {
        id: 'finops', label: 'Financial Ops',
        description: 'Budgeting, cost tracking, asset lifecycle costing',
        tier: 'core', icon: DollarSign, path: '/finops',
        routes: ['/finops'],
        dependencies: ['core'], section: 'eam',
    },
    {
        id: 'reports', label: 'Reports',
        description: 'Enterprise analytics and interactive dashboards',
        tier: 'core', icon: FileBarChart, path: '/reports',
        routes: ['/reports'],
        dependencies: ['core'], section: 'platform',
    },
    // ── Deferred Modules (mock-heavy, hidden from launch) ─────
    {
        id: 'vision', label: 'Vision AI',
        description: 'Computer vision for defect detection, drone surveys, AR inspections',
        tier: 'intelligence', icon: Shield, path: '/vision',
        routes: ['/vision'],
        dependencies: ['predict'], section: 'ers', launchReady: false,
    },
    {
        id: 'intelligence', label: 'Knowledge & Data',
        description: 'Knowledge graph visualization, data quality scoring, digital twin',
        tier: 'intelligence', icon: Shield, path: null,
        children: [
            { id: 'knowledge-dash', label: 'Knowledge Graph', path: '/knowledge-graph' },
            { id: 'data-quality-dash', label: 'Data Quality', path: '/data-quality' },
        ],
        routes: ['/knowledge-graph', '/data-quality'],
        dependencies: ['predict'], section: 'ers', launchReady: false,
    },
];

/** Lookup by module ID */
export const MODULE_MAP = new Map(MODULE_REGISTRY.map(m => [m.id, m]));

/** Get all routes owned by a module */
export function getModuleForRoute(path: string): ModuleDefinition | undefined {
    return MODULE_REGISTRY.find(m => m.routes.some(r => path.startsWith(r) || path === r));
}
