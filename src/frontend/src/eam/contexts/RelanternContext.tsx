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

interface PageContext {
    data: string;
    type?: string;
}

interface RelanternContextType {
    isOpen: boolean;
    contextData?: string;
    contextType?: string;
    initialPrompt?: string;
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
 * Convenience hook for pages: registers this page's AI context for as long as
 * the page is mounted, so the global TopBar Specialist opens pre-grounded.
 */
export const usePageRelanternContext = (data: string | null, type?: string) => {
    const { registerPageContext } = useRelantern();
    useEffect(() => {
        if (!data) return;
        registerPageContext({ data, type });
        return () => registerPageContext(null);
    }, [data, type, registerPageContext]);
};

interface RelanternProviderProps {
    children: ReactNode;
}

export const RelanternProvider: React.FC<RelanternProviderProps> = ({ children }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [contextData, setContextData] = useState<string>();
    const [contextType, setContextType] = useState<string>();
    const [initialPrompt, setInitialPrompt] = useState<string>();

    // Held in a ref, not state: registering page context must not re-render the
    // whole tree, and openRelantern needs to read the latest value at call time.
    const pageContext = useRef<PageContext | null>(null);

    const registerPageContext = useCallback((ctx: PageContext | null) => {
        pageContext.current = ctx;
    }, []);

    const openRelantern = useCallback((data?: string, type?: string, prompt?: string) => {
        const fallback = pageContext.current;
        setContextData(data ?? fallback?.data);
        setContextType(type ?? (data ? undefined : fallback?.type));
        setInitialPrompt(prompt);
        setIsOpen(true);
    }, []);

    const closeRelantern = useCallback(() => {
        setIsOpen(false);
        setContextData(undefined);
        setContextType(undefined);
        setInitialPrompt(undefined);
    }, []);

    return (
        <RelanternCtx.Provider value={{
            isOpen, contextData, contextType, initialPrompt,
            openRelantern, closeRelantern, registerPageContext,
        }}>
            {children}
        </RelanternCtx.Provider>
    );
};
