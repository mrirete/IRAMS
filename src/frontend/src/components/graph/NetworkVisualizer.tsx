import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react';

interface Node extends d3.SimulationNodeDatum {
    id: string;
    label: string;
    name?: string;
    group?: number;
    critical?: boolean;
    dimmed?: boolean;
}

interface Link extends d3.SimulationLinkDatum<Node> {
    source: string | Node;
    target: string | Node;
    type: string;
    name?: string;
}

interface Props {
    data: {
        nodes: Node[];
        links: Link[];
    };
    onNodeClick?: (node: Node) => void;
}

export const NetworkVisualizer: React.FC<Props> = ({ data, onNodeClick }) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Create a ref to hold the zoom behavior so we can call it from buttons
    const zoomBehavior = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

    useEffect(() => {
        if (!svgRef.current || !containerRef.current || !data.nodes.length) return;

        const width = containerRef.current.clientWidth;
        const height = containerRef.current.clientHeight;

        // Clean up previous SVG content
        d3.select(svgRef.current).selectAll('*').remove();

        // Create main SVG group for zooming
        const svg = d3.select(svgRef.current)
            .attr('width', width)
            .attr('height', height)
            .attr('viewBox', [0, 0, width, height]);

        const g = svg.append('g');

        // Setup Zoom
        const zoom = d3.zoom<SVGSVGElement, unknown>()
            .scaleExtent([0.1, 4])
            .on('zoom', (event) => {
                g.attr('transform', event.transform);
            });

        svg.call(zoom);
        zoomBehavior.current = zoom;

        // Force Simulation setup
        const simulation = d3.forceSimulation(data.nodes)
            .force('link', d3.forceLink(data.links).id((d: any) => d.id).distance(100))
            .force('charge', d3.forceManyBody().strength(-400))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collide', d3.forceCollide().radius(40));

        const defs = svg.append('defs');

        // Arrow marker for directed edges
        defs.append('marker')
            .attr('id', 'arrowhead')
            .attr('viewBox', '-0 -5 10 10')
            .attr('refX', 25)
            .attr('refY', 0)
            .attr('orient', 'auto')
            .attr('markerWidth', 6)
            .attr('markerHeight', 6)
            .attr('xoverflow', 'visible')
            .append('svg:path')
            .attr('d', 'M 0,-5 L 10 ,0 L 0,5')
            .attr('fill', '#64748b')
            .style('stroke', 'none');

        // Drop shadow for premium float effect
        const filter = defs.append('filter')
            .attr('id', 'shadow')
            .attr('height', '140%')
            .attr('width', '140%')
            .attr('x', '-20%')
            .attr('y', '-20%');

        filter.append('feDropShadow')
            .attr('dx', '0')
            .attr('dy', '3')
            .attr('stdDeviation', '3')
            .attr('flood-color', '#0f172a')
            .attr('flood-opacity', '0.15');

        // Draw edges
        const link = g.append('g')
            .attr('stroke', '#475569')
            .attr('stroke-opacity', 0.6)
            .selectAll('line')
            .data(data.links)
            .join('line')
            .attr('stroke-width', 2)
            .attr('marker-end', 'url(#arrowhead)');

        // Edge labels
        const edgeLabels = g.append('g')
            .selectAll('text')
            .data(data.links)
            .join('text')
            .attr('font-size', '9px')
            .attr('fill', '#475569') // darker slate for crisp contrast on bg-slate-50
            .attr('text-anchor', 'middle')
            .attr('pointer-events', 'none')
            .text(d => d.type.replace('_', ' '));

        // Draw nodes (groups of circle + text)
        const node = g.append('g')
            .selectAll('g')
            .data(data.nodes)
            .join('g')
            .call(d3.drag<any, any>()
                .on('start', dragstarted)
                .on('drag', dragged)
                .on('end', dragended)
            )
            .style('cursor', 'pointer')
            .style('opacity', (d: any) => d.dimmed ? 0.15 : 1)
            .style('transition', 'opacity 0.3s')
            .on('click', (_event, d) => {
                if (onNodeClick) onNodeClick(d);
            })
            // Hover effects
            .on('mouseover', function () {
                d3.select(this).select('circle')
                    .transition().duration(200)
                    .attr('r', 20)
                    .attr('stroke-width', 3);
            })
            .on('mouseout', function (_event, d: any) {
                d3.select(this).select('circle')
                    .transition().duration(200)
                    .attr('r', d.critical ? 20 : 16)
                    .attr('stroke-width', d.critical ? 3 : 2);
            });

        // Determine node color based on type/label
        const getNodeColor = (label: string) => {
            switch (label) {
                case 'Asset': return '#06b6d4'; // accent-cyan
                case 'FailureMode': return '#eab308'; // yellow-500
                case 'Cause': return '#ef4444'; // red-500
                case 'Person': return '#3b82f6'; // blue-500
                case 'KPI': return '#a855f7'; // purple-500
                case 'Department': return '#10b981'; // emerald-500
                case 'Competency': return '#f97316'; // orange-500
                default: return '#94a3b8'; // slate-400
            }
        };

        // Node circles
        node.append('circle')
            .attr('r', d => d.critical ? 20 : 16)
            .attr('fill', d => getNodeColor(d.label))
            .attr('stroke', '#ffffff')
            .attr('stroke-width', d => d.critical ? 3 : 2)
            .style('filter', 'url(#shadow)');

        // Node icons or letters
        node.append('text')
            .attr('dy', 4)
            .attr('text-anchor', 'middle')
            .attr('fill', d => d.label === 'FailureMode' ? '#0f172a' : '#ffffff')
            .attr('font-size', '12px')
            .attr('font-weight', 'bold')
            .attr('pointer-events', 'none')
            .text(d => d.label.charAt(0));

        // Node names (labels below circle) — truncated to prevent overlap
        node.append('text')
            .attr('dy', 30)
            .attr('text-anchor', 'middle')
            .attr('fill', '#334155') // dark slate for readable contrast on bg-slate-50
            .attr('font-size', '10px')
            .attr('font-weight', d => d.critical ? 'bold' : 'normal')
            .attr('pointer-events', 'none')
            .text(d => {
                const name = d.name || d.id;
                return name.length > 18 ? name.slice(0, 16) + '…' : name;
            });

        // Full name tooltip on hover
        node.append('title')
            .text(d => d.name || d.id);

        // Simulation tick updates
        simulation.on('tick', () => {
            link
                .attr('x1', (d: any) => d.source.x)
                .attr('y1', (d: any) => d.source.y)
                .attr('x2', (d: any) => d.target.x)
                .attr('y2', (d: any) => d.target.y);

            edgeLabels
                .attr('x', (d: any) => (d.source.x + d.target.x) / 2)
                .attr('y', (d: any) => (d.source.y + d.target.y) / 2 - 5);

            node
                .attr('transform', (d: any) => `translate(${d.x},${d.y})`);
        });

        // Drag functions
        function dragstarted(event: any) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            event.subject.fx = event.subject.x;
            event.subject.fy = event.subject.y;
        }

        function dragged(event: any) {
            event.subject.fx = event.x;
            event.subject.fy = event.y;
        }

        function dragended(event: any) {
            if (!event.active) simulation.alphaTarget(0);
            event.subject.fx = null;
            event.subject.fy = null;
        }

        return () => {
            simulation.stop();
        };
    }, [data, onNodeClick]);

    const handleZoomIn = () => {
        if (svgRef.current && zoomBehavior.current) {
            d3.select(svgRef.current).transition().duration(300).call(zoomBehavior.current.scaleBy as any, 1.3);
        }
    };

    const handleZoomOut = () => {
        if (svgRef.current && zoomBehavior.current) {
            d3.select(svgRef.current).transition().duration(300).call(zoomBehavior.current.scaleBy as any, 1 / 1.3);
        }
    };

    const handleReset = () => {
        if (svgRef.current && zoomBehavior.current) {
            d3.select(svgRef.current).transition().duration(750).call(
                zoomBehavior.current.transform as any,
                d3.zoomIdentity.translate(0, 0).scale(1)
            );
        }
    };

    return (
        <div className="relative w-full h-[600px] bg-slate-50 rounded-xl overflow-hidden border border-slate-200" ref={containerRef}>
            <svg ref={svgRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

            {/* View Controls */}
            <div className="absolute bottom-4 right-4 flex flex-col gap-2 bg-white/80 backdrop-blur-sm p-2 rounded-lg border border-slate-200">
                <button onClick={handleZoomIn} className="p-1.5 text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded transition">
                    <ZoomIn size={18} />
                </button>
                <button onClick={handleReset} className="p-1.5 text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded transition">
                    <Maximize size={18} />
                </button>
                <button onClick={handleZoomOut} className="p-1.5 text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded transition">
                    <ZoomOut size={18} />
                </button>
            </div>

            {/* Legend */}
            <div className="absolute top-4 left-4 bg-white/80 backdrop-blur-sm p-3 rounded-lg border border-slate-200 text-xs shadow-sm">
                <h4 className="text-slate-700 font-semibold mb-2 uppercase tracking-wider text-[10px]">Node Legend</h4>
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full flex-shrink-0 shadow-sm border border-white" style={{ backgroundColor: '#06b6d4' }} />
                        <span className="text-slate-600 font-medium">Asset</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full flex-shrink-0 shadow-sm border border-white" style={{ backgroundColor: '#eab308' }} />
                        <span className="text-slate-600 font-medium">Failure Mode</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full flex-shrink-0 shadow-sm border border-white" style={{ backgroundColor: '#ef4444' }} />
                        <span className="text-slate-600 font-medium">Cause</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full flex-shrink-0 shadow-sm border border-white" style={{ backgroundColor: '#3b82f6' }} />
                        <span className="text-slate-600 font-medium">Person</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full flex-shrink-0 shadow-sm border border-white" style={{ backgroundColor: '#a855f7' }} />
                        <span className="text-slate-600 font-medium">KPI</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full flex-shrink-0 shadow-sm border border-white" style={{ backgroundColor: '#10b981' }} />
                        <span className="text-slate-600 font-medium">Department</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full flex-shrink-0 shadow-sm border border-white" style={{ backgroundColor: '#f97316' }} />
                        <span className="text-slate-600 font-medium">Competency</span>
                    </div>
                </div>
            </div>
        </div>
    );
};
