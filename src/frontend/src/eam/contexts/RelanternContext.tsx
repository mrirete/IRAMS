/**
 * RelanternContext — Global AI context provider
 * 
 * Any module page can call `openRelantern(contextData, contextType)` to:
 * 1. Set the AI context for the current module
 * 2. Open the Relantern AI panel
 */

import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface RelanternContextType {
    isOpen: boolean;
    contextData?: string;
    contextType?: string;
    initialPrompt?: string;
    openRelantern: (contextData: string, contextType?: string, initialPrompt?: string) => void;
    closeRelantern: () => void;
}

const RelanternCtx = createContext<RelanternContextType>({
    isOpen: false,
    openRelantern: () => { },
    closeRelantern: () => { },
});

export const useRelantern = () => useContext(RelanternCtx);

interface RelanternProviderProps {
    children: ReactNode;
}

export const RelanternProvider: React.FC<RelanternProviderProps> = ({ children }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [contextData, setContextData] = useState<string>();
    const [contextType, setContextType] = useState<string>();
    const [initialPrompt, setInitialPrompt] = useState<string>();

    const openRelantern = useCallback((data: string, type?: string, prompt?: string) => {
        setContextData(data);
        setContextType(type);
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
        <RelanternCtx.Provider value={{ isOpen, contextData, contextType, initialPrompt, openRelantern, closeRelantern }}>
            {children}
        </RelanternCtx.Provider>
    );
};
