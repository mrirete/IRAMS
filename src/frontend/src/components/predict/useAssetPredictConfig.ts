import { useCallback, useEffect, useState } from 'react';
import { predictionService, type AssetPredictConfig } from '../../eam/services/PredictionService';

/**
 * The asset's saved Predict setup (assets.properties.predict), loaded fresh for
 * every asset. One owner for the Model tab, so the Monitoring setup pop-up and
 * the vibration panel always read the same saved values.
 */
export function useAssetPredictConfig(assetId: string) {
    // Tagged with the asset it belongs to: on the render right after a switch
    // the previous asset's copy must read as "not loaded", never as this
    // asset's setup (it seeded the new asset's capture speed once).
    const [state, setState] = useState<{ assetId: string; cfg: AssetPredictConfig } | null>(null);

    useEffect(() => {
        let alive = true;
        if (!assetId) return;
        predictionService.getAssetPredictConfig(assetId).then(cfg => { if (alive) setState({ assetId, cfg }); });
        return () => { alive = false; };
    }, [assetId]);

    /** Merge onto the freshest stored copy (other keys — e.g. regime.degree — survive). */
    const save = useCallback(async (patch: Partial<AssetPredictConfig>): Promise<boolean> => {
        const current = await predictionService.getAssetPredictConfig(assetId);
        const next = { ...current, ...patch };
        const ok = await predictionService.saveAssetPredictConfig(assetId, next);
        if (ok) setState({ assetId, cfg: next });
        return ok;
    }, [assetId]);

    const config = state?.assetId === assetId ? state.cfg : null;
    return { config, loading: config === null, save };
}
