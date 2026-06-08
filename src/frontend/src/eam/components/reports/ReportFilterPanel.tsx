import React, { useState, useMemo } from 'react';
import { Filter, X, ChevronDown, ChevronRight, RotateCcw, MapPin, Check, Search } from 'lucide-react';
import { DictionaryEntry } from '../../types';

export interface ReportFilters {
  selectedAssetIds: string[];
  departments: string[];
  assetTypes: string[];
  assetCategories: string[];
  assetClasses: string[];
  criticalities: string[];
  statuses: string[];
  workTypes: string[];
  priorities: string[];
  costCenters: string[];
}

export const EMPTY_FILTERS: ReportFilters = {
  selectedAssetIds: [], departments: [], assetTypes: [], assetCategories: [],
  assetClasses: [], criticalities: [], statuses: [], workTypes: [],
  priorities: [], costCenters: [],
};

// ── Hierarchy Level styling ─────────────────────────────
const LEVEL_STYLE: Record<string, { color: string; bg: string; border: string; icon: string }> = {
  SITE:      { color: 'text-blue-600',   bg: 'bg-blue-50',    border: 'border-blue-400',   icon: '📍' },
  UNIT:      { color: 'text-indigo-600', bg: 'bg-indigo-50',  border: 'border-indigo-400', icon: '🏭' },
  SYSTEM:    { color: 'text-teal-600',   bg: 'bg-teal-50',    border: 'border-teal-400',   icon: '⚙️' },
  EQUIPMENT: { color: 'text-amber-600',  bg: 'bg-amber-50',   border: 'border-amber-400',  icon: '🔧' },
  COMPONENT: { color: 'text-slate-500',  bg: 'bg-slate-50',   border: 'border-slate-300',  icon: '🔩' },
};
const DEFAULT_STYLE = { color: 'text-slate-600', bg: 'bg-slate-50', border: 'border-slate-300', icon: '•' };

interface TreeNodeData {
  id: string;
  tag: string;
  name: string;
  hierarchy_level: string;
  parent_id: string | null;
  children: TreeNodeData[];
  depth: number;
  // Roll-up metrics
  descendantCount: number;
  descendantWOCount: number;
}

// ── FilterSection (reused for dictionary filters) ──────
interface FilterSectionProps {
  label: string;
  options: { value: string; label: string; color?: string }[];
  selected: string[];
  onChange: (vals: string[]) => void;
  icon?: React.ReactNode;
  accent?: boolean;
}

