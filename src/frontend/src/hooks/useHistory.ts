/**
 * useHistory — Generic undo / redo stack for any serialisable state.
 *
 * Usage:
 *   const { state, set, undo, redo, canUndo, canRedo, reset } = useHistory(initialState);
 *
 * ★ FIX: Uses a counter state to force re-renders when refs change,
 *   so canUndo/canRedo properly update the UI.
 */
import { useState, useCallback, useRef } from 'react';

interface UseHistoryReturn<T> {
    state: T;
    set: (newState: T | ((prev: T) => T)) => void;
    undo: () => void;
    redo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    reset: (newState: T) => void;
}

const MAX_STACK = 50;

export function useHistory<T>(initialState: T): UseHistoryReturn<T> {
    const [state, _setState] = useState<T>(initialState);
    const pastRef = useRef<T[]>([]);
    const futureRef = useRef<T[]>([]);
    // ★ FIX: Counter to force re-renders when stack changes
    const [, setTick] = useState(0);
    const tick = () => setTick(c => c + 1);

    const set = useCallback((newState: T | ((prev: T) => T)) => {
        _setState(prev => {
            const next = typeof newState === 'function' ? (newState as (p: T) => T)(prev) : newState;
            // Push current state to past
            pastRef.current = [...pastRef.current.slice(-MAX_STACK + 1), prev];
            // Clear future on new action
            futureRef.current = [];
            return next;
        });
        tick();
    }, []);

    const undo = useCallback(() => {
        _setState(current => {
            if (pastRef.current.length === 0) return current;
            const previous = pastRef.current[pastRef.current.length - 1];
            pastRef.current = pastRef.current.slice(0, -1);
            futureRef.current = [current, ...futureRef.current];
            return previous;
        });
        tick();
    }, []);

    const redo = useCallback(() => {
        _setState(current => {
            if (futureRef.current.length === 0) return current;
            const next = futureRef.current[0];
            futureRef.current = futureRef.current.slice(1);
            pastRef.current = [...pastRef.current, current];
            return next;
        });
        tick();
    }, []);

    const reset = useCallback((newState: T) => {
        _setState(newState);
        pastRef.current = [];
        futureRef.current = [];
        tick();
    }, []);

    return {
        state,
        set,
        undo,
        redo,
        canUndo: pastRef.current.length > 0,
        canRedo: futureRef.current.length > 0,
        reset,
    };
}

export default useHistory;
