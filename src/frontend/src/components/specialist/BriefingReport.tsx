/**
 * BriefingReport — the reliability digest rendered as an interactive brief
 * instead of a wall of markdown asterisks.
 *
 * Design intent: the prose stays the Specialist's voice, but every entity in
 * it becomes a doorway — asset tags open a live mini-dossier popover with
 * routes into the register and the chat; "Act this week" becomes a mission
 * list with progress the user can tick off (persisted per briefing), each
 * mission deep-linking to the module where the work actually happens.
 * Numbers are NOT re-derived here: this component renders the agent's cited
 * text; structure comes from lib/briefingParse (pure, tested).
 *
 * Visual language matches the workspace: flat white, hairline borders, one
 * blue for action, colour only as state (rose = cost pain, amber = risk,
 * emerald = clear/done).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Megaphone, Wrench, TrendingDown, ShieldCheck, ShieldAlert, Target,
    ChevronRight, Check, ExternalLink, MessageCircleQuestion, Sparkles,
} from 'lucide-react';
import {
    parseBriefing, tokenizeTags, routeForAction, MISSION_HANDOFF_KEY,
    type ActiveMission, type BriefingSection, type SectionKey,
} from '../../lib/briefingParse';
import SectionCharts from './BriefingCharts';
import type { BriefingAnalytics } from '../../lib/briefingCharts';

export interface BriefingAsset {
    id: string;
    tag: string;
    name: string;
    criticality: string | null;
}

interface Props {
    text: string;
    /** Stable key for this briefing (created_at) — scopes mission progress. */
    briefingKey: string;
    /** Lower-cased tag → asset row; drives entity linking. */
    assetsByTag: Map<string, BriefingAsset>;
    /** Hand a question to the workspace chat ("Ask the Specialist"). */
    onAsk?: (question: string) => void;
    /** Live chart data (lib/briefingCharts) — computed, never parsed from prose. */
    analytics?: BriefingAnalytics | null;
    formatCurrency?: (n: number) => string;
}

// ── inline rendering ──────────────────────────────────────────────────────

/** Popover mini-dossier behind every linked asset tag. */
const TagChip: React.FC<{ raw: string; asset: BriefingAsset; onAsk?: (q: string) => void }> = ({ raw, asset, onAsk }) => {
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        if (!open) return;
        const close = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);

    return (
        <span ref={ref} className="relative inline-block">
            <button
                onClick={() => setOpen((o) => !o)}
                className={`inline-flex items-center gap-0.5 rounded-md border px-1 py-0 mx-px font-mono text-[0.92em] font-semibold align-baseline transition-colors ${open
                    ? 'border-primary-400 bg-primary-100 text-primary-800'
                    : 'border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100 hover:border-primary-300'}`}
                title={`${asset.tag} · ${asset.name}`}
            >
                {raw}
            </button>
            {open && (
                <span className="absolute left-0 top-full mt-1.5 z-30 block w-64 rounded-xl border border-slate-200 bg-white shadow-lg p-3 text-left animate-in fade-in duration-150">
                    <span className="flex items-start justify-between gap-2">
                        <span className="block min-w-0">
                            <span className="block font-mono text-[12px] font-bold text-slate-800">{asset.tag}</span>
                            <span className="block text-[11.5px] text-slate-500 truncate">{asset.name}</span>
                        </span>
                        {asset.criticality && (
                            <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${asset.criticality === 'A' ? 'bg-rose-50 text-rose-600 border border-rose-200'
                                : asset.criticality === 'B' ? 'bg-amber-50 text-amber-600 border border-amber-200'
                                    : 'bg-slate-50 text-slate-500 border border-slate-200'}`}>
                                Crit {asset.criticality}
                            </span>
                        )}
                    </span>
                    <span className="mt-2.5 flex gap-1.5">
                        <button
                            onClick={() => navigate(`/assets?id=${asset.id}`)}
                            className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-[11px] font-semibold h-7 transition-colors">
                            <ExternalLink size={11} /> Open asset
                        </button>
                        {onAsk && (
                            <button
                                onClick={() => { setOpen(false); onAsk(`Give me the full picture on ${asset.tag} — cost, failures, open work and what you'd do first.`); }}
                                className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 text-[11px] font-semibold h-7 transition-colors">
                                <MessageCircleQuestion size={11} /> Ask
                            </button>
                        )}
                    </span>
                </span>
            )}
        </span>
    );
};

/** Bold + linked-tag inline rendering for one line of prose. */
const InlineText: React.FC<{ text: string; assetsByTag: Map<string, BriefingAsset>; onAsk?: (q: string) => void }> = ({ text, assetsByTag, onAsk }) => {
    const tags = useMemo(() => [...assetsByTag.values()].map((a) => a.tag), [assetsByTag]);
    const parts = text.split(/\*\*(.+?)\*\*/g); // odd indexes were bold
    return (
        <>
            {parts.map((part, i) => {
                const toks = tokenizeTags(part, tags);
                const rendered = toks.map((t, j) => {
                    if (t.kind === 'tag') {
                        const asset = assetsByTag.get(t.value.toLowerCase());
                        if (asset) return <TagChip key={j} raw={t.value} asset={asset} onAsk={onAsk} />;
                    }
                    return <React.Fragment key={j}>{t.value}</React.Fragment>;
                });
                return i % 2 === 1
                    ? <strong key={i} className="font-semibold text-slate-800">{rendered}</strong>
                    : <React.Fragment key={i}>{rendered}</React.Fragment>;
            })}
        </>
    );
};

