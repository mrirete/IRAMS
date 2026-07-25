// writebackPackage — pure transformation of approved Specialist proposals into
// rows a foreign CMMS can import (Specialist Phase 3, strategy §6 item 9).
//
// The mirror image of lib/importPipeline: Phase 1 read SAP PM / Maximo /
// MaintainX exports in; this writes drafted work back out in the same
// vendors' upload shapes. Used two ways:
//   1. Export package — always available; the customer bulk-imports the file.
//   2. Live write-back — the same normalized actions POSTed by an outbound
//      connector where the host CMMS exposes an API.
// No I/O here: proposals in, rows out. A human has already approved every
// proposal that reaches this module.

export type TargetSystem = 'generic' | 'sap_pm' | 'maximo' | 'maintainx';

/** A row of ers_agent_actions with status 'approved'. */
export interface ApprovedProposal {
    id: string;
    agent_type: string;
    action_type: string;
    asset_id: string | null;
    draft_payload: Record<string, unknown> | null;
    created_at: string;
}

export interface AssetRef {
    id: string;
    tag: string;
    name: string;
}

export type Priority = 'EMERGENCY' | 'HIGH' | 'MEDIUM' | 'LOW';
export type WorkType = 'CM' | 'PM' | 'PdM' | 'INSPECTION';

/**
 * System-neutral action, derived from a proposal's draft_payload. Every target
 * mapping renders from this — vendor columns never read draft_payload directly.
 */
export interface NormalizedAction {
    proposal_id: string;
    kind: 'work_order' | 'pm_change';
    asset_tag: string;
    asset_name: string;
    title: string;
    description: string;
    priority: Priority;
    work_type: WorkType;
    /** Annual value at stake (savings preferred, else current cost). 0 when unknown. */
    estimated_value: number;
    /** PM interval recommendation in days; null for work orders. */
    interval_days: number | null;
    source: string;
    created_at: string;
}

export interface SkippedProposal {
    proposal_id: string;
    reason: string;
}

export interface WritebackPackage {
    target: TargetSystem;
    columns: string[];
    rows: Record<string, string | number>[];
    actions: NormalizedAction[];
    skipped: SkippedProposal[];
    notes: string[];
}

// ── normalisation ─────────────────────────────────────────────────────────

const PRIORITY_BY_NAME: Record<string, Priority> = {
    critical: 'EMERGENCY',
    emergency: 'EMERGENCY',
    high: 'HIGH',
    medium: 'MEDIUM',
    normal: 'MEDIUM',
    low: 'LOW',
};

function toPriority(raw: unknown): Priority {
    const key = String(raw ?? '').trim().toLowerCase();
    return PRIORITY_BY_NAME[key] ?? 'MEDIUM';
}

function num(raw: unknown): number {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
}

function str(raw: unknown): string {
    return raw === null || raw === undefined ? '' : String(raw).trim();
}

/** Resolve the asset a proposal targets: explicit tag wins, else asset_id lookup. */
function resolveAsset(
    p: ApprovedProposal,
    byId: Map<string, AssetRef>,
): AssetRef | null {
    const payload = p.draft_payload ?? {};
    const tag = str(payload.asset_tag);
    if (p.asset_id && byId.has(p.asset_id)) {
        const hit = byId.get(p.asset_id)!;
        // A payload tag that disagrees with the linked asset is informational
        // only — the FK is authoritative.
        return hit;
    }
    if (tag) {
        for (const a of byId.values()) {
            if (a.tag.toLowerCase() === tag.toLowerCase()) return a;
        }
        // Tag present but unknown locally: still exportable — the host CMMS
        // owns that tag, which is exactly the Mode A case.
        return { id: '', tag, name: str(payload.asset_name) || tag };
    }
    return null;
}

/**
 * Turn one approved proposal into a normalized action. Returns a skip reason
 * instead of throwing when the proposal cannot be expressed as external work.
 */
