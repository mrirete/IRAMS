/**
 * Tabs — design-system alias for the existing UnifiedTabBar.
 * Re-exported so new code imports `Tabs` from the primitive set while the proven
 * overflow/auto-scroll implementation stays the single source.
 */
export { UnifiedTabBar as Tabs } from './UnifiedTabBar';
export type { TabDefinition, UnifiedTabBarProps as TabsProps } from './UnifiedTabBar';
