import {
    ServiceRequestRecord,
    WorkOrderRecord,
    AssetRecord,
    RequestStatusDB
} from '../schema';
import {
    ServiceRequest,
    WorkOrder,
    Asset,
    RequestStatus,
    WorkOrderStatus,
    WorkOrderType,
    JobFile,
    JobTask,
    JobLabor,
    JobInventory,
    JobJSA,
    JSAHazard,
    PTWPermit,
    PTWIsolationPoint,
    PTWApproval
} from '../types';

/**
 * Data Mapper
 * Bridges the "Strict Database Schema" (schema.ts) with the "Rich UI Types" (types.ts).
 * In a real app, this would happen in the API layer (Controllers/DTOs).
 */
export class DataMapper {

    // --- REQUESTS ---

    static toUIRequest(record: ServiceRequestRecord, assets?: Asset[], users?: any[]): ServiceRequest { // using any[] for users for flexibility as we might use Contact or UserRecord
        const foundAsset = assets?.find(a => a.id === record.asset_id);
        const foundRequester = users?.find(u => u.id === record.requester_id || u.contact_id === record.requester_id);

        let locationName = 'Unknown';
        if (foundAsset && assets) {
            // Use buildAssetPath to find location context (e.g. Site Name > Area Name)
            const path = DataMapper.buildAssetPath(foundAsset, assets);
            // location is usually the top-most or relevant parent.
            // path[0] might be Site.
            if (path.length > 0) {
                locationName = path.join(' > ');
            } else if (foundAsset.location) {
                // Check if location is ID (standard behavior of toUIAsset)
                // If ID, try look up
                const locAsset = assets.find(a => a.id === foundAsset.location);
                locationName = locAsset ? (locAsset.tag || locAsset.name) : (foundAsset.location === 'Linked Loc' ? 'Unknown' : foundAsset.location);
            }
        }

        return {
            id: record.id,
            requestNumber: record.request_number,
            title: record.description.length > 40 ? record.description.substring(0, 40) + '...' : record.description,
            description: record.description,
            status: DataMapper.mapRequestStatus(record.status),
            priority: 'MEDIUM',
            category: record.category || 'General',
            assetId: record.asset_id,
            assetName: foundAsset ? foundAsset.tag : 'Asset ' + record.asset_id.substring(0, 8) + '...', // Show Tag if found
            location: locationName,
            requesterId: record.requester_id,
            requesterName: foundRequester ? (foundRequester.username || foundRequester.name || foundRequester.email) : 'User ' + record.requester_id.substring(0, 8) + '...',
            createdAt: record.created_at,
            slaDeadline: new Date(new Date(record.created_at).getTime() + 86400000).toISOString(),
            aiRiskScore: record.risk_score,
            functionalFailureType: record.functional_failure_id,
            workCenterId: record.work_center_id || undefined,
            rejectionReason: record.rejection_reason,
            isBreakdown: record.is_breakdown,
            authorizedBy: record.authorized_by,
            authorizedAt: record.authorized_at,
            linkedWOId: (record as any).work_orders?.[0]?.id,
            linkedWONumber: (record as any).work_orders?.[0]?.wo_number
        };
    }

    static toDBRequest(ui: ServiceRequest): ServiceRequestRecord {
        return {
            id: ui.id,
            request_number: ui.requestNumber,
            status: DataMapper.mapUIRequestStatus(ui.status),
            description: ui.description,
            asset_id: ui.assetId || null as any,
            requester_id: ui.requesterId,
            functional_failure_id: ui.functionalFailureType || null as any,
            work_center_id: ui.workCenterId || null,
            risk_score: ui.aiRiskScore || 0,
            rejection_reason: ui.rejectionReason,
            is_breakdown: ui.isBreakdown || false,
            category: ui.category || 'GENERAL',
            authorized_by: ui.authorizedBy,
            authorized_at: ui.authorizedAt,
            created_at: ui.createdAt,
            updated_at: new Date().toISOString()
        };
    }

    // --- JOB TASKS ---

