
import React, { useState } from 'react';
import { DatabaseService } from '../services/DatabaseService';
import { useAuth } from '../contexts/AuthContext';

export const DebugSave: React.FC = () => {
    const { user } = useAuth();
    const [log, setLog] = useState<string[]>([]);

    const addLog = (msg: string) => setLog(prev => [...prev, `${new Date().toISOString().split('T')[1]} - ${msg}`]);

    const runTest = async () => {
        addLog('Starting test...');
        const woId = '6c4fdcf7-7202-4200-9de7-18458417ee53'; // WO-2026-6958

        if (!user) {
            addLog('Error: No user logged in!');
            return;
        }

        try {
            addLog(`Attempting to update WO ${woId} as user ${user.id}...`);
            await DatabaseService.getInstance().updateWorkOrder(woId, {
                description: 'Vibration - Debug Test Update',
                updated_at: new Date().toISOString()
            } as any, user.id);
            addLog('Success! Work Order updated.');
        } catch (e: any) {
            addLog('Error details:');
            addLog(JSON.stringify(e, null, 2));
            addLog('Message: ' + e.message);
            if (e.details) addLog('Details: ' + e.details);
            if (e.hint) addLog('Hint: ' + e.hint);
            if (e.code) addLog('Code: ' + e.code);
        }
    };

    return (
        <div className="p-10">
            <h1 className="text-2xl font-bold mb-4">Debug WO Save</h1>
            <button onClick={runTest} className="bg-relantern-500 text-white px-4 py-2 rounded">
                Run Update Test
            </button>
            <pre className="mt-4 bg-slate-100 p-4 rounded border border-slate-300 whitespace-pre-wrap font-mono text-sm">
                {log.join('\n')}
            </pre>
        </div>
    );
};
