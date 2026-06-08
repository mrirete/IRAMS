import React, { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const PumpModel = () => {
    const meshRef = useRef<THREE.Mesh>(null);

    // Simple rotation animation
    useFrame(() => {
        if (meshRef.current) {
            meshRef.current.rotation.y += 0.005;
        }
    });

    return (
        <mesh ref={meshRef}>
            <cylinderGeometry args={[1, 1, 3, 32]} />
            <meshStandardMaterial color="#3b82f6" wireframe={true} />

            {/* Annotated "Hot Spot" */}
            <mesh position={[0, 1, 1]}>
                <sphereGeometry args={[0.2, 16, 16]} />
                <meshBasicMaterial color="#ef4444" />
            </mesh>
        </mesh>
    );
};

export const DigitalTwin: React.FC = () => {
    return (
        <div className="w-full h-full min-h-[400px] bg-slate-50 border border-slate-300 rounded-lg relative overflow-hidden">

            {/* HUD Overlay */}
            <div className="absolute top-4 left-4 z-10 bg-white/80 p-4 rounded backdrop-blur-sm border border-slate-300">
                <h3 className="text-sm font-bold text-slate-800 mb-2">PUMP-101A (Booster)</h3>
                <div className="space-y-1 text-xs">
                    <div className="flex justify-between w-40">
                        <span className="text-slate-400">Health Index</span>
                        <span className="text-accent-safe font-semibold">88%</span>
                    </div>
                    <div className="flex justify-between w-40">
                        <span className="text-slate-400">RUL (P50)</span>
                        <span className="text-slate-800">112 Days</span>
                    </div>
                    <div className="flex justify-between w-40">
                        <span className="text-slate-400">Vibration (DE)</span>
                        <span className="text-accent-warn font-semibold">4.2 mm/s</span>
                    </div>
                </div>
            </div>

            <Canvas camera={{ position: [4, 3, 5], fov: 45 }}>
                <ambientLight intensity={0.5} />
                <pointLight position={[10, 10, 10]} intensity={1} />
                <PumpModel />
            </Canvas>

        </div>
    );
};
