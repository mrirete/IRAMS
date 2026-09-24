/**
 * PlantScene3D — the drawing as a plant: every drawn component a solid on a
 * ground plane, every connection a pipe, colour from the health snapshot.
 *
 * WHERE THE GEOMETRY COMES FROM
 * The site stores no coordinates for its equipment (no plot plan, no model).
 * The P&ID does: each node has an x,y the engineer placed. That is laid on
 * the ground (x → east, y → south) and each equipment class gets a primitive
 * of a recognisable shape — a vessel stands, an exchanger lies, a tank is
 * squat, a pump is a block, a valve a small node, an instrument a pin. It is
 * a schematic in three dimensions, not a survey: distances are drawing
 * distances. Phase 3 replaces primitives with one model per ISO 14224 class.
 *
 * WHAT IT ANSWERS THAT THE 2D SHEET DOES NOT
 * Click a component: everything it feeds and everything that feeds it lights
 * up, from the same deterministic graph walk the permit and the Specialist
 * use (pidGraph.walk) — the flow path is the reliability question.
 *
 * Loaded lazily: three is ~600 kB and only this toggle needs it.
 */
import React, { useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Html, Line, Grid } from '@react-three/drei';
import * as THREE from 'three';
import type { PIDEquipment, PIDConnection } from '../analyze/PIDViewer';
import { buildPidGraph, walk } from '../../../supabase/functions/agent-run/pidGraph.ts';

interface Props {
    equipment: PIDEquipment[];
    connections: PIDConnection[];
    /** The node that stands for the asset being studied — drawn with a ring. */
    selectedNodeId?: string | null;
    /** Study the register asset behind a drawn component. */
    onStudy?: (assetId: string) => void;
    showLabels?: boolean;
}

/** Drawing pixels → scene units. A 1040-px sheet becomes 26 units wide. */
const SCALE = 1 / 40;
const PIPE_Y = 0.35;

type Shape =
    | { kind: 'cyl'; r: number; h: number; horizontal?: boolean }
    | { kind: 'box'; w: number; h: number; d: number }
    | { kind: 'sphere'; r: number }
    | { kind: 'pin' };

function shapeFor(type: PIDEquipment['type']): Shape {
    switch (type) {
        case 'vessel':
        case 'separator': return { kind: 'cyl', r: 0.45, h: 2.2 };
        case 'column': return { kind: 'cyl', r: 0.4, h: 3.2 };
        case 'heat_exchanger': return { kind: 'cyl', r: 0.35, h: 1.8, horizontal: true };
        case 'tank': return { kind: 'cyl', r: 0.8, h: 1.0 };
        case 'pump': return { kind: 'box', w: 0.9, h: 0.6, d: 0.7 };
        case 'compressor':
        case 'turbine': return { kind: 'box', w: 1.3, h: 0.9, d: 0.9 };
        case 'motor': return { kind: 'box', w: 0.7, h: 0.5, d: 0.5 };
        case 'valve': return { kind: 'sphere', r: 0.22 };
        case 'transmitter':
        case 'controller':
        case 'indicator': return { kind: 'pin' };
        default: return { kind: 'box', w: 0.6, h: 0.4, d: 0.6 };
    }
}

function heightOf(s: Shape): number {
    if (s.kind === 'cyl') return s.horizontal ? s.r * 2 : s.h;
    if (s.kind === 'box') return s.h;
    if (s.kind === 'sphere') return s.r * 2;
    return 1.6;
}

function healthColor(hi: number | undefined, dim: boolean): string {
    if (hi === undefined || hi === null) return dim ? '#e2e8f0' : '#94a3b8';
    if (hi >= 80) return dim ? '#bbf7d0' : '#22c55e';
    if (hi >= 60) return dim ? '#fde68a' : '#f59e0b';
    return dim ? '#fecaca' : '#ef4444';
}

const EDGE_STYLE: Record<PIDConnection['type'], { color: string; width: number; dashed: boolean }> = {
    process: { color: '#475569', width: 2.5, dashed: false },
    instrument: { color: '#3b82f6', width: 1.2, dashed: true },
    signal: { color: '#a855f7', width: 1.2, dashed: true },
    electrical: { color: '#f59e0b', width: 1.5, dashed: true },
};

