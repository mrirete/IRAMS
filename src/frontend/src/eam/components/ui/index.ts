/**
 * Design-system primitives — single import surface.
 * Pass-1 foundation for the Hybrid UI (MaintainX mobile / Fiori desktop).
 * Tokens live in src/index.css `@theme`. Build pages from these, not inline styles.
 */
export { cn } from './cn';
export { Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';
export { Card, CardHeader, CardBody } from './Card';
export type { CardProps, CardHeaderProps, CardBodyProps } from './Card';
export { Badge, StatusPill, PriorityPill } from './Badge';
export type { BadgeProps } from './Badge';
export { statusTone, priorityTone } from './statusTones';
export type { Tone } from './statusTones';
export { Field, Input, Select, Textarea } from './Field';
export type { FieldProps, InputProps, SelectProps, TextareaProps } from './Field';
export { Modal, Drawer } from './Overlay';
export type { ModalProps, DrawerProps } from './Overlay';
export { Tabs } from './Tabs';
export type { TabDefinition, TabsProps } from './Tabs';
export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';
export { Skeleton, SkeletonRows } from './Skeleton';
export { LoadingState } from './LoadingState';
export type { LoadingStateProps } from './LoadingState';
export { DataList } from './DataList';
export type { DataListProps, DataColumn } from './DataList';
export { DensityToggle } from './DensityToggle';
export type { Density } from './DensityToggle';
export { UnifiedFilterBar } from './UnifiedFilterBar';
export type { UnifiedFilterBarProps, FilterPill, FilterBarAction } from './UnifiedFilterBar';
export { ScrollTabStrip } from './ScrollTabStrip';
export type { ScrollTabStripProps } from './ScrollTabStrip';
export { ConfirmDialog } from './ConfirmDialog';
export type { ConfirmDialogProps, ConfirmVariant } from './ConfirmDialog';
export { PromptDialog } from './PromptDialog';
export type { PromptDialogProps } from './PromptDialog';
export { ModernSelect } from './ModernSelect';
export type { ModernSelectProps, SelectOption } from './ModernSelect';


export { DetailRail, RailRow, RAIL_INPUT, RAIL_INPUT_LOCKED } from './DetailRail';
export type { DetailRailProps, RailRowProps } from './DetailRail';
