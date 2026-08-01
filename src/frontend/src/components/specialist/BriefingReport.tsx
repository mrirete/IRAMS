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
    Megaphone, Wrench, TrendingDown, TrendingUp, ShieldCheck, ShieldAlert, Target,
    ChevronRight, Check, ExternalLink, MessageCircleQuestion, Sparkles,
    BadgeDollarSign, Database,
} from 'lucide-react';
import {
    parseBriefing, tokenizeTags, routeForAction, deepLink, takeaway, MISSION_HANDOFF_KEY,
    type ActiveMission, type BriefingSection, type SectionKey,
} from '../../lib/briefingParse';
import SectionCharts, { hasSectionChart, BacklogFigures } from './BriefingCharts';
import ReportModal from './ReportModal';
import type { BriefingAnalytics } from '../../lib/briefingCharts';
import type { DetMission } from '../../lib/missionEngine';

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
    /** Deterministic, self-verifying missions (lib/missionEngine). When
     *  provided they REPLACE the parsed act-items — the data decides "done",
     *  not the honor system. */
    missions?: DetMission[] | null;
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
        const out: Array<{ kind: 'p' | 'ul' | 'h'; lines: string[] }> = [];
        for (const raw of text.split('\n')) {
            const line = raw.trimEnd();
            if (!line.trim()) continue;
            // A markdown heading that reached this far (unstructured fallback,
            // a chat reply) is rendered AS a heading. Printing the literal `###`
            // is the one thing it must never do.
            const heading = line.match(/^\s*#{1,6}\s+(\S.*?)\s*$/);
            if (heading) {
                out.push({ kind: 'h', lines: [heading[1].replace(/\*\*/g, '').replace(/[:.]$/, '')] });
                continue;
            }
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
            {blocks.map((b, i) => b.kind === 'h' ? (
                <h4 key={i} className="pt-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                    {b.lines[0]}
                </h4>
            ) : b.kind === 'p' ? (
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
    wins: { icon: <BadgeDollarSign size={14} />, tint: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
    data: { icon: <Database size={14} />, tint: 'text-slate-500 bg-slate-50 border-slate-100' },
    trend: { icon: <TrendingUp size={14} />, tint: 'text-indigo-600 bg-indigo-50 border-indigo-100' },
    other: { icon: <Sparkles size={14} />, tint: 'text-slate-500 bg-slate-50 border-slate-100' },
};

/**
 * A briefing section: the picture first, one line of the Specialist's own
 * words, and the full text a click away.
 *
 * Why this shape — the digest used to open every section with a paragraph, so
 * reading it was the only way to find out whether it mattered. Now the figure
 * carries the magnitude, the takeaway carries the point, and anyone who wants
 * the reasoning opens it. Nothing is hidden: "Read the full section" states how
 * much more there is, and the full prose is the same text, unedited.
 */
const SectionCard: React.FC<{
    section: BriefingSection;
    assetsByTag: Map<string, BriefingAsset>;
    onAsk?: (q: string) => void;
    analytics?: BriefingAnalytics | null;
    formatCurrency?: (n: number) => string;
}> = ({ section, assetsByTag, onAsk, analytics, formatCurrency }) => {
    const [open, setOpen] = useState(false);
    // Integrity reads calm when the agent reports it clear.
    const clear = section.key === 'integrity' && /no cml|clear|none|nothing/i.test(section.body);
    const meta = clear
        ? { icon: <ShieldCheck size={14} />, tint: 'text-emerald-600 bg-emerald-50 border-emerald-100' }
        : SECTION_META[section.key as keyof typeof SECTION_META] ?? SECTION_META.other;

    const charted = formatCurrency ? hasSectionChart(section.key, analytics ?? null) : false;
    const figures = section.key === 'load' && analytics ? <BacklogFigures analytics={analytics} /> : null;
    const lead = takeaway(section.body);
    // With no illustration and nothing to hold back, the section is short
    // enough to simply read where it stands.
    const inlineOnly = !charted && !figures && !lead.truncated;

    const header = (
        <h3 className="flex items-center gap-2">
            <span className={`w-6 h-6 rounded-md border flex items-center justify-center ${meta.tint}`}>{meta.icon}</span>
            <span className="text-[12px] font-semibold text-slate-800 uppercase tracking-[0.05em]">{section.title}</span>
        </h3>
    );

    return (
        <>
            <section className="rounded-xl border border-slate-200 bg-white p-4">
                {/* One affordance per card. A header button AND a footer link
                    for the same overlay is two signs pointing the same way. */}
                <div className="mb-2.5">{header}</div>

                {/* Illustration first — magnitude before narration. */}
                {figures && <div className={charted ? 'mb-3' : 'mb-3'}>{figures}</div>}
                {charted && formatCurrency && (
                    <SectionCharts sectionKey={section.key} analytics={analytics ?? null}
                        formatCurrency={formatCurrency} flush={!figures} />
                )}

                {inlineOnly ? (
                    <RichText text={section.body} assetsByTag={assetsByTag} onAsk={onAsk} />
                ) : (
                    <div className={charted || figures ? 'mt-3' : ''}>
                        {lead.text
                            ? <p className="text-[13px] leading-[1.65] text-slate-600">
                                <InlineText text={lead.text} assetsByTag={assetsByTag} onAsk={onAsk} />
                            </p>
                            : <p className="text-[12px] italic text-slate-400">The Specialist's detail for this section is in the full text.</p>}
                        <button
                            onClick={() => setOpen(true)}
                            className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary-600 transition-colors hover:text-primary-700"
                        >
                            Read the full section <ChevronRight size={12} />
                        </button>
                    </div>
                )}
            </section>

            <ReportModal
                open={open}
                onClose={() => setOpen(false)}
                title={section.title}
                subtitle="The Specialist's full read on this section — same text, nothing summarised away."
                icon={meta.icon}
                width="lg"
            >
                {figures && <div className="mb-4">{figures}</div>}
                {charted && formatCurrency && (
                    <div className="mb-4">
                        <SectionCharts sectionKey={section.key} analytics={analytics ?? null}
                            formatCurrency={formatCurrency} flush={!figures} />
                    </div>
                )}
                <RichText text={section.body} assetsByTag={assetsByTag} onAsk={onAsk} />
            </ReportModal>
        </>
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
                        const tagAssets = [...new Set(tokenizeTags(a, [...assetsByTag.values()].map((x) => x.tag))
                            .filter((t) => t.kind === 'tag')
                            .map((t) => assetsByTag.get(t.value.toLowerCase()))
                            .filter((x): x is BriefingAsset => Boolean(x)))];
                        // Sharpened destination: pre-scoped to the mission's entities.
                        const target = deepLink(route, tagAssets);
                        const handoff: ActiveMission = {
                            briefingKey, index: i, text: a,
                            path: target, label: route.label,
                            tags: tagAssets.map((x) => x.tag),
                        };
                        try { sessionStorage.setItem(MISSION_HANDOFF_KEY, JSON.stringify(handoff)); } catch { /* ignore */ }
                        navigate(target);
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

/** Self-verifying mission list: the data marks missions done, nobody ticks. */
const DetMissionList: React.FC<{
    missions: DetMission[];
    briefingKey: string;
    assetsByTag: Map<string, BriefingAsset>;
    onAsk?: (q: string) => void;
}> = ({ missions, briefingKey, assetsByTag, onAsk }) => {
    const navigate = useNavigate();
    const doneCount = missions.filter((m) => m.done).length;
    const pct = missions.length ? Math.round((doneCount / missions.length) * 100) : 0;

    const go = (m: DetMission, i: number) => {
        if (!m.path) return;
        const handoff: ActiveMission = {
            briefingKey, index: i, text: m.text,
            path: m.path, label: m.label ?? 'module', tags: m.tags,
        };
        try { sessionStorage.setItem(MISSION_HANDOFF_KEY, JSON.stringify(handoff)); } catch { /* ignore */ }
        navigate(m.path);
    };

    return (
        <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
                <h3 className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-md border text-primary-600 bg-primary-50 border-primary-100 flex items-center justify-center"><Target size={14} /></span>
                    <span className="text-[12px] font-semibold text-slate-800 uppercase tracking-[0.05em]">This week's missions</span>
                    <span className="hidden sm:inline text-[10px] font-medium text-slate-400 normal-case tracking-normal">verified from your records — done means done</span>
                </h3>
                <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-semibold tabular-nums ${doneCount === missions.length ? 'text-emerald-600' : 'text-slate-400'}`}>
                        {doneCount}/{missions.length} done
                    </span>
                    <span className="w-20 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <span className={`block h-full rounded-full transition-all duration-500 ${doneCount === missions.length ? 'bg-emerald-500' : 'bg-primary-500'}`} style={{ width: `${pct}%` }} />
                    </span>
                </div>
            </div>
            <ul className="divide-y divide-slate-100">
                {missions.map((m, i) => (
                    <li key={m.id} className={`flex items-start gap-3 px-4 py-3 transition-colors ${m.done ? 'bg-emerald-50/40' : 'hover:bg-slate-50/60'}`}>
                        {m.done ? (
                            <span className="mt-0.5 w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0">
                                <Check size={12} strokeWidth={3} />
                            </span>
                        ) : (
                            <span className="mt-0.5 w-5 h-5 rounded-full border-2 border-primary-300 bg-primary-50 text-primary-700 text-[9.5px] font-bold flex items-center justify-center shrink-0 tabular-nums">
                                {m.current > 9 ? '9+' : m.current}
                            </span>
                        )}
                        <div className={`flex-1 min-w-0 text-[13px] leading-[1.6] ${m.done ? 'text-slate-400' : 'text-slate-600'}`}>
                            <InlineText text={m.text} assetsByTag={assetsByTag} onAsk={onAsk} />
                            {m.done && (
                                <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[9.5px] font-bold px-1.5 py-px align-middle">
                                    <Check size={9} strokeWidth={3} /> verified
                                </span>
                            )}
                        </div>
                        {m.path && !m.done && (
                            <button
                                onClick={() => go(m, i)}
                                title={`The Specialist guides you through this in ${m.label}`}
                                className="shrink-0 inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white hover:border-primary-300 hover:text-primary-700 text-slate-500 text-[11px] font-semibold px-2 h-7 transition-colors">
                                {m.label} <ChevronRight size={12} />
                            </button>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    );
};

// ── the report ────────────────────────────────────────────────────────────

export const BriefingReport: React.FC<Props> = ({ text, briefingKey, assetsByTag, onAsk, analytics, formatCurrency, missions }) => {
    const parsed = useMemo(() => parseBriefing(text), [text]);

    // Unstructured (errors, free-form replies) → plain rich text, no chrome.
    if (parsed.sections.length === 0) {
        return <RichText text={text} assetsByTag={assetsByTag} onAsk={onAsk} />;
    }

    // Every headline-keyed block (explicit Headline section + any title-lede
    // the parser folded in) merges into one hero statement.
    const headlineBody = parsed.sections
        .filter((s) => s.key === 'headline' && s.body)
        .map((s) => s.body)
        .join('\n');
    const cards = parsed.sections.filter((s) => !['headline', 'act'].includes(s.key));

    return (
        <div className="space-y-3">
            {headlineBody && (
                <div className="flex gap-3 rounded-xl bg-primary-50/60 border border-primary-100 px-4 py-3">
                    <span className="mt-0.5 text-primary-600 shrink-0"><Megaphone size={16} /></span>
                    <p className="text-[13.5px] text-slate-700 leading-[1.65] font-medium">
                        <InlineText text={headlineBody.replace(/\n+/g, ' ')} assetsByTag={assetsByTag} onAsk={onAsk} />
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
            {missions && missions.length > 0 ? (
                <DetMissionList missions={missions} briefingKey={briefingKey} assetsByTag={assetsByTag} onAsk={onAsk} />
            ) : parsed.actions.length > 0 ? (
                <MissionList actions={parsed.actions} briefingKey={briefingKey} assetsByTag={assetsByTag} onAsk={onAsk} />
            ) : null}
        </div>
    );
};

export default BriefingReport;
