import React, { useState } from 'react';
import { DatabaseService } from '../services/DatabaseService';
import { CheckCircle, AlertTriangle, Play, Shield, Terminal } from 'lucide-react';

export const SystemHealth: React.FC = () => {
    const [logs, setLogs] = useState<string[]>([]);
    const [dbState, setDbState] = useState<any>(null);

    const log = (msg: string) => setLogs(prev => [...prev, `${new Date().toLocaleTimeString()} > ${msg}`]);

    const runDiagnostics = async () => {
        setLogs([]);
        log("Initialize Database Service...");
        const db = DatabaseService.getInstance();
        await db.reset();

        try {
            // TEST 1: Workflow
            log("TEST 1: Request -> Work Order Conversion");
            const req = await db.createRequest({
                id: 'req-1',
                request_number: 'REQ-001',
                status: 'AUTHORIZED', // Skipping to AUTHORIZED for test
                description: 'Vibration on Pump 101',
                asset_id: 'a1',
                requester_id: 'u1',
                functional_failure_id: 'FF-VIB',
                risk_score: 80,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }, 'tester');
            log(`Created Request: ${req.id} [${req.status}]`);

            const wo = await db.approveRequestAndConvert('req-1', 'admin');
            log(`Converted to WO: ${wo.id} [${wo.status}]`);

            // TEST 2: Cost Freezing
            log("TEST 2: Closure & Cost Freezing");
            const closedWo = await db.updateWorkOrder(wo.id, { status: 'CLOSED' }, 'admin');
            log(`Closed WO. Cost Frozen: ${closedWo.cost_frozen}. Labor: $${closedWo.frozen_labor_cost}`);

            if (!closedWo.cost_frozen) throw new Error("FAIL: Cost not frozen upon closure");

            // TEST 3: Security Violation
            log("TEST 3: Attempting to Modify Frozen Record...");
            try {
                await db.updateWorkOrder(wo.id, { frozen_labor_cost: 9999 }, 'hacker');
                log("FAIL: Modification allowed!");
            } catch (e: any) {
                log(`SUCCESS: Modification blocked with error: "${e.message}"`);
            }

            setDbState({
                logs: await db.getLogs(),
                workOrders: await db.getWorkOrder(wo.id)
            });

        } catch (e: any) {
            log(`CRITICAL FAILURE: ${e.message}`);
        }
    };

    return (
        <div className="p-8 max-w-4xl mx-auto space-y-6">
            <h1 className="text-2xl font-bold flex items-center gap-2">
                <Shield className="text-green-600" /> System Diagnostics & Health
            </h1>

            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="font-bold text-slate-800">Backend Logic Verification</h2>
                    <button
                        onClick={runDiagnostics}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 font-mono text-sm"
                    >
                        <Play size={16} /> Run Test Suite
                    </button>
                </div>

                <div className="bg-slate-950 text-green-400 p-4 rounded-lg font-mono text-sm h-64 overflow-y-auto mb-4 border border-slate-800">
                    {logs.length === 0 ? <span className="text-slate-600 opacity-50">// Ready to run diagnostics...</span> : logs.map((l, i) => (
                        <div key={i}>{l}</div>
                    ))}
                </div>

                {dbState && (
                    <div className="space-y-4">
                        <h3 className="font-bold text-sm uppercase text-slate-500">Audit Trail (Last Transaction)</h3>
                        <div className="border rounded-lg overflow-hidden">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-slate-50 text-slate-500">
                                    <tr>
                                        <th className="p-2">Action</th>
                                        <th className="p-2">Table</th>
                                        <th className="p-2">ID</th>
                                        <th className="p-2">Changes</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {dbState.logs.slice(-5).map((log: any) => (
                                        <tr key={log.id} className="border-t border-slate-100">
                                            <td className="p-2 font-mono text-blue-600">{log.action}</td>
                                            <td className="p-2">{log.table_name}</td>
                                            <td className="p-2 font-mono text-xs">{log.record_id}</td>
                                            <td className="p-2 max-w-xs truncate text-slate-400 text-xs">{log.changes}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
