import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { ConfirmDialog, type ConfirmVariant } from '../components/ui/ConfirmDialog';

/**
 * ConfirmContext — imperative `confirm()` as a hook.
 *
 * Usage:
 *   const confirm = useConfirm();
 *
 *   const handleDelete = async () => {
 *       const ok = await confirm({
 *           title: 'Delete Task',
 *           message: 'This task and all its data will be permanently removed.',
 *           variant: 'danger',
 *           confirmLabel: 'Delete',
 *       });
 *       if (!ok) return;
 *       // proceed with deletion…
 *   };
 */

export interface ConfirmOptions {
    title: string;
    message: string;
    variant?: ConfirmVariant;
    confirmLabel?: string;
    cancelLabel?: string;
}

interface ConfirmContextType {
    confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextType | undefined>(undefined);

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [state, setState] = useState<(ConfirmOptions & { open: boolean }) | null>(null);
    const resolveRef = useRef<((value: boolean) => void) | null>(null);

    const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
        return new Promise<boolean>((resolve) => {
            resolveRef.current = resolve;
            setState({ ...options, open: true });
        });
    }, []);

    const handleConfirm = useCallback(() => {
        resolveRef.current?.(true);
        resolveRef.current = null;
        setState(null);
    }, []);

    const handleCancel = useCallback(() => {
        resolveRef.current?.(false);
        resolveRef.current = null;
        setState(null);
    }, []);

    return (
        <ConfirmContext.Provider value={{ confirm }}>
            {children}
            <ConfirmDialog
                open={!!state?.open}
                onConfirm={handleConfirm}
                onCancel={handleCancel}
                title={state?.title ?? ''}
                message={state?.message ?? ''}
                variant={state?.variant ?? 'danger'}
                confirmLabel={state?.confirmLabel ?? 'Confirm'}
                cancelLabel={state?.cancelLabel ?? 'Cancel'}
            />
        </ConfirmContext.Provider>
    );
};

export const useConfirm = (): ConfirmContextType['confirm'] => {
    const context = useContext(ConfirmContext);
    if (!context) {
        throw new Error('useConfirm must be used within a ConfirmProvider');
    }
    return context.confirm;
};
