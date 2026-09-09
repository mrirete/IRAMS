/**
 * RCMApplyTemplateModal — spool a study template onto similar assets (0352).
 *
 * Pick a saved study template, tick the register assets of that class that
 * have no study yet, and one study per asset is created: breakdown, worksheet
 * and decisions as defaults, each in draft with its own operating context and
 * an "unreviewed" flag that blocks approval until the facilitator confirms the
 * per-asset review. Nothing about implementation or the team is copied.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Layers, CheckSquare, Square, RefreshCw, ArrowRight } from 'lucide-react';
import type { RCMStudyTemplate } from '../../eam/services/RCMService';
import { rcmService } from '../../eam/services/RCMService';

export const RCMApplyTemplateModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onApply: (template: RCMStudyTemplate, assetIds: string[]) => Promise<void>;
}> = ({ open, onClose, onApply }) => {
  const [templates, setTemplates] = useState<RCMStudyTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [assets, setAssets] = useState<Array<{ id: string; tag: string; name: string; criticality: string | null; asset_type_code: string | null }>>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const template = useMemo(() => templates.find(t => t.id === templateId) || null, [templates, templateId]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    rcmService.listStudyTemplates().then(list => { if (!live) return; setTemplates(list); if (!templateId && list[0]) setTemplateId(list[0].id); });
    return () => { live = false; };
  }, [open, templateId]);

  useEffect(() => {
    if (!template) { setAssets([]); return; }
    let live = true;
    setLoading(true);
    rcmService.listAssetsWithoutStudy(template.asset_class, null).then(list => { if (!live) return; setAssets(list); setPicked(new Set()); setLoading(false); });
    return () => { live = false; };
  }, [template]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open || typeof document === 'undefined') return null;
  const modes = template ? template.payload.functions.reduce((n, f) => n + f.failure_modes.length, 0) : 0;
  const toggle = (id: string) => setPicked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const sameType = template?.asset_type_code ? assets.filter(a => a.asset_type_code === template.asset_type_code) : assets;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Apply a study template to similar assets">
      <div className="absolute inset-0 bg-slate-900/40" onClick={() => !busy && onClose()} />
      <div className="relative w-full sm:max-w-2xl bg-white sm:rounded-2xl rounded-t-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[92vh]">
        <div className="flex items-start gap-3 px-5 py-4 border-b border-slate-100">
          <Layers size={16} className="text-primary-600 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-800">Apply a study to similar assets</p>
            <p className="text-[11px] text-slate-500">One study per asset, in draft, with its own operating context. Each needs a per-asset review before approval.</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="px-5 py-4 overflow-y-auto space-y-4">
          {templates.length === 0 ? (
            <p className="text-xs text-slate-500">No study templates yet. Open an approved study and choose "Save as study template" on its Overview.</p>
          ) : (
            <div>
              <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Template</label>
              <select className="w-full text-sm bg-white border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-accent-cyan" value={templateId} onChange={e => setTemplateId(e.target.value)}>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}{t.asset_class ? ` · ${t.asset_class}${t.asset_type_code ? ` / ${t.asset_type_code}` : ''}` : ''}</option>)}
              </select>
              {template && (
                <p className="text-[11px] text-slate-500 mt-1">
                  {template.payload.items.length} equipment items · {template.payload.functions.length} functions · {modes} failure modes with their decisions as defaults · saved {new Date(template.created_at).toLocaleDateString()}
                </p>
              )}
            </div>
          )}
          {template && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider">{template.asset_class || 'Any class'} assets with no study</label>
                {assets.length > 0 && (
                  <button type="button" className="text-[11px] font-bold text-primary-600 hover:underline" onClick={() => setPicked(picked.size === assets.length ? new Set() : new Set(assets.map(a => a.id)))}>
                    {picked.size === assets.length ? 'Clear' : `Select all ${assets.length}`}
                  </button>
                )}
              </div>
              {loading ? <p className="text-xs text-slate-400 flex items-center gap-1.5"><RefreshCw size={12} className="animate-spin" /> Reading the register…</p>
                : assets.length === 0 ? <p className="text-xs text-slate-500">Every {template.asset_class || ''} asset in the register already has a study, or none is classed as {template.asset_class || 'this class'} yet (set the ISO 14224 class on the asset's Details tab).</p>
                : (
                  <ul className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-64 overflow-y-auto">
                    {assets.map(a => (
                      <li key={a.id}>
                        <button type="button" onClick={() => toggle(a.id)} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-50">
                          {picked.has(a.id) ? <CheckSquare size={15} className="text-primary-600 shrink-0" /> : <Square size={15} className="text-slate-300 shrink-0" />}
                          <span className="text-xs font-bold text-slate-700 w-28 shrink-0 truncate">{a.tag}</span>
                          <span className="text-xs text-slate-600 truncate flex-1">{a.name}</span>
                          {a.criticality && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-slate-200 text-slate-500">{a.criticality}</span>}
                          {template.asset_type_code && a.asset_type_code !== template.asset_type_code && <span className="text-[10px] text-amber-700" title={`Template is ${template.asset_type_code}; this asset is ${a.asset_type_code || 'untyped'}`}>different type</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              {template.asset_type_code && sameType.length !== assets.length && assets.length > 0 && (
                <p className="text-[10px] text-slate-400 mt-1">{sameType.length} of {assets.length} share the template's type; the rest are the same class only — review their worksheets more carefully.</p>
              )}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="px-3 py-2 text-xs font-bold rounded-lg text-slate-600 hover:bg-slate-100">Cancel</button>
          <button
            type="button"
            disabled={!template || picked.size === 0 || busy}
            onClick={async () => { if (!template) return; setBusy(true); try { await onApply(template, [...picked]); } finally { setBusy(false); } }}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-primary-600 text-white hover:bg-primary-500 disabled:opacity-50"
          >
            {busy ? <RefreshCw size={12} className="animate-spin" /> : <ArrowRight size={12} />} Create {picked.size || ''} stud{picked.size === 1 ? 'y' : 'ies'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default RCMApplyTemplateModal;