export function normalizeProposal(
    p: ApprovedProposal,
    byId: Map<string, AssetRef>,
): { action: NormalizedAction } | { skipped: SkippedProposal } {
    const payload = p.draft_payload ?? {};
    const asset = resolveAsset(p, byId);
    if (!asset) {
        return { skipped: { proposal_id: p.id, reason: 'No asset on the proposal — cannot target work in the host CMMS.' } };
    }

    const base = {
        proposal_id: p.id,
        asset_tag: asset.tag,
        asset_name: asset.name,
        source: str(p.agent_type) || 'specialist',
        created_at: p.created_at,
    };

    switch (p.action_type) {
        case 'draft_de_task': {
            const rootCause = str(payload.root_cause_summary);
            const solution = str(payload.proposed_solution);
            const annual = num(payload.annual_cost);
            const savings = num(payload.estimated_savings);
            const lines = [
                solution && `Proposed solution: ${solution}`,
                rootCause && `Suspected root cause: ${rootCause}`,
                annual > 0 && `Current annual cost of this defect: ${Math.round(annual)}`,
                savings > 0 && `Estimated annual saving: ${Math.round(savings)}`,
                `Raised by the Reliability Specialist (${base.source}); approved by a human reviewer.`,
            ].filter(Boolean) as string[];
            return {
                action: {
                    ...base,
                    kind: 'work_order',
                    title: str(payload.title) || `Defect elimination — ${asset.tag}`,
                    description: lines.join('\n'),
                    priority: toPriority(payload.priority),
                    work_type: 'CM',
                    estimated_value: savings || annual,
                    interval_days: null,
                },
            };
        }

        case 'draft_pm_interval': {
            const type = str(payload.recommendation_type) || 'set_interval';
            const days = payload.recommended_interval_days === null || payload.recommended_interval_days === undefined
                ? null
                : num(payload.recommended_interval_days) || null;
            const basis = str(payload.basis);
            const pmCode = str(payload.current_pm_code);

            const headline = type === 'condition_monitoring'
                ? `Move ${asset.tag} to condition monitoring`
                : type === 'quality_review'
                    ? `Review installation/maintenance quality on ${asset.tag}`
                    : days
                        ? `${type === 'extend_interval' ? 'Extend' : 'Set'} PM interval to ${days} days — ${asset.tag}`
                        : `Revise PM basis — ${asset.tag}`;

            const lines = [
                basis && `Statistical basis: ${basis}`,
                pmCode && `Existing PM: ${pmCode}`,
                type === 'condition_monitoring' && 'Failures are age-independent — a fixed interval adds cost without reducing risk.',
                type === 'quality_review' && 'Failures cluster early after work — increasing PM frequency would make this worse.',
                `Raised by the Reliability Specialist (${base.source}); approved by a human reviewer.`,
            ].filter(Boolean) as string[];

            return {
                action: {
                    ...base,
                    kind: 'pm_change',
                    title: headline,
                    description: lines.join('\n'),
                    priority: 'MEDIUM',
                    work_type: type === 'quality_review' ? 'INSPECTION' : 'PM',
                    estimated_value: 0,
                    interval_days: days,
                },
            };
        }

        default: {
            // Unknown proposal kinds still export as a generic work order when
            // they carry a usable title — better than silently dropping work.
            const title = str(payload.title) || str(payload.action);
            if (!title) {
                return { skipped: { proposal_id: p.id, reason: `Unsupported proposal type '${p.action_type}' with no title.` } };
            }
            return {
                action: {
                    ...base,
                    kind: 'work_order',
                    title,
                    description: `${str(payload.description) || str(payload.basis)}\nRaised by the Reliability Specialist (${base.source}); approved by a human reviewer.`.trim(),
                    priority: toPriority(payload.priority),
                    work_type: 'CM',
                    estimated_value: num(payload.estimated_savings) || num(payload.annual_cost),
                    interval_days: null,
                },
            };
        }
    }
}

// ── target column mappings ────────────────────────────────────────────────

