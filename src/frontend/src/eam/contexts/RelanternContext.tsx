/**
 * RelanternContext — Global AI context provider
 *
 * There is ONE Reliability Specialist in the product: the RelanternAI panel
 * mounted in AppLayout. Two ways to reach it:
 *
 * 1. `openRelantern(contextData, contextType)` — an explicit, page-supplied
 *    call from an "Ask Specialist" button.
 * 2. The TopBar Specialist button, available on every page. It calls
 *    `openRelantern()` with no arguments, which opens the panel grounded in
 *    whatever the current page registered via `registerPageContext`.
 *
 * `registerPageContext` is what lets the one global panel be pre-grounded in
 * the page you're looking at, instead of each module bolting on its own chat.
 * Pages register on mount and clear on unmount.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';

/**
 * A page-supplied Specialist skill.
 *
 * `run` MUST call a deterministic IRAMS engine (aiEngine / Weibull / Monte Carlo /
 * criticality) and return the formatted result. It must NOT ask the chat model to
 * compute anything: the Specialist cites our engines, it does not do the reliability
 * maths itself. The panel renders whatever markdown `run` returns, verbatim.
 *
 * These live on the page because the page owns the structured data (the asset,
 * the Pareto set) the engines need — the panel only ever sees a context string.
 */
export interface SpecialistAction {
    label: string;
    /** Tooltip — what this skill does. */
    description?: string;
    /** Message shown as the user's turn when the chip is clicked. */
    userMessage: string;
    /** Calls an engine; returns markdown to render as the Specialist's reply. */
    run: () => Promise<string>;
}

interface PageContext {
    data: string;
    type?: string;
    actions?: SpecialistAction[];
}

interface RelanternContextType {
    isOpen: boolean;
    contextData?: string;
    contextType?: string;
    initialPrompt?: string;
    /** Engine-backed skills supplied by the page that was active when the panel opened. */
    pageActions?: SpecialistAction[];
    /** Open the panel. With no args, falls back to the current page's registered context. */
    openRelantern: (contextData?: string, contextType?: string, initialPrompt?: string) => void;
    closeRelantern: () => void;
    /** Called by pages to describe themselves to the global Specialist. */
    registerPageContext: (ctx: PageContext | null) => void;
}

const RelanternCtx = createContext<RelanternContextType>({
    isOpen: false,
    openRelantern: () => { },
    closeRelantern: () => { },
    registerPageContext: () => { },
});

export const useRelantern = () => useContext(RelanternCtx);

/**
 * Convenience hook for pages: registers this page's AI context — and optionally its
 * engine-backed skills — for as long as the page is mounted, so the global TopBar
 * Specialist opens pre-grounded and with the right tools.
 *
 * Pass `actions` from a useMemo so this doesn't re-register every render.
 */
export const usePageRelanternContext = (
    data: string | null,
    type?: string,
    actions?: SpecialistAction[],
) => {
    const { registerPageContext } = useRelantern();
    useEffect(() => {
        if (!data) return;
        registerPageContext({ data, type, actions });
        return () => registerPageContext(null);
    }, [data, type, actions, registerPageContext]);
};

interface RelanternProviderProps {
    children: ReactNode;
}

export const RelanternProvider: React.FC<RelanternProviderProps> = ({ children }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [contextData, setContextData] = useState<string>();
    const [contextType, setContextType] = useState<string>();
    const [initialPrompt, setInitialPrompt] = useState<string>();
    const [pageActions, setPageActions] = useState<SpecialistAction[] | undefined>();

    // Held in a ref, not state: registering page context must not re-render the
    // whole tree, and openRelantern needs to read the latest value at call time.
    // Snapshotted into state when the panel opens, so the panel can render it.
    const pageContext = useRef<PageContext | null>(null);

    const registerPageContext = useCallback((ctx: PageContext | null) => {
        pageContext.current = ctx;
    }, []);

    const openRelantern = useCallback((data?: string, type?: string, prompt?: string) => {
        const page = pageContext.current;
        setContextData(data ?? page?.data);
        setContextType(type ?? (data ? undefined : page?.type));
        setInitialPrompt(prompt);
        // Engine-backed skills always come from the page we're standing on.
        setPageActions(page?.actions);
        setIsOpen(true);
    }, []);

    const closeRelantern = useCallback(() => {
        setIsOpen(false);
        setContextData(undefined);
        setContextType(undefined);
        setInitialPrompt(undefined);
        setPageActions(undefined);
    }, []);

    return (
        <RelanternCtx.Provider value={{
            isOpen, contextData, contextType, initialPrompt, pageActions,
            openRelantern, closeRelantern, registerPageContext,
        }}>
            {children}
        </RelanternCtx.Provider>
    );
};
