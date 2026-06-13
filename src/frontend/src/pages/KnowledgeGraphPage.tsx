import React, { useState, useMemo } from 'react';
import { Search, Share2, Info, AlignLeft, ExternalLink, ChevronRight } from 'lucide-react';
import { useIntelligence } from '../hooks/useIntelligence';
import { NetworkVisualizer } from '../components/graph/NetworkVisualizer';

export const KnowledgeGraphPage: React.FC = () => {
    const { loading, network } = useIntelligence();
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedNode, setSelectedNode] = useState<any>(null);

    // Format network data into D3 nodes and links
    const graphData = useMemo(() => {
        if (!network) return { nodes: [], links: [] };

        const nodesMap = new Map();

        // Add root asset
        nodesMap.set(network.root_asset.id, { ...network.root_asset });

        // Add directly fed assets
        network.directly_fed_assets.forEach(asset => {
            nodesMap.set(asset.id, { ...asset });
        });

        // Add nodes from paths that might not be in the direct asset lists
        const links = network.paths.map(path => {
            if (!nodesMap.has(path.source)) {
                const label = path.source.startsWith('psn-') ? 'Person'
                    : path.source.startsWith('fm-') ? 'FailureMode'
                        : path.source.startsWith('cau-') ? 'Cause'
                            : path.source.startsWith('dept-') ? 'Department'
                                : path.source.startsWith('comp-') ? 'Competency'
                                    : 'Asset';
                nodesMap.set(path.source, { id: path.source, label, name: path.name || path.source });
            }
            if (!nodesMap.has(path.target)) {
                const label = path.target.startsWith('kpi-') ? 'KPI'
                    : path.target.startsWith('fm-') ? 'FailureMode'
                        : path.target.startsWith('cau-') ? 'Cause'
                            : path.target.startsWith('ast-') ? 'Asset'
                                : path.target.startsWith('comp-') ? 'Competency'
                                    : 'Asset';
                nodesMap.set(path.target, { id: path.target, label, name: path.name || path.target });
            }
            return { source: path.source, target: path.target, type: path.type, name: path.name };
        });

        return { nodes: Array.from(nodesMap.values()), links };
    }, [network]);

    // Get connections for selected node
    const selectedNodeConnections = useMemo(() => {
        if (!selectedNode || !graphData.links.length) return [];
        return graphData.links.filter(link => {
            const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
            const targetId = typeof link.target === 'string' ? link.target : link.target.id;
            return sourceId === selectedNode.id || targetId === selectedNode.id;
        }).map(link => {
            const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
            const targetId = typeof link.target === 'string' ? link.target : link.target.id;
            const connectedId = sourceId === selectedNode.id ? targetId : sourceId;
            const connectedNode = graphData.nodes.find(n => n.id === connectedId);
            const direction = sourceId === selectedNode.id ? 'outgoing' : 'incoming';
            return { node: connectedNode, edgeType: link.type, direction };
        });
    }, [selectedNode, graphData]);

    // Filter graph based on search
    const filteredGraphData = useMemo(() => {
        if (!searchQuery.trim()) return graphData;
        const q = searchQuery.toLowerCase();
        const matchingNodeIds = new Set(
            graphData.nodes.filter(n => (n.name || n.id).toLowerCase().includes(q) || n.label.toLowerCase().includes(q)).map(n => n.id)
        );
        // Keep all nodes but mark non-matching as dimmed (handled in visualizer via prop)
        return {
            nodes: graphData.nodes.map(n => ({ ...n, dimmed: !matchingNodeIds.has(n.id) })),
            links: graphData.links,
        };
    }, [graphData, searchQuery]);

    const matchCount = searchQuery.trim() ? filteredGraphData.nodes.filter(n => !n.dimmed).length : graphData.nodes.length;

    if (loading) {
        return (
            <div className="flex flex-col h-[calc(100vh-8rem)] space-y-6 animate-pulse">
                <div className="flex justify-between items-end">
                    <div>
                        <div className="h-8 w-72 bg-brand-800 rounded" />
                        <div className="h-4 w-96 bg-brand-800 rounded mt-2" />
                    </div>
                    <div className="flex gap-4">
                        <div className="h-10 w-64 bg-brand-800 rounded-lg" />
                        <div className="h-10 w-20 bg-brand-800 rounded-lg" />
                    </div>
                </div>
                <div className="flex flex-1 gap-6 min-h-0">
                    <div className="flex-1 bg-white border border-slate-200 rounded-xl" />
                    <div className="w-80 bg-white border border-slate-200 rounded-xl" />
                </div>
            </div>
        );
    }

    const getLabelColor = (label: string) => {
        switch (label) {
            case 'Asset': return 'bg-accent-cyan/10 text-accent-cyan border-accent-cyan/30';
            case 'FailureMode': return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30';
            case 'Cause': return 'bg-red-500/10 text-red-500 border-red-500/30';
            case 'Person': return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
            case 'KPI': return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
            case 'Department': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
            case 'Competency': return 'bg-orange-500/10 text-orange-400 border-orange-500/30';
            default: return 'bg-slate-100 text-brand-300 border-slate-300';
        }
    };

    return (
        <div className="flex flex-col h-[calc(100vh-8rem)] animate-in fade-in duration-500">
            {/* Header Area */}
            <div className="flex justify-between items-end mb-6 shrink-0">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 font-sans tracking-tight">Impact Network Explorer</h1>
                    <p className="text-slate-500 text-sm mt-1">Interactive ontology of assets, failures, causes, and personnel</p>
                </div>
                <div className="flex gap-4 items-center">
                    <div className="relative w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input
                            type="text"
                            placeholder="Search nodes..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 placeholder-brand-600 shadow-inner"
                        />
                        {searchQuery && (
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded">
                                {matchCount} match{matchCount !== 1 ? 'es' : ''}
                            </span>
                        )}
                    </div>
                    <button className="flex items-center gap-2 px-3 py-2 bg-brand-800 hover:bg-slate-100 text-brand-300 rounded-lg text-sm transition-colors border border-slate-200">
                        <Share2 size={16} /> Export
                    </button>
                </div>
            </div>

            {/* Main Stage & Context Panel */}
            <div className="flex flex-1 gap-6 min-h-0">
                {/* Visualizer (Left) */}
                <div className="flex-1 bg-white border border-slate-200 rounded-xl shadow-lg flex flex-col overflow-hidden relative">
                    <NetworkVisualizer data={filteredGraphData} onNodeClick={setSelectedNode} />

                    {/* Top Overlay Stats */}
                    <div className="absolute top-4 right-4 flex gap-3 pointer-events-none">
                        <div className="bg-white/90 backdrop-blur-sm border border-slate-200/80 px-3 py-1.5 rounded-lg shadow-sm flex items-center gap-2 pointer-events-auto">
                            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Nodes:</span>
                            <span className="text-xs font-bold text-slate-800">{graphData.nodes.length}</span>
                        </div>
                        <div className="bg-white/90 backdrop-blur-sm border border-slate-200/80 px-3 py-1.5 rounded-lg shadow-sm flex items-center gap-2 pointer-events-auto">
                            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Depth:</span>
                            <span className="text-xs font-bold text-slate-800">{network?.cascade_depth || 0}</span>
                        </div>
                        <div className="bg-white/90 backdrop-blur-sm border border-slate-200/80 px-3 py-1.5 rounded-lg shadow-sm flex items-center gap-2 pointer-events-auto">
                            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Edges:</span>
                            <span className="text-xs font-bold text-slate-800">{graphData.links.length}</span>
                        </div>
                    </div>
                </div>

                {/* Context Panel (Right) */}
                <div className="w-80 bg-white border border-slate-200 rounded-xl shadow-lg flex flex-col shrink-0 overflow-y-auto">
                    <div className="p-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-brand-800/95 backdrop-blur-sm z-10">
                        <div className="flex items-center gap-2">
                            <AlignLeft size={18} className="text-slate-500" />
                            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Context Panel</h3>
                        </div>
                    </div>

                    {selectedNode ? (
                        <div className="p-4 space-y-5 animate-in slide-in-from-right-4 duration-300">
                            {/* Node Header */}
                            <div>
                                <div className="flex items-center gap-2 mb-2">
                                    <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded border ${getLabelColor(selectedNode.label)}`}>
                                        {selectedNode.label}
                                    </span>
                                    {selectedNode.critical && (
                                        <span className="bg-red-500/20 text-red-500 border border-red-500/30 text-[10px] uppercase font-bold px-2 py-0.5 rounded">
                                            Crit A
                                        </span>
                                    )}
                                </div>
                                <h4 className="text-lg font-bold text-slate-800">{selectedNode.name || selectedNode.id}</h4>
                                <p className="text-xs text-slate-400 mt-1 font-mono">{selectedNode.id}</p>
                            </div>

                            {/* Node Properties */}
                            <div className="space-y-3 border-t border-slate-200 pt-4">
                                <h5 className="text-xs font-semibold text-brand-300 uppercase tracking-wider">Properties</h5>
                                {selectedNode.label === 'Asset' && (
                                    <>
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="text-slate-400">System Group:</span>
                                            <span className="text-brand-200">Compression Train A</span>
                                        </div>
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="text-slate-400">Current Health:</span>
                                            <span className="text-accent-safe font-medium">82.5 / 100</span>
                                        </div>
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="text-slate-400">Risk Priority:</span>
                                            <span className="text-yellow-500 font-medium">High</span>
                                        </div>
                                    </>
                                )}
                                {selectedNode.label === 'Person' && (
                                    <>
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="text-slate-400">Role:</span>
                                            <span className="text-brand-200">Reliability Engineer</span>
                                        </div>
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="text-slate-400">Certifications:</span>
                                            <span className="text-brand-200">CMRP, ISO 18436</span>
                                        </div>
                                    </>
                                )}
                                {selectedNode.label === 'FailureMode' && (
                                    <>
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="text-slate-400">Severity (S):</span>
                                            <span className="text-red-400 font-bold font-mono">8</span>
                                        </div>
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="text-slate-400">Occurrence (O):</span>
                                            <span className="text-yellow-500 font-bold font-mono">4</span>
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* Connections */}
                            {selectedNodeConnections.length > 0 && (
                                <div className="space-y-3 border-t border-slate-200 pt-4">
                                    <h5 className="text-xs font-semibold text-brand-300 uppercase tracking-wider">
                                        Connections ({selectedNodeConnections.length})
                                    </h5>
                                    <div className="space-y-2 max-h-48 overflow-y-auto">
                                        {selectedNodeConnections.map((conn, idx) => (
                                            <button
                                                key={idx}
                                                onClick={() => conn.node && setSelectedNode(conn.node)}
                                                className="w-full flex items-center gap-3 px-3 py-2 bg-slate-50 border border-slate-200/50 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-colors text-left group"
                                            >
                                                <div className={`w-2 h-2 rounded-full shrink-0 ${conn.node?.label === 'Asset' ? 'bg-accent-cyan' : conn.node?.label === 'FailureMode' ? 'bg-yellow-500' : conn.node?.label === 'Cause' ? 'bg-red-500' : conn.node?.label === 'Person' ? 'bg-blue-500' : 'bg-brand-400'}`} />
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs text-brand-200 truncate group-hover:text-accent-cyan transition-colors">
                                                        {conn.node?.name || conn.node?.id}
                                                    </p>
                                                    <p className="text-[10px] text-slate-400 flex items-center gap-1">
                                                        {conn.direction === 'outgoing' ? '→' : '←'} {conn.edgeType.replace('_', ' ')}
                                                    </p>
                                                </div>
                                                <ChevronRight size={12} className="text-brand-600 group-hover:text-slate-500" />
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Actions */}
                            <div className="border-t border-slate-200 pt-4 flex flex-col gap-2">
                                <button className="w-full py-2 bg-slate-100 hover:bg-brand-600 text-slate-800 rounded text-sm font-medium transition-colors">
                                    Set as Root Node
                                </button>
                                {selectedNode.label === 'Asset' && (
                                    <button className="w-full py-2 bg-slate-50 border border-accent-cyan/50 text-accent-cyan hover:bg-accent-cyan/10 rounded text-sm font-medium transition-colors flex items-center justify-center gap-2">
                                        <ExternalLink size={14} /> View Asset Detail
                                    </button>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="p-8 flex flex-col items-center justify-center text-center h-full text-slate-400">
                            <Info size={32} className="mb-4 opacity-50" />
                            <p className="text-sm">Select a node in the graph to view its properties and connections.</p>
                            <p className="text-xs text-brand-600 mt-2">Click any node or search above to get started.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
