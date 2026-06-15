import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from './cn';

/**
 * Overlay primitives — Modal (centered dialog) + Drawer (side sheet).
 * Both: backdrop click + Esc to close, body scroll lock, safe-area aware.
 *
 * Drawer is the master–detail surface: a right-side sheet on desktop, full-screen
 * on mobile (so a technician opening a work order gets a native full-page view).
 */

function useOverlayBehavior(open: boolean, onClose: () => void) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prev;
        };
    }, [open, onClose]);
}

const Backdrop: React.FC<{ onClose: () => void }> = ({ onClose }) => (
    <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-[1px] animate-[fadeIn_120ms_ease-out]"
        onClick={onClose}
        aria-hidden
    />
);

// ── Modal ───────────────────────────────────────────────────────────────────
export interface ModalProps {
    open: boolean;
    onClose: () => void;
    title?: React.ReactNode;
    /** Footer actions, right-aligned */
    footer?: React.ReactNode;
    size?: 'sm' | 'md' | 'lg';
    children: React.ReactNode;
}

const MODAL_SIZE = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' };

export const Modal: React.FC<ModalProps> = ({ open, onClose, title, footer, size = 'md', children }) => {
    useOverlayBehavior(open, onClose);
    if (!open) return null;
    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <Backdrop onClose={onClose} />
            <div
                role="dialog"
                aria-modal="true"
                className={cn(
                    'relative w-full bg-white rounded-card shadow-overlay flex flex-col max-h-[90vh]',
                    'animate-[scaleIn_140ms_ease-out]',
                    MODAL_SIZE[size]
                )}
            >
                {title && (
                    <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
                        <h2 className="text-base font-bold text-slate-800">{title}</h2>
                        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 -mr-1" aria-label="Close">
                            <X size={18} />
                        </button>
                    </div>
                )}
                <div className="flex-1 overflow-y-auto p-5">{children}</div>
                {footer && (
                    <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50/60">
                        {footer}
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
};

// ── Drawer ──────────────────────────────────────────────────────────────────
export interface DrawerProps {
    open: boolean;
    onClose: () => void;
    title?: React.ReactNode;
    subtitle?: React.ReactNode;
    /** Sticky footer (e.g. mobile execution actions) */
    footer?: React.ReactNode;
    /** Desktop width */
    width?: 'md' | 'lg' | 'xl';
    children: React.ReactNode;
}

const DRAWER_WIDTH = { md: 'md:max-w-md', lg: 'md:max-w-lg', xl: 'md:max-w-2xl' };

export const Drawer: React.FC<DrawerProps> = ({ open, onClose, title, subtitle, footer, width = 'lg', children }) => {
    useOverlayBehavior(open, onClose);
    if (!open) return null;
    return createPortal(
        <div className="fixed inset-0 z-[100] flex justify-end">
            <Backdrop onClose={onClose} />
            <div
                role="dialog"
                aria-modal="true"
                className={cn(
                    'relative w-full bg-slate-50 shadow-overlay flex flex-col h-full',
                    'animate-[slideInRight_180ms_ease-out]',
                    DRAWER_WIDTH[width]
                )}
            >
                {(title || subtitle) && (
                    <div className="flex items-start justify-between gap-3 px-4 md:px-5 py-3 border-b border-slate-200 bg-white flex-shrink-0">
                        <div className="min-w-0">
                            {title && <h2 className="text-base font-bold text-slate-800 truncate">{title}</h2>}
                            {subtitle && <p className="text-xs text-slate-500 truncate">{subtitle}</p>}
                        </div>
                        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 -mr-1 flex-shrink-0" aria-label="Close">
                            <X size={20} />
                        </button>
                    </div>
                )}
                <div className="flex-1 overflow-y-auto overflow-x-hidden">{children}</div>
                {footer && (
                    <div
                        className="flex items-center gap-2 px-4 py-3 border-t border-slate-200 bg-white flex-shrink-0"
                        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
                    >
                        {footer}
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
};
