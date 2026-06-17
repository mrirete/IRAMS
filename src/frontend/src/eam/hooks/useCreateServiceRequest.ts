import { useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { buildServiceRequest, submitServiceRequest, type BuildRequestInput } from '../lib/serviceRequest';
import type { ServiceRequest } from '../types';

type CreateInput = Omit<BuildRequestInput, 'requesterId' | 'requesterName'>;

/**
 * useCreateServiceRequest — shared create flow for the unified report/request form.
 * Resolves the requester from auth, builds the request, submits through the offline
 * queue, and surfaces the result via toast. `onCreated` lets a host refresh its list.
 */
export function useCreateServiceRequest(onCreated?: (req: ServiceRequest, queued: boolean) => void) {
    const { user, profile } = useAuth();
    const { showToast } = useToast();
    const [submitting, setSubmitting] = useState(false);

    const create = useCallback(async (input: CreateInput): Promise<ServiceRequest | null> => {
        if (!user) {
            showToast('You must be logged in to submit a request.', 'error');
            return null;
        }
        if (input.description.trim().length < 3) {
            showToast('Please describe the problem.', 'error');
            return null;
        }

        setSubmitting(true);
        try {
            const req = buildServiceRequest({
                ...input,
                requesterId: user.id,
                requesterName: profile?.username || user.email || 'Unknown User',
            });
            const { queued } = await submitServiceRequest(req, user.id);
            showToast(
                queued
                    ? 'Saved offline — will sync automatically when you reconnect.'
                    : `Request submitted — priority ${req.priority}.`,
                queued ? 'info' : 'success',
            );
            onCreated?.(req, queued);
            return req;
        } catch (e) {
            console.error('[useCreateServiceRequest] submit failed:', e);
            showToast('Could not submit request. Try again.', 'error');
            return null;
        } finally {
            setSubmitting(false);
        }
    }, [user, profile, showToast, onCreated]);

    return { create, submitting };
}
