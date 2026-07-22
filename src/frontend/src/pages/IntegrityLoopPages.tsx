/**
 * Mechanical Integrity — loop-step wrapper pages.
 *
 * The integrity workflow is one loop (Assess → Plan → Measure → Evaluate),
 * previously shattered into seven flat sidebar pages that all read the same
 * useIntegrity data. Each step here pairs its two views as tabs so the tier
 * reads as a workflow, not a tool pile. Legacy routes redirect in with a
 * ?tab= hint so old links land on the right view.
 */

import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RbiPage } from './RbiPage';
import { DamageMechanismsPage } from './DamageMechanismsPage';
import { ThicknessDataPage } from './ThicknessDataPage';
import { CorrosionRatesPage } from './CorrosionRatesPage';
import { FfsPage } from './FfsPage';
import { IowDashboardPage } from './IowDashboardPage';

interface TabDef {
    key: string;
    label: string;
    render: () => React.ReactNode;
}

/** Slim step tab bar — the tab content is a full existing page. */
const LoopStep: React.FC<{ step: string; tabs: TabDef[] }> = ({ step, tabs }) => {
    const [params] = useSearchParams();
    const requested = params.get('tab');
    const [active, setActive] = useState(
        tabs.some(t => t.key === requested) ? (requested as string) : tabs[0].key,
    );
    const current = tabs.find(t => t.key === active) ?? tabs[0];

    return (
        <div>
            <div className="flex items-center gap-1 mb-4 border-b border-slate-200">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mr-3 pb-2">{step}</span>
                {tabs.map(t => (
                    <button
                        key={t.key}
                        onClick={() => setActive(t.key)}
                        className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                            active === t.key
                                ? 'border-primary-500 text-primary-700'
                                : 'border-transparent text-slate-500 hover:text-slate-700'
                        }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>
            {current.render()}
        </div>
    );
};

/** Assess — risk drives everything downstream. */
export const ComplyAssessPage: React.FC = () => (
    <LoopStep
        step="Assess"
        tabs={[
            { key: 'rbi', label: 'Risk-Based Inspection', render: () => <RbiPage /> },
            { key: 'dm', label: 'Damage Mechanisms', render: () => <DamageMechanismsPage /> },
        ]}
    />
);

/** Measure — one dataset, two lenses (trends vs raw readings). */
export const ComplyMeasurePage: React.FC = () => (
    <LoopStep
        step="Measure"
        tabs={[
            { key: 'corrosion', label: 'Corrosion Trends', render: () => <CorrosionRatesPage /> },
            { key: 'readings', label: 'Thickness Readings', render: () => <ThicknessDataPage /> },
        ]}
    />
);

/** Evaluate — engineering disposition of what the measurements found. */
export const ComplyEvaluatePage: React.FC = () => (
    <LoopStep
        step="Evaluate"
        tabs={[
            { key: 'ffs', label: 'Fitness-for-Service', render: () => <FfsPage /> },
            { key: 'iow', label: 'Operating Windows', render: () => <IowDashboardPage /> },
        ]}
    />
);
