/**
 * Admin navigation — the one list the sidebar, the command palette and the
 * top-bar breadcrumb all read, so a page's name is the same in all three and
 * a page added here is findable everywhere at once.
 *
 * Two groups. DATA is how records move in and out (files, the way back to
 * SAP, and the three continuous parts of Integrations); SETUP is everything
 * that configures the tenant. Every label matches its page's own title.
 */
export interface AdminNavItem {
    to: string;
    label: string;
    /** Match the path exactly (a parent whose children have their own entries). */
    end?: boolean;
    /** Other paths that belong to this entry (sub-pages, wizards). */
    alsoActiveOn?: string[];
    /** Extra permission beyond admin access. */
    permission?: 'activityLog';
    badge?: string;
}

export interface AdminNavGroup {
    label: string;
    /** A captioned run of entries inside the group (Integrations' three parts). */
    sections: { caption?: string; items: AdminNavItem[] }[];
}

export const ADMIN_NAV: AdminNavGroup[] = [
    {
        label: 'Data',
        sections: [
            {
                items: [
                    { to: '/admin/migration', label: 'Migration Center', end: true, alsoActiveOn: ['/admin/migration/cockpit'] },
                    { to: '/admin/migration/sap', label: 'Send to SAP' },
                ],
            },
            {
                caption: 'Integrations',
                items: [
                    { to: '/admin/integrations', label: 'ERP Systems' },
                    { to: '/admin/connectors', label: 'Sensor & Data Feeds' },
                    { to: '/admin/api-keys', label: 'Inbound APIs' },
                ],
            },
        ],
    },
    {
        label: 'Setup',
        sections: [
            {
                items: [
                    { to: '/eam-admin', label: 'System Administration' },
                    { to: '/admin/invitations', label: 'Invitations' },
                    { to: '/admin/settings', label: 'Global Settings' },
                    { to: '/admin/companies', label: 'Your Company' },
                    { to: '/admin/hierarchy', label: 'Hierarchy Config' },
                    { to: '/admin/manufacturers', label: 'Manufacturers' },
                    { to: '/admin/work-centers', label: 'Work Centers' },
                    { to: '/admin/ops-health', label: 'Operations Health' },
                    { to: '/admin/error-logs', label: 'Error Logs' },
                    { to: '/admin/activity-log', label: 'Activity Log', permission: 'activityLog', badge: 'Super' },
                ],
            },
        ],
    },
];

/** Pages reached from inside an admin page, findable by search but not in the sidebar. */
export const ADMIN_SEARCH_EXTRAS: AdminNavItem[] = [
    { to: '/admin/migration/cockpit', label: 'Import from SAP Migration Cockpit' },
    { to: '/admin/connectors/new', label: 'Add a sensor or data feed connector' },
];

export const adminNavItems = (): AdminNavItem[] =>
    ADMIN_NAV.flatMap(g => g.sections.flatMap(s => s.items));

/** The page a path is — longest match wins, so /admin/migration/sap is Send to SAP, not Migration Center. */
export function adminItemFor(pathname: string): AdminNavItem | undefined {
    let best: { item: AdminNavItem; len: number } | undefined;
    for (const item of [...adminNavItems(), ...ADMIN_SEARCH_EXTRAS]) {
        const p = item.to;
        const hit = pathname === p || pathname.startsWith(p + '/');
        if (hit && p.length > (best?.len ?? 0)) best = { item, len: p.length };
    }
    return best?.item;
}

/** Whether a sidebar entry is the one to light up for this path. */
export function adminItemActive(item: AdminNavItem, pathname: string): boolean {
    const own = item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(item.to + '/');
    return own || (item.alsoActiveOn ?? []).some(p => pathname === p || pathname.startsWith(p + '/'));
}

export const isAdminPath = (pathname: string) =>
    pathname === '/eam-admin' || pathname.startsWith('/eam-admin/') || pathname === '/admin' || pathname.startsWith('/admin/');
