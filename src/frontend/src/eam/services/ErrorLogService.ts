/**
 * ErrorLogService.ts — Global Error Capture & Persistence
 *
 * Provides a singleton service that captures, classifies, and persists
 * application errors to the `error_logs` table. Designed to be called
 * from any module — services, components, import handlers, API callers.
 *
 * Key Design Decisions:
 * - Fire-and-forget: Logging never throws — a logging failure must not
 *   cascade into the user's workflow.
 * - Sanitization: Strips passwords, tokens, and secrets from input_snapshot.
 * - Batching: Groups rapid-fire errors (e.g. row-by-row import validation)
 *   into a single debounced write to avoid Supabase rate-limiting.
 * - In-memory buffer: Keeps the last 200 errors in RAM for instant UI access
 *   without requiring a DB round-trip.
 */

import { supabase } from '../lib/supabase';

// ── Types ────────────────────────────────────────────────────

export type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

export type ErrorCategory =
    | 'validation'
    | 'import'
    | 'api'
    | 'authentication'
    | 'permission'
    | 'business_rule'
    | 'integration'
    | 'ai'
    | 'system';

export interface ErrorLogEntry {
    id?: string;
    severity: ErrorSeverity;
    category: ErrorCategory;
    module?: string;
    action?: string;
    message: string;
    technicalDetail?: string;
    userId?: string;
    entityType?: string;
    entityId?: string;
    inputSnapshot?: Record<string, any>;
    isResolved?: boolean;
    resolvedBy?: string;
    resolvedAt?: string;
    resolutionNote?: string;
    browserInfo?: string;
    url?: string;
    createdAt?: string;
}

/** Convenience params for the most common capture call */
export interface CaptureParams {
    severity?: ErrorSeverity;
    category?: ErrorCategory;
    module?: string;
    action?: string;
    message: string;
    error?: unknown;           // Raw Error/exception object
    userId?: string;
    entityType?: string;
    entityId?: string;
    inputSnapshot?: Record<string, any>;
}

// ── Sanitization ─────────────────────────────────────────────

const SENSITIVE_KEYS = new Set([
    'password', 'token', 'secret', 'apikey', 'api_key',
    'authorization', 'cookie', 'session', 'credit_card',
    'ssn', 'access_token', 'refresh_token', 'private_key',
]);

function sanitize(obj: Record<string, any> | undefined): Record<string, any> {
    if (!obj) return {};
    const clean: Record<string, any> = {};
    for (const [key, val] of Object.entries(obj)) {
        if (SENSITIVE_KEYS.has(key.toLowerCase())) {
            clean[key] = '***REDACTED***';
        } else if (val && typeof val === 'object' && !Array.isArray(val)) {
            clean[key] = sanitize(val);
        } else {
            clean[key] = val;
        }
    }
    return clean;
}

function extractTechnicalDetail(error: unknown): string {
    if (!error) return '';
    if (error instanceof Error) {
        return `${error.name}: ${error.message}\n${error.stack || ''}`.trim();
    }
    if (typeof error === 'string') return error;
    try {
        return JSON.stringify(error, null, 2);
    } catch {
        return String(error);
    }
}

// ── Service ──────────────────────────────────────────────────

export class ErrorLogService {
    private static instance: ErrorLogService;
    private buffer: ErrorLogEntry[] = [];
    private pendingWrites: ErrorLogEntry[] = [];
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    private static MAX_BUFFER = 200;
    private static FLUSH_DELAY_MS = 1500;

    private constructor() {
        // Global unhandled error capture
        if (typeof window !== 'undefined') {
            window.addEventListener('error', (event) => {
                this.capture({
                    severity: 'error',
                    category: 'system',
                    message: event.message || 'Unhandled error',
                    error: event.error,
                    module: 'global',
                    action: 'unhandled_error',
                });
            });

            window.addEventListener('unhandledrejection', (event) => {
                this.capture({
                    severity: 'error',
                    category: 'system',
                    message: event.reason?.message || 'Unhandled promise rejection',
                    error: event.reason,
                    module: 'global',
                    action: 'unhandled_rejection',
                });
            });
        }
    }

    public static getInstance(): ErrorLogService {
        if (!ErrorLogService.instance) {
            ErrorLogService.instance = new ErrorLogService();
        }
        return ErrorLogService.instance;
    }

    // ── Primary API ──────────────────────────────────────────

