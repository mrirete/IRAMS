/**
 * FMECA Division — Proactive: "What could fail?"
 *
 * IEC 60812 workflow: Criticality Assessment → FMEA Worksheets
 *   Step 1: Risk-rank assets to determine which need FMEA
 *   Step 2: Analyze failure modes for high-criticality assets
 */
import React, { useState } from 'react';
import { ShieldAlert, AlertTriangle } from 'lucide-react';
import FMEATab from './FMEATab';
import CriticalityAssessmentTab from './CriticalityAssessmentTab';

interface FMECADivisionProps {
    fmeaWorksheets: any[];
    onNewFMEA: () => void;
    onRefresh?: () => void;
}

type FMECASubTab = 'criticality' | 'fmea';

export const FMECADivision: React.FC<FMECADivisionProps> = ({
    fmeaWorksheets,
    onNewFMEA,
    onRefresh,
}) => {
    const [activeSubTab, setActiveSubTab] = useState<FMECASubTab>('criticality');

    const SUB_TABS: { id: FMECASubTab; label: string; icon: React.ReactNode; desc: string }[] = [
        { id: 'criticality', label: 'Criticality Assessment', icon: <AlertTriangle size={14} />, desc: 'Risk-rank assets (Severity × Probability) — determines which need FMEA' },
        { id: 'fmea', label: 'FMEA Worksheets', icon: <ShieldAlert size={14} />, desc: 'Failure Mode & Effects Analysis — identify how assets can fail and score RPN' },
    ];

    return (
        <div className="space-y-4">
            {/* Sub-tab bar */}
            <div className="flex gap-1 bg-white/80 backdrop-blur-sm p-1 rounded-xl border border-slate-200/60 shadow-sm">
                {SUB_TABS.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveSubTab(tab.id)}
                        className={`group flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-250 ${activeSubTab === tab.id
                            ? 'bg-gradient-to-r from-primary-500 to-primary-500 text-white shadow-md shadow-primary-500/20'
                            : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                            }`}
                    >
                        <span className={`transition-colors duration-250 ${activeSubTab === tab.id ? 'text-white/90' : 'text-slate-400 group-hover:text-primary-500'}`}>{tab.icon}</span>
                        <span>{tab.label}</span>
                    </button>
                ))}
            </div>

            {/* Description */}
            <div className="flex items-center gap-2 px-1">
                <div className="w-1 h-3.5 rounded-full bg-gradient-to-b from-primary-400 to-primary-400" />
                <p className="text-xs text-slate-500">
                    {SUB_TABS.find(t => t.id === activeSubTab)?.desc}
                </p>
            </div>

            {/* Content */}
            {activeSubTab === 'criticality' && <CriticalityAssessmentTab />}
            {activeSubTab === 'fmea' && (
                <FMEATab
                    fmeaWorksheets={fmeaWorksheets}
                    onNewFMEA={onNewFMEA}
                    onRefresh={onRefresh}
                />
            )}
        </div>
    );
};

export default FMECADivision;
