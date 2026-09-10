/**
 * Study objectives — "what decision is this study for?"
 *
 * A reliability study is not a folder that holds every calculator. It exists
 * to make ONE decision, and the decision picks the tools: a spares study never
 * needs a block diagram, an interval study rarely needs Poisson sizing. Each
 * objective below declares its own short plan — the analysis steps it needs,
 * then the ACTUALISATION step where the answer leaves the study and becomes
 * work (a PM program, a stock level, an RCM strategy, an RCA).
 *
 * Every tool stays reachable from the rail; the plan only says which ones this
 * study is asking for, and in what order.
 */
import type { ReliabilityAnalysisType } from '../../eam/services/AnalyzeService';

export type StudyObjective = 'interval' | 'downtime' | 'spares' | 'weak_link' | 'general';

/** The kinds of work a study can produce — mirrors 0357's `kind` CHECK. */
export type OutcomeKind = 'pm' | 'spares' | 'rcm' | 'rca' | 'wo';

export type ToolId = 'ram' | 'weibull' | 'spares' | 'rbd' | 'montecarlo';

export interface StudyStep {
    /** Analysis step: the tool to open. Absent on the actualisation step. */
    tool?: ToolId;
    /** Which saved analysis type marks this step done. */
    satisfiedBy?: ReliabilityAnalysisType;
    /** The actualisation step: the outcome kind that marks it done. */
    outcome?: OutcomeKind;
    label: string;
    /** Why this step is in the plan — shown under the label. */
    why: string;
    /** Optional steps are shown greyed and never block the plan. */
    optional?: boolean;
}

export interface ObjectiveDef {
    id: StudyObjective;
    label: string;
    /** The decision, in the words a maintenance manager would use. */
    question: string;
    /** What a finished study of this kind hands over. */
    delivers: string;
    /** Prompt for the findings box — what a reviewer needs to read. */
    decisionPrompt: string;
    steps: StudyStep[];
}

export const OBJECTIVES: ObjectiveDef[] = [
    {
        id: 'interval',
        label: 'Set a maintenance interval',
        question: 'When should we change this out, or inspect it, before it fails?',
        delivers: 'A PM program with an evidence-based interval',
        decisionPrompt: 'What interval did you set, on what basis (B10 / η / simulated optimum), and what risk does it accept?',
        steps: [
            { tool: 'weibull', satisfiedBy: 'weibull', label: 'Fit the failure pattern', why: 'β says whether age-based replacement helps at all; η and B10 give the age.' },
            { tool: 'montecarlo', satisfiedBy: 'montecarlo', label: 'Test the interval against run-to-failure', why: 'Compares cost and downtime at P10/P50/P90 — justifies the interval rather than asserting it.', optional: true },
            { outcome: 'pm', label: 'Create the PM program', why: 'The interval becomes scheduled work with the study cited as its origin.' },
        ],
    },
    {
        id: 'downtime',
        label: 'Cut downtime on a bad actor',
        question: 'This asset keeps hurting us — where is the loss and what do we change?',
        delivers: 'A baseline, a failure pattern, and a strategy or investigation',
        decisionPrompt: 'What is the baseline (MTBF / MTTR / availability), what does the failure pattern say, and what change did you decide on?',
        steps: [
            { tool: 'ram', satisfiedBy: 'mtbf', label: 'Establish the baseline', why: 'MTBF, MTTR and availability — the number the improvement is measured against.' },
            { tool: 'weibull', satisfiedBy: 'weibull', label: 'Characterise the failures', why: 'Wear-out, random or infant mortality decides whether a PM, a redesign or an RCA is the right answer.' },
            { outcome: 'rcm', label: 'Send it to a strategy or an investigation', why: 'Wear-out → RCM strategy. Random or repeat failures → RCA. Either way it leaves as work.' },
        ],
    },
    {
        id: 'spares',
        label: 'Right-size a spares holding',
        question: 'How many of these should we hold, and what is the stock-out risk?',
        delivers: 'A min stock level for the resupply window',
        decisionPrompt: 'What min level did you set, at what service level, and over what lead time?',
        steps: [
            { tool: 'ram', satisfiedBy: 'mtbf', label: 'Get the failure rate', why: 'The MTBF that drives demand — taken from work-order history, not a catalogue figure.', optional: true },
            { tool: 'spares', satisfiedBy: 'spares', label: 'Size the holding', why: 'Poisson demand over the resupply window at your service level.' },
            { outcome: 'spares', label: 'Apply the min level', why: 'The number lands on the inventory item, so reordering follows the evidence.' },
        ],
    },
    {
        id: 'weak_link',
        label: 'Find the weak link',
        question: 'Which single item takes the whole system down, and is redundancy worth it?',
        delivers: 'System availability and a ranked target to spend on',
        decisionPrompt: 'Which block limits the system, what is the system availability, and what change did you recommend?',
        steps: [
            { tool: 'rbd', label: 'Model the system', why: 'Series, parallel and k-of-n structure — where a single failure propagates.' },
            { tool: 'montecarlo', satisfiedBy: 'montecarlo', label: 'Forecast the loss', why: 'Puts hours and cost against the weak link so the spend can be argued.', optional: true },
            { outcome: 'rcm', label: 'Take the target forward', why: 'A redesign, a redundancy case or an RCM strategy on the limiting block.' },
        ],
    },
    {
        id: 'general',
        label: 'General analysis',
        question: 'Exploratory — no single decision yet.',
        delivers: 'Saved, versioned analyses to build on',
        decisionPrompt: 'What did this study conclude, and what should happen next?',
        steps: [],
    },
];

export const objectiveDef = (id: string | null | undefined): ObjectiveDef =>
    OBJECTIVES.find(o => o.id === id) ?? OBJECTIVES[OBJECTIVES.length - 1];

export const OUTCOME_META: Record<OutcomeKind, { label: string; verb: string; href: (refId: string | null) => string }> = {
    pm:     { label: 'PM program',      verb: 'Created',  href: id => id ? `/recurring-work?id=${id}` : '/recurring-work' },
    spares: { label: 'Inventory level', verb: 'Applied',  href: id => id ? `/inventory?id=${id}` : '/inventory' },
    rcm:    { label: 'RCM strategy',    verb: 'Sent to',  href: () => '/rcm' },
    rca:    { label: 'Investigation',   verb: 'Raised',   href: id => id ? `/analyze/rca/${id}` : '/analyze?tab=rca' },
    wo:     { label: 'Work order',      verb: 'Raised',   href: id => id ? `/work-orders?id=${id}` : '/work-orders' },
};