    static toUIJobTask(record: any): JobTask {
        return {
            id: record.id,
            sequence: record.sequence,
            description: record.description,
            status: record.status as any,
            estHours: record.est_hours || 0,
            estStartDate: record.est_start_date,
            estFinishDate: record.est_finish_date,
            estStartTime: record.est_start_time,
            estFinishTime: record.est_finish_time,
            actualHours: record.actual_hours,
            actualStartDate: record.actual_start_date,
            actualFinishDate: record.actual_finish_date,
            actualStartTime: record.actual_start_time,
            actualFinishTime: record.actual_finish_time,
            instructions: record.instructions || [],
            operationNo: record.operation_no || undefined,
            workCenterId: record.work_center_id || undefined,
            controlKey: record.control_key || undefined,
            plannedRate: record.planned_rate != null ? Number(record.planned_rate) : undefined,
            predecessorTaskId: record.predecessor_task_id || undefined,
            assignedUserIds: record.assigned_user_ids || [],
            assignedOrgUnitIds: record.assigned_org_unit_ids || []
        };
    }

    static toDBJobTask(ui: JobTask, woId: string): any {
        const record: any = {
            wo_id: woId,
            sequence: ui.sequence,
            description: ui.description,
            status: ui.status,
            est_hours: ui.estHours,
            est_start_date: ui.estStartDate || null,
            est_finish_date: ui.estFinishDate || null,
            est_start_time: ui.estStartTime || null,
            est_finish_time: ui.estFinishTime || null,
            actual_hours: ui.actualHours || null,
            actual_start_date: ui.actualStartDate || null,
            actual_finish_date: ui.actualFinishDate || null,
            actual_start_time: ui.actualStartTime || null,
            actual_finish_time: ui.actualFinishTime || null,
            instructions: ui.instructions || [],
            // WM-2b: operation number defaults to sequence*10, zero-padded, if unset.
            operation_no: ui.operationNo || String(Math.max(ui.sequence || 0, 0) * 10).padStart(4, '0'),
            work_center_id: ui.workCenterId || null,
            control_key: ui.controlKey || 'PM01',
            planned_rate: ui.plannedRate != null ? ui.plannedRate : null,
            predecessor_task_id: ui.predecessorTaskId || null,
            assigned_user_ids: ui.assignedUserIds || [],
            assigned_org_unit_ids: ui.assignedOrgUnitIds || []
        };

        if (ui.id && !ui.id.startsWith('new-')) {
            record.id = ui.id;
        }

        return record;
    }

    // --- LABOR & INVENTORY ---

    static toUIJobLabor(record: any): JobLabor {
        return {
            id: record.id,
            contactId: record.contact_id,
            contactType: record.contact_type_code,
            isLead: record.is_lead || false,
            headcount: Number(record.headcount) || 1,
            estDuration: Number(record.hours_worked) || 0,
            estRate: Number(record.rate_per_hour) || 0,
            actualDuration: Number(record.hours_worked) || 0,
            costCenter: undefined,
            dateWorkPerformed: record.date_worked,
            jobTaskId: record.job_task_id,
            isFinal: record.is_final || false,
            confirmationNo: record.confirmation_no != null ? Number(record.confirmation_no) : undefined,
            remainingHours: record.remaining_hours != null ? Number(record.remaining_hours) : undefined
        };
    }

    static toDBJobLabor(ui: JobLabor, woId: string): any {
        const duration = ui.actualDuration !== undefined ? ui.actualDuration : ui.estDuration;
        return {
            id: ui.id.startsWith('new-') ? undefined : ui.id,
            wo_id: woId,
            contact_id: ui.contactId || null,
            contact_type_code: ui.contactType,
            is_lead: ui.isLead || false,
            headcount: Number(ui.headcount) || 1,
            hours_worked: Number(duration) || 0,
            rate_per_hour: Number(ui.estRate) || 0,
            date_worked: ui.dateWorkPerformed || new Date().toISOString().split('T')[0],
            job_task_id: (ui.jobTaskId && !ui.jobTaskId.startsWith('new-')) ? ui.jobTaskId : null,
            is_final: ui.isFinal || false,
            confirmation_no: ui.confirmationNo != null ? ui.confirmationNo : null,
            remaining_hours: ui.remainingHours != null ? ui.remainingHours : null
        };
    }

