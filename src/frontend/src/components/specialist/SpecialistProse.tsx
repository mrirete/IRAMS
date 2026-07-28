/**
 * SpecialistProse — drop-in replacement for the `whitespace-pre-wrap` agent
 * prose blob, anywhere in the app.
 *
 * Renders agent output through the briefing's RichText (markdown bold/lists +
 * asset-tag chips with the mini-dossier popover), fetching the register tag
 * map itself so callers need no wiring. The map is fetched once per session
 * (module-level cache) — ten panels rendering prose cost one query.
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '../../eam/lib/supabase';
import { RichText, type BriefingAsset } from './BriefingReport';

let tagMapPromise: Promise<Map<string, BriefingAsset>> | null = null;

function loadTagMap(): Promise<Map<string, BriefingAsset>> {
    tagMapPromise ??= (async () => {
        const { data, error } = await supabase
            .from('assets')
            .select('id, tag, name, criticality')
            .limit(10000);
        if (error) {
            // Next mount retries instead of caching an empty map forever.
            tagMapPromise = null;
            return new Map();
        }
        return new Map(((data ?? []) as BriefingAsset[]).map((a) => [a.tag.toLowerCase(), a]));
    })();
    return tagMapPromise;
}

export const SpecialistProse: React.FC<{
    text: string;
    className?: string;
    onAsk?: (question: string) => void;
}> = ({ text, className, onAsk }) => {
    const [map, setMap] = useState<Map<string, BriefingAsset>>(new Map());
    useEffect(() => {
        let alive = true;
        void loadTagMap().then((m) => { if (alive) setMap(m); });
        return () => { alive = false; };
    }, []);
    return <RichText text={text} assetsByTag={map} onAsk={onAsk} className={className} />;
};

export default SpecialistProse;
