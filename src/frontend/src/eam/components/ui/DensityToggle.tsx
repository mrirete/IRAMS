import React from 'react';
import { AlignLeft, StretchHorizontal } from 'lucide-react';

/**
 * DensityToggle — Compact / Spacious toggle for data tables.
 * Desktop-only control (field technicians on mobile get card views instead).
 *
 * Usage:
 *   const [density, setDensity] = useState<'compact' | 'spacious'>('compact');
 *   <DensityToggle value={density} onChange={setDensity} />
 *   <div className={`density-${density}`}>
 *     <table>...</table>
 *   </div>
 */

export type Density = 'compact' | 'spacious';

interface DensityToggleProps {
    value: Density;
    onChange: (density: Density) => void;
}

export const DensityToggle: React.FC<DensityToggleProps> = ({ value, onChange }) => {
    return (
        <div className="hidden md:flex items-center bg-slate-100 p-0.5 rounded-lg" title="Table density">
            <button
                onClick={() => onChange('compact')}
                className={`p-1.5 rounded-md transition-colors ${
                    value === 'compact'
                        ? 'bg-white shadow-sm text-slate-800'
                        : 'text-slate-400 hover:text-slate-600'
                }`}
                title="Compact view"
                aria-label="Compact density"
            >
                <AlignLeft size={14} />
            </button>
            <button
                onClick={() => onChange('spacious')}
                className={`p-1.5 rounded-md transition-colors ${
                    value === 'spacious'
                        ? 'bg-white shadow-sm text-slate-800'
                        : 'text-slate-400 hover:text-slate-600'
                }`}
                title="Spacious view"
                aria-label="Spacious density"
            >
                <StretchHorizontal size={14} />
            </button>
        </div>
    );
};
