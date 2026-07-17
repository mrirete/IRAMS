import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, CheckCircle2, ArrowLeft, Loader2, Server, XCircle, RotateCcw, AlertTriangle, Globe, Database, FileText, Radio, Activity, FolderOpen, CloudSun } from 'lucide-react';
import { ConnectorTypeSelector } from '../../components/connectors/ConnectorTypeSelector';
import { ConfigForm } from '../../components/connectors/ConfigForm';
import { FieldMapper } from '../../components/connectors/FieldMapper';
import { useConnectors } from '../../hooks/useConnectors';
import type { ConnectorType, AnyConnectorConfig } from '../../types/connectors';

const STEPS = ['Select Type', 'Configure', 'Test Connection', 'Field Mapping', 'Activate'];

const getTypeIcon = (type: ConnectorType | null) => {
    switch (type) {
        case 'rest_api': return <Globe size={18} className="text-blue-600" />;
        case 'database': return <Database size={18} className="text-primary-600" />;
        case 'csv': return <FileText size={18} className="text-slate-600" />;
        case 'mqtt': return <Radio size={18} className="text-amber-600" />;
        case 'opc_ua': return <Server size={18} className="text-blue-600" />;
        case 'historian': return <Activity size={18} className="text-pink-600" />;
        case 'document_store': return <FolderOpen size={18} className="text-emerald-600" />;
        case 'weather_api': return <CloudSun size={18} className="text-sky-600" />;
        default: return <Server size={18} className="text-slate-400" />;
    }
};