const Solid: React.FC<{
    eq: PIDEquipment; pos: [number, number, number]; shape: Shape; color: string;
    ring: boolean; hovered: boolean; traced: boolean; showLabel: boolean;
    onHover: (id: string | null) => void; onClick: (id: string) => void; onStudy?: (assetId: string) => void;
}> = ({ eq, pos, shape, color, ring, hovered, traced, showLabel, onHover, onClick, onStudy }) => {
    const h = heightOf(shape);
    const emissive = hovered ? '#1e293b' : traced ? '#0f172a' : '#000000';
    const emissiveIntensity = hovered ? 0.25 : traced ? 0.15 : 0;
    const mat = <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={emissiveIntensity} roughness={0.55} metalness={0.15} />;
    const common = {
        onPointerOver: (e: { stopPropagation: () => void }) => { e.stopPropagation(); onHover(eq.id); },
        onPointerOut: () => onHover(null),
        onClick: (e: { stopPropagation: () => void }) => { e.stopPropagation(); onClick(eq.id); },
    };
    return (
        <group position={pos}>
            {shape.kind === 'cyl' && !shape.horizontal && (
                <mesh position={[0, h / 2, 0]} castShadow {...common}><cylinderGeometry args={[shape.r, shape.r, shape.h, 24]} />{mat}</mesh>
            )}
            {shape.kind === 'cyl' && shape.horizontal && (
                <mesh position={[0, shape.r, 0]} rotation={[0, 0, Math.PI / 2]} castShadow {...common}><cylinderGeometry args={[shape.r, shape.r, shape.h, 24]} />{mat}</mesh>
            )}
            {shape.kind === 'box' && (
                <mesh position={[0, shape.h / 2, 0]} castShadow {...common}><boxGeometry args={[shape.w, shape.h, shape.d]} />{mat}</mesh>
            )}
            {shape.kind === 'sphere' && (
                <mesh position={[0, PIPE_Y, 0]} castShadow {...common}><sphereGeometry args={[shape.r, 16, 16]} />{mat}</mesh>
            )}
            {shape.kind === 'pin' && (
                <>
                    <mesh position={[0, 0.7, 0]}><cylinderGeometry args={[0.03, 0.03, 1.4, 6]} /><meshStandardMaterial color="#64748b" /></mesh>
                    <mesh position={[0, 1.45, 0]} {...common}><sphereGeometry args={[0.16, 12, 12]} />{mat}</mesh>
                </>
            )}
            {ring && (
                <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                    <ringGeometry args={[0.9, 1.05, 32]} />
                    <meshBasicMaterial color="#dc2626" transparent opacity={0.85} />
                </mesh>
            )}
            {(showLabel || hovered) && (
                <Html position={[0, h + 0.35, 0]} center distanceFactor={14} style={{ pointerEvents: hovered ? 'auto' : 'none' }}>
                    <div className="px-1.5 py-0.5 rounded bg-white/95 border border-slate-200 shadow-sm text-[10px] whitespace-nowrap text-slate-700">
                        <span className="font-semibold">{eq.label}</span>
                        {eq.healthIndex !== undefined && <span className="ml-1 text-slate-500">{eq.healthIndex}%</span>}
                        {(eq.woCount || 0) > 0 && <span className="ml-1 text-amber-600">{eq.woCount} WO</span>}
                        {hovered && eq.assetId && onStudy && (
                            <button onClick={(e) => { e.stopPropagation(); onStudy(eq.assetId!); }} className="ml-1.5 text-primary-600 font-semibold hover:underline">Study →</button>
                        )}
                    </div>
                </Html>
            )}
        </group>
    );
};

const Pipe: React.FC<{ a: THREE.Vector3; b: THREE.Vector3; type: PIDConnection['type']; lit: boolean; dim: boolean }> = ({ a, b, type, lit, dim }) => {
    const style = EDGE_STYLE[type] ?? EDGE_STYLE.process;
    const color = lit ? '#0ea5e9' : dim ? '#cbd5e1' : style.color;
    const dir = useMemo(() => b.clone().sub(a).normalize(), [a, b]);
    const mid = useMemo(() => a.clone().add(b).multiplyScalar(0.5), [a, b]);
    const quat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir), [dir]);
    return (
        <>
            <Line points={[a, b]} color={color} lineWidth={lit ? style.width + 1.5 : style.width} dashed={style.dashed} dashSize={0.3} gapSize={0.15} />
            {type === 'process' && (
                <mesh position={mid} quaternion={quat}>
                    <coneGeometry args={[0.12, 0.32, 8]} />
                    <meshStandardMaterial color={color} />
                </mesh>
            )}
        </>
    );
};