const FilterSection: React.FC<FilterSectionProps> = ({ label, options, selected, onChange, icon, accent }) => {
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(
    () => options.filter(o => o.label.toLowerCase().includes(search.toLowerCase())),
    [options, search]
  );

  const toggle = (val: string) => {
    onChange(selected.includes(val) ? selected.filter(v => v !== val) : [...selected, val]);
  };

  if (options.length === 0) return null;

  return (
    <div className="border-b border-slate-100">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center justify-between px-3 py-2 text-xs font-semibold transition-colors ${
          accent ? 'text-blue-600 hover:bg-blue-50/50' : 'text-slate-600 hover:bg-slate-50'
        }`}
      >
        <span className="flex items-center gap-1.5">{icon}{label}</span>
        <div className="flex items-center gap-1.5">
          {selected.length > 0 && (
            <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded-full ${
              accent ? 'bg-blue-500/20 text-blue-600' : 'bg-slate-500/20 text-slate-600'
            }`}>{selected.length}</span>
          )}
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </div>
      </button>
      {expanded && (
        <div className="px-3 pb-2 space-y-1">
          {options.length > 6 && (
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full text-xs border border-slate-200 rounded px-2 py-1 mb-1 focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
          )}
          {filtered.map(o => (
            <label key={o.value} className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-slate-50 cursor-pointer text-xs text-slate-700">
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-300 h-3.5 w-3.5" />
              {o.color && <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: o.color }} />}
              <span className="truncate">{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Asset Hierarchy Tree ────────────────────────────────
interface AssetTreeProps {
  assets: any[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  workOrders?: any[];
}

const AssetHierarchyTree: React.FC<AssetTreeProps> = ({ assets, selectedIds, onChange, workOrders = [] }) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  // Build WO count per asset
  const woCountMap = useMemo(() => {
    const map = new Map<string, number>();
    workOrders.forEach((w: any) => {
      if (w.asset_id) map.set(w.asset_id, (map.get(w.asset_id) || 0) + 1);
    });
    return map;
  }, [workOrders]);

  // Build tree structure
  const { tree, nodeMap } = useMemo(() => {
    const nodeMap = new Map<string, TreeNodeData>();
    const roots: TreeNodeData[] = [];

    // Create nodes
    assets.forEach((a: any) => {
      nodeMap.set(a.id, {
        id: a.id,
        tag: a.tag || '',
        name: a.name || '',
        hierarchy_level: a.hierarchy_level || 'EQUIPMENT',
        parent_id: a.parent_id || null,
        children: [],
        depth: 0,
        descendantCount: 0,
        descendantWOCount: 0,
      });
    });

    // Build hierarchy
    assets.forEach((a: any) => {
      const node = nodeMap.get(a.id)!;
      if (a.parent_id && nodeMap.has(a.parent_id)) {
        const parent = nodeMap.get(a.parent_id)!;
        node.depth = parent.depth + 1;
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    });

    // Calculate roll-up metrics
    const calcRollups = (node: TreeNodeData): { count: number; wos: number } => {
      let count = 0;
      let wos = woCountMap.get(node.id) || 0;
      node.children.forEach(child => {
        const childStats = calcRollups(child);
        count += 1 + childStats.count;
        wos += childStats.wos;
      });
      node.descendantCount = count;
      node.descendantWOCount = wos + (woCountMap.get(node.id) || 0);
      // Only count wo once at top level
      node.descendantWOCount = wos;
      return { count, wos };
    };
    roots.forEach(r => calcRollups(r));

    // Sort children
    const sortChildren = (nodes: TreeNodeData[]) => {
      nodes.sort((a, b) => a.tag.localeCompare(b.tag) || a.name.localeCompare(b.name));
      nodes.forEach(n => sortChildren(n.children));
    };
    sortChildren(roots);

    return { tree: roots, nodeMap };
  }, [assets, woCountMap]);

  // Get all descendant IDs
  const getDescendantIds = (id: string): string[] => {
    const descendants: string[] = [];
    const node = nodeMap.get(id);
    if (!node) return descendants;
    const collect = (n: TreeNodeData) => {
      n.children.forEach(child => {
        descendants.push(child.id);
        collect(child);
      });
    };
    collect(node);
    return descendants;
  };

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleExpandAll = () => {
    if (expandedIds.size > 0) {
      setExpandedIds(new Set());
    } else {
      const allIds = new Set<string>();
      const collect = (nodes: TreeNodeData[]) => {
        nodes.forEach(n => {
          if (n.children.length > 0) allIds.add(n.id);
          collect(n.children);
        });
      };
      collect(tree);
      setExpandedIds(allIds);
    }
  };

  const toggleSelect = (id: string) => {
    const descendants = getDescendantIds(id);
    if (selectedIds.includes(id)) {
      // Deselect: remove self + all descendants
      const toRemove = new Set([id, ...descendants]);
      onChange(selectedIds.filter(i => !toRemove.has(i)));
    } else {
      // Select: add self + all descendants
      const newIds = new Set([...selectedIds, id, ...descendants]);
      onChange(Array.from(newIds));
    }
  };

  // Search filter
  const matchesSearch = (node: TreeNodeData): boolean => {
    if (!search) return true;
    const q = search.toLowerCase();
    if (node.tag.toLowerCase().includes(q) || node.name.toLowerCase().includes(q)) return true;
    return node.children.some(c => matchesSearch(c));
  };

  const renderNode = (node: TreeNodeData): React.ReactNode => {
    if (!matchesSearch(node)) return null;

    const hasChildren = node.children.length > 0;
    const isExpanded = expandedIds.has(node.id) || !!search;
    const isSelected = selectedIds.includes(node.id);
    const style = LEVEL_STYLE[node.hierarchy_level] || DEFAULT_STYLE;

    return (
      <div key={node.id} className="select-none">
        <div
          className={`flex items-center gap-1.5 py-1 px-1 rounded transition-colors ${
            isSelected ? `${style.bg} ring-1 ring-inset ring-current/10` : 'hover:bg-slate-50'
          }`}
          style={{ paddingLeft: `${node.depth * 14 + 4}px` }}
        >
          {/* Expand/Collapse */}
          <button
            onClick={() => toggleExpand(node.id)}
            className={`p-0.5 rounded hover:bg-slate-200 transition-colors flex-shrink-0 ${
              hasChildren ? '' : 'invisible'
            }`}
          >
            {isExpanded ? (
              <ChevronDown size={12} className="text-slate-400" />
            ) : (
              <ChevronRight size={12} className="text-slate-400" />
            )}
          </button>

          {/* Checkbox */}
          <button
            onClick={() => toggleSelect(node.id)}
            className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all flex-shrink-0 ${
              isSelected ? 'bg-blue-500 border-blue-600' : 'border-slate-300 hover:border-blue-400'
            }`}
          >
            {isSelected && <Check size={10} className="text-white" strokeWidth={3} />}
          </button>

          {/* Level icon */}
          <span className="text-[10px] flex-shrink-0">{style.icon}</span>

          {/* Label */}
          <div
            className="flex-1 flex items-center gap-1.5 cursor-pointer min-w-0"
            onClick={() => toggleSelect(node.id)}
          >
            <span className={`text-[10px] font-semibold ${style.color}`}>
              {node.tag}
            </span>
            <span className="text-[9px] text-slate-400 truncate hidden sm:inline">
              — {node.name}
            </span>
          </div>

          {/* Roll-up badge */}
          {hasChildren && (
            <span className="text-[9px] text-slate-400 font-mono flex-shrink-0 tabular-nums">
              {node.descendantCount}
              {node.descendantWOCount > 0 && (
                <span className="text-amber-500 ml-0.5">·{node.descendantWOCount}wo</span>
              )}
            </span>
          )}
        </div>

        {/* Children */}
        {hasChildren && isExpanded && (
          <div className="border-l border-slate-500 ml-3">
            {node.children.map(child => renderNode(child))}
          </div>
        )}
      </div>
    );
  };

  // Scope summary
  const scopeSummary = useMemo(() => {
    if (selectedIds.length === 0) return null;
    // Find the highest-level selected nodes
    const selectedSet = new Set(selectedIds);
    const topLevel = selectedIds.filter(id => {
      const node = nodeMap.get(id);
      if (!node) return false;
      // Is top-level if its parent is NOT selected
      return !node.parent_id || !selectedSet.has(node.parent_id);
    });
    if (topLevel.length === 0) return null;
    const first = nodeMap.get(topLevel[0]);
    if (!first) return null;
    if (topLevel.length === 1) {
      return `${first.tag} / ${first.name} (${selectedIds.length} assets)`;
    }
    return `${topLevel.length} groups (${selectedIds.length} assets)`;
  }, [selectedIds, nodeMap]);

  return (
    <div>
      {/* Search + expand toggle */}
      <div className="px-3 pt-2 pb-1 flex items-center gap-1.5">
        <div className="flex-1 relative">
          <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search assets..."
            className="w-full text-xs border border-slate-200 rounded pl-6 pr-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300"
          />
        </div>
        <button
          onClick={toggleExpandAll}
          className="text-[10px] text-slate-400 hover:text-slate-600 px-1"
          title={expandedIds.size > 0 ? 'Collapse all' : 'Expand all'}
        >
          {expandedIds.size > 0 ? '⊟' : '⊞'}
        </button>
      </div>

      {/* Tree */}
      <div className="px-2 pb-2 max-h-64 overflow-y-auto custom-scrollbar">
        {tree.length === 0 ? (
          <div className="text-xs text-slate-400 text-center py-4">No assets loaded</div>
        ) : (
          tree.map(node => renderNode(node))
        )}
      </div>

      {/* Scope summary chip */}
      {scopeSummary && (
        <div className="px-3 py-1.5 border-t border-slate-100 bg-blue-50/50">
          <span className="text-[10px] font-medium text-blue-600">{scopeSummary}</span>
        </div>
      )}
    </div>
  );
};

// ── Main Panel ──────────────────────────────────────────
interface ReportFilterPanelProps {
  filters: ReportFilters;
  onChange: (filters: ReportFilters) => void;
  dictionaries: DictionaryEntry[];
  isOpen: boolean;
  onToggle: () => void;
  assets?: any[];
  workOrders?: any[];
}

export const ReportFilterPanel: React.FC<ReportFilterPanelProps> = ({
  filters, onChange, dictionaries, isOpen, onToggle, assets = [], workOrders = [],
}) => {
  const getOpts = (type: string) =>
    dictionaries
      .filter(d => d.type === type && d.active !== false)
      .map(d => ({ value: d.code, label: d.description || d.code, color: d.colorCode }));

  const activeCount = filters.selectedAssetIds.length +
    Object.entries(filters).filter(([k]) => k !== 'selectedAssetIds')
      .reduce((s, [, a]) => s + (a as string[]).length, 0);

  const dictSections: { label: string; key: keyof ReportFilters; dictType: string }[] = [
    { label: 'Department', key: 'departments', dictType: 'DEPARTMENT' },
    { label: 'Asset Type', key: 'assetTypes', dictType: 'ASSET_TYPE' },
    { label: 'Asset Category', key: 'assetCategories', dictType: 'ASSET_CATEGORY' },
    { label: 'Asset Class', key: 'assetClasses', dictType: 'ASSET_CLASS' },
    { label: 'Criticality', key: 'criticalities', dictType: 'CRITICALITY' },
    { label: 'Status', key: 'statuses', dictType: 'STATUS_CODE' },
    { label: 'Work Type', key: 'workTypes', dictType: 'WORK_TYPE' },
    { label: 'Priority', key: 'priorities', dictType: 'PRIORITY' },
    { label: 'Cost Center', key: 'costCenters', dictType: 'COST_CENTRE' },
  ];

  return (
    <>
      {/* Toggle Button (visible when panel closed) */}
      {!isOpen && (
        <button
          onClick={onToggle}
          className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
        >
          <Filter size={14} />
          Filters
          {activeCount > 0 && (
            <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 text-[10px] font-bold rounded-full">{activeCount}</span>
          )}
        </button>
      )}

      {/* Panel — Desktop: inline sidebar, Mobile: full-screen overlay */}
      {isOpen && (
        <>
          {/* Mobile backdrop */}
          <div
            className="fixed inset-0 bg-black/30 z-40 lg:hidden"
            onClick={onToggle}
          />
          <div className="
            fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw]
            lg:relative lg:inset-auto lg:z-auto lg:w-64
            flex-shrink-0 bg-white border border-slate-200 rounded-xl shadow-lg lg:shadow-sm overflow-hidden flex flex-col
            transition-transform duration-200
          ">
          {/* Panel Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50/50">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <Filter size={14} className="text-blue-600" /> Slicers
            </span>
            <div className="flex items-center gap-1">
              {activeCount > 0 && (
                <button onClick={() => onChange(EMPTY_FILTERS)} className="p-1 hover:bg-slate-200 rounded text-slate-500 hover:text-slate-900" title="Clear All">
                  <RotateCcw size={14} />
                </button>
              )}
              <button onClick={onToggle} className="p-1 hover:bg-slate-200 rounded text-slate-500 hover:text-slate-900">
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Filter Sections */}
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {/* Asset Hierarchy Tree (replaces Site/Location/Unit/System) */}
            <div className="border-b-2 border-blue-100">
              <div className="px-3 pt-2 pb-1">
                <span className="text-[10px] font-bold text-blue-500 uppercase tracking-widest flex items-center gap-1">
                  <MapPin size={10} /> Asset Hierarchy
                </span>
              </div>
              <AssetHierarchyTree
                assets={assets}
                selectedIds={filters.selectedAssetIds}
                onChange={(ids) => onChange({ ...filters, selectedAssetIds: ids })}
                workOrders={workOrders}
              />
            </div>

            {/* Dictionary Filters */}
            {dictSections.map(sec => (
              <FilterSection
                key={sec.key}
                label={sec.label}
                options={getOpts(sec.dictType)}
                selected={filters[sec.key] as string[]}
                onChange={(vals) => onChange({ ...filters, [sec.key]: vals })}
              />
            ))}
          </div>

          {/* Active Filter Chips */}
          {activeCount > 0 && (
            <div className="px-3 py-3 border-t border-slate-200 bg-slate-50/50 flex flex-wrap gap-1.5">
              {Object.entries(filters).filter(([k]) => k !== 'selectedAssetIds').map(([key, vals]) =>
                (vals as string[]).map(v => (
                  <span key={`${key}-${v}`} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
                    {v.length > 20 ? v.slice(0, 18) + '…' : v}
                    <button onClick={() => {
                      const updated = { ...filters, [key]: (filters[key as keyof ReportFilters] as string[]).filter(x => x !== v) };
                      onChange(updated);
                    }} className="hover:text-blue-900 bg-blue-200/50 hover:bg-blue-300/50 rounded-full p-0.5">
                      <X size={10} />
                    </button>
                  </span>
                ))
              )}
            </div>
          )}
        </div>
        </>
      )}
    </>
  );
};
