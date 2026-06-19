import { DatabaseService } from './DatabaseService';
import { ModuleName } from '../types';
import { supabase } from '../lib/supabase';

export class NotificationService {

    /**
     * Evaluate rules and trigger notifications.
     * Called from workflow code when events occur (status changes, assignments, etc.)
     * @param module The module context (e.g. 'requests', 'workOrders')
     * @param event The event name (e.g. 'STATUS_CHANGE', 'ASSIGNED')
     * @param entity The entity data (e.g. WorkOrder object)
     * @param context Additional context (currentUserId, previousEntity, etc.)
     */
    static async checkRules(
        module: ModuleName,
        event: string,
        entity: any,
        context?: { currentUserId?: string; previousEntity?: any }
    ) {
        console.groupCollapsed(`[NotificationService] Checking Rules for ${module}:${event}`);

        try {
            const db = DatabaseService.getInstance();
            const rules = await db.getNotificationRules();

            // 1. Filter by Module & Event & Active
            const candidates = rules.filter((r: any) =>
                r.isActive &&
                r.module === module &&
                r.eventTrigger === event
            );

            console.log(`Found ${candidates.length} candidate rules.`);

            for (const rule of candidates) {
                // 2. Evaluate Filters against entity
                const isMatch = this.evaluateFilters(rule.filters, entity);

                if (isMatch) {
                    await this.dispatch(rule, entity, context);
                }
            }

        } catch (e) {
            console.error("Error in NotificationService:", e);
        } finally {
            console.groupEnd();
        }
    }

    /**
     * Quick helper: create a single in-app notification without going through rules.
     * Use for direct notifications (e.g., "You were assigned WO-001234").
     */
    static async notify(params: {
        recipientId: string;
        title: string;
        message: string;
        severity: 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';
        notificationType: string;
        module: string;
        entityId?: string;
        entityType?: string;
        entityNumber?: string;
        actionLink?: string;
        actionRequired?: boolean;
        createdBy?: string;
    }) {
        try {
            const db = DatabaseService.getInstance();
            await db.createNotification(params);
        } catch (e) {
            console.error('[NotificationService] Error sending direct notification:', e);
        }
    }

    private static evaluateFilters(filters: any[], entity: any): boolean {
        if (!filters || filters.length === 0) return true;

        return filters.every(filter => {
            const { field, operator, value } = filter;
            const entityValue = this.resolveField(entity, field);

            const valStr = String(value).toLowerCase();
            const entStr = String(entityValue).toLowerCase();

            switch (operator) {
                case 'EQUALS': return entStr === valStr;
                case 'NOT_EQUALS': return entStr !== valStr;
                case 'CONTAINS': return entStr.includes(valStr);
                case 'GREATER_THAN': return Number(entityValue) > Number(value);
                case 'LESS_THAN': return Number(entityValue) < Number(value);
                default: return false;
            }
        });
    }

    private static resolveField(obj: any, path: string): any {
        return path.split('.').reduce((o, key) => (o && o[key] !== undefined) ? o[key] : undefined, obj);
    }

