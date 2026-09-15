/**
 * DrawingsCard — "which drawings show this asset".
 *
 * Two sources, both already in the database:
 *   • ers_pid_configurations whose equipment carries this asset (the graph)
 *   • ers_drawing_tags — sheets the Migration Center extracted the tag from
 * Renders nothing at all when neither knows the asset: a quiet card is
 * better than an empty one on a screen that is already busy.
 */
import React, { useEffect, useState } from 'react';
import { FileText, GitBranch } from 'lucide-react';
import { DatabaseService, type AssetDrawings } from '../services/DatabaseService';

interface Props {
    assetId: string | null | undefined;
    assetTag: string | null | undefined;
    /** 'card' = section on the asset Details tab; 'inline' = chips on a work-order row. */
    variant?: 'card' | 'inline';
}

export const DrawingsCard: React.FC<Props> = ({ assetId, assetTag, variant = 'card' }) => {
    const [drawings, setDrawings] = useState<AssetDrawings | null>(null);

    useEffect(() => {
        let alive = true;
        if (!assetId && !assetTag) { setDrawings(null); return; }
        DatabaseService.getInstance().getDrawingsForAsset(assetId ?? null, assetTag ?? null)
            .then((d) => { if (alive) setDrawings(d); })
            .catch(() => { if (alive) setDrawings(null); });
        return () => { alive = false; };
    }, [assetId, assetTag]);

    if (!drawings || (drawings.pids.length === 0 && drawings.sheets.length === 0)) return null;

    const chips = (
        <div className="flex flex-wrap gap-1.5">
            {drawings.pids.map((p) => (
                <span key={`pid-${p.id}`} title="P&ID stored in Analyze" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-cyan-50 text-cyan-800 border border-cyan-100">
                    <GitBranch size={11} /> {p.title}
                </span>
            ))}
            {drawings.sheets.map((s) => (
                <span key={`sheet-${s.drawing_name}-${s.page ?? 0}`} title="Sheet the tag was read from" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-50 text-slate-700 border border-slate-200">
                    <FileText size={11} /> {s.drawing_name}{s.page ? ` p.${s.page}` : ''}
                </span>
            ))}
        </div>
    );

    if (variant === 'inline') return chips;

    return (
        <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-3">
            <h3 className="font-bold text-slate-800 border-b border-slate-100 pb-2">Drawings</h3>
            {chips}
            <p className="text-[10px] text-slate-400">P&IDs from Analyze and sheets read by the Migration Center. Drawings can be out of date — the equipment is the authority.</p>
        </div>
    );
};

export default DrawingsCard;
