import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Search, CornerDownLeft, ArrowUp, ArrowDown, Wrench, Package, FileText } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { MODULE_REGISTRY } from '../config/moduleRegistry';
import { DatabaseService } from '../eam/services/DatabaseService';
import { StatusPill } from '../eam/components/ui';

/**
 * CommandPalette — global ⌘K / Ctrl+K launcher (Spotlight / cmdk style).
 *
 * Searches three sources: navigation pages (from MODULE_REGISTRY), live work
 * orders, and live assets. Keyboard-first (↑/↓ to move, ↵ to open, Esc to close).
 * Opened via the `open-command-palette` window event or the global shortcut
 * (both wired in AppLayout); the TopBar search field also dispatches the event.
 */

interface Command {
    id: string;
    label: string;
    hint?: string;
    icon: LucideIcon;
    group: 'Pages' | 'Work Orders' | 'Assets';
    run: (nav: ReturnType<typeof useNavigate>) => void;
    status?: string;
}

interface AssetLite { id: string; tag?: string; name?: string }
interface WorkOrderLite { id: string; wo_number?: string; title?: string; status?: string }

// Flatten the module registry into page commands (top-level + accordion children).
function buildPageCommands(): Command[] {
    const cmds: Command[] = [];
    for (const mod of MODULE_REGISTRY) {
        if (mod.path) {
            cmds.push({ id: `mod-${mod.id}`, label: mod.label, icon: mod.icon, group: 'Pages', run: (nav) => nav(mod.path!) });
        }
        for (const child of mod.children ?? []) {
            cmds.push({
                id: `child-${child.id}`,
                label: child.label,
                hint: mod.label,
                icon: mod.icon,
                group: 'Pages',
                run: (nav) => nav(child.path),
            });
        }
    }
    return cmds;
}

export const CommandPalette: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const navigate = useNavigate();
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const [assets, setAssets] = useState<AssetLite[]>([]);
    const [workOrders, setWorkOrders] = useState<WorkOrderLite[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const pageCommands = useMemo(buildPageCommands, []);

    // Lazy-load searchable data once on first open
    useEffect(() => {
        if (!open) return;
        setQuery('');
        setActive(0);
        const t = setTimeout(() => inputRef.current?.focus(), 30);
        if (!assets.length) DatabaseService.getInstance().getAssets().then((r) => setAssets(r as AssetLite[])).catch(() => {});
        if (!workOrders.length) DatabaseService.getInstance().getWorkOrders().then((r) => setWorkOrders(r as unknown as WorkOrderLite[])).catch(() => {});
        return () => clearTimeout(t);
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    // Build the filtered, ranked command list
    const results = useMemo<Command[]>(() => {
        const q = query.trim().toLowerCase();
        const pages = pageCommands.filter(c => !q || c.label.toLowerCase().includes(q) || c.hint?.toLowerCase().includes(q));

        const woCmds: Command[] = q
            ? workOrders
                .filter((w) =>
                    (w.wo_number || '').toLowerCase().includes(q) ||
                    (w.title || '').toLowerCase().includes(q))
                .slice(0, 6)
                .map((w) => ({
                    id: `wo-${w.id}`,
                    label: w.title || w.wo_number || w.id,
                    hint: w.wo_number,
                    icon: Wrench,
                    group: 'Work Orders' as const,
                    status: w.status,
                    run: (nav) => nav(`/work-orders/${w.id}`),
                }))
            : [];

        const assetCmds: Command[] = q
            ? assets
                .filter((a) =>
                    (a.tag || '').toLowerCase().includes(q) ||
                    (a.name || '').toLowerCase().includes(q))
                .slice(0, 6)
                .map((a) => ({
                    id: `asset-${a.id}`,
                    label: a.tag || a.name || a.id,
                    hint: a.name,
                    icon: Package,
                    group: 'Assets' as const,
                    run: (nav) => nav('/assets'),
                }))
            : [];

        return [...pages.slice(0, q ? 6 : 12), ...woCmds, ...assetCmds];
    }, [query, pageCommands, workOrders, assets]);

    // Clamp active index when results change
    useEffect(() => { setActive(a => Math.min(a, Math.max(0, results.length - 1))); }, [results.length]);

    // Keyboard handling + body scroll lock
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { onClose(); return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter') {
                e.preventDefault();
                const cmd = results[active];
                if (cmd) { cmd.run(navigate); onClose(); }
            }
        };
        document.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
    }, [open, results, active, navigate, onClose]);

    // Keep the active row scrolled into view
    useEffect(() => {
        listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
    }, [active]);

    if (!open) return null;

    // Group results for rendering while keeping a flat index for keyboard nav
    let flatIdx = -1;
    const groups: Command['group'][] = ['Pages', 'Work Orders', 'Assets'];

    return createPortal(
        <div className="fixed inset-0 z-[120] flex items-start justify-center p-4 pt-[12vh]">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={onClose} aria-hidden />

            <div role="dialog" aria-modal="true" aria-label="Command palette"
                className="relative w-full max-w-xl bg-white rounded-card shadow-overlay flex flex-col max-h-[70vh] overflow-hidden animate-[scaleIn_140ms_ease-out]">
                {/* Search input */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200">
                    <Search size={18} className="text-slate-400 flex-shrink-0" />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                        placeholder="Search pages, work orders, assets…"
                        className="flex-1 bg-transparent text-base text-slate-900 placeholder:text-slate-400 focus:outline-none"
                    />
                    <kbd className="hidden sm:inline text-[10px] font-semibold text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">ESC</kbd>
                </div>

                {/* Results */}
                <div ref={listRef} className="flex-1 overflow-y-auto py-2">
                    {results.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm text-slate-400">No matches for “{query}”.</div>
                    ) : (
                        groups.map(group => {
                            const items = results.filter(r => r.group === group);
                            if (!items.length) return null;
                            return (
                                <div key={group} className="mb-1">
                                    <div className="px-4 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{group}</div>
                                    {items.map(cmd => {
                                        flatIdx++;
                                        const isActive = flatIdx === active;
                                        const Icon = cmd.icon;
                                        const idx = flatIdx;
                                        return (
                                            <button
                                                key={cmd.id}
                                                data-active={isActive}
                                                onMouseEnter={() => setActive(idx)}
                                                onClick={() => { cmd.run(navigate); onClose(); }}
                                                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${isActive ? 'bg-primary-50' : 'hover:bg-slate-50'}`}
                                            >
                                                <Icon size={16} className={isActive ? 'text-primary-600' : 'text-slate-400'} />
                                                <span className="flex-1 min-w-0">
                                                    <span className="block text-sm font-medium text-slate-800 truncate">{cmd.label}</span>
                                                    {cmd.hint && <span className="block text-[11px] text-slate-400 truncate">{cmd.hint}</span>}
                                                </span>
                                                {cmd.status && <StatusPill status={cmd.status} />}
                                                {isActive && <CornerDownLeft size={14} className="text-primary-400 flex-shrink-0" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Footer hint */}
                <div className="flex items-center gap-4 px-4 py-2 border-t border-slate-100 bg-slate-50/60 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1"><ArrowUp size={11} /><ArrowDown size={11} /> navigate</span>
                    <span className="flex items-center gap-1"><CornerDownLeft size={11} /> open</span>
                    <span className="flex items-center gap-1 ml-auto"><FileText size={11} /> {results.length} results</span>
                </div>
            </div>
        </div>,
        document.body
    );
};