    /**
     * Dispatch notification to all resolved recipients.
     * Creates real DB records in the `notifications` table.
     * Respects the global channel kill-switch from Delivery Channels.
     */
    private static async dispatch(
        rule: any,
        entity: any,
        context?: { currentUserId?: string; previousEntity?: any }
    ) {
        const db = DatabaseService.getInstance();

        // ── Channel Kill-Switch ──────────────────────────────
        // Check which channels are globally enabled in Delivery Channels.
        // If a rule targets EMAIL but EMAIL is disabled globally, skip that channel.
        let enabledChannels: string[] = [];
        try {
            const channelConfigs = await db.getNotificationChannels();
            enabledChannels = channelConfigs
                .filter((c: any) => c.isActive || c.is_active)
                .map((c: any) => c.type);
        } catch {
            // If we can't load channel config, default to IN_APP only
            enabledChannels = ['IN_APP'];
        }

        // Filter the rule's channels to only globally active ones
        const ruleChannels: string[] = rule.channels || ['IN_APP'];
        const activeChannels = ruleChannels.filter(ch => enabledChannels.includes(ch));

        // IN_APP always gets through as a fallback
        if (!activeChannels.includes('IN_APP') && enabledChannels.includes('IN_APP')) {
            activeChannels.push('IN_APP');
        }

        if (activeChannels.length === 0) {
            console.warn(`[NOTIFICATION] All channels disabled for rule "${rule.name}" — skipping dispatch.`);
            return;
        }

        console.log(`%c[NOTIFICATION] Dispatching: ${rule.name} via [${activeChannels.join(', ')}]`, 'color: #10b981; font-weight: bold;');

        const recipients = await this.resolveRecipients(rule.recipients, entity, context, rule.escalationScope);

        // Build notification content
        const entityNumber = entity.woNumber || entity.requestNumber || entity.poNumber || entity.assetCode || '';
        const entityType = this.inferEntityType(rule.module);

        for (const recipientId of recipients) {
            if (!recipientId) continue;

            try {
                // Check if this is a vendor recipient (external)
                if (recipientId.startsWith('VENDOR::')) {
                    const vendorId = recipientId.replace('VENDOR::', '');
                    console.log(`%c[NOTIFICATION] External vendor dispatch: ${vendorId}`, 'color: #f59e0b; font-weight: bold;');

                    // Log for external delivery (email/webhook) — future integration point
                    await db.logNotificationAudit(
                        `VENDOR:${vendorId}`,
                        'EMAIL',
                        rule.name,
                        `[VENDOR] ${rule.description || rule.name} | Entity: ${entityNumber}`
                    );

                    // Also create an in-app record for admin visibility
                    if (activeChannels.includes('IN_APP')) {
                        await db.createNotification({
                            recipientId: 'SYSTEM', // Visible to admins
                            title: `📤 Vendor Notified: ${rule.name}`,
                            message: `External vendor notification dispatched. ${rule.description || rule.name} — Entity: ${entityNumber}`,
                            severity: rule.severity,
                            notificationType: this.mapEventToType(rule.eventTrigger),
                            module: rule.module,
                            entityId: entity.id,
                            entityType,
                            entityNumber,
                            actionLink: this.buildActionLink(rule.module, entity.id),
                            actionRequired: false,
                            vendorRecipientId: vendorId,
                            createdBy: context?.currentUserId || 'SYSTEM',
                        });
                    }
                    continue;
                }

                // Standard internal user — create IN_APP notification
                if (activeChannels.includes('IN_APP')) {
                    await db.createNotification({
                        recipientId,
                        title: rule.name,
                        message: rule.description || `${rule.name} triggered for ${entityNumber}`,
                        severity: rule.severity,
                        notificationType: this.mapEventToType(rule.eventTrigger),
                        module: rule.module,
                        entityId: entity.id,
                        entityType,
                        entityNumber,
                        actionLink: this.buildActionLink(rule.module, entity.id),
                        actionRequired: ['APPROVAL_NEEDED', 'ASSIGNED', 'TECO_BLOCKED'].includes(rule.eventTrigger),
                        escalationTimeoutMinutes: rule.escalationTimeoutMinutes || 0,
                        escalationRecipientRole: rule.escalationRecipientRole || '',
                        createdBy: context?.currentUserId || 'SYSTEM',
                    });
                }
            } catch (e) {
                console.error(`[NotificationService] Failed to notify ${recipientId}:`, e);
            }
        }

        // Also log to notification_logs for audit trail
        try {
            const primaryChannel = activeChannels[0] || 'IN_APP';
            await db.logNotificationAudit(
                recipients.join(', '),
                primaryChannel,
                rule.name,
                `${rule.description || rule.name} | Entity: ${entityNumber}`
            );
        } catch (e) {
            // Non-critical, just for audit
        }
    }

