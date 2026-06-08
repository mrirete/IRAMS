import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

// Mock Data for Graph
const data = {
    nodes: [
        { id: 'Pump-101', group: 1, label: 'Pump-101', type: 'Asset' },
        { id: 'Motor-101', group: 1, label: 'Motor-101', type: 'Asset' },
        { id: 'Bearing Failure', group: 2, label: 'Bearing Failure', type: 'Failure Mode' },
        { id: 'Misalignment', group: 3, label: 'Misalignment', type: 'Cause' },
        { id: 'John_Tech', group: 4, label: 'John Tech', type: 'Person' },
        { id: 'ISO_55001_v2', group: 5, label: 'ISO 55001', type: 'Rule' }
    ],
    links: [
        { source: 'Motor-101', target: 'Pump-101', type: 'DRIVES' },
        { source: 'Bearing Failure', target: 'Motor-101', type: 'AFFECTS' },
        { source: 'Misalignment', target: 'Bearing Failure', type: 'CAUSES' },
        { source: 'John_Tech', target: 'Motor-101', type: 'MAINTAINS' },
        { source: 'John_Tech', target: 'ISO_55001_v2', type: 'COMPLIES_WITH' }
    ]
};

export const KnowledgeGraphView: React.FC = () => {
    const svgRef = useRef<SVGSVGElement>(null);

    useEffect(() => {
        if (!svgRef.current) return;

        const width = 800;
        const height = 500;

        // Clear previous
        d3.select(svgRef.current).selectAll("*").remove();

        const svg = d3.select(svgRef.current)
            .attr("viewBox", [0, 0, width, height]);

        // Apply Navy Theme Map
        const colorMap: Record<number, string> = {
            1: '#3b82f6', // Asset = Blue
            2: '#ef4444', // Failure = Red
            3: '#f59e0b', // Cause = Orange
            4: '#10b981', // Person = Green
            5: '#a855f7'  // Rule = Purple
        };

        const simulation = d3.forceSimulation(data.nodes as any)
            .force("link", d3.forceLink(data.links).id((d: any) => d.id).distance(100))
            .force("charge", d3.forceManyBody().strength(-300))
            .force("center", d3.forceCenter(width / 2, height / 2));

        const link = svg.append("g")
            .attr("stroke", "#475569")
            .attr("stroke-opacity", 0.6)
            .selectAll("line")
            .data(data.links)
            .join("line")
            .attr("stroke-width", 1.5);

        const node = svg.append("g")
            .selectAll("g")
            .data(data.nodes)
            .join("g")
            .call(d3.drag<any, any>()
                .on("start", dragstarted)
                .on("drag", dragged)
                .on("end", dragended) as any);

        node.append("circle")
            .attr("r", 12)
            .attr("fill", (d) => colorMap[d.group])
            .attr("stroke", "#0B1120")
            .attr("stroke-width", 2);

        node.append("text")
            .text((d) => d.label)
            .attr("x", 16)
            .attr("y", 4)
            .attr("fill", "#F1F5F9")
            .attr("font-size", "10px")
            .attr("font-family", "Inter, sans-serif");

        link.append("title")
            .text(d => d.type);

        simulation.on("tick", () => {
            link
                .attr("x1", (d: any) => d.source.x)
                .attr("y1", (d: any) => d.source.y)
                .attr("x2", (d: any) => d.target.x)
                .attr("y2", (d: any) => d.target.y);

            node
                .attr("transform", (d: any) => `translate(${d.x},${d.y})`);
        });

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
    }, []);

    return (
        <div className="w-full h-full min-h-[500px] bg-slate-50 border border-slate-300 rounded-lg relative overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-200 bg-white flex justify-between items-center z-10">
                <h2 className="text-slate-800 font-semibold">Industrial Knowledge Graph</h2>
                <div className="flex gap-4 text-xs">
                    <span className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-accent-blue"></div> Asset</span>
                    <span className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-accent-alert"></div> Failure</span>
                    <span className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-accent-safe"></div> Person</span>
                </div>
            </div>
            <svg ref={svgRef} className="w-full h-full flex-1" />
        </div>
    );
};
