/**
 * RCMEquipmentTab — "0 · Equipment": what the asset is made of, before the
 * worksheet asks what can fail (0351).
 *
 * The maintainable items of THIS study — subunits, components, parts. Seeded
 * from the register (child assets + BOM) where it exists, typed in where it
 * does not, applied from a template for the next asset of the same class, and
 * saved as a template for the one after that. Everything downstream — the
 * Specialist prompts, the pins, the coverage card, the spares — reads this list.
 *
 * One quiet table. No wizard.
 */
import React, { useMemo, useState } from 'react';
import { Plus, Trash2, Download, Save, ClipboardPaste, Boxes, Lock, ChevronRight, Star, Sparkles, Upload } from 'lucide-react';
import type { RCMStudyItem, RCMBreakdownTemplate } from '../../eam/services/RCMService';

export interface RCMEquipmentTabProps {
  items: RCMStudyItem[];
  locked?: boolean;
  /** what the register could offer, so the import button says how much */
  registerCounts: { components: number; parts: number } | null;
  templates: RCMBreakdownTemplate[];
  assetLabel: string | null;
  assetClass: string | null;
  assetType: string | null;
  saving?: boolean;
  onAdd: (item: Partial<RCMStudyItem> & { name: string }) => void;
  onUpdate: (id: string, patch: Partial<RCMStudyItem>) => void;
  onDelete: (id: string) => void;
  onImportRegister: () => void;
  onApplyTemplate: (template: RCMBreakdownTemplate) => void;
  onSaveTemplate: (name: string) => void;
  onPasteList: (lines: string[], kind: RCMStudyItem['kind']) => void;
  onGoToWorksheet: () => void;
  /** 0352 — the Specialist proposes the items from the asset context (undefined = AI not available). */
  onSuggest?: () => void;
  suggesting?: boolean;
  /** 0352 — typed items become register children / BOM lines (undefined = no register asset behind the study). */
  onPromote?: () => void;
  promotable?: number;
}

const KIND_LABEL: Record<RCMStudyItem['kind'], string> = { subunit: 'Subunit', component: 'Component', part: 'Part' };
const SOURCE_LABEL: Record<RCMStudyItem['source'], string> = { register: 'register', bom: 'BOM', manual: 'typed', template: 'template', specialist: 'Specialist' };

const inp = 'w-full bg-transparent border-b border-transparent hover:border-slate-200 focus:border-accent-cyan focus:outline-none text-xs text-slate-800 py-1 px-1';
const sel = 'text-[11px] bg-white border border-slate-200 rounded-md px-1.5 py-1 text-slate-700 focus:outline-none focus:border-accent-cyan';