    /**
     * Resolve recipient list from rule configuration.
     * Handles ROLE, USER, DYNAMIC, and VENDOR recipient types.
     * VENDOR recipients return a special 'VENDOR::{vendorId}' identifier.
     * For ROLE type, uses escalationScope to determine resolution strategy.
     */
    private static async resolveRecipients(
        recipients: any[],
        entity: any,
        context?: { currentUserId?: string },
        escalationScope?: 'ORG_UNIT' | 'SITE' | 'GLOBAL'
    ): Promise<string[]> {
        const resolved: string[] = [];
        const scope = escalationScope || 'ORG_UNIT';

        for (const r of recipients || []) {
            switch (r.type) {
                case 'USER':
                    resolved.push(r.targetId);
                    break;
                case 'DYNAMIC': {
                    // Resolve dynamic targets from entity fields (case-insensitive)
                    const targetKey = (r.targetId || '').toLowerCase();
                    if (targetKey === 'assignee' && entity.assignedTo) {
                        resolved.push(entity.assignedTo);
                    } else if (targetKey === 'requester' && entity.requestedBy) {
                        resolved.push(entity.requestedBy);
                    } else if (targetKey === 'permitholder' && entity.requestedBy) {
                        resolved.push(entity.requestedBy);
                    } else if (targetKey === 'createdby' && entity.createdBy) {
                        resolved.push(entity.createdBy);
                    }
                    break;
                }
                case 'ROLE':
                    // Resolve ROLE using scoped strategy
                    try {
                        const roleUsers = await this.resolveRoleRecipientsScoped(
                            r.targetId,
                            scope,
                            context?.currentUserId,
                            entity.siteId || entity.site_id
                        );
                        if (roleUsers.length > 0) {
                            roleUsers.forEach(uid => resolved.push(uid));
                        } else if (context?.currentUserId) {
                            resolved.push(context.currentUserId);
                        }
                    } catch {
                        if (context?.currentUserId) {
                            resolved.push(context.currentUserId);
                        }
                    }
                    break;
                case 'VENDOR':
                    // External vendor — use special prefix so dispatch can handle separately
                    if (r.targetId) {
                        resolved.push(`VENDOR::${r.targetId}`);
                    }
                    break;
            }
        }

        // Deduplicate
        return [...new Set(resolved)];
    }

    private static mapEventToType(event: string): string {
        const map: Record<string, string> = {
            // Work Orders
            'WO_CREATED': 'STATUS_CHANGE',
            'WO_ASSIGNED': 'ASSIGNMENT',
            'WO_STATUS_CHANGE': 'STATUS_CHANGE',
            'WO_COMPLETED': 'STATUS_CHANGE',
            'WO_CLOSED': 'STATUS_CHANGE',
            'WO_OVERDUE': 'SCHEDULE_ALERT',
            'WO_CANCELLED': 'STATUS_CHANGE',
            'WO_PRIORITY_ESCALATED': 'STATUS_CHANGE',
            // Service Requests
            'SR_CREATED': 'STATUS_CHANGE',
            'SR_APPROVED': 'STATUS_CHANGE',
            'SR_REJECTED': 'STATUS_CHANGE',
            'SR_STATUS_CHANGE': 'STATUS_CHANGE',
            'SR_CONVERTED_TO_WO': 'STATUS_CHANGE',
            // Inventory
            'STOCK_LOW': 'INVENTORY_ALERT',
            'STOCK_OUT': 'INVENTORY_ALERT',
            'STOCK_RECEIVED': 'INVENTORY_ALERT',
            'STOCK_ISSUED': 'INVENTORY_ALERT',
            'STOCK_ADJUSTED': 'INVENTORY_ALERT',
            // PM
            'PM_DUE': 'SCHEDULE_ALERT',
            'PM_OVERDUE': 'SCHEDULE_ALERT',
            'PM_WO_GENERATED': 'SCHEDULE_ALERT',
            'PM_COMPLETED': 'STATUS_CHANGE',
            // Readings
            'READING_ALARM': 'SAFETY_ALERT',
            'READING_WARNING': 'SAFETY_ALERT',
            'READING_MISSED': 'SCHEDULE_ALERT',
            'READING_TREND_ANOMALY': 'AI_RECOMMENDATION',
            // Purchasing
            'PO_CREATED': 'STATUS_CHANGE',
            'PO_APPROVED': 'APPROVAL_REQUIRED',
            'PO_RECEIVED': 'STATUS_CHANGE',
            'PO_OVERDUE': 'SCHEDULE_ALERT',
            'PO_BUDGET_EXCEEDED': 'COST_THRESHOLD',
            // Safety
            'PTW_ISSUED': 'SAFETY_ALERT',
            'PTW_EXPIRED': 'SAFETY_ALERT',
            'PTW_VIOLATION': 'SAFETY_ALERT',
            'PTW_RENEWED': 'STATUS_CHANGE',
            // Legacy fallbacks
            'ASSIGNED': 'ASSIGNMENT',
            'SLA_BREACH': 'SLA_BREACH',
            'APPROVAL_NEEDED': 'APPROVAL_REQUIRED',
            'AI_INSIGHT': 'AI_RECOMMENDATION',
            'BAD_ACTOR': 'AI_RECOMMENDATION',
            // Defect Elimination
            'DE_TASK_CREATED': 'STATUS_CHANGE',
            'DE_TASK_ADVANCED': 'STATUS_CHANGE',
            'DE_TASK_RESOLVED': 'STATUS_CHANGE',
            'DE_WO_GENERATED': 'STATUS_CHANGE',
        };
        return map[event] || 'SYSTEM';
    }