export const ConnectorWizard: React.FC = () => {
    const navigate = useNavigate();
    const { registerConnector, testConnector } = useConnectors();

    const [currentStep, setCurrentStep] = useState(0);
    const [selectedType, setSelectedType] = useState<ConnectorType | null>(null);
    const [config, setConfig] = useState<Partial<AnyConnectorConfig>>({});
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
    // The test saves a real (inactive) connector row and runs sensor-sync on
    // it — keep its id so retries and final activation reuse the same row.
    const [draftId, setDraftId] = useState<string | undefined>(undefined);
    const [testRecords, setTestRecords] = useState(0);
    const [testError, setTestError] = useState<string | null>(null);
    const [mapping, setMapping] = useState<Record<string, string>>({});
    const [isSaving, setIsSaving] = useState(false);
    const [configErrors, setConfigErrors] = useState<Record<string, string>>({});

    // Mock schemas for Step 4
    const mockExternalFields = ['id_external', 'equip_num', 'description', 'status_code', 'last_modified', 'location_code', 'manufacturer'];
    const mockInternalFields = ['asset_id', 'code', 'name', 'status', 'updated_at', 'location', 'oem'];

    // --- Validation ---
    const validateConfig = (): boolean => {
        const errors: Record<string, string> = {};

        if (!config.name?.trim()) errors.name = 'Connector name is required';
        if (config.sync_interval_seconds !== undefined && config.sync_interval_seconds < 60) {
            errors.sync_interval_seconds = 'Minimum interval is 60 seconds';
        }

        if (selectedType === 'rest_api') {
            if (!(config as any).base_url?.trim()) errors.base_url = 'Base URL is required';
            if (!(config as any).map_asset?.trim()) errors.map_asset = 'Asset field is required';
            if (!(config as any).map_tag?.trim()) errors.map_tag = 'Tag field is required';
            if (!(config as any).map_value?.trim()) errors.map_value = 'Value field is required';
        }
        if (selectedType === 'database') {
            if (!(config as any).connection_url?.trim()) errors.connection_url = 'Connection URL is required';
        }
        if (selectedType === 'historian') {
            if (!(config as any).server_name?.trim()) errors.server_name = 'Server name is required';
        }
        if (selectedType === 'mqtt') {
            if (!(config as any).broker_url?.trim()) errors.broker_url = 'Broker URL is required';
        }
        if (selectedType === 'document_store') {
            if (!(config as any).endpoint_url?.trim()) errors.endpoint_url = 'Endpoint / Site URL is required';
        }
        if (selectedType === 'weather_api') {
            if (!(config as any).api_key?.trim()) errors.api_key = 'API key is required';
        }

        setConfigErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleNext = async () => {
        // Validate on Step 1 → Step 2 transition
        if (currentStep === 1) {
            if (!validateConfig()) return;
        }

        if (currentStep === 2) {
            // Test Connection step
            await runConnectionTest();
            return;
        }

        if (currentStep === 4) {
            // Activate Step — flips the (draft) row to is_active
            setIsSaving(true);
            const finalConfig = { ...config, type: selectedType } as AnyConnectorConfig;
            await registerConnector(finalConfig, draftId);
            setIsSaving(false);
            navigate('/admin/connectors');
            return;
        }

        // REST configures its reading map in step 1 — skip the (asset-schema)
        // mapping step, which doesn't apply to sensor feeds.
        if (currentStep === 2 && selectedType === 'rest_api') {
            setCurrentStep(4);
            return;
        }

        setCurrentStep(prev => Math.min(prev + 1, STEPS.length - 1));
    };

    /**
     * Real end-to-end test: persist the config as an inactive connector and
     * run the sensor-sync edge function against just that row. Success means
     * readings actually landed in ers_sensor_readings.
     */
    const runConnectionTest = async () => {
        setIsTesting(true);
        setTestResult(null);
        setTestError(null);

        const result = await testConnector({ ...config, type: selectedType! }, draftId);
        setDraftId(result.connectorId);

        if (result.ok) {
            setTestResult('success');
            setTestRecords(result.records);
            setIsTesting(false);
            setTimeout(() => setCurrentStep(selectedType === 'rest_api' ? 4 : 3), 1200);
        } else {
            setTestResult('error');
            setTestError(result.error || 'Unknown error');
            setIsTesting(false);
        }
    };

    const handleBack = () => {
        if (currentStep === 0) navigate('/admin/connectors');
        else {
            // Clear test result if going back from test step
            if (currentStep === 2) {
                setTestResult(null);
                setTestError(null);
            }
            // REST skips the mapping step in both directions
            if (currentStep === 4 && selectedType === 'rest_api') {
                setCurrentStep(2);
                return;
            }
            setCurrentStep(prev => Math.max(prev - 1, 0));
        }
    };

    const renderStepContent = () => {
        switch (currentStep) {
            case 0:
                return (
                    <div className="space-y-4">
                        <h2 className="text-xl font-bold text-slate-900">What do you want to connect?</h2>
                        <p className="text-sm text-slate-500 font-medium">Choose the type of system you're integrating with ERS.</p>
                        <ConnectorTypeSelector
                            selectedType={selectedType}
                            onSelect={(type) => {
                                setSelectedType(type);
                                setConfig({ type });
                                setConfigErrors({});
                            }}
                        />
                    </div>
                );
            case 1:
                return (
                    <div className="space-y-4">
                        <h2 className="text-xl font-bold text-slate-900">Configure Credentials & Endpoint</h2>
                        <p className="text-sm text-slate-500 font-medium">Provide the connection details. Fields marked with * are required.</p>
                        {selectedType && (
                            <ConfigForm
                                type={selectedType}
                                config={config}
                                onChange={(updates) => { setConfig(updates); setConfigErrors({}); }}
                                errors={configErrors}
                            />
                        )}
                    </div>
                );
            case 2:
                return (
                    <div className="flex flex-col items-center justify-center py-12 space-y-6 bg-white border border-slate-200 rounded-xl shadow-sm">
                        <div className={`p-5 rounded-full transition-all duration-500 ${testResult === 'success' ? 'bg-emerald-50 ring-2 ring-emerald-300' :
                            testResult === 'error' ? 'bg-red-50 ring-2 ring-red-300' :
                                isTesting ? 'bg-blue-50 ring-2 ring-blue-300' : 'bg-slate-100'}`}>
                            {isTesting ? (
                                <Loader2 size={48} className="text-blue-500 animate-spin" />
                            ) : testResult === 'success' ? (
                                <CheckCircle2 size={48} className="text-emerald-500" />
                            ) : testResult === 'error' ? (
                                <XCircle size={48} className="text-red-500" />
                            ) : (
                                <Server size={48} className="text-slate-400" />
                            )}
                        </div>

                        <div className="text-center max-w-md">
                            <h2 className="text-xl font-bold text-slate-900">
                                {isTesting ? 'Testing Connection...'
                                    : testResult === 'success' ? 'Connection Successful!'
                                        : testResult === 'error' ? 'Connection Failed'
                                            : 'Ready to Test'}
                            </h2>
                            <p className="text-slate-500 mt-2 text-sm font-medium">
                                {isTesting ? `Running a real pull from ${config.name || 'the source'} — readings land in the live sensor feed.`
                                    : testResult === 'success' ? `Pulled ${testRecords} reading point${testRecords === 1 ? '' : 's'} into the sensor feed Predict reads.`
                                        : testResult === 'error' ? 'The pull failed. Review the source\'s actual response below.'
                                            : 'Test Now saves a draft and runs one real pull through the sensor-sync function.'}
                            </p>
                        </div>

                        {/* Error Detail Panel */}
                        {testResult === 'error' && testError && (
                            <div className="w-full max-w-lg space-y-3">
                                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                                    <div className="flex items-start space-x-2">
                                        <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
                                        <div>
                                            <h4 className="text-sm font-bold text-red-700">Error Details</h4>
                                            <p className="text-xs text-red-600 mt-1 font-mono leading-relaxed">{testError}</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center justify-center gap-3">
                                    <button
                                        onClick={runConnectionTest}
                                        className="flex items-center px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-sm font-semibold shadow-sm"
                                    >
                                        <RotateCcw size={14} className="mr-2" /> Retry Test
                                    </button>
                                    <button
                                        onClick={() => setCurrentStep(1)}
                                        className="flex items-center px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-sm font-semibold shadow-sm"
                                    >
                                        <ArrowLeft size={14} className="mr-2" /> Edit Configuration
                                    </button>
                                </div>
                                <button
                                    onClick={() => { setTestResult(null); setTestError(null); setCurrentStep(selectedType === 'rest_api' ? 4 : 3); }}
                                    className="block mx-auto text-xs text-slate-500 hover:text-slate-700 underline transition-colors font-medium"
                                >
                                    Continue anyway (sync may fail)
                                </button>
                            </div>
                        )}

                        {/* Manual Test Button when idle */}
                        {!testResult && !isTesting && (
                            <button
                                onClick={runConnectionTest}
                                className="px-6 py-2.5 bg-accent-blue text-white rounded-lg font-semibold hover:bg-primary-600 transition-all shadow-lg shadow-blue-500/20 active:scale-95"
                            >
                                Test Now
                            </button>
                        )}
                    </div>
                );
            case 3:
                return (
                    <div className="space-y-4">
                        <h2 className="text-xl font-bold text-slate-900">Map Data Fields</h2>
                        <p className="text-sm text-slate-500 font-medium">Map fields from the external system to ERS ISO 14224 taxonomy. Required fields are marked with ⚠.</p>
                        <FieldMapper
                            externalFields={mockExternalFields}
                            internalFields={mockInternalFields}
                            mapping={mapping}
                            onChange={setMapping}
                        />
                    </div>
                );
            case 4:
                return (
                    <div className="space-y-6">
                        <h2 className="text-xl font-bold text-slate-900">Review & Activate</h2>

                        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
                            {[
                                { label: 'Connector Name', value: config.name },
                                { label: 'Type', value: selectedType?.replace('_', ' ')?.toUpperCase() },
                                { label: 'Sync Interval', value: `${config.sync_interval_seconds || 3600}s` },
                                selectedType === 'rest_api'
                                    ? { label: 'Reading Map', value: `${(config as any).map_asset || 'asset'} / ${(config as any).map_tag || 'tag'} / ${(config as any).map_value || 'value'}` }
                                    : { label: 'Fields Mapped', value: `${Object.keys(mapping).length} / ${mockInternalFields.length}` },
                                { label: 'Connection Test', value: testResult === 'success' ? `✅ Passed (${testRecords} points)` : '⚠️ Skipped / Failed' },
                            ].map((row, i, arr) => (
                                <div key={row.label} className={`flex justify-between items-center ${i < arr.length - 1 ? 'border-b border-slate-100 pb-4' : ''}`}>
                                    <span className="text-sm text-slate-500 font-semibold">{row.label}</span>
                                    <span className="font-bold text-slate-900">{row.value}</span>
                                </div>
                            ))}
                        </div>

                        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-start space-x-3">
                            <CheckCircle2 className="text-emerald-600 shrink-0 mt-0.5" size={18} />
                            <div>
                                <h4 className="text-sm font-bold text-emerald-700">Ready to activate</h4>
                                <p className="text-sm text-emerald-600 mt-1">Activation enables this connector for sensor-sync runs (scheduled, or on demand via Sync Now on its card). Readings land in the live sensor feed that Predict and the digital twin read.</p>
                            </div>
                        </div>
                    </div>
                );
            default: return null;
        }
    };

    // Determine if Next should be disabled
    const isNextDisabled = () => {
        if (currentStep === 0 && !selectedType) return true;
        if (currentStep === 1 && !config.name) return true;
        if (currentStep === 2 && (isTesting || testResult === 'error')) return true;
        if (isSaving) return true;
        return false;
    };

    return (
        <div className="max-w-5xl mx-auto animate-in fade-in duration-500">
            {/* Header */}
            <div className="mb-8">
                <button onClick={handleBack} className="flex items-center text-sm text-slate-500 hover:text-slate-800 transition-colors mb-4 font-semibold">
                    <ArrowLeft size={16} className="mr-1" /> Back to Hub
                </button>
                <h1 className="text-2xl font-black text-slate-900 tracking-tight">Add New Connector</h1>
            </div>

            <div className="flex gap-8">
                {/* Main Content */}
                <div className="flex-1 min-w-0">
                    {/* Stepper Wizard Chrome */}
                    <div className="flex items-center justify-between mb-8 relative">
                        <div className="absolute left-0 top-1/2 w-full h-[2px] bg-slate-200 -z-10 -translate-y-1/2" />
                        <div
                            className="absolute left-0 top-1/2 h-[2px] bg-accent-cyan -z-10 -translate-y-1/2 transition-all duration-500"
                            style={{ width: `${(currentStep / (STEPS.length - 1)) * 100}%` }}
                        />

                        {STEPS.map((step, idx) => {
                            const isCompleted = idx < currentStep;
                            const isCurrent = idx === currentStep;
                            return (
                                <div key={step} className="flex flex-col items-center">
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm bg-white transition-all duration-300 ${isCompleted ? 'border-2 border-accent-cyan text-primary-600' :
                                        isCurrent ? 'border-2 border-accent-cyan bg-primary-50 text-slate-900 shadow-[0_0_15px_rgba(6,182,212,0.3)]' :
                                            'border-2 border-slate-300 text-slate-400'
                                        }`}>
                                        {isCompleted ? <CheckCircle2 size={20} /> : (idx + 1)}
                                    </div>
                                    <span className={`mt-2 text-xs font-semibold hidden sm:block ${isCurrent ? 'text-slate-900' : isCompleted ? 'text-primary-600' : 'text-slate-400'}`}>
                                        {step}
                                    </span>
                                </div>
                            );
                        })}
                    </div>

                    {/* Step Content */}
                    <div className="mb-8 min-h-[400px]">
                        {renderStepContent()}
                    </div>

                    {/* Footer Navigation */}
                    <div className="flex items-center justify-between pt-6 border-t border-slate-200">
                        <button
                            onClick={handleBack}
                            className="px-6 py-2.5 rounded-lg font-semibold text-slate-500 hover:text-slate-800 transition-colors disabled:opacity-50"
                            disabled={isTesting || isSaving}
                        >
                            {currentStep === 0 ? 'Cancel' : 'Previous Step'}
                        </button>

                        {/* Don't show Next on Step 2 if test failed (retry/edit buttons shown inline) */}
                        {!(currentStep === 2 && (testResult === 'error' || (!testResult && !isTesting))) && (
                            <button
                                onClick={handleNext}
                                disabled={isNextDisabled()}
                                className="flex items-center px-6 py-2.5 bg-accent-blue text-white rounded-lg font-semibold hover:bg-primary-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-500/20 active:scale-95"
                            >
                                {isSaving ? (
                                    <><Loader2 size={18} className="mr-2 animate-spin" /> Activating...</>
                                ) : currentStep === STEPS.length - 1 ? (
                                    <><CheckCircle2 size={18} className="mr-2" /> Activate Connector</>
                                ) : (
                                    <>Next Step <ChevronRight size={18} className="ml-1" /></>
                                )}
                            </button>
                        )}
                    </div>
                </div>

                {/* Right-hand Summary Sidebar (large screens) */}
                <div className="hidden lg:block w-64 flex-shrink-0">
                    <div className="sticky top-6 bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-5">
                        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Setup Summary</h3>

                        <div className="space-y-4">
                            <div className="flex items-center space-x-3">
                                <div className={`p-2 rounded-lg ${selectedType ? 'bg-primary-50' : 'bg-slate-100'} border border-slate-200`}>
                                    {getTypeIcon(selectedType)}
                                </div>
                                <div>
                                    <div className="text-xs text-slate-500 font-semibold">Type</div>
                                    <div className="text-sm font-bold text-slate-800">{selectedType ? selectedType.replace('_', ' ').toUpperCase() : 'Not selected'}</div>
                                </div>
                            </div>

                            <div className="border-t border-slate-100 pt-3">
                                <div className="text-xs text-slate-500 mb-1 font-semibold">Name</div>
                                <div className="text-sm font-bold text-slate-800">{config.name || '—'}</div>
                            </div>

                            <div className="border-t border-slate-100 pt-3">
                                <div className="text-xs text-slate-500 mb-1 font-semibold">Connection</div>
                                <div className="flex items-center space-x-1.5">
                                    {testResult === 'success' ? (
                                        <><CheckCircle2 size={14} className="text-emerald-500" /><span className="text-sm font-bold text-emerald-600">Verified</span></>
                                    ) : testResult === 'error' ? (
                                        <><XCircle size={14} className="text-red-500" /><span className="text-sm font-bold text-red-600">Failed</span></>
                                    ) : (
                                        <span className="text-sm text-slate-400 font-medium">Pending</span>
                                    )}
                                </div>
                            </div>

                            <div className="border-t border-slate-100 pt-3">
                                <div className="text-xs text-slate-500 mb-1 font-semibold">Fields Mapped</div>
                                <div className="text-sm font-bold text-slate-800">
                                    {Object.keys(mapping).length} / {mockInternalFields.length}
                                </div>
                                <div className="mt-1.5 w-full bg-slate-100 rounded-full h-1.5">
                                    <div
                                        className="h-1.5 rounded-full bg-accent-cyan transition-all duration-300"
                                        style={{ width: `${(Object.keys(mapping).length / mockInternalFields.length) * 100}%` }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
