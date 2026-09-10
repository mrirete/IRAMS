/**
 * EquipmentItemPanel — "This item": what the platform already holds about the
 * failed equipment item, read while the RCA collects evidence (0355).
 *
 * Work orders coded to the item, RCM failure modes pinned to it with their
 * strategy and PM, prior RCAs and DE tasks, the latest reading on a linked
 * point. Each line cites into the evidence library with one click — the
 * investigation is about the dry gas seal, not about the whole compressor.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Boxes, Wrench, GitBranch, Search, Activity, Plus, RefreshCw, ArrowUpRight } from 'lucide-react';
import { rcmService, type EquipmentItemHistory } from '../../eam/services/RCMService';

export interface EquipmentItemLink { study_item_id?: string | null; component_asset_id?: string | null; bom_item_id?: string | null; item_label?: string | null }

export interface CitedEvidence {
  evidence_type: 'work_order' | 'fmea' | 'note' | 'sensor_data';
  title: string;
  content: string;
  linked_entity_id: string | null;
}

export const EquipmentItemPanel: React.FC<{
  assetId: string | null;
  link: EquipmentItemLink;
  /** titles already in the evidence library — cited lines are shown as such */
  citedTitles: string[];
  readOnly?: boolean;
  /** the investigation being viewed — never listed under "investigated before" */
  excludeRcaId?: string | null;
  onCite: (ev: CitedEvidence) => Promise<void> | void;
}> = ({ assetId, link, citedTitles, readOnly = false, excludeRcaId = null, onCite }) => {
  const [h, setH] = useState<EquipmentItemHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const hasLink = !!(link.study_item_id || link.component_asset_id || link.bom_item_id || (link.item_label || '').trim());

  useEffect(() => {
    if (!assetId || !hasLink) { setH(null); return; }
    let live = true;
    setLoading(true);
    rcmService.getEquipmentItemHistory(assetId, link).then(r => { if (live) { setH(r ? { ...r, rcas: r.rcas.filter(x => x.id !== excludeRcaId) } : r); setLoading(false); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, link.study_item_id, link.component_asset_id, link.bom_item_id, link.item_label]);

  if (!assetId || !hasLink) return null;
  const cited = new Set(citedTitles.map(t => t.trim().toLowerCase()));
  const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const cite = async (key: string, ev: CitedEvidence) => { setBusy(key); try { await onCite(ev); } finally { setBusy(null); } };
  const CiteBtn: React.FC<{ k: string; ev: CitedEvidence }> = ({ k, ev }) => {
    if (readOnly) return null;
    if (cited.has(ev.title.trim().toLowerCase())) return <span className="text-[10px] font-bold text-emerald-700 shrink-0">cited</span>;
    return (
      <button type="button" onClick={() => void cite(k, ev)} disabled={busy === k} className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold bg-white border border-slate-200 text-slate-700 hover:border-accent-cyan disabled:opacity-50" title="Add this to the evidence library, linked to the record">
        {busy === k ? <RefreshCw size={10} className="animate-spin" /> : <Plus size={10} />} Cite
      </button>
    );
  };
  const empty = h && h.work_orders.length === 0 && h.rcm_modes.length === 0 && h.rcas.length === 0 && h.de_tasks.length === 0 && h.points.length === 0;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 md:p-6 shadow-sm">
      <div className="text-sm sm:text-base font-extrabold text-slate-900 border-b border-slate-100 pb-3.5 mb-4 flex items-center gap-2 flex-wrap">
        <Boxes className="w-4 h-4 text-primary-600" /> This item
        <span className="text-xs font-semibold text-slate-500 truncate">· {link.item_label || 'equipment item'}</span>
        {h && (
          <span className="ml-auto text-[11px] font-semibold text-slate-500" title={`Corrective work orders on the asset in the last ${h.months} months, and how many of them are on this item`}>
            <strong className={h.item_cm_count > 0 ? 'text-red-600' : 'text-slate-700'}>{h.item_cm_count}</strong> of {h.asset_cm_count} corrective work orders on this item · {h.months} months
          </span>
        )}
      </div>
      {loading && <p className="text-xs text-slate-400 flex items-center gap-1.5"><RefreshCw size={12} className="animate-spin" /> Reading the item's history…</p>}
      {!loading && empty && <p className="text-xs text-slate-500">Nothing on record for this item yet — no coded work orders, no RCM failure mode pinned to it, no prior investigation. What you find here will be the first.</p>}
      {!loading && h && !empty && (
        <div className="space-y-4">
          {h.work_orders.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1"><Wrench size={11} /> Work orders coded to this item</p>
              <ul className="space-y-1">
                {h.work_orders.slice(0, 8).map(w => (
                  <li key={w.id} className="flex items-center gap-2 text-xs">
                    <Link to={`/work-orders/${w.id}`} className="font-bold text-primary-700 hover:underline shrink-0">{w.wo_number || w.id.slice(0, 8)}</Link>
                    <span className="text-slate-700 truncate flex-1">{w.title}</span>
                    <span className="text-slate-400 shrink-0">{w.type || ''}{w.failure_mode_code ? ` · ${w.failure_mode_code}` : ''} · {fmt(w.created_at)}</span>
                    <CiteBtn k={`wo-${w.id}`} ev={{ evidence_type: 'work_order', title: `WO ${w.wo_number || w.id.slice(0, 8)} — ${w.title}`, content: `${w.type || 'work order'} on ${link.item_label || 'this item'}${w.failure_mode_code ? `, coded ${w.failure_mode_code}` : ''}, ${fmt(w.created_at)} (${w.status || ''})`, linked_entity_id: w.id }} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {h.rcm_modes.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1"><GitBranch size={11} /> What the RCM study expects of it</p>
              <ul className="space-y-1">
                {h.rcm_modes.slice(0, 6).map(m => (
                  <li key={m.failure_mode_id} className="flex items-center gap-2 text-xs">
                    <span className="text-slate-700 truncate flex-1">{m.failure_mode_code ? <strong className="text-slate-500 mr-1">{m.failure_mode_code}</strong> : null}{m.failure_mode}</span>
                    <span className="text-slate-500 shrink-0 truncate max-w-[22rem]">{m.strategy ? `${m.strategy}${m.interval ? ` every ${m.interval}` : ''}` : 'no strategy yet'}{m.recurring_work_id ? ` · PM ${m.recurring_work_id}` : m.strategy ? ' · no PM yet' : ''}</span>
                    <Link to={`/rcm/${m.study_id}`} className="shrink-0 text-slate-400 hover:text-primary-600" title={`Open "${m.study_title}" (${m.study_status})`}><ArrowUpRight size={12} /></Link>
                    <CiteBtn k={`fm-${m.failure_mode_id}`} ev={{ evidence_type: 'fmea', title: `RCM: ${m.failure_mode}`, content: `Study "${m.study_title}" (${m.study_status}): ${m.strategy || 'no strategy'}${m.task ? ` — ${m.task}` : ''}${m.interval ? ` every ${m.interval}` : ''}${m.recurring_work_id ? `; PM ${m.recurring_work_id}` : '; no PM created'}`, linked_entity_id: m.failure_mode_id }} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {h.points.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1"><Activity size={11} /> Condition</p>
              <ul className="space-y-1">
                {h.points.map(p => (
                  <li key={p.id} className="flex items-center gap-2 text-xs">
                    <span className="text-slate-700 truncate flex-1">{p.name}</span>
                    <span className={`shrink-0 ${p.is_alarm ? 'text-red-600 font-bold' : 'text-slate-500'}`}>{p.last_value != null ? `${p.last_value} ${p.unit || ''}` : 'no reading yet'}{p.last_at ? ` · ${fmt(p.last_at)}` : ''}{p.max_warning != null ? ` · warn > ${p.max_warning}` : ''}</span>
                    <CiteBtn k={`pt-${p.id}`} ev={{ evidence_type: 'sensor_data', title: `Reading: ${p.name}`, content: p.last_value != null ? `${p.last_value} ${p.unit || ''} on ${fmt(p.last_at)}${p.is_alarm ? ' — in alarm' : ''}${p.max_warning != null ? ` (warning above ${p.max_warning})` : ''}` : 'no reading recorded yet', linked_entity_id: p.id }} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(h.rcas.length > 0 || h.de_tasks.length > 0) && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1"><Search size={11} /> Investigated before</p>
              <ul className="space-y-1">
                {h.rcas.map(r => (
                  <li key={r.id} className="flex items-center gap-2 text-xs">
                    <Link to={`/analyze/rca/${r.id}`} className="text-slate-700 hover:text-primary-700 truncate flex-1">RCA: {r.title}</Link>
                    <span className="text-slate-400 shrink-0">{r.status} · {fmt(r.created_at)}</span>
                    <CiteBtn k={`rca-${r.id}`} ev={{ evidence_type: 'note', title: `Prior RCA: ${r.title}`, content: `${r.status}, ${fmt(r.created_at)}${r.root_cause_summary ? ` — root cause then: ${r.root_cause_summary}` : ''}`, linked_entity_id: r.id }} />
                  </li>
                ))}
                {h.de_tasks.map(d => (
                  <li key={d.id} className="flex items-center gap-2 text-xs">
                    <span className="text-slate-700 truncate flex-1">DE: {d.title}</span>
                    <span className="text-slate-400 shrink-0">{d.status} · {fmt(d.created_at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default EquipmentItemPanel;