/** Paragraphs + bullet groups for a section body (or a chat message). */
export const RichText: React.FC<{ text: string; assetsByTag: Map<string, BriefingAsset>; onAsk?: (q: string) => void; className?: string }> = ({ text, assetsByTag, onAsk, className }) => {
    const blocks = useMemo(() => {
        const out: Array<{ kind: 'p' | 'ul'; lines: string[] }> = [];
        for (const raw of text.split('\n')) {
            const line = raw.trimEnd();
            if (!line.trim()) continue;
            const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
            if (bullet) {
                if (out.length === 0 || out[out.length - 1].kind !== 'ul') out.push({ kind: 'ul', lines: [] });
                out[out.length - 1].lines.push(bullet[1]);
            } else {
                out.push({ kind: 'p', lines: [line.trim()] });
            }
        }
        return out;
    }, [text]);

    return (
        <div className={className ?? 'space-y-2'}>
            {blocks.map((b, i) => b.kind === 'p' ? (
                <p key={i} className="text-[13px] text-slate-600 leading-[1.65]">
                    <InlineText text={b.lines[0]} assetsByTag={assetsByTag} onAsk={onAsk} />
                </p>
            ) : (
                <ul key={i} className="space-y-1.5">
                    {b.lines.map((l, j) => (
                        <li key={j} className="flex gap-2 text-[13px] text-slate-600 leading-[1.6]">
                            <span className="mt-[7px] w-1 h-1 rounded-full bg-slate-300 shrink-0" />
                            <span className="min-w-0"><InlineText text={l} assetsByTag={assetsByTag} onAsk={onAsk} /></span>
                        </li>
                    ))}
                </ul>
            ))}
        </div>
    );
};

// ── section chrome ────────────────────────────────────────────────────────

const SECTION_META: Record<Exclude<SectionKey, 'title' | 'headline' | 'act'>, { icon: React.ReactNode; tint: string }> = {
    load: { icon: <Wrench size={14} />, tint: 'text-sky-600 bg-sky-50 border-sky-100' },
    badActors: { icon: <TrendingDown size={14} />, tint: 'text-rose-600 bg-rose-50 border-rose-100' },
    integrity: { icon: <ShieldAlert size={14} />, tint: 'text-amber-600 bg-amber-50 border-amber-100' },
    other: { icon: <Sparkles size={14} />, tint: 'text-slate-500 bg-slate-50 border-slate-100' },
};

const SectionCard: React.FC<{
    section: BriefingSection;
    assetsByTag: Map<string, BriefingAsset>;
    onAsk?: (q: string) => void;
    analytics?: BriefingAnalytics | null;
    formatCurrency?: (n: number) => string;
}> = ({ section, assetsByTag, onAsk, analytics, formatCurrency }) => {
    // Integrity reads calm when the agent reports it clear.
    const clear = section.key === 'integrity' && /no cml|clear|none|nothing/i.test(section.body);
    const meta = clear
        ? { icon: <ShieldCheck size={14} />, tint: 'text-emerald-600 bg-emerald-50 border-emerald-100' }
        : SECTION_META[section.key as keyof typeof SECTION_META] ?? SECTION_META.other;
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="flex items-center gap-2 mb-2.5">
                <span className={`w-6 h-6 rounded-md border flex items-center justify-center ${meta.tint}`}>{meta.icon}</span>
                <span className="text-[12px] font-semibold text-slate-800 uppercase tracking-[0.05em]">{section.title}</span>
            </h3>
            <RichText text={section.body} assetsByTag={assetsByTag} onAsk={onAsk} />
            {formatCurrency && (
                <SectionCharts sectionKey={section.key} analytics={analytics ?? null} formatCurrency={formatCurrency} />
            )}
        </section>
    );
};

// ── missions ──────────────────────────────────────────────────────────────

