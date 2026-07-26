import React, { useMemo } from 'react';
import {
    ChevronDown, ChevronUp, HelpCircle, Asterisk, CheckCircle2, Camera,
    ClipboardList, Eye, Gauge, Shield, FileText, Search, Wrench,
    GitBranch, Layers, Activity, Flashlight
} from 'lucide-react';
import type { InspectionFormTemplate, TemplateSection, TemplateField } from '../../types/integrity';

// ── Icon resolver ──
const ICON_MAP: Record<string, React.ReactNode> = {
    ClipboardList: <ClipboardList size={14} />, Eye: <Eye size={14} />,
    Gauge: <Gauge size={14} />, Ruler: <Gauge size={14} />,
    Shield: <Shield size={14} />, FileText: <FileText size={14} />,
    Search: <Search size={14} />, Flashlight: <Flashlight size={14} />,
    Wrench: <Wrench size={14} />, GitBranch: <GitBranch size={14} />,
    Layers: <Layers size={14} />, Activity: <Activity size={14} />,
    Cylinder: <Gauge size={14} />, Home: <Shield size={14} />,
    Plug: <Wrench size={14} />, Unplug: <Wrench size={14} />,
    Tent: <Shield size={14} />,
};

interface InspectionFormRendererProps {
    template: InspectionFormTemplate;
    responses: Record<string, string | number | boolean>;
    onResponseChange: (fieldId: string, value: string | number | boolean) => void;
    readonly?: boolean;
}