    private static inferEntityType(module: string): string {
        const map: Record<string, string> = {
            'requests': 'WORK_REQUEST',
            'workOrders': 'WORK_ORDER',
            'pm': 'PREVENTIVE_MAINTENANCE',
            'purchasing': 'PURCHASE_ORDER',
            'inventory': 'INVENTORY_ITEM',
            'safety': 'PERMIT_TO_WORK',
            'assets': 'ASSET',
            'analytics': 'REPORT',
            'readings': 'READING',
            'contacts': 'QUALIFICATION',
            'analyze': 'DE_TASK',
        };
        return map[module] || 'UNKNOWN';
    }

    private static buildActionLink(module: string, entityId: string): string {
        const map: Record<string, string> = {
            'requests': '/requests',
            'workOrders': '/work-orders',
            'pm': '/pm',
            'purchasing': '/purchasing',
            'inventory': '/inventory',
            'safety': '/work-orders',
            'assets': '/assets',
            'analytics': '/analytics',
            'analyze': '/analyze?division=defect_elimination',
        };
        return map[module] || '/notifications';
    }

    /**
     * Trigger PM-Due & Overdue notifications with 4-tier escalation.
     * ISO 55000: Proactive lifecycle management requires alerts with escalation tiers.
     *
     * Tier 1 — Approaching:  Due within leadTimeDays  → WARNING
     * Tier 2 — Due Today:    Due date = today         → CRITICAL
     * Tier 3 — Overdue:      Due date < today         → CRITICAL (escalation)
     * Tier 4 — Crit-A Overdue: Overdue + Criticality A → CRITICAL + EMERGENCY flag
     *
     * @param jobs Array of RecurringJob with nextDueDate populated
     * @param assets Array of assets for criticality lookup
     * @param currentUserId The current logged-in user
     */
    static async triggerPMDueNotifications(
        jobs: any[],
        assets: any[] = [],
        currentUserId: string = 'SYSTEM'
    ): Promise<number> {
        const DEDUP_KEY = 'pm_notification_session';
        const sessionCache = JSON.parse(localStorage.getItem(DEDUP_KEY) || '{}');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let notificationCount = 0;

        for (const job of jobs) {
            if (job.status !== 'ACTIVE' || !job.nextDueDate) continue;

            const dueDate = new Date(job.nextDueDate);
            dueDate.setHours(0, 0, 0, 0);
            const daysUntilDue = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

            // Skip already-notified PMs this session (by jobId + tier)
            const tierKey = `${job.id}_${daysUntilDue <= 0 ? 'overdue' : daysUntilDue === 0 ? 'today' : 'approaching'}`;
            if (sessionCache[tierKey]) continue;

            // Determine criticality from assigned assets
            const primaryAssetId = job.assignedAssets?.[0]?.assetId;
            const primaryAsset = assets.find((a: any) => a.id === primaryAssetId);
            const criticality = primaryAsset?.criticality || 'C';

            let tier: number = 0;
            let severity: 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL' = 'INFO';
            let title = '';
            let message = '';

            if (daysUntilDue < 0) {
                // OVERDUE
                if (criticality === 'A') {
                    // Tier 4 — Crit-A Overdue → EMERGENCY
                    tier = 4;
                    severity = 'CRITICAL';
                    title = `🚨 EMERGENCY: Criticality A PM Overdue — ${job.code}`;
                    message = `PM "${job.description}" is ${Math.abs(daysUntilDue)} day(s) overdue on a SAFETY-CRITICAL asset. Immediate action required per governance protocol. Auto-escalated to Emergency status.`;
                } else {
                    // Tier 3 — Standard Overdue
                    tier = 3;
                    severity = 'CRITICAL';
                    title = `⚠ PM Overdue — ${job.code}`;
                    message = `PM "${job.description}" is ${Math.abs(daysUntilDue)} day(s) overdue. Schedule immediate execution to maintain compliance.`;
                }
            } else if (daysUntilDue === 0) {
                // Tier 2 — Due Today
                tier = 2;
                severity = 'CRITICAL';
                title = `📅 PM Due Today — ${job.code}`;
                message = `PM "${job.description}" is due today. ${criticality === 'A' ? 'Safety-critical asset — prioritize immediately.' : 'Ensure work order is generated and assigned.'}`;
            } else if (daysUntilDue <= (job.leadTimeDays || 7)) {
                // Tier 1 — Approaching
                tier = 1;
                severity = 'WARNING';
                title = `🔔 PM Approaching — ${job.code}`;
                message = `PM "${job.description}" is due in ${daysUntilDue} day(s). Begin planning and resource allocation.`;
            }

            if (tier > 0) {
                await this.notify({
                    recipientId: currentUserId,
                    title,
                    message,
                    severity,
                    notificationType: tier === 4 ? 'EMERGENCY' : 'SCHEDULE_ALERT',
                    module: 'pm',
                    entityId: job.id,
                    entityType: 'PREVENTIVE_MAINTENANCE',
                    entityNumber: job.code,
                    actionLink: '/pm',
                    actionRequired: tier >= 2,
                    createdBy: 'SYSTEM',
                });

                sessionCache[tierKey] = Date.now();
                notificationCount++;
            }
        }

        // Persist dedup cache
        localStorage.setItem(DEDUP_KEY, JSON.stringify(sessionCache));
        console.log(`[NotificationService] PM-Due: ${notificationCount} notifications triggered.`);
        return notificationCount;
    }

