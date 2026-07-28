/**
 * briefingParse — turn the reliability digest's markdown prose into structure
 * the workspace can render as an interactive briefing (sections, mission list,
 * asset-tag entity links) instead of a wall of asterisks.
 *
 * The digest agent is instructed (agents.ts) to emit exactly five sections —
 * Headline, Maintenance load, Top bad actors, Integrity watch, Act this week —
 * as bold-line headings. This parser is deliberately forgiving about the
 * variants an LLM actually produces (numbered headings, ##-style, a document
 * title line) and degrades to "no sections" so the caller can fall back to
 * plain text. Never throws.
 */

export type SectionKey = 'title' | 'headline' | 'load' | 'badActors' | 'integrity' | 'act' | 'other';

export interface BriefingSection {
    key: SectionKey;
    title: string;
    body: string;
}

export interface ParsedBriefing {
    sections: BriefingSection[];
    /** Items of the "Act this week/month" section, markers stripped. */
    actions: string[];
}

/** A whole line that is a heading: optional ##/1. prefix, then **Title**. */
const HEADING_RE = /^\s*(?:#{1,4}\s*)?(?:\d+\.\s*)?\*\*(.+?)\*\*[:.]?\s*$/;

function classify(title: string): SectionKey {
    const t = title.toLowerCase();
    if (/digest|overview|briefing/.test(t)) return 'title';
    if (/headline/.test(t)) return 'headline';
    if (/maintenance load|open work|workload/.test(t)) return 'load';
    if (/bad actor/.test(t)) return 'badActors';
    if (/integrity/.test(t)) return 'integrity';
    if (/act this|action|this week|this month/.test(t)) return 'act';
    return 'other';
}

const ITEM_RE = /^\s*(?:\d+[.)]\s+|[-*•]\s+)(.*)$/;

export function parseBriefing(text: string): ParsedBriefing {
    const lines = (text ?? '').split(/\r?\n/);
    const sections: BriefingSection[] = [];
    let current: BriefingSection | null = null;
    let sawHeading = false;

    for (const line of lines) {
        const m = line.match(HEADING_RE);
        if (m) {
            sawHeading = true;
            if (current) current.body = current.body.trim();
            current = { key: classify(m[1]), title: m[1].trim(), body: '' };
            sections.push(current);
        } else if (current) {
            current.body += line + '\n';
        } else if (line.trim()) {
            // Prose before any heading — keep it as an untitled headline.
            current = { key: 'headline', title: '', body: line + '\n' };
            sections.push(current);
        }
    }
    if (current) current.body = current.body.trim();
    if (!sawHeading) return { sections: [], actions: [] };

    const kept = sections.filter((s) => s.key !== 'title' && (s.body || s.key === 'headline'));

    // Split the act section into discrete items; continuation lines belong to
    // the previous item (LLMs wrap long actions).
    const actions: string[] = [];
    const act = kept.find((s) => s.key === 'act');
    if (act) {
        for (const line of act.body.split('\n')) {
            const m = line.match(ITEM_RE);
            if (m && m[1].trim()) actions.push(m[1].trim());
            else if (line.trim() && actions.length) actions[actions.length - 1] += ' ' + line.trim();
        }
    }
    return { sections: kept, actions };
}

// ── entity linking ────────────────────────────────────────────────────────

export type TextToken = { kind: 'text' | 'tag'; value: string };

const TAG_BOUNDARY = /[A-Za-z0-9-]/;

/**
 * Split text into text/tag tokens against a set of KNOWN tags (real register
 * rows — never a guessed pattern, so "P-101" in prose only links when P-101
 * exists). Longest tag wins so "P-101-A" is not eaten by "P-101"; matches are
 * case-insensitive and boundary-checked so "PMP-411" never matches "P-411".
 */
export function tokenizeTags(text: string, tags: string[]): TextToken[] {
    if (!text || tags.length === 0) return text ? [{ kind: 'text', value: text }] : [];
    const sorted = [...tags].filter(Boolean).sort((a, b) => b.length - a.length);
    const lower = text.toLowerCase();
    const tokens: TextToken[] = [];
    let pos = 0;

    while (pos < text.length) {
        let best: { at: number; tag: string } | null = null;
        for (const tag of sorted) {
            const at = lower.indexOf(tag.toLowerCase(), pos);
            if (at === -1) continue;
            const beforeOk = at === 0 || !TAG_BOUNDARY.test(text[at - 1]);
            const afterOk = at + tag.length >= text.length || !TAG_BOUNDARY.test(text[at + tag.length]);
            if (!beforeOk || !afterOk) continue;
            if (!best || at < best.at || (at === best.at && tag.length > best.tag.length)) best = { at, tag };
        }
        if (!best) {
            tokens.push({ kind: 'text', value: text.slice(pos) });
            break;
        }
        if (best.at > pos) tokens.push({ kind: 'text', value: text.slice(pos, best.at) });
        tokens.push({ kind: 'tag', value: text.slice(best.at, best.at + best.tag.length) });
        pos = best.at + best.tag.length;
    }
    return tokens;
}

// ── action routing ────────────────────────────────────────────────────────

export interface ActionRoute {
    path: string;
    label: string;
}

/**
 * Where an "Act this week" item leads. Keyword → module map, checked in
 * specificity order. Null when nothing confidently matches (no Go button
 * beats a wrong one).
 */
export function routeForAction(text: string): ActionRoute | null {
    const t = text.toLowerCase();
    if (/\bcml|corrosion|t-min|integrity|inspection/.test(t)) return { path: '/comply/evaluate', label: 'Integrity' };
    if (/root cause|rca\b|defect elimination|investigate/.test(t)) return { path: '/analyze', label: 'Analyze' };
    if (/overdue pm|\bpms?\b|preventive/.test(t)) return { path: '/recurring-work', label: 'PM schedules' };
    if (/work order|open work|backlog/.test(t)) return { path: '/work-orders', label: 'Work orders' };
    if (/warranty/.test(t)) return { path: '/specialist/assessment', label: 'Assessment' };
    if (/proposal|approve/.test(t)) return { path: '/specialist/deliver', label: 'Deliver work' };
    return null;
}
