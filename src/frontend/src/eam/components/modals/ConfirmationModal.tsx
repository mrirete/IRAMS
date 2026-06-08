import React from 'react';
import { AlertTriangle, CheckCircle, Info, XCircle, X } from 'lucide-react';

export type ConfirmationType = 'danger' | 'warning' | 'success' | 'info';

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm?: () => void; // If undefined, it acts as an "Alert" (OK only)
    title: string;
    message: string;
    type?: ConfirmationType;
    confirmText?: string;
    cancelText?: string;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    type = 'info',
    confirmText = 'Confirm',
    cancelText = 'Cancel'
}) => {
    if (!isOpen) return null;

    const styles = {
        danger: {
            icon: <AlertTriangle className="text-red-600" size={24} />,
            bgIcon: 'bg-red-100',
            button: 'bg-red-600 hover:bg-red-700 text-white',
            border: 'border-red-200'
        },
        warning: {
            icon: <AlertTriangle className="text-orange-600" size={24} />,
            bgIcon: 'bg-orange-100',
            button: 'bg-orange-600 hover:bg-orange-700 text-white',
            border: 'border-orange-200'
        },
        success: {
            icon: <CheckCircle className="text-green-600" size={24} />,
            bgIcon: 'bg-green-100',
            button: 'bg-green-600 hover:bg-green-700 text-white',
            border: 'border-green-200'
        },
        info: {
            icon: <Info className="text-blue-600" size={24} />,
            bgIcon: 'bg-blue-100',
            button: 'bg-relantern-500 hover:bg-relantern-600 text-white',
            border: 'border-blue-200'
        }
    };

    const style = styles[type];

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden transform transition-all scale-100">
                <div className="p-6">
                    <div className="flex items-start gap-4">
                        <div className={`flex-shrink-0 p-3 rounded-full ${style.bgIcon}`}>
                            {style.icon}
                        </div>
                        <div className="flex-1">
                            <h3 className="text-lg font-bold text-slate-900 mb-2">{title}</h3>
                            <div className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">
                                {message}
                            </div>
                        </div>
                        <button onClick={onClose} className="text-slate-400 hover:text-slate-500 transition-colors">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <div className="bg-slate-50 px-6 py-4 flex justify-end gap-3 border-t border-slate-100">
                    {onConfirm ? (
                        <>
                            <button
                                onClick={onClose}
                                className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-slate-700 text-sm font-medium hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-sm"
                            >
                                {cancelText}
                            </button>
                            <button
                                onClick={() => {
                                    onConfirm();
                                    onClose();
                                }}
                                className={`px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition-colors ${style.button}`}
                            >
                                {confirmText}
                            </button>
                        </>
                    ) : (
                        <button
                            onClick={onClose}
                            className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-slate-700 text-sm font-medium hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-sm"
                        >
                            Close
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
