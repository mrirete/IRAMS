import React, { createContext, useContext, useState, useCallback, useRef, useMemo } from 'react';
import { ConfirmDialog, type ConfirmVariant } from '../components/ui/ConfirmDialog';
import { PromptDialog } from '../components/ui/PromptDialog';

export interface ConfirmOptions {
    title: string;
    message: string;
    variant?: ConfirmVariant;
    confirmLabel?: string;
    cancelLabel?: string;
}

export interface PromptOptions {
    title: string;
    message?: string;
    defaultValue?: string;
    placeholder?: string;
    icon?: React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    inputType?: 'text' | 'textarea' | 'number';
    validation?: (value: string) => string | null | undefined;
}

export type PromptFunction = (
    optionsOrTitle: PromptOptions | string,
    defaultValue?: string
) => Promise<string | null>;

export type ConfirmFunction = (optionsOrMessage: ConfirmOptions | string) => Promise<boolean>;

export interface ConfirmContextCallable {
    (optionsOrMessage: ConfirmOptions | string): Promise<boolean>;
    confirm: ConfirmFunction;
    prompt: PromptFunction;
}

interface ConfirmContextType {
    confirm: ConfirmFunction;
    prompt: PromptFunction;
}

const ConfirmContext = createContext<ConfirmContextType | undefined>(undefined);

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // Confirmation Modal State
    const [confirmState, setConfirmState] = useState<(ConfirmOptions & { open: boolean }) | null>(null);
    const confirmResolveRef = useRef<((value: boolean) => void) | null>(null);

    // Prompt Modal State
    const [promptState, setPromptState] = useState<(PromptOptions & { open: boolean }) | null>(null);
    const promptResolveRef = useRef<((value: string | null) => void) | null>(null);

    // ── Confirm Handler ──
    const confirm = useCallback((optionsOrMessage: ConfirmOptions | string): Promise<boolean> => {
        const opts: ConfirmOptions = typeof optionsOrMessage === 'string'
            ? { title: 'Confirm Action', message: optionsOrMessage, variant: 'warning' }
            : optionsOrMessage;

        return new Promise<boolean>((resolve) => {
            confirmResolveRef.current = resolve;
            setConfirmState({ ...opts, open: true });
        });
    }, []);

    const handleConfirmOk = useCallback(() => {
        confirmResolveRef.current?.(true);
        confirmResolveRef.current = null;
        setConfirmState(null);
    }, []);

    const handleConfirmCancel = useCallback(() => {
        confirmResolveRef.current?.(false);
        confirmResolveRef.current = null;
        setConfirmState(null);
    }, []);

    // ── Prompt Handler ──
    const prompt = useCallback((
        optionsOrTitle: PromptOptions | string,
        defaultValue?: string
    ): Promise<string | null> => {
        const opts: PromptOptions = typeof optionsOrTitle === 'string'
            ? { title: optionsOrTitle, defaultValue: defaultValue ?? '' }
            : optionsOrTitle;

        return new Promise<string | null>((resolve) => {
            promptResolveRef.current = resolve;
            setPromptState({ ...opts, open: true });
        });
    }, []);

    const handlePromptOk = useCallback((val: string) => {
        promptResolveRef.current?.(val);
        promptResolveRef.current = null;
        setPromptState(null);
    }, []);

    const handlePromptCancel = useCallback(() => {
        promptResolveRef.current?.(null);
        promptResolveRef.current = null;
        setPromptState(null);
    }, []);

    const contextValue = useMemo(() => ({
        confirm,
        prompt
    }), [confirm, prompt]);

    return (
        <ConfirmContext.Provider value={contextValue}>
            {children}

            {/* Confirmation Dialog */}
            <ConfirmDialog
                open={!!confirmState?.open}
                onConfirm={handleConfirmOk}
                onCancel={handleConfirmCancel}
                title={confirmState?.title ?? ''}
                message={confirmState?.message ?? ''}
                variant={confirmState?.variant ?? 'danger'}
                confirmLabel={confirmState?.confirmLabel ?? 'Confirm'}
                cancelLabel={confirmState?.cancelLabel ?? 'Cancel'}
            />

            {/* Prompt Dialog */}
            <PromptDialog
                open={!!promptState?.open}
                onConfirm={handlePromptOk}
                onCancel={handlePromptCancel}
                title={promptState?.title ?? ''}
                message={promptState?.message}
                defaultValue={promptState?.defaultValue}
                placeholder={promptState?.placeholder}
                icon={promptState?.icon}
                confirmLabel={promptState?.confirmLabel ?? 'Save'}
                cancelLabel={promptState?.cancelLabel ?? 'Cancel'}
                inputType={promptState?.inputType ?? 'text'}
                validation={promptState?.validation}
            />
        </ConfirmContext.Provider>
    );
};

export const useConfirm = (): ConfirmContextCallable => {
    const context = useContext(ConfirmContext);
    if (!context) {
        throw new Error('useConfirm must be used within a ConfirmProvider');
    }

    const fn = (optionsOrMessage: ConfirmOptions | string) => context.confirm(optionsOrMessage);
    fn.confirm = context.confirm;
    fn.prompt = context.prompt;

    return fn as ConfirmContextCallable;
};

export const usePrompt = (): PromptFunction => {
    const context = useContext(ConfirmContext);
    if (!context) {
        throw new Error('usePrompt must be used within a ConfirmProvider');
    }
    return context.prompt;
};