    static toUIJobInventory(record: any): JobInventory {
        return {
            id: record.id,
            inventoryId: record.item_id,
            description: record.notes || '',
            estQty: Number(record.quantity) || 0,
            estUnitCost: Number(record.unit_cost) || 0,
            actualQty: Number(record.quantity) || 0,
            actualUnitCost: Number(record.unit_cost) || 0,
            dateUsed: record.date_used,
            costCenter: undefined,
            uom: 'EA', // Default to EA if missing
            jobTaskId: record.job_task_id // New Mapping
        };
    }

    static toDBJobInventory(ui: JobInventory, woId: string): any {
        if (ui.jobTaskId && ui.jobTaskId.startsWith('new-')) {
            console.error(`[DataMapper] Attempting to save inventory with temp jobTaskId: ${ui.jobTaskId}. This implies ID mapping failed in DatabaseService.`);
        }

        const qty = ui.actualQty !== undefined ? ui.actualQty : ui.estQty;
        const uCost = ui.actualUnitCost !== undefined ? ui.actualUnitCost : ui.estUnitCost;

        return {
            id: ui.id.startsWith('new-') ? undefined : ui.id,
            wo_id: woId,
            item_id: ui.inventoryId || null,
            notes: ui.description || '',
            quantity: Number(qty) || 0,
            unit_cost: Number(uCost) || 0,
            date_used: ui.dateUsed || null,
            job_task_id: (ui.jobTaskId && !ui.jobTaskId.startsWith('new-')) ? ui.jobTaskId : null
        };
    }

    // --- WORK ORDERS ---

    static toUIJobJSA(record: any): JobJSA {
        return {
            id: record.id,
            status: record.status as any,
            permits: record.permits || [],
            hazards: (record.hazards || []).map(DataMapper.toUIJSAHazard),
            signoffs: record.signoffs || []
        };
    }

    private static jsaRiskLevel(score: number): JSAHazard['riskLevel'] {
        return score >= 20 ? 'Critical' : score >= 15 ? 'High' : score >= 8 ? 'Medium' : 'Low';
    }

    static toUIJSAHazard(record: any): JSAHazard {
        // Rows saved before 0208 only carry the combined risk_score (TEXT);
        // leave the factors undefined rather than fabricating a 1×1.
        const storedScore = Number(record.risk_score);
        const consequence = record.consequence ?? undefined;
        const likelihood = record.likelihood ?? undefined;
        const score = consequence && likelihood
            ? consequence * likelihood
            : (Number.isFinite(storedScore) ? storedScore : 1);
        const residualConsequence = record.residual_consequence ?? undefined;
        const residualLikelihood = record.residual_likelihood ?? undefined;
        const residualScore = residualConsequence && residualLikelihood
            ? residualConsequence * residualLikelihood
            : undefined;
        return {
            id: record.id,
            hazard: record.hazard,
            consequence: consequence as number,
            likelihood: likelihood as number,
            riskScore: score,
            riskLevel: DataMapper.jsaRiskLevel(score),
            controlHierarchy: record.control_hierarchy || [],
            controls: record.controls,
            residualConsequence,
            residualLikelihood,
            residualRiskScore: residualScore,
            residualRiskLevel: residualScore !== undefined ? DataMapper.jsaRiskLevel(residualScore) : undefined,
            taskRefId: record.task_ref_id,
            signoffRequired: record.signoff_required ?? undefined,
            signoffBy: record.signoff_by ?? undefined,
            signoffDate: record.signoff_date ?? undefined
        };
    }

    static toDBJobJSA(ui: JobJSA, woId: string): any {
        return {
            wo_id: woId,
            status: ui.status || 'DRAFT',
            permits: ui.permits,
            signoffs: ui.signoffs,
            updated_at: new Date().toISOString()
        };
    }

