import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../eam/lib/supabase';

export interface ReliabilityPresenceUser {
    userId: string;
    username: string;
    fullName: string;
    role: string;
    department: string;
    activePage: string;
    onlineAt: string;
}

const RELIABILITY_ROUTES = [
    '/predict',
    '/reliability-modelling',
    '/analyze',
    '/rcm',
    '/vision',
    '/knowledge-graph',
    '/data-quality'
];

/**
 * Translates a pathname into a descriptive, user-friendly activity label.
 */
function getActivityLabel(pathname: string): string {
    if (pathname === '/predict') return 'Reviewing Predictive RUL Models';
    if (pathname === '/reliability-modelling') return 'Developing Reliability Models';
    if (pathname.startsWith('/analyze/rca/') && pathname.endsWith('/report')) return 'Reviewing RCA Report';
    if (pathname.startsWith('/analyze/rca/')) return 'Conducting RCA Investigation';
    if (pathname.startsWith('/analyze/fmea/')) return 'Analyzing FMEA Worksheet';
    if (pathname === '/analyze') return 'Analyzing Bad Actors & RCAs';
    if (pathname.startsWith('/rcm/')) return 'Editing RCM Study';
    if (pathname === '/rcm') return 'Reviewing RCM Studies';
    if (pathname === '/vision') return 'Diagnosing Vision Diagnostics';
    if (pathname === '/knowledge-graph') return 'Exploring Asset Knowledge Graph';
    if (pathname === '/data-quality') return 'Checking Data Quality';
    
    // Fallback search
    if (RELIABILITY_ROUTES.some(route => pathname.startsWith(route))) {
        return 'Active in Reliability Suite';
    }
    return '';
}

/**
 * useReliabilityPresence
 * ═════════════════════════════════
 * Real-time Supabase Presence hook scoped to the Reliability Suite.
 * Automatically tracks user profile and active page when the route is within
 * the Reliability Suite, syncing presence with other engineers.
 */
export function useReliabilityPresence() {
    const { user, isAuthenticated } = useAuth();
    const location = useLocation();
    const [onlineUsers, setOnlineUsers] = useState<ReliabilityPresenceUser[]>([]);
    const [isConnecting, setIsConnecting] = useState(false);
    const channelRef = useRef<any>(null);

    const currentPath = location.pathname;
    const isReliabilityRoute = RELIABILITY_ROUTES.some(route => currentPath.startsWith(route));
    const activeActivity = getActivityLabel(currentPath);

    useEffect(() => {
        // Only run presence if user is authenticated and on a reliability suite page
        if (!isAuthenticated || !user || !isReliabilityRoute) {
            setOnlineUsers([]);
            if (channelRef.current) {
                console.log('[Presence] Unsubscribing due to page exit:', currentPath);
                channelRef.current.unsubscribe();
                channelRef.current = null;
            }
            return;
        }

        setIsConnecting(true);
        console.log('[Presence] Initializing presence for page:', currentPath, 'Activity:', activeActivity);

        // Define a presence channel specifically for the reliability suite
        const channel = supabase.channel('reliability_suite_presence', {
            config: {
                presence: {
                    key: user.id || user.username || 'unknown',
                },
            },
        });

        channelRef.current = channel;

        const syncPresences = () => {
            const presenceState = channel.presenceState();
            const aggregatedUsers: ReliabilityPresenceUser[] = [];

            Object.keys(presenceState).forEach(key => {
                const userPresences = presenceState[key] as any[];
                if (userPresences && userPresences.length > 0) {
                    // Sort by newest onlineAt timestamp to show their most active session
                    const sorted = [...userPresences].sort(
                        (a, b) => new Date(b.onlineAt).getTime() - new Date(a.onlineAt).getTime()
                    );
                    const mainSession = sorted[0];
                    aggregatedUsers.push({
                        userId: mainSession.userId,
                        username: mainSession.username,
                        fullName: mainSession.fullName,
                        role: mainSession.role,
                        department: mainSession.department,
                        activePage: mainSession.activePage,
                        onlineAt: mainSession.onlineAt
                    });
                }
            });

            console.log('[Presence] Synchronized online users count:', aggregatedUsers.length);
            setOnlineUsers(aggregatedUsers);
        };

        channel
            .on('presence', { event: 'sync' }, () => {
                syncPresences();
            })
            .on('presence', { event: 'join' }, ({ key, newPresences }) => {
                console.log('[Presence] User joined:', key, newPresences);
            })
            .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
                console.log('[Presence] User left:', key, leftPresences);
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    setIsConnecting(false);
                    // Register current user details in the Presence state
                    await channel.track({
                        userId: user.id,
                        username: user.username,
                        fullName: user.full_name || user.username,
                        role: user.role || 'Engineer',
                        department: user.departments?.[0] || 'Reliability Dept',
                        activePage: activeActivity,
                        onlineAt: new Date().toISOString(),
                    });
                    console.log('[Presence] Successfully tracked current user presence.');
                } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                    setIsConnecting(false);
                }
            });

        return () => {
            if (channelRef.current) {
                console.log('[Presence] Cleanup: unsubscribing from channel.');
                channelRef.current.unsubscribe();
                channelRef.current = null;
            }
        };
    }, [isAuthenticated, user?.id, user?.username, user?.full_name, user?.role, user?.departments, isReliabilityRoute, currentPath, activeActivity]);

    return {
        onlineUsers,
        isReliabilityRoute,
        isConnecting,
        currentUser: user
    };
}