export const InspectionFormRenderer: React.FC<InspectionFormRendererProps> = ({
    template, responses, onResponseChange, readonly,
}) => {
    const [collapsedSections, setCollapsedSections] = React.useState<Set<string>>(new Set());

    const toggleSection = (id: string) => {
        setCollapsedSections(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    // Calculate completion progress
    const { totalRequired, completedRequired, pct } = useMemo(() => {
        let total = 0, completed = 0;
        for (const section of template.sections) {
            for (const field of section.fields) {
                if (!field.required) continue;
                // Check conditional visibility
                if (field.condition) {
                    const depVal = responses[field.condition.depends_on];
                    if (depVal !== field.condition.equals) continue; // hidden, don't count
                }
                total++;
                const val = responses[field.id];
                if (val !== undefined && val !== '' && val !== false) completed++;
            }
        }
        return { totalRequired: total, completedRequired: completed, pct: total === 0 ? 100 : Math.round((completed / total) * 100) };
    }, [template, responses]);

    const isFieldVisible = (field: TemplateField): boolean => {
        if (!field.condition) return true;
        return responses[field.condition.depends_on] === field.condition.equals;
    };

    const renderField = (field: TemplateField) => {
        if (!isFieldVisible(field)) return null;
        const value = responses[field.id];
        const isComplete = field.required && value !== undefined && value !== '' && value !== false;

        if (readonly) {
            return (
                <div key={field.id} className="py-2">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                        {field.label}
                    </label>
                    <p className="text-sm text-slate-700">
                        {value === true ? '✓ Yes' : value === false ? '✗ No' : (value ?? '—')}
                        {field.unit && value ? ` ${field.unit}` : ''}
                    </p>
                </div>
            );
        }

        return (
            <div key={field.id} className="py-2">
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 mb-1.5">
                    {field.label}
                    {field.required && <span className="text-red-400 text-[10px]">*</span>}
                    {isComplete && <CheckCircle2 size={10} className="text-emerald-500" />}
                    {field.help_text && (
                        <span className="group relative cursor-help ml-auto">
                            <HelpCircle size={11} className="text-slate-400" />
                            <span className="hidden group-hover:block absolute z-50 bottom-full right-0 mb-1 w-56 p-2 bg-slate-800 text-white text-[10px] rounded-lg shadow-xl leading-relaxed">
                                {field.help_text}
                            </span>
                        </span>
                    )}
                </label>

                {field.field_type === 'text' && (
                    <input
                        type="text"
                        value={(value as string) ?? ''}
                        onChange={e => onResponseChange(field.id, e.target.value)}
                        placeholder={field.placeholder}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-400 transition-all"
                    />
                )}

                {field.field_type === 'number' && (
                    <input
                        type="number"
                        value={(value as number) ?? ''}
                        onChange={e => onResponseChange(field.id, parseFloat(e.target.value) || 0)}
                        min={field.min_value}
                        max={field.max_value}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-300 transition-all"
                    />
                )}

                {field.field_type === 'measurement' && (
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            step="0.01"
                            value={(value as number) ?? ''}
                            onChange={e => onResponseChange(field.id, parseFloat(e.target.value) || 0)}
                            min={field.min_value}
                            placeholder="0.00"
                            className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-300 transition-all"
                        />
                        <span className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-2 rounded-lg border border-slate-200 shrink-0">
                            {field.unit || 'mm'}
                        </span>
                    </div>
                )}

                {field.field_type === 'select' && (
                    <select
                        value={(value as string) ?? ''}
                        onChange={e => onResponseChange(field.id, e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-300 transition-all"
                    >
                        <option value="">— Select —</option>
                        {field.options?.map(opt => (
                            <option key={opt} value={opt}>{opt.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())}</option>
                        ))}
                    </select>
                )}

                {field.field_type === 'checkbox' && (
                    <label className="flex items-center gap-2.5 cursor-pointer group/toggle">
                        <div className="relative">
                            <input
                                type="checkbox"
                                checked={(value as boolean) || false}
                                onChange={e => onResponseChange(field.id, e.target.checked)}
                                className="sr-only peer"
                            />
                            <div className="w-10 h-5 bg-slate-200 rounded-full peer-checked:bg-primary-500 transition-colors" />
                            <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm peer-checked:translate-x-5 transition-transform" />
                        </div>
                        <span className="text-xs text-slate-600 group-hover/toggle:text-slate-800 transition-colors">
                            {(value as boolean) ? 'Yes' : 'No'}
                        </span>
                    </label>
                )}

                {field.field_type === 'textarea' && (
                    <textarea
                        value={(value as string) ?? ''}
                        onChange={e => onResponseChange(field.id, e.target.value)}
                        placeholder={field.placeholder}
                        rows={3}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-primary-300 resize-none transition-all"
                    />
                )}

                {field.field_type === 'date' && (
                    <input
                        type="date"
                        value={(value as string) ?? ''}
                        onChange={e => onResponseChange(field.id, e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-300 transition-all"
                    />
                )}

                {field.field_type === 'photo' && (
                    <div className="w-20 h-20 bg-slate-100 border-2 border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-primary-400 hover:bg-primary-50/30 transition-all">
                        <Camera size={20} className="text-slate-300" />
                        <span className="text-[9px] text-slate-400 mt-1">Add Photo</span>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="space-y-4">
            {/* Progress Bar */}
            <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Checklist Progress</span>
                    <span className="text-xs font-bold text-slate-700">{completedRequired}/{totalRequired} required fields</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                        className={`h-full rounded-full transition-all duration-500 ${pct === 100 ? 'bg-gradient-to-r from-emerald-400 to-emerald-500' : 'bg-gradient-to-r from-primary-400 to-blue-500'}`}
                        style={{ width: `${pct}%` }}
                    />
                </div>
            </div>

            {/* Template Info */}
            <div className="flex items-center gap-2 px-1">
                <span className="text-[10px] font-bold text-primary-600 bg-primary-50 px-2 py-0.5 rounded-md border border-primary-200">{template.governing_code}</span>
                <span className="text-xs text-slate-500 font-medium">{template.name}</span>
                <span className="text-[10px] text-slate-400 ml-auto">v{template.version}</span>
            </div>

            {/* Sections */}
            {template.sections.map(section => {
                const isCollapsed = collapsedSections.has(section.id);
                const sectionIcon = ICON_MAP[section.icon || ''] || <ClipboardList size={14} />;
                const visibleFields = section.fields.filter(isFieldVisible);
                const requiredCount = visibleFields.filter(f => f.required).length;
                const completedCount = visibleFields.filter(f => {
                    if (!f.required) return false;
                    const v = responses[f.id];
                    return v !== undefined && v !== '' && v !== false;
                }).length;

                return (
                    <div key={section.id} className="bg-white/80 backdrop-blur-sm border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-200">
                        <button
                            onClick={() => toggleSection(section.id)}
                            className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50/50 transition-colors"
                        >
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 shrink-0">
                                {sectionIcon}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                    <h4 className="text-sm font-bold text-slate-800">{section.title}</h4>
                                    {section.required && <span className="text-[8px] font-bold text-red-400 bg-red-50 px-1.5 py-0.5 rounded border border-red-200">REQ</span>}
                                </div>
                                {section.description && <p className="text-[10px] text-slate-400 mt-0.5 truncate">{section.description}</p>}
                            </div>
                            {requiredCount > 0 && (
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border shrink-0 ${completedCount === requiredCount ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                                    {completedCount}/{requiredCount}
                                </span>
                            )}
                            {isCollapsed ? <ChevronDown size={16} className="text-slate-400 shrink-0" /> : <ChevronUp size={16} className="text-slate-400 shrink-0" />}
                        </button>
                        {!isCollapsed && (
                            <div className="px-4 pb-4 border-t border-slate-100 divide-y divide-slate-50">
                                {visibleFields.map(renderField)}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};