    /**
     * Trigger Qualification Expiry notifications with 3-tier escalation.
     * ISO 55000: Personnel competency management requires proactive renewal alerts.
     *
     * Tier 1 — Warning:   Expires within 30 days  → WARNING
     * Tier 2 — Critical:  Expires within 7 days   → CRITICAL
     * Tier 3 — Expired:   Already expired          → CRITICAL (non-compliant)
     *
     * @param qualifications Array of Qualification objects with dateExpires
     * @param contactName Display name of the contact for notification context
     * @param currentUserId The current logged-in user to receive notifications
     */
    static async triggerQualificationExpiryNotifications(
        qualifications: any[],
        contactName: string = 'Unknown',
        currentUserId: string = 'SYSTEM'
    ): Promise<number> {
        const DEDUP_KEY = 'qual_expiry_notification_session';
        const sessionCache = JSON.parse(localStorage.getItem(DEDUP_KEY) || '{}');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let notificationCount = 0;

        for (const qual of qualifications) {
            if (!qual.dateExpires || qual.status === 'Pending') continue;

            const expiryDate = new Date(qual.dateExpires);
            expiryDate.setHours(0, 0, 0, 0);
            const daysUntilExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

            // Determine tier key for dedup
            const tierLabel = daysUntilExpiry < 0 ? 'expired' : daysUntilExpiry <= 7 ? 'critical' : 'warning';
            const tierKey = `${qual.id}_${tierLabel}`;
            if (sessionCache[tierKey]) continue;

            let tier: number = 0;
            let severity: 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL' = 'INFO';
            let title = '';
            let message = '';

            if (daysUntilExpiry < 0) {
                // Tier 3 — Expired
                tier = 3;
                severity = 'CRITICAL';
                title = `🚨 EXPIRED: ${qual.name} — ${contactName}`;
                message = `Qualification "${qual.name}" for ${contactName} expired ${Math.abs(daysUntilExpiry)} day(s) ago. Personnel is non-compliant. Immediate renewal required.`;
            } else if (daysUntilExpiry <= 7) {
                // Tier 2 — Critical (≤7 days)
                tier = 2;
                severity = 'CRITICAL';
                title = `⚠ Qualification Expiring Soon: ${qual.name} — ${contactName}`;
                message = `Qualification "${qual.name}" for ${contactName} expires in ${daysUntilExpiry} day(s)! Schedule renewal immediately.`;
            } else if (daysUntilExpiry <= 30) {
                // Tier 1 — Warning (≤30 days)
                tier = 1;
                severity = 'WARNING';
                title = `🔔 Qualification Renewal Due: ${qual.name} — ${contactName}`;
                message = `Qualification "${qual.name}" for ${contactName} expires in ${daysUntilExpiry} day(s). Plan renewal.`;
            }

            if (tier > 0) {
                await this.notify({
                    recipientId: currentUserId,
                    title,
                    message,
                    severity,
                    notificationType: tier === 3 ? 'COMPLIANCE_ALERT' : 'SCHEDULE_ALERT',
                    module: 'contacts',
                    entityId: qual.id,
                    entityType: 'QUALIFICATION',
                    entityNumber: qual.name,
                    actionLink: '/people',
                    actionRequired: tier >= 2,
                    createdBy: 'SYSTEM',
                });

                sessionCache[tierKey] = Date.now();
                notificationCount++;
            }
        }

        // Persist dedup cache
        localStorage.setItem(DEDUP_KEY, JSON.stringify(sessionCache));
        console.log(`[NotificationService] Qual-Expiry: ${notificationCount} notifications triggered.`);
        return notificationCount;
    }

