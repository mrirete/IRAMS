import { useRef, useState, useCallback, useEffect } from 'react';

interface PullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
  cooldown?: number;
}

export function usePullToRefresh({
  onRefresh,
  threshold = 80,
  cooldown = 2000,
}: PullToRefreshOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const touchStartY = useRef(0);
  const isTouching = useRef(false);
  const lastRefreshTime = useRef(0);

  const pullProgress = Math.min(pullDistance / threshold, 1);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const el = containerRef.current;
    if (!el || el.scrollTop > 0 || isRefreshing) return;

    touchStartY.current = e.touches[0].clientY;
    isTouching.current = true;
  }, [isRefreshing]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isTouching.current || isRefreshing) return;
    const el = containerRef.current;
    if (!el || el.scrollTop > 0) {
      isTouching.current = false;
      setPullDistance(0);
      return;
    }

    const deltaY = e.touches[0].clientY - touchStartY.current;
    if (deltaY > 0) {
      // Resistance factor: the further you pull, the harder it gets
      const dampened = deltaY * 0.5;
      setPullDistance(dampened);
      if (dampened > 10) {
        e.preventDefault(); // Prevent native scroll while pulling
      }
    }
  }, [isRefreshing]);

  const handleTouchEnd = useCallback(async () => {
    if (!isTouching.current) return;
    isTouching.current = false;

    if (pullDistance >= threshold && !isRefreshing) {
      // Cooldown check (G7)
      const now = Date.now();
      if (now - lastRefreshTime.current < cooldown) {
        setPullDistance(0);
        return;
      }

      // Haptic feedback (G8)
      if (navigator.vibrate) {
        navigator.vibrate(10);
      }

      setIsRefreshing(true);
      lastRefreshTime.current = now;
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, threshold, isRefreshing, cooldown, onRefresh]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd);

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  return { containerRef, isRefreshing, pullDistance, pullProgress };
}
