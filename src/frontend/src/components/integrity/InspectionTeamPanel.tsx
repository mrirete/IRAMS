import React, { useState } from 'react';
import { Users, Plus, X, Award, User, Search, ChevronDown, Shield, Wrench, Eye } from 'lucide-react';
import type { InspectionTeamMember, InspectionTeamRole } from '../../types/integrity';

const ROLE_CONFIG: Record<InspectionTeamRole, { label: string; icon: React.ReactNode; bg: string; text: string }> = {
    lead_inspector: { label: 'Lead Inspector', icon: <Shield size={10} />, bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700' },
    nde_technician: { label: 'NDE Technician', icon: <Wrench size={10} />, bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700' },
    engineer: { label: 'Engineer', icon: <Award size={10} />, bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700' },
    observer: { label: 'Observer', icon: <Eye size={10} />, bg: 'bg-slate-50 border-slate-200', text: 'text-slate-600' },
};

const MOCK_PEOPLE = [
    { user_id: 'usr-chen', name: 'D. Chen', department: 'Inspection', email: 'd.chen@ers.io' },
    { user_id: 'usr-okafor', name: 'M. Okafor', department: 'NDE Services', email: 'm.okafor@ers.io' },
    { user_id: 'usr-jenkins', name: 'S. Jenkins', department: 'Integrity', email: 's.jenkins@ers.io' },
    { user_id: 'usr-burton', name: 'A. Burton', department: 'Inspection', email: 'a.burton@ers.io' },
    { user_id: 'usr-nagata', name: 'N. Nagata', department: 'Operations', email: 'n.nagata@ers.io' },
    { user_id: 'usr-brooks', name: 'T. Brooks', department: 'Reliability', email: 't.brooks@ers.io' },
    { user_id: 'usr-garcia', name: 'L. Garcia', department: 'Maintenance', email: 'l.garcia@ers.io' },
];

interface InspectionTeamPanelProps {
    team: InspectionTeamMember[];
    onAdd: (member: Omit<InspectionTeamMember, 'id' | 'added_at'>) => void;
    onRemove: (id: string) => void;
    onUpdateRole: (id: string, role: InspectionTeamRole) => void;
    readonly?: boolean;
}

export const InspectionTeamPanel: React.FC<InspectionTeamPanelProps> = ({
    team, onAdd, onRemove, onUpdateRole, readonly,
}) => {
    const [showPicker, setShowPicker] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedRole, setSelectedRole] = useState<InspectionTeamRole>('nde_technician');
    const [certification, setCertification] = useState('');
    const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

    const existingUserIds = new Set(team.map(m => m.user_id));
    const filteredPeople = MOCK_PEOPLE
        .filter(p => !existingUserIds.has(p.user_id))
        .filter(p => !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.department.toLowerCase().includes(searchQuery.toLowerCase()));

    const handleAddMember = (person: typeof MOCK_PEOPLE[0]) => {
        onAdd({
            user_id: person.user_id,
            name: person.name,
            role: selectedRole,
            certification: certification || undefined,
            department: person.department,
            email: person.email,
        });
        setSearchQuery('');
        setCertification('');
        setShowPicker(false);
    };

    const getInitials = (name: string) => name.split(' ').map(n => n[0]).join('').toUpperCase();

    const INITIALS_COLORS = ['bg-blue-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-blue-500'];

    return (
        <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="w-1 h-5 rounded-full bg-gradient-to-b from-blue-400 to-blue-400" />
                    <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Inspection Team</h3>
                    <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-medium">{team.length}</span>
                </div>
                {!readonly && (
                    <button
                        onClick={() => setShowPicker(!showPicker)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                    >
                        <Plus size={12} /> Add Inspector
                    </button>
                )}
            </div>

            {/* Avatar Stack (compact view) */}
            {team.length > 0 && !showPicker && (
                <div className="space-y-2">
                    {team.map((member, idx) => {
                        const role = ROLE_CONFIG[member.role];
                        const colorClass = INITIALS_COLORS[idx % INITIALS_COLORS.length];
                        return (
                            <div key={member.id} className="bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-3 shadow-sm hover:shadow-md transition-all duration-200">
                                {/* Avatar */}
                                <div className={`w-9 h-9 rounded-full ${colorClass} flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-sm`}>
                                    {getInitials(member.name)}
                                </div>
                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-sm font-semibold text-slate-800">{member.name}</span>
                                        {readonly ? (
                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-md border ${role.bg} ${role.text}`}>
                                                {role.icon} {role.label}
                                            </span>
                                        ) : (
                                            <select
                                                value={member.role}
                                                onChange={e => onUpdateRole(member.id, e.target.value as InspectionTeamRole)}
                                                className={`px-2 py-0.5 text-[10px] font-bold rounded-md border ${role.bg} ${role.text} cursor-pointer focus:outline-none`}
                                            >
                                                <option value="lead_inspector">Lead Inspector</option>
                                                <option value="nde_technician">NDE Technician</option>
                                                <option value="engineer">Engineer</option>
                                                <option value="observer">Observer</option>
                                            </select>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400">
                                        {member.department && <span>{member.department}</span>}
                                        {member.certification && (
                                            <>
                                                <span>•</span>
                                                <span className="inline-flex items-center gap-0.5"><Award size={8} /> {member.certification}</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                                {/* Remove */}
                                {!readonly && (
                                    confirmRemove === member.id ? (
                                        <div className="flex items-center gap-1 shrink-0">
                                            <button onClick={() => { onRemove(member.id); setConfirmRemove(null); }} className="px-2 py-1 text-[10px] font-bold text-white bg-red-500 rounded hover:bg-red-600 transition-colors">Remove</button>
                                            <button onClick={() => setConfirmRemove(null)} className="px-2 py-1 text-[10px] text-slate-500 bg-slate-100 rounded hover:bg-slate-200 transition-colors">Cancel</button>
                                        </div>
                                    ) : (
                                        <button onClick={() => setConfirmRemove(member.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors shrink-0" title="Remove">
                                            <X size={14} />
                                        </button>
                                    )
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Empty State */}
            {team.length === 0 && !showPicker && (
                <div className="bg-white border border-slate-200 rounded-xl p-6 text-center">
                    <Users size={24} className="mx-auto text-slate-300 mb-2" />
                    <p className="text-sm text-slate-500 font-medium">No team members assigned</p>
                    <p className="text-xs text-slate-400 mt-1">Add inspectors and NDE technicians to this inspection</p>
                </div>
            )}

            {/* Picker Modal */}
            {showPicker && !readonly && (
                <div className="bg-white/90 backdrop-blur-sm border border-blue-200/60 rounded-xl p-4 shadow-lg space-y-3 animate-in slide-in-from-top-2 duration-200">
                    {/* Search */}
                    <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search people..."
                            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300 transition-all"
                            autoFocus
                        />
                    </div>

                    {/* Role + Certification */}
                    <div className="flex gap-2">
                        <select
                            value={selectedRole}
                            onChange={e => setSelectedRole(e.target.value as InspectionTeamRole)}
                            className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300 transition-all"
                        >
                            <option value="lead_inspector">Lead Inspector</option>
                            <option value="nde_technician">NDE Technician</option>
                            <option value="engineer">Engineer</option>
                            <option value="observer">Observer</option>
                        </select>
                        <input
                            value={certification}
                            onChange={e => setCertification(e.target.value)}
                            placeholder="Certification (e.g. API 510)"
                            className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300 transition-all"
                        />
                    </div>

                    {/* People List */}
                    <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
                        {filteredPeople.length === 0 ? (
                            <div className="p-4 text-center text-xs text-slate-400">No matching people found</div>
                        ) : (
                            filteredPeople.map(person => (
                                <button
                                    key={person.user_id}
                                    onClick={() => handleAddMember(person)}
                                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-blue-50 transition-colors"
                                >
                                    <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-600 shrink-0">
                                        {getInitials(person.name)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-semibold text-slate-800">{person.name}</p>
                                        <p className="text-[10px] text-slate-400">{person.department}</p>
                                    </div>
                                    <Plus size={14} className="text-blue-400 shrink-0" />
                                </button>
                            ))
                        )}
                    </div>

                    <button onClick={() => setShowPicker(false)} className="w-full py-1.5 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
                        Close
                    </button>
                </div>
            )}
        </div>
    );
};