    /**
     * Polls for notifications with breached escalation deadlines.
     * Called periodically from Layout.tsx alongside the regular polling.
     * Creates escalation-level follow-up notifications for unacknowledged alerts.
     * 
     * **Hierarchy-based escalation:**
     * - If `escalation_recipient_role` is empty → re-notifies the same recipient
     * - If `escalation_recipient_role` is `__SUPERVISOR` → looks up the org chart 
     *   to find the original recipient's supervisor/manager
     * - If `escalation_recipient_role` is a role code (e.g. 'MAINT_MANAGER') →
     *   queries all users with that contact_type and notifies them
     */
    static async checkEscalations(): Promise<number> {
        const ESCAL_KEY = 'ers_escalation_cache';
        const cache: Record<string, number> = JSON.parse(localStorage.getItem(ESCAL_KEY) || '{}');
        let escalated = 0;

        try {
            const db = DatabaseService.getInstance();
            // Get all unacknowledged notifications (limit to recent)
            const notifications = await db.getNotifications('__ALL__', { limit: 50, unreadOnly: true });

            const now = Date.now();

            for (const notif of notifications) {
                // Skip if already escalated recently (24h dedup)
                if (cache[notif.id] && now - cache[notif.id] < 86400000) continue;

                // Check if escalation deadline is set and breached
                if (!notif.escalationDeadline) continue;
                const deadline = new Date(notif.escalationDeadline).getTime();
                if (deadline > now) continue; // not yet breached

                // Skip if already acknowledged
                if (notif.isAcknowledged) continue;

                // Determine escalation level
                const newLevel = (notif.escalationLevel || 0) + 1;
                const severity = newLevel >= 2 ? 'CRITICAL' : 'WARNING';
                const escalationRole = notif.escalationRecipientRole || '';

                console.warn(
                    `[ESCALATION] Notification "${notif.title}" breached deadline. Level: ${newLevel}, EscRole: ${escalationRole || 'SAME'}`
                );

                // --- Resolve escalation recipients ---
                // When escalating to someone else, the original recipient stays in copy
                let escalationRecipientIds: string[] = [];

                if (!escalationRole || escalationRole === '') {
                    // Same recipient
                    escalationRecipientIds = [notif.recipientId];
                } else if (escalationRole === '__SUPERVISOR') {
                    // Look up org chart supervisor + keep original in copy
                    try {
                        const supervisorId = await this.resolveOrgChartSupervisor(notif.recipientId);
                        escalationRecipientIds = supervisorId
                            ? [supervisorId, notif.recipientId]  // Supervisor + original (CC)
                            : [notif.recipientId];
                        if (!supervisorId) {
                            console.warn('[ESCALATION] No supervisor found, falling back to same recipient');
                        }
                    } catch {
                        escalationRecipientIds = [notif.recipientId];
                    }
                } else {
                    // Role-based: scoped resolution + keep original in copy
                    try {
                        const roleUsers = await this.resolveRoleRecipientsScoped(
                            escalationRole,
                            'ORG_UNIT',          // Default: walk up from original recipient's org unit
                            notif.recipientId    // Context: the person whose notification breached
                        );
                        escalationRecipientIds = roleUsers.length > 0
                            ? [...roleUsers, notif.recipientId]  // Role targets + original (CC)
                            : [notif.recipientId];
                    } catch {
                        escalationRecipientIds = [notif.recipientId];
                    }
                }

                // Deduplicate (in case original is also in the escalation target list)
                escalationRecipientIds = [...new Set(escalationRecipientIds)];

                // Create escalation notification for each resolved recipient
                for (const recipientId of escalationRecipientIds) {
                    try {
                        await db.createNotification({
                            recipientId,
                            title: `⚠️ ESCALATION (L${newLevel}): ${notif.title}`,
                            message: `This alert has not been acknowledged within the required timeframe. Original: ${notif.message}`,
                            severity,
                            notificationType: 'ESCALATION',
                            module: notif.module,
                            entityId: notif.entityId,
                            entityType: notif.entityType,
                            entityNumber: notif.entityNumber,
                            actionLink: notif.actionLink,
                            actionRequired: true,
                            createdBy: 'SYSTEM_ESCALATION',
                        });
                        escalated++;
                    } catch (e) {
                        console.error('[ESCALATION] Failed to create escalation:', e);
                    }
                }

                cache[notif.id] = now;
            }

            localStorage.setItem(ESCAL_KEY, JSON.stringify(cache));
        } catch (e) {
            console.error('[NotificationService] Escalation check failed:', e);
        }

        if (escalated > 0) {
            console.log(`[NotificationService] Escalated ${escalated} notifications.`);
        }
        return escalated;
    }