export const RCMEquipmentTab: React.FC<RCMEquipmentTabProps> = ({
  items, locked = false, registerCounts, templates, assetLabel, assetClass, assetType, saving,
  onAdd, onUpdate, onDelete, onImportRegister, onApplyTemplate, onSaveTemplate, onPasteList, onGoToWorksheet,
  onSuggest, suggesting, onPromote, promotable = 0,
}) => {
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<RCMStudyItem['kind']>('component');
  const [newParent, setNewParent] = useState<string>('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteKind, setPasteKind] = useState<RCMStudyItem['kind']>('component');
  const [tplName, setTplName] = useState('');
  const [tplOpen, setTplOpen] = useState(false);

  // Tree order: parents before children, parts last.
  const ordered = useMemo(() => {
    const byParent = new Map<string | null, RCMStudyItem[]>();
    for (const i of items) {
      const k = i.kind === 'part' ? '__parts' : (i.parent_item_id && items.some(x => x.id === i.parent_item_id) ? i.parent_item_id : null);
      byParent.set(k, [...(byParent.get(k) || []), i]);
    }
    const out: Array<{ item: RCMStudyItem; depth: number }> = [];
    const walk = (parent: string | null, depth: number, seen: Set<string>) => {
      for (const i of (byParent.get(parent) || []).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))) {
        if (seen.has(i.id)) continue; seen.add(i.id);
        out.push({ item: i, depth });
        walk(i.id, depth + 1, seen);
      }
    };
    walk(null, 0, new Set());
    for (const p of (byParent.get('__parts') || []).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))) out.push({ item: p, depth: 0 });
    return out;
  }, [items]);
  const parents = items.filter(i => i.kind !== 'part');
  const counts = { subunits: items.filter(i => i.kind === 'subunit').length, components: items.filter(i => i.kind === 'component').length, parts: items.filter(i => i.kind === 'part').length };
  const bestTemplate = templates[0] || null;
  const classLabel = [assetClass, assetType].filter(Boolean).join(' / ') || null;

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    onAdd({ name, kind: newKind, parent_item_id: newKind === 'part' ? null : (newParent || null), source: 'manual' });
    setNewName('');
  };

  return (
    <div className="space-y-3 animate-in fade-in duration-300">
      {/* Header — what this is, where it came from, what to do with it */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-4 sm:px-5 py-3 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Boxes size={16} className="text-slate-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-800">Equipment breakdown{assetLabel ? <span className="text-slate-400 font-medium"> · {assetLabel}</span> : null}</p>
            <p className="text-[11px] text-slate-500">
              {items.length === 0
                ? 'What is the equipment made of? The worksheet, the Specialist and the spares all read this list.'
                : `${counts.subunits ? `${counts.subunits} subunit${counts.subunits !== 1 ? 's' : ''} · ` : ''}${counts.components} component${counts.components !== 1 ? 's' : ''} · ${counts.parts} part${counts.parts !== 1 ? 's' : ''}${classLabel ? ` · ${classLabel}` : ''}`}
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {locked && <span className="inline-flex items-center gap-1 text-[11px] text-amber-700"><Lock size={11} /> frozen while approved</span>}
          {!locked && registerCounts && (registerCounts.components + registerCounts.parts) > 0 && (
            <button type="button" onClick={onImportRegister} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-white border border-slate-200 text-slate-700 hover:border-accent-cyan" title="Child assets become subunits / components, BOM lines become parts; re-importing adds only what is new">
              <Download size={12} /> Import from register ({registerCounts.components + registerCounts.parts})
            </button>
          )}
          {!locked && bestTemplate && (
            <button type="button" onClick={() => onApplyTemplate(bestTemplate)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-accent-cyan/10 border border-accent-cyan/40 text-slate-800 hover:bg-accent-cyan/20" title={`${bestTemplate.items.length} items · ${bestTemplate.scope === 'library' ? 'shipped library' : 'saved by your team'}${bestTemplate.asset_type_code ? ` · ${bestTemplate.asset_type_code}` : ''}`}>
              <ClipboardPaste size={12} /> Start from "{bestTemplate.name}" ({bestTemplate.items.length})
            </button>
          )}
          {!locked && (
            <button type="button" onClick={() => setPasteOpen(o => !o)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-white border border-slate-200 text-slate-700 hover:border-accent-cyan" title="One item per line">
              <ClipboardPaste size={12} /> Paste a list
            </button>
          )}
          {!locked && onSuggest && (
            <button type="button" onClick={onSuggest} disabled={!!suggesting} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-amber-50 border border-amber-200 text-amber-800 hover:bg-amber-100 disabled:opacity-60" title="The Reliability Specialist proposes the ISO 14224 subunits and maintainable items from the asset context — added as drafts you can edit">
              <Sparkles size={12} className={suggesting ? 'animate-pulse' : ''} /> {suggesting ? 'Specialist thinking…' : 'Suggest with the Specialist'}
            </button>
          )}
          {!locked && onPromote && promotable > 0 && (
            <button type="button" onClick={onPromote} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-white border border-slate-200 text-slate-700 hover:border-accent-cyan" title="Typed subunits and components become child assets under this asset in the register; parts become BOM lines. The items and their failure modes gain the register links.">
              <Upload size={12} /> Save {promotable} to register
            </button>
          )}
          {items.length > 0 && (
            <button type="button" onClick={() => setTplOpen(o => !o)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-white border border-slate-200 text-slate-700 hover:border-accent-cyan" title="Keep this breakdown for the next study on the same kind of equipment">
              <Save size={12} /> Save as template
            </button>
          )}
          {items.length > 0 && (
            <button type="button" onClick={onGoToWorksheet} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-slate-800 text-white hover:bg-slate-700">
              Next: 1 · Worksheet <ChevronRight size={12} />
            </button>
          )}
        </div>
      </div>

      {templates.length > 1 && !locked && (
        <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-slate-500 px-1">
          <span className="font-bold uppercase tracking-wider text-[9px] text-slate-400">Other templates</span>
          {templates.slice(1, 6).map(t => (
            <button key={t.id} type="button" onClick={() => onApplyTemplate(t)} className="px-2 py-0.5 rounded-full border border-slate-200 hover:bg-slate-50" title={`${t.items.length} items · ${t.scope}`}>{t.name} ({t.items.length})</button>
          ))}
        </div>
      )}

      {tplOpen && (
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-slate-500">Template name</span>
          <input className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 w-72 focus:outline-none focus:border-accent-cyan" value={tplName} onChange={e => setTplName(e.target.value)} placeholder={classLabel ? `${classLabel} — standard breakdown` : 'e.g. Centrifugal compressor — standard breakdown'} />
          <span className="text-[11px] text-slate-400">saved for {classLabel || 'any class'} · {items.length} items</span>
          <button type="button" disabled={!tplName.trim()} onClick={() => { onSaveTemplate(tplName.trim()); setTplName(''); setTplOpen(false); }} className="ml-auto px-3 py-1.5 rounded-lg text-[11px] font-bold bg-primary-600 text-white disabled:opacity-40">Save</button>
        </div>
      )}

      {pasteOpen && !locked && (
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500">One item per line, as</span>
            <select className={sel} value={pasteKind} onChange={e => setPasteKind(e.target.value as RCMStudyItem['kind'])}>
              <option value="subunit">Subunits</option><option value="component">Components</option><option value="part">Parts</option>
            </select>
            <span className="text-[11px] text-slate-400">— a leading "TAG:" becomes the tag, a trailing "*" marks it critical</span>
          </div>
          <textarea className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-accent-cyan font-mono" rows={5} value={pasteText} onChange={e => setPasteText(e.target.value)} placeholder={'DGS: Dry gas seal *\nRADBRG: Radial bearing\nThrust bearing\nSeal gas panel'} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setPasteOpen(false); setPasteText(''); }} className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-slate-600 hover:bg-slate-100">Cancel</button>
            <button type="button" disabled={!pasteText.trim()} onClick={() => { onPasteList(pasteText.split(/\r?\n/).map(l => l.trim()).filter(Boolean), pasteKind); setPasteText(''); setPasteOpen(false); }} className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-primary-600 text-white disabled:opacity-40">Add {pasteText.split(/\r?\n/).filter(l => l.trim()).length || ''} items</button>
          </div>
        </div>
      )}

      {/* The table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="text-left px-3 py-2 w-28">Tag</th>
                <th className="text-left px-3 py-2">Item</th>
                <th className="text-left px-3 py-2 w-28">Kind</th>
                <th className="text-left px-3 py-2 w-44">Under</th>
                <th className="text-center px-3 py-2 w-16" title="Critical to the function">Crit.</th>
                <th className="text-left px-3 py-2 w-24">Qty</th>
                <th className="text-left px-3 py-2 w-20">Source</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {ordered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                  Nothing listed yet. {registerCounts && (registerCounts.components + registerCounts.parts) > 0 ? 'Import from the register, ' : ''}{bestTemplate ? `start from the "${bestTemplate.name}" template, ` : ''}paste a list, or add the first item below.
                </td></tr>
              )}
              {ordered.map(({ item, depth }) => (
                <tr key={item.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-3 py-1"><input className={`${inp} font-mono text-[11px]`} disabled={locked} value={item.tag || ''} placeholder="—" onChange={e => onUpdate(item.id, { tag: e.target.value || null })} /></td>
                  <td className="px-3 py-1">
                    <div className="flex items-center gap-1" style={{ paddingLeft: depth * 14 }}>
                      {depth > 0 && <span className="text-slate-300">└</span>}
                      <input className={inp} disabled={locked} value={item.name} onChange={e => onUpdate(item.id, { name: e.target.value })} />
                    </div>
                  </td>
                  <td className="px-3 py-1">
                    <select className={sel} disabled={locked} value={item.kind} onChange={e => onUpdate(item.id, { kind: e.target.value as RCMStudyItem['kind'], ...(e.target.value === 'part' ? { parent_item_id: null } : {}) })}>
                      {(Object.keys(KIND_LABEL) as RCMStudyItem['kind'][]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-1">
                    {item.kind !== 'part' ? (
                      <select className={`${sel} w-full`} disabled={locked} value={item.parent_item_id || ''} onChange={e => onUpdate(item.id, { parent_item_id: e.target.value || null })}>
                        <option value="">Whole asset</option>
                        {parents.filter(p => p.id !== item.id).map(p => <option key={p.id} value={p.id}>{p.tag ? `${p.tag} — ` : ''}{p.name}</option>)}
                      </select>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-1 text-center">
                    <button type="button" disabled={locked} onClick={() => onUpdate(item.id, { critical: !item.critical })} className={`p-1 rounded ${item.critical ? 'text-amber-500' : 'text-slate-300 hover:text-slate-500'}`} title={item.critical ? 'Critical — click to clear' : 'Mark critical'}>
                      <Star size={13} fill={item.critical ? 'currentColor' : 'none'} />
                    </button>
                  </td>
                  <td className="px-3 py-1">
                    {item.kind === 'part'
                      ? <input className={`${inp} w-20`} disabled={locked} value={item.qty ?? ''} placeholder="1" onChange={e => onUpdate(item.id, { qty: e.target.value === '' ? null : Number(e.target.value) })} />
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-1 text-[10px] text-slate-400">{SOURCE_LABEL[item.source] || item.source}{item.asset_id || item.bom_item_id ? ' · linked' : ''}</td>
                  <td className="px-2 py-1 text-right">
                    {!locked && <button type="button" onClick={() => onDelete(item.id)} className="p-1 text-slate-300 hover:text-red-500" title="Remove"><Trash2 size={13} /></button>}
                  </td>
                </tr>
              ))}
              {!locked && (
                <tr className="border-t border-slate-200 bg-slate-50/40">
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2">
                    <input className="w-full text-xs bg-white border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-accent-cyan" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} placeholder="Add an item — e.g. Seal gas panel" />
                  </td>
                  <td className="px-3 py-2">
                    <select className={sel} value={newKind} onChange={e => setNewKind(e.target.value as RCMStudyItem['kind'])}>
                      {(Object.keys(KIND_LABEL) as RCMStudyItem['kind'][]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    {newKind !== 'part' && (
                      <select className={`${sel} w-full`} value={newParent} onChange={e => setNewParent(e.target.value)}>
                        <option value="">Whole asset</option>
                        {parents.map(p => <option key={p.id} value={p.id}>{p.tag ? `${p.tag} — ` : ''}{p.name}</option>)}
                      </select>
                    )}
                  </td>
                  <td colSpan={3} />
                  <td className="px-2 py-2 text-right">
                    <button type="button" disabled={!newName.trim() || saving} onClick={add} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-primary-600 text-white disabled:opacity-40"><Plus size={12} /> Add</button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[10px] text-slate-400 px-1">ISO 14224 levels 7–9: subunit → component / maintainable item → part. Failure modes on the Worksheet pin to these; spares on the Strategy tab come from the parts.</p>
    </div>
  );
};

export default RCMEquipmentTab;