export const PlantScene3D: React.FC<Props> = ({ equipment, connections, selectedNodeId, onStudy, showLabels = false }) => {
    const [hovered, setHovered] = useState<string | null>(null);
    const [traced, setTraced] = useState<string | null>(null);

    // Centre the sheet on the origin so orbit feels natural.
    const layout = useMemo(() => {
        const xs = equipment.map((e) => e.x || 0), ys = equipment.map((e) => e.y || 0);
        const cx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
        const cy = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
        const pos = new Map<string, THREE.Vector3>();
        for (const e of equipment) pos.set(e.id, new THREE.Vector3(((e.x || 0) - cx) * SCALE, 0, ((e.y || 0) - cy) * SCALE));
        const extent = Math.max(8, ...xs.map((x) => Math.abs(x - cx) * SCALE), ...ys.map((y) => Math.abs(y - cy) * SCALE));
        return { pos, extent };
    }, [equipment]);

    // Flow trace from the same graph the permit and the Specialist use.
    const trace = useMemo(() => {
        if (!traced) return null;
        const g = buildPidGraph(
            equipment.map((e) => ({ id: e.id, type: e.type, label: e.label, assetId: e.assetId, assetTag: e.assetTag })),
            connections.map((c) => ({ id: c.id, fromId: c.fromId, toId: c.toId, type: c.type })),
        );
        const up = new Set(walk(g, traced, 'up').map((n) => n.id));
        const down = new Set(walk(g, traced, 'down').map((n) => n.id));
        return { up, down, all: new Set([traced, ...up, ...down]) };
    }, [traced, equipment, connections]);

    const camDist = layout.extent * 1.6;

    return (
        <div className="relative rounded-lg overflow-hidden border border-slate-200 bg-slate-50" style={{ height: 480 }}>
            <Canvas shadows camera={{ position: [0, camDist * 0.75, camDist], fov: 42, near: 0.1, far: 500 }} dpr={[1, 1.75]} onPointerMissed={() => setTraced(null)}>
                <color attach="background" args={['#f8fafc']} />
                <ambientLight intensity={0.75} />
                <directionalLight position={[12, 20, 8]} intensity={1.1} castShadow shadow-mapSize={[1024, 1024]} />
                <Grid args={[layout.extent * 4, layout.extent * 4]} cellSize={1} cellThickness={0.5} cellColor="#e2e8f0" sectionSize={5} sectionThickness={0.8} sectionColor="#cbd5e1" fadeDistance={layout.extent * 4} fadeStrength={1} infiniteGrid />
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
                    <planeGeometry args={[layout.extent * 4, layout.extent * 4]} />
                    <shadowMaterial opacity={0.12} />
                </mesh>

                {connections.map((c) => {
                    const a = layout.pos.get(c.fromId), b = layout.pos.get(c.toId);
                    if (!a || !b) return null;
                    const lit = !!trace && trace.all.has(c.fromId) && trace.all.has(c.toId) && c.type === 'process';
                    const dim = !!trace && !lit;
                    return <Pipe key={c.id} a={a.clone().setY(PIPE_Y)} b={b.clone().setY(PIPE_Y)} type={c.type} lit={lit} dim={dim} />;
                })}

                {equipment.map((e) => {
                    const p = layout.pos.get(e.id);
                    if (!p) return null;
                    const inTrace = !!trace && trace.all.has(e.id);
                    const dim = !!trace && !inTrace;
                    return (
                        <Solid
                            key={e.id}
                            eq={e}
                            pos={[p.x, 0, p.z]}
                            shape={shapeFor(e.type)}
                            color={healthColor(e.healthIndex, dim)}
                            ring={e.id === selectedNodeId}
                            hovered={hovered === e.id}
                            traced={inTrace}
                            showLabel={showLabels || e.id === selectedNodeId || e.id === traced}
                            onHover={setHovered}
                            onClick={(id) => setTraced((cur) => (cur === id ? null : id))}
                            onStudy={onStudy}
                        />
                    );
                })}

                <OrbitControls makeDefault enableDamping dampingFactor={0.1} maxPolarAngle={Math.PI / 2 - 0.05} minDistance={3} maxDistance={camDist * 3} />
            </Canvas>

            <div className="absolute left-2 bottom-2 flex items-center gap-2 text-[10px] text-slate-500 bg-white/90 border border-slate-200 rounded px-2 py-1">
                {trace ? (
                    <>
                        <span className="font-semibold text-slate-700">{equipment.find((e) => e.id === traced)?.label}</span>
                        <span>· feeds {trace.down.size} · fed by {trace.up.size}</span>
                        <button onClick={() => setTraced(null)} className="text-primary-600 font-semibold hover:underline">clear</button>
                    </>
                ) : (
                    <span>Drag to orbit · scroll to zoom · click a component to trace its flow path</span>
                )}
            </div>
        </div>
    );
};

export default PlantScene3D;