const MissionList: React.FC<{ actions: string[]; briefingKey: string; assetsByTag: Map<string, BriefingAsset>; onAsk?: (q: string) => void }> = ({ actions, briefingKey, assetsByTag, onAsk }) => {
    const navigate = useNavigate();
    const storageKey = `specialist-missions:${briefingKey}`;
    const [done, setDone] = useState<Set<number>>(() => {
        try { return new Set(JSON.parse(localStorage.getItem(storageKey) ?? '[]') as number[]); }
        catch { return new Set(); }
    });
    // Progress restarts with each new briefing — reload when the key changes.
    useEffect(() => {
        try { setDone(new Set(JSON.parse(localStorage.getItem(storageKey) ?? '[]') as number[])); }
        catch { setDone(new Set()); }
    }, [storageKey]);

    const toggle = (i: number) => {
        setDone((prev) => {
            const next = new Set(prev);
            if (next.has(i)) next.delete(i); else next.add(i);
            try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch { /* private mode */ }
            return next;
        });
    };
    const pct = actions.length ? Math.round((done.size / actions.length) * 100) : 0;

    return (
        <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
                <h3 className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-md border text-primary-600 bg-primary-50 border-primary-100 flex items-center justify-center"><Target size={14} /></span>
                    <span className="text-[12px] font-semibold text-slate-800 uppercase tracking-[0.05em]">This week's missions</span>
                </h3>
                <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-semibold tabular-nums ${done.size === actions.length ? 'text-emerald-600' : 'text-slate-400'}`}>
                        {done.size}/{actions.length} handled
                    </span>
                    <span className="w-20 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <span className={`block h-full rounded-full transition-all duration-500 ${done.size === actions.length ? 'bg-emerald-500' : 'bg-primary-500'}`} style={{ width: `${pct}%` }} />
                    </span>
                </div>
            </div>
            <ul className="divide-y divide-slate-100">
                {actions.map((a, i) => {
                    const route = routeForAction(a);
                    const isDone = done.has(i);
                    /** Go = a guided handoff, not a drop-off: the mission travels
                     *  via sessionStorage and MissionGuide (AppLayout) continues
                     *  the Specialist's walkthrough inside the destination. */
                    const go = () => {
                        if (!route) return;
                        const tags = tokenizeTags(a, [...assetsByTag.values()].map((x) => x.tag))
                            .filter((t) => t.kind === 'tag')
                            .map((t) => assetsByTag.get(t.value.toLowerCase())?.tag ?? t.value);
                        const handoff: ActiveMission = {
                            briefingKey, index: i, text: a,
                            path: route.path, label: route.label,
                            tags: [...new Set(tags)],
                        };
                        try { sessionStorage.setItem(MISSION_HANDOFF_KEY, JSON.stringify(handoff)); } catch { /* ignore */ }
                        navigate(route.path);
                    };
                    return (
                        <li key={i} className={`flex items-start gap-3 px-4 py-3 transition-colors ${isDone ? 'bg-emerald-50/40' : 'hover:bg-slate-50/60'}`}>
                            <button
                                onClick={() => toggle(i)}
                                aria-label={isDone ? 'Mark mission open' : 'Mark mission handled'}
                                className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${isDone
                                    ? 'bg-emerald-500 border-emerald-500 text-white'
                                    : 'border-slate-300 text-transparent hover:border-primary-400'}`}>
                                <Check size={12} strokeWidth={3} />
                            </button>
                            <div className={`flex-1 min-w-0 text-[13px] leading-[1.6] ${isDone ? 'text-slate-400 line-through decoration-slate-300' : 'text-slate-600'}`}>
                                <InlineText text={a} assetsByTag={assetsByTag} onAsk={onAsk} />
                            </div>
                            {route && !isDone && (
                                <button
                                    onClick={go}
                                    title={`The Specialist guides you through this in ${route.label}`}
                                    className="shrink-0 inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white hover:border-primary-300 hover:text-primary-700 text-slate-500 text-[11px] font-semibold px-2 h-7 transition-colors">
                                    {route.label} <ChevronRight size={12} />
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
};

// ── the report ────────────────────────────────────────────────────────────

export const BriefingReport: React.FC<Props> = ({ text, briefingKey, assetsByTag, onAsk, analytics, formatCurrency }) => {
    const parsed = useMemo(() => parseBriefing(text), [text]);

    // Unstructured (errors, free-form replies) → plain rich text, no chrome.
    if (parsed.sections.length === 0) {
        return <RichText text={text} assetsByTag={assetsByTag} onAsk={onAsk} />;
    }

    const headline = parsed.sections.find((s) => s.key === 'headline');
    const cards = parsed.sections.filter((s) => !['headline', 'act'].includes(s.key));

    return (
        <div className="space-y-3">
            {headline && headline.body && (
                <div className="flex gap-3 rounded-xl bg-primary-50/60 border border-primary-100 px-4 py-3">
                    <span className="mt-0.5 text-primary-600 shrink-0"><Megaphone size={16} /></span>
                    <p className="text-[13.5px] text-slate-700 leading-[1.65] font-medium">
                        <InlineText text={headline.body.replace(/\n+/g, ' ')} assetsByTag={assetsByTag} onAsk={onAsk} />
                    </p>
                </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {cards.map((s, i) => (
                    <div key={i} className={cards.length % 2 === 1 && i === cards.length - 1 ? 'md:col-span-2' : ''}>
                        <SectionCard section={s} assetsByTag={assetsByTag} onAsk={onAsk}
                            analytics={analytics} formatCurrency={formatCurrency} />
                    </div>
                ))}
            </div>
            {parsed.actions.length > 0 && (
                <MissionList actions={parsed.actions} briefingKey={briefingKey} assetsByTag={assetsByTag} onAsk={onAsk} />
            )}
        </div>
    );
};

export default BriefingReport;
