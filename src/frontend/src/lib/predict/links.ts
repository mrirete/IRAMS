/**
 * Links between Predict and Reliability Modelling's drawings.
 *
 * Both ends live in the address bar, so Back, refresh and a shared link all
 * land in the same place. Predict: ?asset=&tab=. Reliability Modelling:
 * ?tool=rbd&view=pid (the P&ID view of Block Diagram) plus the drawing to
 * open — or, when no drawing shows the asset yet, the title to pre-fill in
 * the New drawing form — and from=predict so it can offer the way back.
 */

export type PredictTabId = 'overview' | 'twin' | 'rul';

export function predictHref(assetId: string, tab?: PredictTabId | null): string {
    const p = new URLSearchParams({ asset: assetId });
    if (tab && tab !== 'overview') p.set('tab', tab);
    return `/predict?${p.toString()}`;
}

export interface DrawingLink {
    assetId: string;
    /** What the Back banner calls the asset — its tag, else its name. */
    assetLabel: string;
    /** Predict tab to return to. */
    tab?: PredictTabId | null;
    /** The drawing that shows the asset, when one does. */
    drawingId?: string | null;
    /** Pre-filled New drawing title when none does (a P&ID covers a system). */
    newTitle?: string | null;
}

export function drawingHref(l: DrawingLink): string {
    const p = new URLSearchParams({ tool: 'rbd', view: 'pid', from: 'predict', asset: l.assetId, label: l.assetLabel });
    if (l.tab && l.tab !== 'overview') p.set('ptab', l.tab);
    if (l.drawingId) p.set('drawing', l.drawingId);
    else if (l.newTitle) p.set('newTitle', l.newTitle);
    return `/reliability-modelling?${p.toString()}`;
}

/** "Compression Train A — P&ID": named after the system the asset sits in. */
export function newDrawingTitle(systemName: string | null | undefined, assetLabel: string): string {
    const s = (systemName || '').trim();
    return `${s && s !== '-' ? s : assetLabel} — P&ID`;
}