/** SAP priority scale: 1 = very high … 4 = low. */
const SAP_PRIORITY: Record<Priority, number> = { EMERGENCY: 1, HIGH: 2, MEDIUM: 3, LOW: 4 };
/** SAP order types — PM01 corrective, PM02 preventive, PM03 predictive, PM05 inspection. */
const SAP_ORDER_TYPE: Record<WorkType, string> = { CM: 'PM01', PM: 'PM02', PdM: 'PM03', INSPECTION: 'PM05' };
const MAXIMO_WORKTYPE: Record<WorkType, string> = { CM: 'CM', PM: 'PM', PdM: 'PDM', INSPECTION: 'INSP' };
const MAXIMO_PRIORITY: Record<Priority, number> = { EMERGENCY: 1, HIGH: 2, MEDIUM: 3, LOW: 4 };
const MAINTAINX_PRIORITY: Record<Priority, string> = { EMERGENCY: 'Critical', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
const MAINTAINX_CATEGORY: Record<WorkType, string> = { CM: 'Reactive', PM: 'Preventive', PdM: 'Preventive', INSPECTION: 'Inspection' };

interface TargetMapping {
    columns: string[];
    row: (a: NormalizedAction) => Record<string, string | number>;
    note?: string;
}

const TARGETS: Record<TargetSystem, TargetMapping> = {
    generic: {
        columns: ['Asset Tag', 'Asset Name', 'Work Type', 'Title', 'Description', 'Priority', 'Interval (days)', 'Est. Annual Value', 'Source', 'Approved On'],
        row: (a) => ({
            'Asset Tag': a.asset_tag,
            'Asset Name': a.asset_name,
            'Work Type': a.work_type,
            'Title': a.title,
            'Description': a.description,
            'Priority': a.priority,
            'Interval (days)': a.interval_days ?? '',
            'Est. Annual Value': a.estimated_value || '',
            'Source': a.source,
            'Approved On': a.created_at.slice(0, 10),
        }),
    },
    sap_pm: {
        columns: ['Order Type', 'Equipment', 'Short Text', 'Priority', 'Long Text', 'MaintActivityType', 'Cycle (days)'],
        row: (a) => ({
            'Order Type': SAP_ORDER_TYPE[a.work_type],
            'Equipment': a.asset_tag,
            // IW31 short text is 40 chars — truncate here rather than let SAP reject the row.
            'Short Text': a.title.slice(0, 40),
            'Priority': SAP_PRIORITY[a.priority],
            'Long Text': a.description,
            'MaintActivityType': a.kind === 'pm_change' ? '002' : '001',
            'Cycle (days)': a.interval_days ?? '',
        }),
        note: 'SAP: PM01=corrective, PM02=preventive, PM05=inspection; priority 1 (very high) to 4 (low). Short text truncated to the 40-character IW31 limit — the full text is in Long Text.',
    },
    maximo: {
        columns: ['WONUM', 'WORKTYPE', 'ASSETNUM', 'DESCRIPTION', 'DESCRIPTION_LONGDESCRIPTION', 'WOPRIORITY', 'STATUS', 'FREQUENCY'],
        row: (a) => ({
            // WONUM left blank so Maximo autonumbers on import.
            'WONUM': '',
            'WORKTYPE': MAXIMO_WORKTYPE[a.work_type],
            'ASSETNUM': a.asset_tag,
            'DESCRIPTION': a.title.slice(0, 100),
            'DESCRIPTION_LONGDESCRIPTION': a.description,
            'WOPRIORITY': MAXIMO_PRIORITY[a.priority],
            'STATUS': 'WAPPR',
            'FREQUENCY': a.interval_days ?? '',
        }),
        note: 'Maximo: WONUM left blank so the system autonumbers; STATUS=WAPPR (waiting approval) so nothing executes without a planner releasing it.',
    },
    maintainx: {
        columns: ['Title', 'Asset', 'Category', 'Priority', 'Description', 'Recurrence (days)'],
        row: (a) => ({
            'Title': a.title,
            'Asset': a.asset_tag,
            'Category': MAINTAINX_CATEGORY[a.work_type],
            'Priority': MAINTAINX_PRIORITY[a.priority],
            'Description': a.description,
            'Recurrence (days)': a.interval_days ?? '',
        }),
    },
};

export const TARGET_LABELS: Record<TargetSystem, string> = {
    generic: 'Generic spreadsheet',
    sap_pm: 'SAP PM (IW31 upload)',
    maximo: 'IBM Maximo',
    maintainx: 'MaintainX',
};

/** Build the export package for a set of approved proposals. */
export function buildPackage(
    proposals: ApprovedProposal[],
    assets: AssetRef[],
    target: TargetSystem = 'generic',
): WritebackPackage {
    const byId = new Map(assets.map((a) => [a.id, a]));
    const actions: NormalizedAction[] = [];
    const skipped: SkippedProposal[] = [];

    for (const p of proposals) {
        const result = normalizeProposal(p, byId);
        if ('action' in result) actions.push(result.action);
        else skipped.push(result.skipped);
    }

    const mapping = TARGETS[target] ?? TARGETS.generic;
    const notes: string[] = [];
    if (mapping.note) notes.push(mapping.note);
    if (skipped.length) notes.push(`${skipped.length} proposal(s) could not be expressed as external work and were left out.`);
    const unknownAssets = actions.filter((a) => !assets.some((x) => x.tag === a.asset_tag)).length;
    if (unknownAssets > 0) {
        notes.push(`${unknownAssets} action(s) reference an asset tag not in this workspace — expected in connected mode, where the host CMMS owns the register.`);
    }

    return {
        target,
        columns: mapping.columns,
        rows: actions.map(mapping.row),
        actions,
        skipped,
        notes,
    };
}

// ── CSV rendering ─────────────────────────────────────────────────────────

function csvCell(value: string | number): string {
    const s = String(value ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Render the package as CSV (CRLF line endings — what Excel and SAP expect). */
export function toCsv(pkg: WritebackPackage): string {
    const header = pkg.columns.map(csvCell).join(',');
    const body = pkg.rows.map((r) => pkg.columns.map((c) => csvCell(r[c] ?? '')).join(','));
    return [header, ...body].join('\r\n');
}