    /**
     * Trigger notification when a DE task is created (from Pareto/RCA/FMEA).
     * Notifies the reliability team so they can begin defect elimination planning.
     */
    static async notifyDETaskCreated(params: {
        taskId: string;
        taskTitle: string;
        assetName: string;
        priority: string;
        source: 'pareto' | 'rca' | 'fmea' | 'manual';
        recipientId: string;
        createdBy?: string;
    }): Promise<void> {
        const prioritySeverity = params.priority === 'critical' ? 'CRITICAL' as const
            : params.priority === 'high' ? 'WARNING' as const : 'INFO' as const;

        const sourceLabel = {
            pareto: 'Pareto Bad Actor Analysis',
            rca: 'Root Cause Analysis',
            fmea: 'FMEA Assessment',
            manual: 'Manual Creation',
        }[params.source];

        await this.notify({
            recipientId: params.recipientId,
            title: `🎯 DE Task Created: ${params.assetName}`,
            message: `"${params.taskTitle}" — Priority: ${params.priority.toUpperCase()}. Source: ${sourceLabel}. Begin defect elimination planning.`,
            severity: prioritySeverity,
            notificationType: 'STATUS_CHANGE',
            module: 'analyze',
            entityId: params.taskId,
            entityType: 'DE_TASK',
            actionLink: `/analyze?division=defect_elimination&task=${params.taskId}`,
            actionRequired: params.priority === 'critical',
            createdBy: params.createdBy || 'SYSTEM',
        });
    }

    /**
     * Notify when a DE task is auto-advanced to 'resolved'.
     * Signals the reliability team that all remediation work is complete.
     */
    static async notifyDETaskResolved(params: {
        taskId: string;
        taskTitle: string;
        assetName: string;
        recipientId: string;
    }): Promise<void> {
        await this.notify({
            recipientId: params.recipientId,
            title: `✅ DE Task Resolved: ${params.assetName}`,
            message: `"${params.taskTitle}" — All linked work orders are closed. Review and verify the defect has been eliminated.`,
            severity: 'SUCCESS',
            notificationType: 'STATUS_CHANGE',
            module: 'analyze',
            entityId: params.taskId,
            entityType: 'DE_TASK',
            actionLink: `/analyze?division=defect_elimination&task=${params.taskId}`,
            actionRequired: true,
            createdBy: 'SYSTEM',
        });
    }

    /**
     * Resolves the org chart supervisor for a given user.
     * Looks up: user's contact → organization_unit_members → organization_units.manager_id
     */
    private static async resolveOrgChartSupervisor(userId: string): Promise<string | null> {
        try {
            // Shared singleton client (never a second GoTrue instance — avoids token races).

            // Find the user's contact record
            const { data: contact } = await supabase
                .from('contacts').select('id').eq('user_id', userId).maybeSingle();
            if (!contact?.id) return null;

            // Find which org unit they belong to
            const { data: membership } = await supabase
                .from('organization_unit_members')
                .select('organization_unit_id')
                .eq('contact_id', contact.id)
                .limit(1)
                .maybeSingle();
            if (!membership?.organization_unit_id) return null;

            // Get the org unit's manager
            const { data: unit } = await supabase
                .from('organization_units')
                .select('manager_id, parent_id')
                .eq('id', membership.organization_unit_id)
                .maybeSingle();

            if (unit?.manager_id && unit.manager_id !== userId) {
                // The manager is a contact ID, resolve to user ID
                const { data: managerContact } = await supabase
                    .from('contacts').select('user_id').eq('id', unit.manager_id).maybeSingle();
                return managerContact?.user_id || null;
            }

            // If same person or no manager, try parent unit's manager
            if (unit?.parent_id) {
                const { data: parentUnit } = await supabase
                    .from('organization_units')
                    .select('manager_id')
                    .eq('id', unit.parent_id)
                    .maybeSingle();
                if (parentUnit?.manager_id) {
                    const { data: parentManager } = await supabase
                        .from('contacts').select('user_id').eq('id', parentUnit.manager_id).maybeSingle();
                    return parentManager?.user_id || null;
                }
            }

            return null;
        } catch (e) {
            console.error('[ESCALATION] Supervisor lookup failed:', e);
            return null;
        }
    }

