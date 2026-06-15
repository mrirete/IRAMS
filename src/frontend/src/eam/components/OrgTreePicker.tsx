import React, { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown, Check } from 'lucide-react';

interface OrgUnit {
    id: string;
    name: string;
    code: string;
    type: string;
    parentId: string | null;
}

interface OrgTreePickerProps {
    units: OrgUnit[];
    selectedIds: string[];
    onChange: (selectedIds: string[]) => void;
    placeholder?: string;
    highlightedIds?: string[]; // Visual-only highlight (e.g., teams of assigned people)
}

interface TreeNode extends OrgUnit {
    children: TreeNode[];
    depth: number;
}

/**
 * OrgTreePicker - A collapsible tree picker for organization units
 * Shows hierarchy with expand/collapse and independent checkboxes at each level
 */
export const OrgTreePicker: React.FC<OrgTreePickerProps> = ({
    units,
    selectedIds,
    onChange,
    placeholder = 'Select organization units...',
    highlightedIds = []
}) => {
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

    // Build tree structure from flat list
    const { tree, nodeMap } = useMemo(() => {
        const nodeMap = new Map<string, TreeNode>();
        const roots: TreeNode[] = [];

        // Create nodes
        units.forEach(unit => {
            nodeMap.set(unit.id, { ...unit, children: [], depth: 0 });
        });

        // Build hierarchy
        units.forEach(unit => {
            const node = nodeMap.get(unit.id)!;
            if (unit.parentId && nodeMap.has(unit.parentId)) {
                const parent = nodeMap.get(unit.parentId)!;
                node.depth = parent.depth + 1;
                parent.children.push(node);
            } else {
                roots.push(node);
            }
        });

        // Sort children by name
        const sortChildren = (nodes: TreeNode[]) => {
            nodes.sort((a, b) => a.name.localeCompare(b.name));
            nodes.forEach(n => sortChildren(n.children));
        };
        sortChildren(roots);

        return { tree: roots, nodeMap };
    }, [units]);

    // Get all ancestor IDs (parents up the chain)
    const getAncestorIds = (id: string): string[] => {
        const ancestors: string[] = [];
        let current = nodeMap.get(id);
        while (current?.parentId) {
            ancestors.push(current.parentId);
            current = nodeMap.get(current.parentId);
        }
        return ancestors;
    };

    // Get all descendant IDs (children down the tree)
    const getDescendantIds = (id: string): string[] => {
        const descendants: string[] = [];
        const node = nodeMap.get(id);
        if (!node) return descendants;

        const collectDescendants = (n: TreeNode) => {
            n.children.forEach(child => {
                descendants.push(child.id);
                collectDescendants(child);
            });
        };
        collectDescendants(node);
        return descendants;
    };

    const toggleExpand = (id: string) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const toggleSelect = (id: string) => {
        if (selectedIds.includes(id)) {
            // UNSELECTING: Also unselect all descendants
            const descendantIds = getDescendantIds(id);
            const idsToRemove = new Set([id, ...descendantIds]);
            onChange(selectedIds.filter(i => !idsToRemove.has(i)));
        } else {
            // SELECTING: Also select all ancestors (parents up the chain)
            const ancestorIds = getAncestorIds(id);
            const newIds = new Set([...selectedIds, id, ...ancestorIds]);
            onChange(Array.from(newIds));
        }
    };


    const renderNode = (node: TreeNode): React.ReactNode => {
        const hasChildren = node.children.length > 0;
        const isExpanded = expandedIds.has(node.id);
        const isSelected = selectedIds.includes(node.id);
        const isHighlighted = highlightedIds.includes(node.id) && !isSelected;


        return (
            <div key={node.id} className="select-none">
                <div
                    className={`flex items-center gap-2 py-1.5 px-2 rounded-r-lg transition-colors border-l-4 ${isSelected ? 'bg-blue-50' : isHighlighted ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'hover:bg-slate-50'} ${node.type === 'DIVISION' ? 'border-blue-400' :
                        node.type === 'GROUP' ? 'border-blue-400' :
                            node.type === 'TEAM' ? 'border-green-400' :
                                'border-amber-400'
                        }`}
                    style={{ paddingLeft: `${node.depth * 16 + 8}px` }}
                >
                    {/* Expand/Collapse Button */}
                    <button
                        onClick={() => toggleExpand(node.id)}
                        className={`p-0.5 rounded hover:bg-slate-200 transition-colors ${hasChildren ? '' : 'invisible'}`}
                    >
                        {isExpanded ? (
                            <ChevronDown size={14} className="text-slate-400" />
                        ) : (
                            <ChevronRight size={14} className="text-slate-400" />
                        )}
                    </button>

                    {/* Checkbox */}
                    <button
                        onClick={() => toggleSelect(node.id)}
                        className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${isSelected
                            ? 'bg-primary-600 border-blue-600'
                            : 'border-slate-300 hover:border-blue-400'
                            }`}
                    >
                        {isSelected && <Check size={12} className="text-white" strokeWidth={3} />}
                    </button>

                    {/* Node Content */}
                    <div className="flex-1 flex items-center gap-2 cursor-pointer min-w-0" onClick={() => toggleSelect(node.id)}>
                        <span className="font-medium text-sm text-slate-700 truncate">{node.name}</span>
                        {node.code && <span className="text-[10px] text-slate-400 font-mono hidden sm:inline-block">{node.code}</span>}
                    </div>
                </div>

                {/* Children */}
                {hasChildren && isExpanded && (
                    <div className="border-l border-slate-200 ml-4">
                        {node.children.map(child => renderNode(child))}
                    </div>
                )}
            </div>
        );
    };

    if (units.length === 0) {
        return (
            <div className="text-sm text-slate-400 p-4 text-center border border-dashed border-slate-200 rounded-lg">
                No organization units available
            </div>
        );
    }

    return (
        <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
            <div className="max-h-80 overflow-y-auto p-2">
                {tree.map(node => renderNode(node))}
            </div>
            {selectedIds.length > 0 && (
                <div className="border-t border-slate-100 px-3 py-2 bg-slate-50 text-xs text-slate-500">
                    {selectedIds.length} unit{selectedIds.length !== 1 ? 's' : ''} selected
                </div>
            )}
        </div>
    );
};

export default OrgTreePicker;