    /**
     * Capture an error. This is the main entry point.
     * Never throws — safe to call in any catch block.
     */
    public capture(params: CaptureParams): void {
        try {
            const entry: ErrorLogEntry = {
                severity: params.severity || 'error',
                category: params.category || 'system',
                module: params.module,
                action: params.action,
                message: params.message,
                technicalDetail: extractTechnicalDetail(params.error),
                userId: params.userId || this.getCurrentUser(),
                entityType: params.entityType,
                entityId: params.entityId,
                inputSnapshot: sanitize(params.inputSnapshot),
                browserInfo: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
                url: typeof window !== 'undefined' ? window.location.href : undefined,
                createdAt: new Date().toISOString(),
                isResolved: false,
            };

            // Add to in-memory buffer
            this.buffer.unshift(entry);
            if (this.buffer.length > ErrorLogService.MAX_BUFFER) {
                this.buffer.pop();
            }

            // Queue for persistence
            this.pendingWrites.push(entry);
            this.scheduleFlush();
        } catch (e) {
            // Never let logging crash the app
            console.error('[ErrorLogService] Failed to capture error:', e);
        }
    }

    // ── Convenience Methods ──────────────────────────────────

    /** Log a validation failure (e.g. required field missing) */
    public validation(module: string, message: string, inputSnapshot?: Record<string, any>) {
        this.capture({ severity: 'warning', category: 'validation', module, message, inputSnapshot });
    }

    /** Log a data import error (e.g. malformed spreadsheet row) */
    public importError(module: string, message: string, error?: unknown, inputSnapshot?: Record<string, any>) {
        this.capture({ severity: 'error', category: 'import', module, action: 'bulk_import', message, error, inputSnapshot });
    }

    /** Log an API/Supabase error */
    public apiError(module: string, action: string, error: unknown, entityType?: string, entityId?: string) {
        const msg = error instanceof Error ? error.message : String(error);
        this.capture({ severity: 'error', category: 'api', module, action, message: `API error: ${msg}`, error, entityType, entityId });
    }

    /** Log a business rule violation */
    public businessRule(module: string, message: string, entityType?: string, entityId?: string) {
        this.capture({ severity: 'warning', category: 'business_rule', module, message, entityType, entityId });
    }

    /** Log an AI service error */
    public aiError(module: string, message: string, error?: unknown) {
        this.capture({ severity: 'error', category: 'ai', module, action: 'ai_request', message, error });
    }

    /** Log a critical system failure */
    public critical(module: string, message: string, error?: unknown) {
        this.capture({ severity: 'critical', category: 'system', module, message, error });
    }

    // ── Data Access ──────────────────────────────────────────

    /** Get in-memory buffer (fast, no DB call) */
    public getRecentErrors(): ErrorLogEntry[] {
        return [...this.buffer];
    }

    /** Get error count by severity from buffer */
    public getErrorCounts(): Record<ErrorSeverity, number> {
        const counts: Record<ErrorSeverity, number> = { info: 0, warning: 0, error: 0, critical: 0 };
        for (const e of this.buffer) {
            counts[e.severity]++;
        }
        return counts;
    }

    /** Fetch errors from Supabase with filters */
    public async fetchErrors(filters?: {
        severity?: ErrorSeverity;
        category?: ErrorCategory;
        module?: string;
        isResolved?: boolean;
        search?: string;
        limit?: number;
        offset?: number;
        from?: string;
        to?: string;
    }): Promise<{ data: ErrorLogEntry[]; total: number }> {
        try {
            let query = supabase
                .from('error_logs')
                .select('*', { count: 'exact' })
                .order('created_at', { ascending: false });

            if (filters?.severity) query = query.eq('severity', filters.severity);
            if (filters?.category) query = query.eq('category', filters.category);
            if (filters?.module) query = query.eq('module', filters.module);
            if (filters?.isResolved !== undefined) query = query.eq('is_resolved', filters.isResolved);
            if (filters?.from) query = query.gte('created_at', filters.from);
            if (filters?.to) query = query.lte('created_at', filters.to);
            if (filters?.search) query = query.or(`message.ilike.%${filters.search}%,technical_detail.ilike.%${filters.search}%`);

            const limit = filters?.limit || 50;
            const offset = filters?.offset || 0;
            query = query.range(offset, offset + limit - 1);

            const { data, count, error } = await query;
            if (error) throw error;

            const mapped: ErrorLogEntry[] = (data || []).map((row: any) => ({
                id: row.id,
                severity: row.severity,
                category: row.category,
                module: row.module,
                action: row.action,
                message: row.message,
                technicalDetail: row.technical_detail,
                userId: row.user_id,
                entityType: row.entity_type,
                entityId: row.entity_id,
                inputSnapshot: row.input_snapshot,
                isResolved: row.is_resolved,
                resolvedBy: row.resolved_by,
                resolvedAt: row.resolved_at,
                resolutionNote: row.resolution_note,
                browserInfo: row.browser_info,
                url: row.url,
                createdAt: row.created_at,
            }));

            return { data: mapped, total: count || 0 };
        } catch (e) {
            console.error('[ErrorLogService] fetchErrors failed:', e);
            return { data: [], total: 0 };
        }
    }