    /**
     * Resolves user IDs by role using a scoped strategy.
     * - ORG_UNIT: Walk up the org tree from contextUser's unit to find members with roleCode
     * - SITE: Find users with roleCode at the same site as the entity
     * - GLOBAL: Find ALL users with roleCode enterprise-wide
     */
    private static async resolveRoleRecipientsScoped(
        roleCode: string,
        scope: 'ORG_UNIT' | 'SITE' | 'GLOBAL',
        contextUserId?: string,
        entitySiteId?: string
    ): Promise<string[]> {
        try {
            // Shared singleton client (never a second GoTrue instance — avoids token races).

            // === ORG_UNIT scope: walk up the org tree ===
            if (scope === 'ORG_UNIT' && contextUserId) {
                // 1. Find the context user's contact record
                const { data: contact } = await supabase
                    .from('contacts').select('id').eq('user_id', contextUserId).maybeSingle();
                if (contact?.id) {
                    // 2. Find their org unit
                    const { data: membership } = await supabase
                        .from('organization_unit_members')
                        .select('organization_unit_id')
                        .eq('contact_id', contact.id)
                        .limit(1)
                        .maybeSingle();

                    if (membership?.organization_unit_id) {
                        let currentUnitId: string | null = membership.organization_unit_id;
                        const maxDepth = 10; // Prevent infinite loops

                        // 3. Walk up the tree looking for members with the target role
                        for (let depth = 0; depth < maxDepth && currentUnitId; depth++) {
                            // Find members of this unit with the target role
                            const { data: unitMembers } = await supabase
                                .from('organization_unit_members')
                                .select('contact_id')
                                .eq('organization_unit_id', currentUnitId);

                            if (unitMembers && unitMembers.length > 0) {
                                const memberContactIds = unitMembers.map((m: any) => m.contact_id);
                                const { data: roleMatches } = await supabase
                                    .from('contacts')
                                    .select('user_id')
                                    .in('id', memberContactIds)
                                    .ilike('contact_type', roleCode);

                                if (roleMatches && roleMatches.length > 0) {
                                    const userIds = roleMatches.map((c: any) => c.user_id).filter(Boolean);
                                    if (userIds.length > 0) {
                                        console.log(`[SCOPED-ROLE] Found ${userIds.length} ${roleCode} at org depth ${depth}`);
                                        return userIds;
                                    }
                                }
                            }

                            // Walk up to parent unit
                            const { data: unit } = await supabase
                                .from('organization_units')
                                .select('parent_id')
                                .eq('id', currentUnitId)
                                .maybeSingle();
                            currentUnitId = unit?.parent_id || null;
                        }
                    }
                }
                // ORG_UNIT walk-up found nothing — fall through to GLOBAL
                console.warn(`[SCOPED-ROLE] No ${roleCode} found in org tree for user ${contextUserId}, falling back to GLOBAL`);
            }

            // === SITE scope: same site as the entity's asset ===
            if (scope === 'SITE' && entitySiteId) {
                // Find contacts with target role at the same site
                const { data: siteContacts } = await supabase
                    .from('contacts')
                    .select('user_id')
                    .ilike('contact_type', roleCode)
                    .eq('site_id', entitySiteId);

                if (siteContacts && siteContacts.length > 0) {
                    const userIds = siteContacts.map((c: any) => c.user_id).filter(Boolean);
                    if (userIds.length > 0) {
                        console.log(`[SCOPED-ROLE] Found ${userIds.length} ${roleCode} at site ${entitySiteId}`);
                        return userIds;
                    }
                }
                console.warn(`[SCOPED-ROLE] No ${roleCode} found at site ${entitySiteId}, falling back to GLOBAL`);
            }

            // === GLOBAL scope (or fallback): all users with the role ===
            const { data: contacts } = await supabase
                .from('contacts')
                .select('user_id')
                .ilike('contact_type', roleCode);

            if (!contacts) return [];
            return contacts.map((c: any) => c.user_id).filter(Boolean);
        } catch (e) {
            console.error('[SCOPED-ROLE] Role resolution failed:', e);
            return [];
        }
    }
}
