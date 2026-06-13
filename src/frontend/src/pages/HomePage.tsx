import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Plus, Sparkles, BarChart2, Download, Clock } from 'lucide-react';
import { DigitalTwin } from '../dashboards/DigitalTwin';
import { KnowledgeGraphView } from '../dashboards/KnowledgeGraphView';
import { KpiStrip } from '../components/dashboard/KpiStrip';
import { FleetHealthBar } from '../components/dashboard/FleetHealthBar';
import { AlertFeed } from '../components/dashboard/AlertFeed';
import { WorkPipeline } from '../components/dashboard/WorkPipeline';
import { CostTrendChart } from '../components/dashboard/CostTrendChart';

export const HomePage: React.FC = () => {
    const { user } = useAuth();
    const navigate = useNavigate();

    const greeting = (() => {
        const hour = new Date().getHours();
        if (hour < 12) return 'Good morning';
        if (hour < 17) return 'Good afternoon';
        return 'Good evening';
    })();

    const displayName = user?.full_name || user?.username || 'Operator';
    const roleBadge = user?.role || 'admin';

    return (
        <div className="space-y-6 pb-24 animate-in fade-in duration-500">
            {/* ═══ Greeting Header ═══ */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-slate-800 tracking-tight">
                        {greeting}, <span className="text-relantern-600">{displayName}</span>
                    </h1>
                    <div className="flex items-center gap-2 mt-1">
                        <p className="text-slate-500 text-xs md:text-sm">Relantern — Command Center</p>
                        <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${roleBadge === 'admin' ? 'bg-accent-cyan/10 text-accent-cyan border-accent-cyan/30' :
                            roleBadge === 'engineer' ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' :
                                roleBadge === 'technician' ? 'bg-accent-safe/10 text-accent-safe border-accent-safe/30' :
                                    'bg-slate-100 text-slate-500 border-slate-300'
                            }`}>
                            {roleBadge}
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Clock size={14} />
                    <span className="font-mono">{new Date().toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</span>
                </div>
            </div>

            {/* ═══ Section 1: Hero KPI Strip ═══ */}
            <KpiStrip />

            {/* ═══ Section 2 + 3: Fleet Health + Alert Feed (2-column) ═══ */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <FleetHealthBar />
                <AlertFeed />
            </div>

            {/* ═══ Section 4: Work Order Pipeline ═══ */}
            <WorkPipeline />

            {/* ═══ Section 5: Cost Trend ═══ */}
            <CostTrendChart />

            {/* ═══ Section 6: Digital Twin + Knowledge Graph (2-column) ═══ */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
                    <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2 mb-4">
                        <span className="w-1.5 h-5 bg-relantern-500 rounded-full" />
                        Reliability Digital Twin
                    </h2>
                    <div className="h-[350px]">
                        <DigitalTwin />
                    </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 flex flex-col">
                    <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2 mb-4">
                        <span className="w-1.5 h-5 bg-relantern-400 rounded-full" />
                        Asset Knowledge Graph
                    </h2>
                    <div className="flex-1 min-h-[350px]">
                        <KnowledgeGraphView />
                    </div>
                </div>
            </div>

            {/* ═══ Section 7: Quick Actions Bar (floating) ═══ */}
            <div className="fixed bottom-4 md:bottom-6 left-1/2 -translate-x-1/2 z-40 max-w-[95vw]">
                <div className="flex items-center gap-2 px-3 md:px-4 py-2 bg-white/90 backdrop-blur-xl border border-slate-200 rounded-2xl shadow-lg shadow-slate-300/40 overflow-x-auto scrollbar-hide">
                    <button
                        onClick={() => navigate('/work')}
                        className="flex items-center gap-2 px-3 md:px-4 py-2 bg-relantern-50 hover:bg-relantern-100 text-relantern-700 border border-relantern-200 rounded-xl text-xs md:text-sm font-semibold transition-all hover:scale-105 whitespace-nowrap"
                    >
                        <Plus size={14} /> Work Request
                    </button>
                    <button
                        onClick={() => navigate('/predict')}
                        className="flex items-center gap-2 px-3 md:px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 rounded-xl text-xs md:text-sm font-semibold transition-all hover:scale-105 whitespace-nowrap"
                    >
                        <Sparkles size={14} /> Predictive
                    </button>
                    <button
                        onClick={() => navigate('/analyze')}
                        className="flex items-center gap-2 px-3 md:px-4 py-2 bg-orange-50 hover:bg-orange-100 text-orange-600 border border-orange-200 rounded-xl text-xs md:text-sm font-semibold transition-all hover:scale-105 whitespace-nowrap"
                    >
                        <BarChart2 size={14} /> Bad Actors
                    </button>
                    <div className="w-px h-6 bg-slate-200 mx-1 flex-shrink-0" />
                    <button className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors flex-shrink-0" title="Export Dashboard">
                        <Download size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
};