    static toDBJSAHazard(ui: JSAHazard, jsaId: string): any {
        return {
            // Preserve the row id across saves so hazards upsert in place;
            // rows born before client-side UUID ids (legacy "hz-…" placeholders)
            // get a fresh one here.
            id: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ui.id)
                ? ui.id : crypto.randomUUID(),
            jsa_id: jsaId,
            hazard: ui.hazard,
            consequence: ui.consequence ?? null,
            likelihood: ui.likelihood ?? null,
            risk_score: ui.riskScore,
            control_hierarchy: ui.controlHierarchy || [],
            controls: ui.controls,
            residual_consequence: ui.residualConsequence ?? null,
            residual_likelihood: ui.residualLikelihood ?? null,
            signoff_required: ui.signoffRequired ?? null,
            signoff_by: ui.signoffBy ?? null,
            signoff_date: ui.signoffDate ?? null,
            task_ref_id: ui.taskRefId ?? null
        };
    }

    // --- PTW (Permit to Work) ---

    static toUIPTWPermit(record: any): PTWPermit {
        return {
            id: record.id,
            jsaId: record.jsa_id,
            permitType: record.permit_type,
            status: record.status,
            permitNumber: record.permit_number,
            description: record.description || '',
            safetyRequirements: record.safety_requirements || [],
            ppeRequirements: record.ppe_requirements || [],
            certificatesRequired: record.certificates_required || [],
            environmentalConditions: record.environmental_conditions,
            validityStart: record.validity_start,
            validityEnd: record.validity_end,
            permitHolderId: record.permit_holder_id,
            issuerId: record.issuer_id,
            receiverId: record.receiver_id,
            toolboxTalkCompleted: record.toolbox_talk_completed || false,
            toolboxTalkNotes: record.toolbox_talk_notes,
            returnNotes: record.return_notes,
            returnedAt: record.returned_at,
            returnedBy: record.returned_by,
            createdBy: record.created_by,
            isolationPoints: (record.ptw_isolation_points || []).map(DataMapper.toUIIsolationPoint),
            approvals: (record.ptw_approvals || []).map(DataMapper.toUIPTWApproval)
        };
    }

    static toDBPTWPermit(ui: Partial<PTWPermit>, jsaId: string): any {
        return {
            jsa_id: jsaId,
            permit_type: ui.permitType,
            status: ui.status || 'DRAFT',
            description: ui.description,
            safety_requirements: ui.safetyRequirements || [],
            ppe_requirements: ui.ppeRequirements || [],
            certificates_required: ui.certificatesRequired || [],
            environmental_conditions: ui.environmentalConditions,
            validity_start: ui.validityStart,
            validity_end: ui.validityEnd,
            permit_holder_id: ui.permitHolderId,
            issuer_id: ui.issuerId,
            receiver_id: ui.receiverId,
            toolbox_talk_completed: ui.toolboxTalkCompleted || false,
            toolbox_talk_notes: ui.toolboxTalkNotes,
            return_notes: ui.returnNotes,
            returned_at: ui.returnedAt,
            returned_by: ui.returnedBy,
            updated_at: new Date().toISOString()
        };
    }

    static toUIIsolationPoint(record: any): PTWIsolationPoint {
        return {
            id: record.id,
            permitId: record.permit_id,
            tagNumber: record.tag_number,
            isolationType: record.isolation_type,
            method: record.method,
            normalPosition: record.normal_position,
            isolatedPosition: record.isolated_position,
            isolatedBy: record.isolated_by,
            isolatedAt: record.isolated_at,
            verifiedBy: record.verified_by,
            verifiedAt: record.verified_at,
            deIsolatedBy: record.de_isolated_by,
            deIsolatedAt: record.de_isolated_at,
            status: record.status,
            sequence: record.sequence || 0
        };
    }

    static toDBIsolationPoint(ui: PTWIsolationPoint, permitId: string): any {
        return {
            permit_id: permitId,
            tag_number: ui.tagNumber,
            isolation_type: ui.isolationType,
            method: ui.method,
            normal_position: ui.normalPosition,
            isolated_position: ui.isolatedPosition,
            isolated_by: ui.isolatedBy,
            isolated_at: ui.isolatedAt,
            verified_by: ui.verifiedBy,
            verified_at: ui.verifiedAt,
            de_isolated_by: ui.deIsolatedBy,
            de_isolated_at: ui.deIsolatedAt,
            status: ui.status || 'PENDING',
            sequence: ui.sequence || 0,
            updated_at: new Date().toISOString()
        };
    }

    static toUIPTWApproval(record: any): PTWApproval {
        return {
            id: record.id,
            permitId: record.permit_id,
            approverId: record.approver_id,
            role: record.role,
            decision: record.decision,
            comments: record.comments,
            decidedAt: record.decided_at,
            sequence: record.sequence || 0
        };
    }

    static toDBPTWApproval(ui: PTWApproval, permitId: string): any {
        return {
            permit_id: permitId,
            approver_id: ui.approverId,
            role: ui.role,
            decision: ui.decision || 'PENDING',
            comments: ui.comments,
            decided_at: ui.decidedAt,
            sequence: ui.sequence || 0,
            updated_at: new Date().toISOString()
        };
    }

    static toUIWorkOrder(record: any, assets?: Asset[], dictionaries?: any[]): WorkOrder {
        const foundAsset = assets?.find(a => a.id === record.asset_id);
        const mappedTasks = (record.job_tasks || []).map(DataMapper.toUIJobTask).sort((a: any, b: any) => a.sequence - b.sequence);

        // Map "type" directly from DB code (e.g. 'PM', 'CM')
        let workTypeCode: WorkOrderType = WorkOrderType.CM;
        if (record.type) {
            // Validate if it matches our Enum, otherwise cast or fallback
            // In a strict world we might check against Object.values(WorkOrderType)
            workTypeCode = record.type as WorkOrderType;
        }

        // Scheduling - map from actual DB columns
        let dateDueStart = '';
        let timeDueStart = '';
        if (record.date_due_start) {
            const d = new Date(record.date_due_start);
            dateDueStart = d.toISOString().split('T')[0];
            timeDueStart = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        }

        let dueDate = '';
        let timeDueFinish = '';
        if (record.due_date) {
            const d = new Date(record.due_date);
            dueDate = d.toISOString().split('T')[0];
            timeDueFinish = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        }

        // Format WO number: legacy rows store an integer (display as WO-XXXX);
        // newer paths (buildWorkOrder, generate_wo_number RPC) store the full
        // "WO-…" string — don't double the prefix.
        const woNum = record.wo_number;
        const formattedWoNumber = !woNum ? record.id
            : String(woNum).toUpperCase().startsWith('WO-') ? String(woNum)
            : `WO-${String(woNum).padStart(4, '0')}`;

        // Map JSA from joined jsa_assessments relation
        const rawJsa = record.jsa_assessments;
        const jsaRecord = Array.isArray(rawJsa) ? rawJsa[0] : rawJsa;
        let mappedJSA: JobJSA | undefined;
        if (jsaRecord) {
            mappedJSA = {
                id: jsaRecord.id,
                status: jsaRecord.status || 'DRAFT',
                hazards: (jsaRecord.jsa_hazards || []).map(DataMapper.toUIJSAHazard),
                permits: jsaRecord.permits || [],
                signoffs: jsaRecord.signoffs || []
            };
        }

        return {
            id: record.id,
            woNumber: formattedWoNumber,
            title: record.title,
            description: record.description || record.title,
            status: record.status as WorkOrderStatus,
            type: workTypeCode,
            scope: (record.scope as any) || 'STANDARD',
            priority: record.priority_code,
            assetId: record.asset_id,
            assetName: foundAsset ? foundAsset.name : 'Asset ' + record.asset_id,
            assetPath: foundAsset && assets ? DataMapper.buildAssetPath(foundAsset, assets) : [],
            assetCode: foundAsset ? foundAsset.tag : undefined,
            createdById: record.created_by,
            dateCreated: record.created_at,
            costCenter: record.cost_center,
            workCenterId: record.work_center_id || undefined, // 0178 — Main Work Center

            // Scheduling
            dateDueStart,
            timeDueStart,
            dueDate,
            timeDueFinish,

            estDuration: record.est_duration || 0,
            estDowntime: Number(record.est_downtime_hrs) || 0,
            actualDuration: Number(record.actual_duration_hrs) || 0,
            actualDowntime: Number(record.actual_downtime_hrs) || 0,
            malfunctionStart: record.malfunction_start || undefined,
            malfunctionEnd: record.malfunction_end || undefined,
            breakdown: typeof record.breakdown === 'boolean' ? record.breakdown : undefined,
            // Frozen ledger snapshot (0284) — the Cost tab must show THIS on a
            // closed order, not a live recompute that can silently disagree.
            costFrozen: record.cost_frozen === true,
            frozenLaborCost: record.frozen_labor_cost !== null && record.frozen_labor_cost !== undefined ? Number(record.frozen_labor_cost) : undefined,
            frozenMaterialCost: record.frozen_material_cost !== null && record.frozen_material_cost !== undefined ? Number(record.frozen_material_cost) : undefined,
            parentWoId: record.parent_wo_id || undefined,
            assignedTo: record.assigned_to,
            recurringWorkId: record.recurring_work_id || undefined,
            tasks: mappedTasks,
            jsa: mappedJSA,

            failureData: (() => {
                const fd = Array.isArray(record.wo_failure_data) ? record.wo_failure_data[0] : record.wo_failure_data;
                if (!fd) return undefined;
                return {
                    failureMode: fd.failure_mode_code || undefined,
                    failureCause: fd.failure_cause_code || undefined,
                    remedyCode: fd.remedy_code || undefined,
                    detectionCode: fd.detection_code || undefined,
                    subunitCode: fd.subunit_code || undefined,
                    objectPart: fd.object_part || undefined,
                    failedBomItemId: fd.failed_bom_item_id || undefined,
                    failedPartNo: fd.failed_part_no || undefined,
                    secondaryFailure: typeof fd.secondary_failure === 'boolean' ? fd.secondary_failure : undefined,
                    causedByWoId: fd.caused_by_wo_id || undefined,
                    comments: fd.comments || undefined,
                    localImpact: fd.local_impact || undefined,
                    plantWideImpact: fd.plant_wide_impact || undefined,
                };
            })(),

            properties: record.properties || {},
            // Journals persisted in properties JSONB
            journals: record.properties?.journals || [],
        } as WorkOrder;
    }

    /** Map journal_entries rows (0285) to the UI journal shape. client_id is
     *  the original app-side id, so optimistic entries and table rows dedupe. */
    static toUIJournals(rows: any[]): any[] {
        return (rows || []).map((r: any) => ({
            id: r.client_id || r.id,
            type: r.entry_type || 'Note',
            entry: r.entry,
            createdBy: r.author_name || 'unknown',
            createdAt: r.created_at,
            isSystem: !!r.is_system,
        }));
    }

    static toDBWorkOrder(ui: WorkOrder, dictionaries?: any[]): any {
        // Build update payload with ONLY columns that exist in the work_orders table.
        // DB schema: id, wo_number(int auto), title, description, asset_id, status,
        //   work_type_id, priority, failure_severity, risk_priority_number,
        //   failure_mode_id, failure_cause_id, remedy_id, required_date, completed_date,
        //   requested_by, assigned_to, rejection_reason, created_at, updated_at
        const record: any = {
            title: ui.title,
            description: ui.description || '',
            status: ui.status,
            updated_at: new Date().toISOString(),
        };

        // Only set asset_id if it has a value (NOT NULL constraint)
        if (ui.assetId) {
            record.asset_id = ui.assetId;
        }

        // Map UI field names to actual DB columns
        // Map UI field names to actual DB columns
        if (ui.type) {
            record.type = ui.type;
        }

        if (ui.priority) {
            record.priority_code = ui.priority;
        }

        if (ui.assignedTo) record.assigned_to = ui.assignedTo;

        // Cost Center (text field in DB)
        if (ui.costCenter !== undefined) {
            record.cost_center = ui.costCenter || null;
        }

        // Main Work Center — the responsible work group (0178, SAP Main Work Center)
        if (ui.workCenterId !== undefined) {
            record.work_center_id = ui.workCenterId || null;
        }

        // Scope (STANDARD / PROJECT)
        if (ui.scope) {
            record.scope = ui.scope;
        }

        // Estimated Duration
        if (ui.estDuration !== undefined) {
            record.est_duration = Number(ui.estDuration) || 0;
        }

        // Downtime & actuals (0283) — previously dead UI controls: these fields
        // were collected in the UI but never mapped, so they saved into the void.
        if (ui.estDowntime !== undefined) {
            record.est_downtime_hrs = Number(ui.estDowntime) || 0;
        }
        if (ui.actualDowntime !== undefined) {
            record.actual_downtime_hrs = Number(ui.actualDowntime) || null;
        }
        if (ui.actualDuration !== undefined) {
            record.actual_duration_hrs = Number(ui.actualDuration) || null;
        }
        if (ui.malfunctionStart !== undefined) {
            record.malfunction_start = ui.malfunctionStart || null;
        }
        if (ui.malfunctionEnd !== undefined) {
            record.malfunction_end = ui.malfunctionEnd || null;
        }
        if (ui.breakdown !== undefined) {
            record.breakdown = ui.breakdown;
        }

        // Follow-up chain (P0-2): parent link was written at creation only and
        // then unreadable/unsaveable — map it both directions.
        if (ui.parentWoId !== undefined) {
            record.parent_wo_id = ui.parentWoId || null;
        }

        // Scheduling dates - map to actual DB columns
        if (ui.dateDueStart) {
            record.date_due_start = ui.timeDueStart
                ? `${ui.dateDueStart}T${ui.timeDueStart}:00Z`
                : `${ui.dateDueStart}T00:00:00Z`;
        }

        if (ui.dueDate) {
            record.due_date = ui.timeDueFinish
                ? `${ui.dueDate}T${ui.timeDueFinish}:00Z`
                : `${ui.dueDate}T00:00:00Z`;
        }

        return record;
    }

    private static buildAssetPath(asset: Asset, allAssets: Asset[]): string[] {
        const path: string[] = [];
        let current: Asset | undefined = asset;
        const maxDepth = 10;
        let depth = 0;

        while (current && depth < maxDepth) {

            if (current.id !== asset.id) {
                const label = current.tag || current.name;
                path.unshift(label);
            }

            if (current.parentId) {
                current = allAssets.find(a => a.id === current?.parentId);
            } else {
                current = undefined;
            }
            depth++;
        }
        return path;
    }


    // --- ASSETS ---

    static toUIAsset(record: AssetRecord): Asset {
        return {
            id: record.id,
            tag: record.tag,
            name: record.name,
            parentId: record.parent_id || undefined,
            status: record.status_code as any,
            healthScore: 100,
            priority: record.criticality === 'A' ? 'HIGH' : record.criticality === 'B' ? 'MEDIUM' : 'LOW',
            criticality: (record.criticality as 'A' | 'B' | 'C') || 'C',

            assetType: record.asset_type_code,
            category: record.asset_type_code || record.hierarchy_level,
            assetCategory: record.asset_category,
            assetClass: record.asset_class,

            location: record.location_id,

            manufacturer: record.manufacturer,
            model: record.model,
            serialNumber: record.serial_number,
            department: '',
            costCenter: record.cost_center_id,

            bomItems: [],
            readings: [],
            trackingLog: []
        } as Asset;
    }

    static toDBAsset(ui: Asset): AssetRecord {
        return {
            id: ui.id,
            tag: ui.tag,
            name: ui.name,
            parent_id: ui.parentId || null,
            hierarchy_level: (['SITE', 'AREA', 'UNIT', 'SYSTEM'].includes(ui.assetType?.toUpperCase() || '') ? ui.assetType?.toUpperCase() : 'EQUIPMENT') as any,
            criticality: ui.priority === 'HIGH' ? 'A' : ui.priority === 'MEDIUM' ? 'B' : 'C',
            status_code: ui.status,
            location_id: undefined,

            asset_type_code: ui.assetType || ui.category,
            asset_category: ui.assetCategory,
            asset_class: ui.assetClass,

            manufacturer: ui.manufacturer,
            model: ui.model,
            serial_number: ui.serialNumber,
            cost_center_id: ui.costCenter,

            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
    }

    // --- HELPERS ---

    private static mapRequestStatus(dbStatus: RequestStatusDB): RequestStatus {


        const map: Record<RequestStatusDB, RequestStatus> = {
            'NEW': RequestStatus.NEW,
            'REVIEW': RequestStatus.REVIEW,
            'AUTHORIZED': RequestStatus.AUTHORIZED,
            'APPROVED': RequestStatus.APPROVED,
            'REJECTED': RequestStatus.REJECTED,
            'CONVERTED': RequestStatus.CONVERTED
        };
        return map[dbStatus] || RequestStatus.NEW;
    }

    private static mapUIRequestStatus(uiStatus: RequestStatus): RequestStatusDB {
        // Reverse map matches 1:1 currently
        return uiStatus as RequestStatusDB;
    }
}
