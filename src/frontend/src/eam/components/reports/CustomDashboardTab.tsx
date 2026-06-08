import React, { useState, useCallback } from 'react';
import {
  Plus, Trash2, Edit3, Copy, X, GripVertical, ChevronDown,
  LayoutDashboard, Download, Sparkles, BarChart3, Gauge
} from 'lucide-react';
import { useDashboardStore } from '../../stores/DashboardStore';
import { WIDGET_REGISTRY, getWidgetByKey, getWidgetsByCategory, WidgetData } from './WidgetRegistry';
import { exportXLSX } from '../../utils/reportExport';

interface CustomDashboardTabProps {
  widgetData: WidgetData;
}

export const CustomDashboardTab: React.FC<CustomDashboardTabProps> = ({ widgetData }) => {
  const {
    state, activeDashboard,
    createDashboard, deleteDashboard, renameDashboard, duplicateDashboard,
    setActive, removeWidget, reorderWidgets,
  } = useDashboardStore();

  const [showAddPanel, setShowAddPanel] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [newDashName, setNewDashName] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // ── Dashboard CRUD Handlers ──
  const handleCreate = useCallback(() => {
    const name = newDashName.trim() || `Dashboard ${state.dashboards.length + 1}`;
    createDashboard(name);
    setNewDashName('');
    setShowNewModal(false);
  }, [newDashName, state.dashboards.length, createDashboard]);

  const handleRename = useCallback((id: string) => {
    if (renameValue.trim()) renameDashboard(id, renameValue.trim());
    setRenaming(null);
  }, [renameValue, renameDashboard]);

  const handleDelete = useCallback((id: string) => {
    if (confirm('Delete this dashboard? This cannot be undone.')) deleteDashboard(id);
  }, [deleteDashboard]);

  // ── Add Widget ──
  const { addWidget } = useDashboardStore();
  const handleAddWidget = useCallback((widgetKey: string) => {
    const def = getWidgetByKey(widgetKey);
    if (!def || !activeDashboard) return;
    addWidget(activeDashboard.id, {
      type: def.type,
      widgetKey: def.key,
      title: def.label,
      w: def.defaultW,
      h: def.defaultH,
    });
  }, [activeDashboard, addWidget]);

  // ── Drag and Drop (simple index swap) ──
  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  };
  const handleDrop = (idx: number) => {
    if (dragIdx === null || dragIdx === idx || !activeDashboard) return;
    const ids = activeDashboard.widgets.map(w => w.id);
    const [removed] = ids.splice(dragIdx, 1);
    ids.splice(idx, 0, removed);
    reorderWidgets(activeDashboard.id, ids);
    setDragIdx(null);
    setDragOverIdx(null);
  };
  const handleDragEnd = () => { setDragIdx(null); setDragOverIdx(null); };

  // ── Export All ──
  const handleExportAll = useCallback(() => {
    if (!activeDashboard) return;
    const rows = activeDashboard.widgets.map(w => ({
      widget: w.title,
      type: w.type,
      key: w.widgetKey,
    }));
    const cols = [
      { key: 'widget', label: 'Widget' },
      { key: 'type', label: 'Type' },
      { key: 'key', label: 'Key' },
    ];
    exportXLSX(rows, cols, `ERS_Dashboard_${activeDashboard.name}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }, [activeDashboard]);

  // ── Empty State ──
  if (state.dashboards.length === 0) {
    return (
      <>
        <div className="flex items-center justify-center min-h-[500px]">
          <div className="text-center max-w-lg">
            {/* Premium empty state */}
            <div className="relative mx-auto w-28 h-28 mb-6">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-3xl rotate-6" />
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-indigo-500/10 rounded-3xl -rotate-3" />
              <div className="relative bg-white border border-slate-200 rounded-2xl w-full h-full flex items-center justify-center shadow-lg">
                <LayoutDashboard size={40} className="text-blue-500" />
              </div>
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">Build Your Custom Dashboard</h3>
            <p className="text-slate-500 text-sm mb-1 font-medium leading-relaxed">
              Pin charts and KPIs from any report tab, or start fresh by adding widgets from the catalog.
              Arrange, resize, and save multiple dashboard views for your team.
            </p>
            <p className="text-slate-400 text-xs mb-6">Dashboards are saved locally and persist across sessions.</p>
            <button
              onClick={() => setShowNewModal(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-sm font-semibold shadow-lg shadow-blue-500/25 transition-all hover:shadow-xl hover:shadow-blue-500/30 hover:-translate-y-0.5"
            >
              <Plus size={16} /> Create Your First Dashboard
            </button>
          </div>
        </div>

        {/* New Dashboard Modal (must be inside this return) */}
        {showNewModal && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center" onClick={() => setShowNewModal(false)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="px-6 py-5 border-b border-slate-100">
                <h3 className="text-lg font-bold text-slate-900">Create Dashboard</h3>
                <p className="text-sm text-slate-500 mt-0.5">Name your custom dashboard view</p>
              </div>
              <div className="px-6 py-5">
                <input
                  autoFocus
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-slate-50 font-medium"
                  placeholder="e.g. Daily Operations, Monthly Review..."
                  value={newDashName}
                  onChange={e => setNewDashName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                />
              </div>
              <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
                <button
                  onClick={() => setShowNewModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors shadow-sm"
                >
                  Create Dashboard
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  const widgetsByCategory = getWidgetsByCategory();
  const pinnedKeys = new Set(activeDashboard?.widgets.map(w => w.widgetKey) || []);

  return (
    <div className="space-y-4">
      {/* ── Dashboard Toolbar ── */}
      <div className="flex items-center justify-between gap-4 bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
        {/* Left: Dashboard selector */}
        <div className="flex items-center gap-3">
          <LayoutDashboard size={18} className="text-blue-600" />
          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-sm font-semibold text-slate-800 transition-colors min-w-[180px]"
            >
              <span className="truncate">{activeDashboard?.name || 'Select Dashboard'}</span>
              <ChevronDown size={14} className={`text-slate-400 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showDropdown && (
              <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1 max-h-64 overflow-y-auto">
                {state.dashboards.map(d => (
                  <div key={d.id} className={`group flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer ${d.id === activeDashboard?.id ? 'bg-blue-50' : ''}`}>
                    {renaming === d.id ? (
                      <input
                        autoFocus
                        className="flex-1 text-sm border border-blue-300 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onBlur={() => handleRename(d.id)}
                        onKeyDown={e => e.key === 'Enter' && handleRename(d.id)}
                      />
                    ) : (
                      <>
                        <span
                          className="flex-1 text-sm font-medium text-slate-700 truncate"
                          onClick={() => { setActive(d.id); setShowDropdown(false); }}
                        >
                          {d.name}
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium">{d.widgets.length} widgets</span>
                        <button onClick={() => { setRenaming(d.id); setRenameValue(d.name); }}
                          className="p-1 rounded hover:bg-slate-200 opacity-0 group-hover:opacity-100 transition-opacity" title="Rename">
                          <Edit3 size={12} className="text-slate-400" />
                        </button>
                        <button onClick={() => duplicateDashboard(d.id)}
                          className="p-1 rounded hover:bg-slate-200 opacity-0 group-hover:opacity-100 transition-opacity" title="Duplicate">
                          <Copy size={12} className="text-slate-400" />
                        </button>
                        <button onClick={() => handleDelete(d.id)}
                          className="p-1 rounded hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity" title="Delete">
                          <Trash2 size={12} className="text-red-400" />
                        </button>
                      </>
                    )}
                  </div>
                ))}
                <div className="border-t border-slate-100 mt-1 pt-1">
                  <button
                    onClick={() => { setShowNewModal(true); setShowDropdown(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 transition-colors"
                  >
                    <Plus size={14} /> New Dashboard
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddPanel(!showAddPanel)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition-colors shadow-sm"
          >
            <Plus size={14} /> Add Widget
          </button>
          <button
            onClick={handleExportAll}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 hover:bg-slate-50 rounded-lg text-xs font-semibold text-slate-600 transition-colors"
          >
            <Download size={13} /> Export All
          </button>
        </div>
      </div>

      {/* ── Add Widget Drawer ── */}
      {showAddPanel && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-blue-500" />
              <h4 className="text-sm font-bold text-slate-800">Widget Catalog</h4>
              <span className="text-[10px] text-slate-400 font-medium bg-slate-100 px-2 py-0.5 rounded-full">
                {WIDGET_REGISTRY.length} available
              </span>
            </div>
            <button onClick={() => setShowAddPanel(false)} className="p-1 rounded hover:bg-slate-200 transition-colors">
              <X size={14} className="text-slate-400" />
            </button>
          </div>
          <div className="p-4 space-y-4 max-h-80 overflow-y-auto">
            {Object.entries(widgetsByCategory).map(([category, widgets]) => (
              <div key={category}>
                <h5 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{category}</h5>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
                  {widgets.map(w => {
                    const alreadyPinned = pinnedKeys.has(w.key);
                    return (
                      <button
                        key={w.key}
                        onClick={() => !alreadyPinned && handleAddWidget(w.key)}
                        disabled={alreadyPinned}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-xs font-medium transition-all
                          ${alreadyPinned
                            ? 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed'
                            : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 text-slate-600 hover:shadow-sm'
                          }`}
                      >
                        {w.type === 'chart' ? <BarChart3 size={13} /> : <Gauge size={13} />}
                        <span className="truncate">{w.label}</span>
                        {alreadyPinned && <span className="text-[9px] ml-auto">✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Widget Grid ── */}
      {activeDashboard && activeDashboard.widgets.length === 0 && (
        <div className="flex flex-col items-center justify-center h-64 bg-white border border-dashed border-slate-300 rounded-xl">
          <BarChart3 size={32} className="text-slate-300 mb-3" />
          <p className="text-sm font-semibold text-slate-500 mb-1">No widgets yet</p>
          <p className="text-xs text-slate-400 mb-4">Click "Add Widget" above or pin charts from other report tabs</p>
          <button
            onClick={() => setShowAddPanel(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition-colors shadow-sm"
          >
            <Plus size={14} /> Add Widget
          </button>
        </div>
      )}

      {activeDashboard && activeDashboard.widgets.length > 0 && (
        <div className="grid grid-cols-12 gap-4 auto-rows-[280px]">
          {activeDashboard.widgets.map((widget, idx) => {
            const def = getWidgetByKey(widget.widgetKey);
            if (!def) return null;

            const colSpan = Math.min(widget.w, 12);
            const isDragging = dragIdx === idx;
            const isDragOver = dragOverIdx === idx;

            return (
              <div
                key={widget.id}
                className={`relative group rounded-xl border bg-white shadow-sm overflow-hidden transition-all
                  ${isDragging ? 'opacity-40 scale-95 border-blue-300' : ''}
                  ${isDragOver ? 'border-blue-400 ring-2 ring-blue-200/50' : 'border-slate-200 hover:shadow-md'}
                `}
                style={{ gridColumn: `span ${colSpan}` }}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDrop={() => handleDrop(idx)}
                onDragEnd={handleDragEnd}
              >
                {/* Widget Header */}
                <div className="flex items-center justify-between px-4 pt-3 pb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <GripVertical size={14} className="text-slate-300 cursor-grab hover:text-slate-500 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                    <h4 className="text-sm font-bold text-slate-800 truncate">{widget.title}</h4>
                  </div>
                  <button
                    onClick={() => removeWidget(activeDashboard.id, widget.id)}
                    className="p-1 rounded-md hover:bg-red-50 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                    title="Remove widget"
                  >
                    <X size={13} />
                  </button>
                </div>

                {/* Widget Content */}
                <div className="px-4 pb-4" style={{ height: 'calc(100% - 44px)' }}>
                  {def.render(widgetData)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── New Dashboard Modal ── */}
      {showNewModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center" onClick={() => setShowNewModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-5 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900">Create Dashboard</h3>
              <p className="text-sm text-slate-500 mt-0.5">Name your custom dashboard view</p>
            </div>
            <div className="px-6 py-5">
              <input
                autoFocus
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-slate-50 font-medium"
                placeholder="e.g. Daily Operations, Monthly Review..."
                value={newDashName}
                onChange={e => setNewDashName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
              />
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
              <button
                onClick={() => setShowNewModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors shadow-sm"
              >
                Create Dashboard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Click-away for dropdown */}
      {showDropdown && (
        <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
      )}
    </div>
  );
};