    /** Mark an error as resolved */
    public async resolveError(id: string, resolvedBy: string, note?: string): Promise<void> {
        try {
            await supabase
                .from('error_logs')
                .update({
                    is_resolved: true,
                    resolved_by: resolvedBy,
                    resolved_at: new Date().toISOString(),
                    resolution_note: note || null,
                })
                .eq('id', id);

            // Update in-memory buffer too
            const entry = this.buffer.find(e => e.id === id);
            if (entry) {
                entry.isResolved = true;
                entry.resolvedBy = resolvedBy;
                entry.resolutionNote = note;
            }
        } catch (e) {
            console.error('[ErrorLogService] resolveError failed:', e);
        }
    }

    /** Get aggregate stats for the dashboard */
    public async getStats(days: number = 7): Promise<{
        totalErrors: number;
        unresolvedCount: number;
        bySeverity: Record<ErrorSeverity, number>;
        byCategory: Record<string, number>;
        byModule: Record<string, number>;
        trend: { date: string; count: number }[];
    }> {
        try {
            const since = new Date();
            since.setDate(since.getDate() - days);
            const sinceStr = since.toISOString();

            const { data, error } = await supabase
                .from('error_logs')
                .select('severity, category, module, is_resolved, created_at')
                .gte('created_at', sinceStr)
                .order('created_at', { ascending: true });

            if (error) throw error;
            const rows = data || [];

            const bySeverity: Record<ErrorSeverity, number> = { info: 0, warning: 0, error: 0, critical: 0 };
            const byCategory: Record<string, number> = {};
            const byModule: Record<string, number> = {};
            const trendMap: Record<string, number> = {};
            let unresolvedCount = 0;

            for (const r of rows) {
                bySeverity[r.severity as ErrorSeverity] = (bySeverity[r.severity as ErrorSeverity] || 0) + 1;
                byCategory[r.category] = (byCategory[r.category] || 0) + 1;
                if (r.module) byModule[r.module] = (byModule[r.module] || 0) + 1;
                if (!r.is_resolved) unresolvedCount++;

                const date = new Date(r.created_at).toISOString().split('T')[0];
                trendMap[date] = (trendMap[date] || 0) + 1;
            }

            const trend = Object.entries(trendMap).map(([date, count]) => ({ date, count }));

            return {
                totalErrors: rows.length,
                unresolvedCount,
                bySeverity,
                byCategory,
                byModule,
                trend,
            };
        } catch (e) {
            console.error('[ErrorLogService] getStats failed:', e);
            return {
                totalErrors: 0, unresolvedCount: 0,
                bySeverity: { info: 0, warning: 0, error: 0, critical: 0 },
                byCategory: {}, byModule: {}, trend: [],
            };
        }
    }

    // ── Internals ────────────────────────────────────────────

    private getCurrentUser(): string | undefined {
        try {
            const stored = localStorage.getItem('ers_current_user');
            if (stored) {
                const parsed = JSON.parse(stored);
                return parsed?.username || parsed?.id;
            }
        } catch { /* ignore */ }
        return undefined;
    }

    private scheduleFlush(): void {
        if (this.flushTimer) return; // Already scheduled
        this.flushTimer = setTimeout(() => {
            this.flush();
            this.flushTimer = null;
        }, ErrorLogService.FLUSH_DELAY_MS);
    }

    private async flush(): Promise<void> {
        if (this.pendingWrites.length === 0) return;

        const batch = [...this.pendingWrites];
        this.pendingWrites = [];

        try {
            const rows = batch.map(e => ({
                severity: e.severity,
                category: e.category,
                module: e.module || null,
                action: e.action || null,
                message: e.message,
                technical_detail: e.technicalDetail || null,
                user_id: e.userId || null,
                entity_type: e.entityType || null,
                entity_id: e.entityId || null,
                input_snapshot: e.inputSnapshot || {},
                is_resolved: false,
                browser_info: e.browserInfo || null,
                url: e.url || null,
                created_at: e.createdAt || new Date().toISOString(),
            }));

            const { data, error } = await supabase
                .from('error_logs')
                .insert(rows)
                .select('id');

            if (error) {
                console.error('[ErrorLogService] Flush failed:', error);
                // Put back for retry (once)
                // Don't retry infinitely to avoid memory leak
                return;
            }

            // Backfill IDs into buffer
            if (data) {
                for (let i = 0; i < data.length && i < batch.length; i++) {
                    batch[i].id = data[i].id;
                }
            }
        } catch (e) {
            console.error('[ErrorLogService] Flush exception:', e);
        }
    }
}

// ── Singleton Export ─────────────────────────────────────────

export const errorLog = ErrorLogService.getInstance();
