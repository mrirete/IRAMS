import React, { useState, useEffect, useRef } from 'react';
import { Monitor, Tablet, Smartphone, X, RotateCcw, RefreshCw } from 'lucide-react';

interface DevicePreviewerProps {
    onClose: () => void;
}

export const DevicePreviewer: React.FC<DevicePreviewerProps> = ({ onClose }) => {
    const [device, setDevice] = useState<'desktop' | 'tablet' | 'mobile'>('tablet');
    const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
    const [iframeKey, setIframeKey] = useState(0);
    const [timeString, setTimeString] = useState('09:41');
    const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });
    const containerRef = useRef<HTMLDivElement>(null);

    // Live clock update for simulated device status bar
    useEffect(() => {
        const updateTime = () => {
            const now = new Date();
            let hours = now.getHours();
            const minutes = String(now.getMinutes()).padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            hours = hours ? hours : 12; // 0 should be 12
            setTimeString(`${hours}:${minutes} ${ampm}`);
        };
        updateTime();
        const interval = setInterval(updateTime, 30000); // update every 30 seconds
        return () => clearInterval(interval);
    }, []);

    // Resize observer to track available canvas dimensions and implement auto-scaling
    useEffect(() => {
        if (!containerRef.current) return;

        // Initial measurement
        setContainerSize({
            width: containerRef.current.clientWidth,
            height: containerRef.current.clientHeight
        });

        const resizeObserver = new ResizeObserver((entries) => {
            if (!entries || entries.length === 0) return;
            const { width, height } = entries[0].contentRect;
            setContainerSize({ width, height });
        });

        resizeObserver.observe(containerRef.current);
        return () => resizeObserver.disconnect();
    }, []);

    const getDimensions = () => {
        if (device === 'tablet') {
            return orientation === 'portrait' ? { width: 768, height: 1024 } : { width: 1024, height: 768 };
        }
        if (device === 'mobile') {
            return orientation === 'portrait' ? { width: 390, height: 844 } : { width: 844, height: 390 };
        }
        return { width: '100%', height: '100%' };
    };

    const dims = getDimensions();

    const getScale = () => {
        if (device === 'desktop') return 1;

        // Calculate device outer container measurements including bezels and chins
        // We add:
        // Width: 24px (12px bezel left + 12px bezel right)
        // Height: 56px (12px bezel top + 12px bezel bottom + 28px status bar + 4px chin)
        const deviceW = (typeof dims.width === 'number' ? dims.width : 0) + 24;
        const deviceH = (typeof dims.height === 'number' ? dims.height : 0) + 56;

        // Define a safe margins of 48px around the device frame for visual breathability
        const maxW = containerSize.width - 48;
        const maxH = containerSize.height - 48;

        const scaleW = maxW / deviceW;
        const scaleH = maxH / deviceH;

        // Find the limiting scale factor, and cap it at 100% (1.0)
        const calculatedScale = Math.min(scaleW, scaleH);
        return calculatedScale < 1 ? calculatedScale : 1;
    };

    const scale = getScale();
    const scalePercentage = Math.round(scale * 100);

    const transformStyle = device !== 'desktop' ? {
        transform: `scale(${scale})`,
        transformOrigin: 'center center',
        transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
    } : {};

    return (
        <div className="fixed inset-0 z-[9999] bg-brand-950 flex flex-col font-sans select-none animate-in fade-in duration-300">
            {/* Top Toolbar */}
            <div className="h-14 bg-brand-900/90 backdrop-blur-md border-b border-brand-800/80 flex items-center justify-between px-4 shadow-lg shrink-0">
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/25">
                            <Monitor size={13} className="text-white" />
                        </div>
                        <div className="flex flex-col">
                            <span className="text-brand-50 font-bold tracking-wide text-xs">ERS Device Simulator</span>
                            {device !== 'desktop' && (
                                <span className="text-[10px] text-brand-400 font-medium">
                                    {scalePercentage < 100 ? `Scaled to fit · ${scalePercentage}%` : 'Actual Size · 100%'}
                                </span>
                            )}
                        </div>
                    </div>
                    
                    {/* Device Selector */}
                    <div className="flex items-center bg-brand-950/60 rounded-lg p-1 border border-brand-800/50 shadow-inner">
                        <button 
                            onClick={() => setDevice('desktop')} 
                            className={`px-3 py-1.5 rounded-md flex items-center gap-2 text-xs font-semibold transition-all duration-200 ${device === 'desktop' ? 'bg-indigo-500/20 text-indigo-300 shadow-sm border border-indigo-500/20' : 'text-brand-400 hover:text-brand-200 hover:bg-brand-900/40 border border-transparent'}`}
                        >
                            <Monitor size={13}/>
                            <span className="hidden xs:inline">Desktop</span>
                        </button>
                        <button 
                            onClick={() => setDevice('tablet')} 
                            className={`px-3 py-1.5 rounded-md flex items-center gap-2 text-xs font-semibold transition-all duration-200 ${device === 'tablet' ? 'bg-indigo-500/20 text-indigo-300 shadow-sm border border-indigo-500/20' : 'text-brand-400 hover:text-brand-200 hover:bg-brand-900/40 border border-transparent'}`}
                        >
                            <Tablet size={13}/>
                            <span className="hidden xs:inline">Tablet</span>
                        </button>
                        <button 
                            onClick={() => setDevice('mobile')} 
                            className={`px-3 py-1.5 rounded-md flex items-center gap-2 text-xs font-semibold transition-all duration-200 ${device === 'mobile' ? 'bg-indigo-500/20 text-indigo-300 shadow-sm border border-indigo-500/20' : 'text-brand-400 hover:text-brand-200 hover:bg-brand-900/40 border border-transparent'}`}
                        >
                            <Smartphone size={13}/>
                            <span className="hidden xs:inline">Mobile</span>
                        </button>
                    </div>
                </div>
                
                {/* Control Actions */}
                <div className="flex items-center gap-2">
                    {device !== 'desktop' && (
                        <button 
                            onClick={() => setOrientation(o => o === 'portrait' ? 'landscape' : 'portrait')} 
                            className="p-1.5 text-brand-300 hover:text-indigo-300 hover:bg-brand-800 rounded-lg transition-all border border-brand-800 bg-brand-900/40 flex items-center gap-1.5 text-xs font-semibold hover:shadow-sm"
                            title="Rotate Device Orientation"
                        >
                            <RotateCcw size={13} className="transition-transform duration-300 hover:-rotate-45" />
                            <span className="hidden sm:inline">{orientation === 'portrait' ? 'Portrait' : 'Landscape'}</span>
                        </button>
                    )}
                    <div className="w-px h-6 bg-brand-800/80 mx-1"></div>
                    <button 
                        onClick={() => setIframeKey(k => k + 1)} 
                        className="p-2 text-brand-400 hover:text-indigo-300 hover:bg-brand-850 rounded-lg transition-all border border-transparent hover:border-brand-800"
                        title="Hard Reload Viewport"
                    >
                        <RefreshCw size={15} />
                    </button>
                    <button 
                        onClick={onClose} 
                        className="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-all ml-1 border border-transparent hover:border-red-500/25"
                        title="Close Device Simulator"
                    >
                        <X size={18} />
                    </button>
                </div>
            </div>

            {/* Preview Simulation Canvas */}
            <div 
                ref={containerRef}
                className="flex-1 overflow-hidden flex items-center justify-center p-4 md:p-8 relative bg-[#090d16] select-none"
                style={{ 
                    backgroundImage: 'radial-gradient(#1e293b 1px, transparent 1px)', 
                    backgroundSize: '24px 24px' 
                }}
            >
                {/* Simulated Physical Hardware Device Shell */}
                <div 
                    className={`bg-slate-950 transition-all duration-500 ease-out relative border-[12px] border-slate-900 rounded-[36px] overflow-hidden flex flex-col ${device === 'desktop' ? 'w-full h-full border-none rounded-none shadow-none ring-0' : 'shadow-2xl shadow-black/80 ring-1 ring-white/10'}`}
                    style={device !== 'desktop' ? { 
                        width: dims.width, 
                        height: dims.height,
                        flexShrink: 0,
                        ...transformStyle
                    } : {}}
                >
                    {/* Simulated Device OS Status Bar */}
                    {device !== 'desktop' && (
                        <div className="h-7 bg-slate-900 text-slate-400 px-6 flex items-center justify-between text-[10px] font-bold tracking-wider select-none border-b border-slate-950/40 relative shrink-0">
                            {/* Left Side: Clock */}
                            <span className="z-10 text-slate-300/90">{timeString}</span>
                            
                            {/* Center Space for Physical Notch Overlay */}
                            <div className="w-24 h-full"></div>
                            
                            {/* Right Side: Status Icons */}
                            <div className="flex items-center gap-2 z-10 text-slate-300/80">
                                {/* Wifi Indicator */}
                                <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                                    <path d="M12 21l-12-12c4.97-4.97 13.03-4.97 18 0l-6 12z"/>
                                </svg>
                                {/* LTE Cellular bars */}
                                <div className="flex items-end gap-[1.5px] h-2.5 w-3">
                                    <div className="w-[1.8px] h-[30%] bg-slate-300/80 rounded-2xs"></div>
                                    <div className="w-[1.8px] h-[55%] bg-slate-300/80 rounded-2xs"></div>
                                    <div className="w-[1.8px] h-[78%] bg-slate-300/80 rounded-2xs"></div>
                                    <div className="w-[1.8px] h-[100%] bg-slate-300/80 rounded-2xs"></div>
                                </div>
                                {/* Battery Percent Label + Icon */}
                                <span className="text-[9px] font-semibold text-slate-400/90">82%</span>
                                <div className="w-5.5 h-3 border border-slate-400/60 rounded-xs p-[1px] flex items-center">
                                    <div className="h-full w-[82%] bg-emerald-400 rounded-3xs"></div>
                                    <div className="w-0.5 h-1 bg-slate-400/60 rounded-r-3xs ml-[0.5px]"></div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Camera Notch Overlay (Simulated Apple Dynamic Island or Android teardrop notch) */}
                    {device !== 'desktop' && orientation === 'portrait' && (
                        <div className="absolute top-1 left-1/2 transform -translate-x-1/2 w-28 h-5 bg-black rounded-full z-50 flex items-center justify-center border border-white/5 shadow-inner">
                            {/* Camera Lens Highlight */}
                            <div className="absolute left-4 w-1.5 h-1.5 bg-indigo-950/80 border border-indigo-500/20 rounded-full flex items-center justify-center">
                                <div className="w-0.5 h-0.5 bg-indigo-400 rounded-full opacity-60"></div>
                            </div>
                            {/* Speaker Mesh line */}
                            <div className="w-10 h-0.5 bg-zinc-800 rounded-full"></div>
                        </div>
                    )}
                    
                    {/* Camera Notch Landscape Mode (Rotating Notch to the Left) */}
                    {device !== 'desktop' && orientation === 'landscape' && (
                        <div className="absolute left-1 top-1/2 transform -translate-y-1/2 w-5 h-28 bg-black rounded-full z-50 flex flex-col items-center justify-center border border-white/5 shadow-inner">
                            {/* Camera Lens Highlight */}
                            <div className="absolute top-4 w-1.5 h-1.5 bg-indigo-950/80 border border-indigo-500/20 rounded-full flex items-center justify-center">
                                <div className="w-0.5 h-0.5 bg-indigo-400 rounded-full opacity-60"></div>
                            </div>
                            {/* Speaker Mesh line */}
                            <div className="h-10 w-0.5 bg-zinc-800 rounded-full"></div>
                        </div>
                    )}

                    {/* Interactive Frame Viewport */}
                    <div className="flex-1 w-full relative bg-slate-50 overflow-hidden">
                        <iframe
                            key={iframeKey}
                            src={window.location.pathname + window.location.search}
                            className="absolute top-0 left-0 w-full h-full border-none bg-slate-50"
                            title="Hardware Device Viewport"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};
