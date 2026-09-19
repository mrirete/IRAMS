/**
 * useIdleTimeout — the consumer that makes Global Settings › Session Timeout
 * real. These tests run the clock with fake timers so the behaviour is proven
 * without a browser and without touching a live tenant's settings.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useIdleTimeout, type IdleTimeoutState } from './useIdleTimeout';

// Minimal renderHook on React 19's own `act` — the repo has no
// @testing-library/react and this does not need one.
let root: Root | null = null;
function renderHook<T>(fn: () => T): { result: { current: T } } {
    const result = { current: undefined as unknown as T };
    const Probe: React.FC = () => { result.current = fn(); return null; };
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => { root!.render(React.createElement(Probe)); });
    return { result };
}

const MIN = 60_000;

describe('useIdleTimeout', () => {
    beforeEach(() => { vi.useFakeTimers(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
    afterEach(() => { act(() => { root?.unmount(); }); root = null; vi.useRealTimers(); });

    it('signs out once the configured minutes pass with no input', () => {
        const onTimeout = vi.fn();
        renderHook(() => useIdleTimeout(2, onTimeout));
        act(() => { vi.advanceTimersByTime(2 * MIN - 1000); });
        expect(onTimeout).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(2000); });
        expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it('warns during the final minute with a live countdown', () => {
        const { result } = renderHook(() => useIdleTimeout(3, vi.fn()));
        act(() => { vi.advanceTimersByTime(2 * MIN + 5_000); });
        expect(result.current.warning).toBe(true);
        expect(result.current.secondsLeft).toBeLessThanOrEqual(55);
        expect(result.current.secondsLeft).toBeGreaterThan(50);
    });

    it('activity before the warning restarts the clock', () => {
        // 3-minute timeout: the warning window is the final minute (2:00–3:00),
        // so 1:30 is still ordinary idle time and a mousemove there must reset.
        const onTimeout = vi.fn();
        renderHook(() => useIdleTimeout(3, onTimeout));
        act(() => { vi.advanceTimersByTime(90_000); });                 // 1:30 idle
        act(() => { window.dispatchEvent(new Event('mousemove')); });   // reset → new deadline 4:30
        act(() => { vi.advanceTimersByTime(2 * MIN); });                // 3:30 — original deadline passed
        expect(onTimeout).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(MIN + 1000); });             // 4:31
        expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it('a stray mousemove does NOT dismiss the warning — only Stay signed in does', () => {
        const onTimeout = vi.fn();
        const { result } = renderHook(() => useIdleTimeout(2, onTimeout));
        act(() => { vi.advanceTimersByTime(MIN + 10_000); });           // inside the final minute
        expect(result.current.warning).toBe(true);
        act(() => { window.dispatchEvent(new Event('mousemove')); });
        act(() => { vi.advanceTimersByTime(1000); });
        expect(result.current.warning).toBe(true);                      // still armed
        act(() => { result.current.staySignedIn(); });
        expect(result.current.warning).toBe(false);
        act(() => { vi.advanceTimersByTime(MIN + 10_000); });
        expect(onTimeout).not.toHaveBeenCalled();                       // full window restored
    });

    it('0 minutes means never', () => {
        const onTimeout = vi.fn();
        const { result } = renderHook(() => useIdleTimeout(0, onTimeout));
        act(() => { vi.advanceTimersByTime(24 * 60 * MIN); });
        expect(onTimeout).not.toHaveBeenCalled();
        expect(result.current.warning).toBe(false);
    });

    it('a machine that slept through the deadline signs out on wake', () => {
        const onTimeout = vi.fn();
        renderHook(() => useIdleTimeout(1, onTimeout));
        // Jump the wall clock far past the deadline in one step, as a resumed
        // laptop does; a tick-counting timer would still think time was left.
        act(() => { vi.setSystemTime(Date.now() + 10 * MIN); vi.advanceTimersByTime(1000); });
        expect(onTimeout).toHaveBeenCalledTimes(1);
    });
});
