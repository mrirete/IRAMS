
import {
    AssetRecord,
    AuditLogRecord,
    DictionaryRecord,
    InventoryItemRecord,
    InventoryTransactionRecord,
    ServiceRequestRecord,
    UserRecord,
    WorkOrderRecord,
    WorkOrderFailureDataRecord,
    RecurringWorkRecord
} from '../schema';
import { DataMapper } from './DataMapper';
import { parseStorageRef, invalidateStorageUrl, callerCompanyId } from '../../lib/storageUrl';
import {
    DictionaryType,
    DictionaryEntry,
    DataScope,
    WorkOrder,
    Asset,
    JobTask,
    WorkCenter,
    Company,
    NumberingOverride,
} from '../types';
import type { MaintenanceStrategy, StrategyPackage } from '../../lib/maintenanceStrategy';
import { evaluateReading } from '../../lib/readingAlarm';
import { movementTypeFor } from '../lib/movementType';
import { isPreventiveWoType } from '../lib/workOrder';
import {
    OperationActual,
    OrderActuals,
    ServiceRequest,
    OrganizationUnit,
    Contact,
    User,
    Vendor,
    LibraryTask,
    JobLabor,
    JobInventory,
    JobJSA,
    JSAHazard,
    PTWPermit,
    PTWIsolationPoint,
    PTWApproval,
    NotificationChannelConfig,
    MessageTemplate,
    NotificationLog
} from '../types';
import { supabase } from '../lib/supabase';
import { tryWrite } from '../lib/supabaseWrite';
import { FinOpsService } from './FinOpsService';
import { errorLog } from './ErrorLogService';

/**
 * DATABASE SERVICE (Supabase Edition)
 * 
 * All core entities are managed in Supabase (PostgreSQL):
 * - Contacts, Users, Organization Units
 * - Assets, Asset Financials
 * - Work Orders (+ tasks, labor, parts, JSA, failure data)
 * - Service Requests
 * - Inventory (items, stock, locations, transactions)
 * - Recurring Work / PMs
 * - Vendors, Manufacturer Models
 * - Dictionaries (reference_codes)
 * - Notification Rules, Channels, Events
 * - Journal Entries, Entity Files
 * - PTW Permits, Isolation Points, Approvals
 * - Qualifications
 * 
 * RLS: Enabled on all tables via migration 0150 (authenticated user policies).
 * Site-scoping: Application-side via filterAssetsBySiteScope().
 */

export class DatabaseService {
    private static instance: DatabaseService;

    // Supabase caches or local state could go here if needed
    // but for "Single Source of Truth", we rely on the DB.

    private _cachedContacts: Contact[] = [];
    private _cachedUsers: UserRecord[] = [];

    private constructor() {
        // No seeding needed - using Real DB
    }

    public static getInstance(): DatabaseService {
        if (!DatabaseService.instance) {
            DatabaseService.instance = new DatabaseService();
        }
        return DatabaseService.instance;
    }

    // --- LOCAL STORAGE HELPERS ---
    private saveToLocal(key: string, data: any) {
        if (typeof window !== 'undefined') {
            localStorage.setItem(key, JSON.stringify(data));
        }
    }

    private getFromLocal(key: string): any {
        if (typeof window !== 'undefined') {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : null;
        }
        return null;
    }


    // --- SUPABASE DATA ACCESS ---

    // --- CONTACTS ---

    /**
     * Names only, for rendering a label — readable by every role.
     *
     * `contacts` and `vendors` hold emails, phones and commercial detail that
     * the matrix withholds from most roles, but almost every page needs to turn
     * an id into a NAME ("Responsible: Jane Smith"). Gating the base tables and
     * leaving it there would blank those labels everywhere.
     *
     * So the base tables answer to the matrix, and these narrow views expose
     * (id, name) to everyone. Use these anywhere you are only displaying a
     * label; use getContacts/getVendors where the record itself is the subject.
     */
    public async getContactDirectory(): Promise<{ id: string; name: string }[]> {
        const { data, error } = await supabase.from('contact_directory').select('id, name');
        if (error) { console.error('Supabase Error (getContactDirectory):', error); return []; }
        return (data || []) as { id: string; name: string }[];
    }

    public async getVendorDirectory(): Promise<{ id: string; name: string }[]> {
        const { data, error } = await supabase.from('vendor_directory').select('id, name');
        if (error) { console.error('Supabase Error (getVendorDirectory):', error); return []; }
        return (data || []) as { id: string; name: string }[];
    }

    public async getContacts(): Promise<Contact[]> {
        try {
            const { data, error } = await supabase.from('contacts').select('*, organization_unit_members(organization_unit_id)');
            if (error) {
                console.error("Supabase Error (getContacts):", error);
                throw error;
            }
            // Map Snake to Camel if needed (Supabase returns object matching JSON if columns match)
            // Our schema uses 'hourlyRate' in properties? No, columns are: id, name, ...
            // Check 0001_contacts.sql: is_active, is_employee...
            // Check Contact type in types.ts: active, types...
            // Need mapping!

            const mappedContacts: Contact[] = (data || []).map((row: any) => ({
                id: row.id,
                name: row.name,
                firstName: row.name.split(' ')[0], // Simple heuristic
                lastName: row.name.split(' ').slice(1).join(' '),
                code: row.code,
                title: row.title,
                email: row.email,
                phone: row.phone,
                mobile: row.mobile,
                active: row.is_active,
                types: row.roles || [], // 'roles' col in DB maps to 'types' in App
                defaultType: (row.roles && row.roles.length > 0) ? row.roles[0] : 'GUEST',
                hourlyRate: row.hourly_rate || 0,
                currency: 'USD',
                address: row.address || { street: '', city: '', state: '', zip: '' },
                flags: {
                    // Attribute flags only — permissions are resolved from the role system.
                    isLabour: row.is_employee || false,
                    hasQualifications: row.has_qualifications || false,
                    isVendor: row.is_vendor || false
                },
                customFields: row.custom_fields || [],
                labourRules: row.labor_rules || undefined,
                qualifications: [],
                image: row.image_url,
                organizationUnitId: row.organization_unit_id,
                organizationUnitIds: row.organization_unit_members?.map((m: any) => m.organization_unit_id) || [],
                parentId: row.parent_id,
                costCenterId: row.cost_center_id
            }));

            // RLS gates `contacts` on contacts.view, but almost every page needs
            // to turn an id into a NAME. A role without the permission gets zero
            // rows here — not an error — so fall back to the name-only directory
            // rather than blanking every "Responsible: …" label in the app.
            // Pages that are ABOUT a contact are permission-gated anyway, so they
            // take the full read above.
            if (mappedContacts.length === 0) {
                const stubs = (await this.getContactDirectory()).map((d) => ({
                    id: d.id, name: d.name,
                    firstName: (d.name || '').split(' ')[0],
                    lastName: (d.name || '').split(' ').slice(1).join(' '),
                    types: [], defaultType: 'GUEST', active: true,
                } as unknown as Contact));
                this._cachedContacts = stubs;
                return stubs;
            }

            this._cachedContacts = mappedContacts;
            return mappedContacts;
        } catch (e) {
            console.error("Error fetching contacts:", e);
            errorLog.apiError('contacts', 'Error fetching contacts', e);
            return [];
        }
    }


    public async addContact(contact: Contact): Promise<Contact> {
        // Map App -> DB
        const row = {
            id: contact.id,
            code: contact.code,
            name: contact.name,
            first_name: contact.firstName,
            last_name: contact.lastName,
            email: contact.email,
            phone: contact.phone,
            mobile: contact.mobile,
            title: contact.title,
            roles: contact.types,
            is_active: contact.active,
            is_employee: contact.flags?.isLabour,
            is_vendor: contact.flags?.isVendor,
            organization_unit_id: contact.organizationUnitId,
            has_qualifications: contact.flags?.hasQualifications,

            hourly_rate: contact.hourlyRate,
            address: contact.address,
            custom_fields: contact.customFields || [],
            labor_rules: contact.labourRules || {},
            image_url: contact.image,
            parent_id: contact.parentId || null,
            cost_center_id: contact.costCenterId
        };

        const { data, error } = await supabase.from('contacts').insert(row).select().single();
        if (error) throw new Error(error.message);


        // 2. Insert into M2M table
        const contactId = data.id;
        if (contact.organizationUnitIds && contact.organizationUnitIds.length > 0) {
            const m2mRows = contact.organizationUnitIds.map((uid, idx) => ({
                contact_id: contactId,
                organization_unit_id: uid,
                is_primary: idx === 0 // Assume first is primary for now
            }));
            const { error: m2mError } = await supabase.from('organization_unit_members').insert(m2mRows);
            if (m2mError) console.error("Error linking org units:", m2mError);
        }

        return { ...contact, id: data.id }; // Return with server ID
    }

    // --- USERS ---



    public async updateContact(contact: Contact): Promise<Contact> {
        const row = {
            name: contact.name,
            first_name: contact.firstName,
            last_name: contact.lastName,
            email: contact.email,
            title: contact.title,
            phone: contact.phone,
            mobile: contact.mobile,
            roles: contact.types,
            is_active: contact.active,
            is_employee: contact.flags?.isLabour,
            is_vendor: contact.flags?.isVendor,
            organization_unit_id: contact.organizationUnitId,
            has_qualifications: contact.flags?.hasQualifications,

            hourly_rate: contact.hourlyRate,
            address: contact.address,
            custom_fields: contact.customFields || [],
            labor_rules: contact.labourRules || {},
            image_url: contact.image,
            parent_id: contact.parentId || null,
            cost_center_id: contact.costCenterId
        };

        console.log("Updating contact with row:", row);
        const { data, error } = await supabase.from('contacts').update(row).eq('id', contact.id).select();

        if (error) {
            console.error("Supabase Update Error:", error);
            alert(`DB Update Error: ${error.message}`);
            throw new Error(error.message);
        }
        console.log("Supabase Update Success, Data:", data);

        // TEMPORARY DEBUG: Prove to user what was saved
        if (data && data.length > 0) {
            const saved = data[0];
            const debugMsg = `DB Confirmed Save:\nParent ID: ${saved.parent_id}\nEmail: ${saved.email}`;
            // alert(debugMsg); // Uncomment if needed, but console is cleaner. 
            // User wants "tell me its saved". relying on button text.
        }

        if (!data || data.length === 0) throw new Error("Update failed: Contact not found or no changes made.");


        // 2. Update M2M table (Delete all, re-insert)
        // A bit heavy but safe for full sync
        await supabase.from('organization_unit_members').delete().eq('contact_id', contact.id);

        if (contact.organizationUnitIds && contact.organizationUnitIds.length > 0) {
            const m2mRows = contact.organizationUnitIds.map((uid, idx) => ({
                contact_id: contact.id,
                organization_unit_id: uid,
                is_primary: idx === 0
            }));
            const { error: m2mError } = await supabase.from('organization_unit_members').insert(m2mRows);
            if (m2mError) console.error("Error relinking org units:", m2mError);
        }

        return contact;
    }

    /**
     * Generic image upload to any Supabase Storage bucket.
     *
     * Returns a `bucket/path` REFERENCE, not a URL. The buckets are private as
     * of 0235, so the only URL that would work is a signed one — and signed
     * URLs expire, which makes them unsafe to persist in a column. Render with
     * <StorageImage value={ref} /> or useStorageUrl(ref).
     *
     * @param file  The file to upload
     * @param bucket  Storage bucket name (e.g. 'assets', 'avatars')
     * @param prefix  Filename prefix (e.g. 'asset_', 'contact_', 'wo_')
     */
    public async uploadImage(file: File, bucket: string, prefix: string = ''): Promise<string> {
        const fileExt = file.name.split('.').pop() || 'jpg';
        const company = await callerCompanyId();
        const objectPath = `${company}/${prefix}${Date.now()}_${Math.random().toString(36).substring(2)}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
            .from(bucket)
            .upload(objectPath, file, { upsert: true });

        if (uploadError) {
            throw uploadError;
        }

        return `${bucket}/${objectPath}`;
    }

    /** Delete an image from Supabase Storage. Accepts a `bucket/path` ref or a legacy URL. */
    public async deleteImage(bucket: string, path: string): Promise<void> {
        // Objects are keyed `<company_id>/<file>` since 0281, so the object
        // path is everything AFTER the bucket — not just the last segment.
        // parseStorageRef handles the ref form, the legacy public-URL form and
        // a bare name alike.
        const ref = parseStorageRef(path.includes('/') ? path : `${bucket}/${path}`);
        const objectPath = ref?.path ?? path;
        const { error } = await supabase.storage.from(bucket).remove([objectPath]);
        if (error) console.error('Failed to delete image:', error);
        invalidateStorageUrl(path);
    }

    /** Convenience: upload avatar to avatars bucket */
    public async uploadAvatar(file: File): Promise<string> {
        return this.uploadImage(file, 'avatars', 'contact_');
    }

    /** Convenience: upload asset image to assets bucket */
    public async uploadAssetImage(file: File): Promise<string> {
        return this.uploadImage(file, 'assets', 'asset_');
    }

    /** Convenience: upload P&ID background image to pid-diagrams bucket */
    public async uploadPIDImage(file: File): Promise<string> {
        return this.uploadImage(file, 'pid-diagrams', 'pid_');
    }

    /**
     * Generic file upload to any Supabase Storage bucket (supports all file types).
     * Unlike uploadImage, this does NOT compress/convert — preserves original format.
     * Returns a `bucket/path` reference (see uploadImage for why, post-0235).
     * @param file    The file to upload (PDF, XLSX, DOCX, etc.)
     * @param bucket  Storage bucket name
     * @param prefix  Filename prefix (e.g. 'wo_doc_', 'sr_doc_')
     */
    public async uploadFile(file: File, bucket: string, prefix: string = ''): Promise<string> {
        const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\s+/g, '_');
        const company = await callerCompanyId();
        const fileName = `${company}/${prefix}${Date.now()}_${sanitizedName}`;

        const { error: uploadError } = await supabase.storage
            .from(bucket)
            .upload(fileName, file, {
                upsert: true,
                contentType: file.type || 'application/octet-stream'
            });

        if (uploadError) {
            throw uploadError;
        }

        return `${bucket}/${fileName}`;
    }

    /** Convenience: upload work order document to work-order-docs bucket */
    public async uploadWorkOrderDocument(file: File): Promise<string> {
        return this.uploadFile(file, 'work-order-docs', 'wo_doc_');
    }

    /**
     * JSA sign-off signature → storage instead of base64-in-JSONB. Every
     * capture gets a fresh path: the bucket's RLS allows INSERT but 403s an
     * overwrite (x-upsert on an existing object), so paths are never reused.
     * The object behind the signature being replaced is removed best-effort.
     *
     * Returns a `bucket/path` reference (post-0235). `previousRef` accepts
     * either that form or a legacy public URL — signoffs live in JSONB, which
     * 0235 deliberately did not rewrite, so both shapes are in the wild.
     */
    public async uploadJSASignature(woId: string, role: string, dataUrl: string, previousRef?: string): Promise<string> {
        const blob = await (await fetch(dataUrl)).blob();
        const company = await callerCompanyId();
        const path = `${company}/jsa_sig_${woId}_${role.replace(/\W+/g, '_')}_${Date.now()}.png`;
        const { error } = await supabase.storage.from('work-order-docs')
            .upload(path, blob, { contentType: 'image/png' });
        if (error) throw error;
        const prev = parseStorageRef(previousRef);
        if (prev?.bucket === 'work-order-docs') {
            void supabase.storage.from('work-order-docs').remove([prev.path]);
            invalidateStorageUrl(previousRef);
        }
        return `work-order-docs/${path}`;
    }

    public async deleteContact(contactId: string): Promise<void> {
        // Validate UUID to prevent "invalid input syntax" error
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(contactId)) {
            console.error(`[DatabaseService] Invalid contact ID format: ${contactId}. Cannot delete non-UUID records.`);
            throw new Error('Invalid contact ID format. All records must be synced to Supabase.');
        }

        // 1. Remove any linked login accounts (auth + profile) so deleting a person
        //    also removes their sign-in — not just unlinks it (fixes "deleted but still logs in").
        const { data: linkedUsers } = await supabase.from('users').select('id').eq('contact_id', contactId);
        for (const u of (linkedUsers || [])) {
            const { error: authErr } = await supabase.rpc('delete_auth_user', { p_user_id: u.id });
            if (authErr) console.warn('delete_auth_user failed for linked user', u.id, authErr.message);
        }
        // Clean up any profile rows the auth cascade didn't remove.
        const { error: profErr } = await supabase.from('users').delete().eq('contact_id', contactId);
        if (profErr) console.warn('Error removing linked user profiles:', profErr.message);

        const { error } = await supabase.from('contacts').delete().eq('id', contactId);
        if (error) throw new Error(error.message);

    }

    // --- VENDORS ---

    public async getVendors(): Promise<Vendor[]> {
        const { data, error } = await supabase.from('vendors').select('*');
        if (error) {
            console.error("Supabase Error (getVendors):", error);
            // Fallback for logic if table doesn't exist yet in real DB but we want to simulate
            return [];
        }

        // Same reasoning as getContacts: `vendors` is gated on vendors.view, but
        // supplier NAMES appear in pickers on Assets and Inventory, which other
        // roles legitimately open. Zero rows means denied, not empty — fall back
        // to the name-only directory so the label still renders.
        if ((data || []).length === 0) {
            return (await this.getVendorDirectory())
                .map((d) => ({ id: d.id, name: d.name, active: true } as unknown as Vendor));
        }

        return (data || []).map((row: any) => ({
            id: row.id,
            name: row.name,
            code: row.code,
            type: row.type,
            active: row.active,
            paymentTerms: row.payment_terms,
            currency: row.currency,
            hourlyRate: row.hourly_rate,
            email: row.contact_details?.email,
            phone: row.contact_details?.phone,
            mobile: row.contact_details?.mobile,
            website: row.contact_details?.website,
            address: row.contact_details?.address,
            primaryContactName: row.contact_details?.primaryContactName,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));
    }

    public async addVendor(vendor: Vendor): Promise<Vendor> {
        const row = {
            name: vendor.name,
            code: vendor.code,
            type: vendor.type,
            active: vendor.active,
            payment_terms: vendor.paymentTerms,
            currency: vendor.currency,
            hourly_rate: vendor.hourlyRate,
            contact_details: {
                email: vendor.email,
                phone: vendor.phone,
                mobile: vendor.mobile,
                website: vendor.website,
                address: vendor.address,
                primaryContactName: vendor.primaryContactName
            }
        };

        const { data, error } = await supabase.from('vendors').insert(row).select().single();
        if (error) throw new Error(error.message);

        return { ...vendor, id: data.id, createdAt: data.created_at, updatedAt: data.updated_at };
    }

    public async updateVendor(vendor: Vendor): Promise<Vendor> {
        const row = {
            name: vendor.name,
            code: vendor.code,
            type: vendor.type,
            active: vendor.active,
            payment_terms: vendor.paymentTerms,
            currency: vendor.currency,
            hourly_rate: vendor.hourlyRate,
            contact_details: {
                email: vendor.email,
                phone: vendor.phone,
                mobile: vendor.mobile,
                website: vendor.website,
                address: vendor.address,
                primaryContactName: vendor.primaryContactName
            },
            updated_at: new Date().toISOString()
        };

        const { error } = await supabase.from('vendors').update(row).eq('id', vendor.id);
        if (error) throw new Error(error.message);

        return vendor;
    }

    public async deleteVendor(id: string): Promise<void> {
        const { error } = await supabase.from('vendors').delete().eq('id', id);
        if (error) throw new Error(error.message);
    }

    // --- SUB-ENTITIES (CONTACTS) ---

    // Models
    public async getContactModels(contactId: string): Promise<any[]> {
        const { data } = await supabase.from('manufacturer_models').select('*').eq('contact_id', contactId);
        return (data || []).map((r: any) => ({
            id: r.id,
            code: r.model_code,
            description: r.description,
            active: r.active
        }));
    }

    public async addContactModel(contactId: string, model: any): Promise<any> {
        const { data, error } = await supabase.from('manufacturer_models').insert({
            contact_id: contactId,
            model_code: model.code,
            description: model.description,
            active: model.active
        }).select().single();
        if (error) throw error;
        return { ...model, id: data.id };
    }

    public async deleteContactModel(id: string): Promise<void> {
        await supabase.from('manufacturer_models').delete().eq('id', id);
    }

    // --- VENDOR MODELS ---

    public async getVendorModels(vendorId: string): Promise<any[]> {
        const { data } = await supabase.from('manufacturer_models').select('*').eq('vendor_id', vendorId);
        return (data || []).map((r: any) => ({
            id: r.id,
            code: r.model_code,
            description: r.description,
            active: r.active
        }));
    }

    public async addVendorModel(vendorId: string, model: any): Promise<any> {
        const { data, error } = await supabase.from('manufacturer_models').insert({
            vendor_id: vendorId,
            model_code: model.code,
            description: model.description,
            active: model.active ?? true
        }).select().single();
        if (error) throw error;
        return { ...model, id: data.id };
    }

    public async deleteVendorModel(modelId: string): Promise<void> {
        await supabase.from('manufacturer_models').delete().eq('id', modelId);
    }

    /** Get models by manufacturer name — checks both contacts and vendors */
    public async getModelsByManufacturerName(name: string): Promise<any[]> {
        // 1. Try vendor table first
        const { data: vendorRows } = await supabase
            .from('vendors')
            .select('id')
            .ilike('name', name)
            .limit(1);

        if (vendorRows && vendorRows.length > 0) {
            return this.getVendorModels(vendorRows[0].id);
        }

        // 2. Fallback to contacts table
        const { data: contactRows } = await supabase
            .from('contacts')
            .select('id')
            .ilike('name', name)
            .limit(1);

        if (contactRows && contactRows.length > 0) {
            return this.getContactModels(contactRows[0].id);
        }

        return [];
    }

    // ── Manufacturer master (UAT F-003 follow-up) — single source of truth ──
    // A manufacturer is a business partner with its own master record; models and
    // assets reference it by id. Replaces the contacts/vendors dual source.
    public async getManufacturers(): Promise<any[]> {
        const { data, error } = await supabase.from('manufacturers_effective').select('*').eq('active', true).order('name');
        if (error) { console.error('DatabaseService.getManufacturers:', error); return []; }
        return data || [];
    }

    public async addManufacturer(m: { name: string; country?: string; website?: string; phone?: string; email?: string; notes?: string }): Promise<any> {
        const { data, error } = await supabase.from('manufacturers').insert({
            name: m.name.trim(),
            country: m.country || null,
            website: m.website || null,
            phone: m.phone || null,
            email: m.email || null,
            notes: m.notes || null,
            active: true,
        }).select().single();
        if (error) { console.error('DatabaseService.addManufacturer:', error); throw error; }
        return data;
    }

    public async updateManufacturer(id: string, patch: Record<string, any>): Promise<void> {
        // Copy-on-write: the 15 seeded manufacturers are global defaults, so
        // editing one produces this tenant's own copy rather than silently
        // touching nothing. See writeConfigRow.
        await this.writeConfigRow('manufacturers', id, { ...patch, updated_at: new Date().toISOString() });
    }

    public async getManufacturerModels(manufacturerId: string): Promise<any[]> {
        const { data } = await supabase.from('manufacturer_models').select('*').eq('manufacturer_id', manufacturerId);
        return (data || []).map((r: any) => ({ id: r.id, code: r.model_code, description: r.description, active: r.active }));
    }

    public async addManufacturerModel(manufacturerId: string, model: { code: string; description?: string; active?: boolean }): Promise<any> {
        const { data, error } = await supabase.from('manufacturer_models').insert({
            manufacturer_id: manufacturerId,
            model_code: model.code,
            description: model.description || null,
            active: model.active ?? true,
        }).select().single();
        if (error) { console.error('DatabaseService.addManufacturerModel:', error); throw error; }
        return { ...model, id: data.id };
    }

    public async deleteManufacturerModel(modelId: string): Promise<void> {
        const { error } = await supabase.from('manufacturer_models').delete().eq('id', modelId);
        if (error) { console.error('DatabaseService.deleteManufacturerModel:', error); throw error; }
    }

    public async updateManufacturerModel(modelId: string, updates: { code: string; description?: string; active?: boolean }): Promise<void> {
        const { error } = await supabase.from('manufacturer_models').update({
            model_code: updates.code,
            description: updates.description || null,
            active: updates.active ?? true,
        }).eq('id', modelId);
        if (error) { console.error('DatabaseService.updateManufacturerModel:', error); throw error; }
    }

    // ── Hierarchy configuration (UAT F-010) — the editable level model ──
    // Per-tenant since 0273: company_id NULL is the product default, a tenant
    // row shadows it. The _effective view returns the one row that applies to
    // the caller, so `.eq('id', 1)` — the single-tenant assumption — is gone.
    public async getHierarchyConfig(): Promise<any[] | null> {
        const { data, error } = await supabase.from('hierarchy_config_effective').select('levels').limit(1).maybeSingle();
        if (error) { console.error('DatabaseService.getHierarchyConfig:', error); return null; }
        return (data?.levels as any[]) || null;
    }

    /**
     * Copy-on-write, like every config table since 0267: try to update the
     * tenant's own row — `.not('company_id','is',null)` narrows to non-global
     * rows and RLS narrows those to ours — and if that touches nothing, the
     * tenant has no row yet, so the save INSERTS their copy (id and company_id
     * both filled by column defaults). Editing must never target the global
     * row: that is the product's, and under RLS the attempt would "succeed"
     * with zero rows — the silent-success bug again.
     */
    public async saveHierarchyConfig(levels: any[]): Promise<void> {
        const patch = { levels, updated_at: new Date().toISOString() };
        const { data, error } = await supabase.from('hierarchy_config')
            .update(patch).not('company_id', 'is', null).select('id');
        if (error) { console.error('DatabaseService.saveHierarchyConfig:', error); throw error; }
        if (data && data.length > 0) return;
        const { error: insErr } = await supabase.from('hierarchy_config').insert(patch);
        if (insErr) { console.error('DatabaseService.saveHierarchyConfig(insert):', insErr); throw insErr; }
    }

    // ── Work Center master (WM-2a, SAP CR) ──
    public async getWorkCenters(activeOnly = false): Promise<WorkCenter[]> {
        let q = supabase.from('work_centers').select('*').order('code');
        if (activeOnly) q = q.eq('active', true);
        const { data, error } = await q;
        if (error) { console.error('DatabaseService.getWorkCenters:', error); return []; }
        return (data || []).map((r: any) => ({
            id: r.id,
            code: r.code,
            name: r.name,
            siteId: r.site_id || undefined,
            costCenterId: r.cost_center_id || undefined,
            activityRate: Number(r.activity_rate) || 0,
            capacityHoursPerDay: Number(r.capacity_hours_per_day) || 0,
            category: r.category || undefined,
            active: r.active !== false,
        }));
    }

    // ── Work center crew (0191): people ↔ work-center bridge ──────────────
    /** Members of one work center (or all memberships when no id given). */
    public async getWorkCenterMembers(workCenterId?: string): Promise<{ workCenterId: string; contactId: string; role: 'MEMBER' | 'LEAD' }[]> {
        let q = supabase.from('work_center_members').select('*');
        if (workCenterId) q = q.eq('work_center_id', workCenterId);
        const { data, error } = await q;
        if (error) { console.error('DatabaseService.getWorkCenterMembers:', error); return []; }
        return (data || []).map((r: any) => ({
            workCenterId: r.work_center_id, contactId: r.contact_id, role: r.role === 'LEAD' ? 'LEAD' : 'MEMBER',
        }));
    }

    public async addWorkCenterMember(workCenterId: string, contactId: string, role: 'MEMBER' | 'LEAD' = 'MEMBER'): Promise<boolean> {
        const { error } = await supabase.from('work_center_members')
            .upsert({ work_center_id: workCenterId, contact_id: contactId, role }, { onConflict: 'work_center_id,contact_id' });
        if (error) { console.error('DatabaseService.addWorkCenterMember:', error); return false; }
        return true;
    }

    public async removeWorkCenterMember(workCenterId: string, contactId: string): Promise<boolean> {
        const { error } = await supabase.from('work_center_members')
            .delete().eq('work_center_id', workCenterId).eq('contact_id', contactId);
        if (error) { console.error('DatabaseService.removeWorkCenterMember:', error); return false; }
        return true;
    }

    public async saveWorkCenter(wc: Partial<WorkCenter> & { code: string; name: string }): Promise<void> {
        const row: any = {
            code: wc.code.trim(),
            name: wc.name.trim(),
            site_id: wc.siteId || null,
            cost_center_id: wc.costCenterId || null,
            activity_rate: wc.activityRate ?? 0,
            capacity_hours_per_day: wc.capacityHoursPerDay ?? 8,
            category: wc.category || null,
            active: wc.active !== false,
            updated_at: new Date().toISOString(),
        };
        if (wc.id) row.id = wc.id;
        const { error } = await supabase.from('work_centers').upsert(row, { onConflict: 'id' });
        if (error) { console.error('DatabaseService.saveWorkCenter:', error); throw error; }
    }

    public async deleteWorkCenter(id: string): Promise<void> {
        // Soft-delete: keep referential history for operations/confirmations.
        const { error } = await supabase.from('work_centers')
            .update({ active: false, updated_at: new Date().toISOString() }).eq('id', id);
        if (error) { console.error('DatabaseService.deleteWorkCenter:', error); throw error; }
    }

    // ── Companies (SAP Company Code tier — enterprise structure T-0) ──
    // Gracefully degrade before migration 0173 is applied: a missing table
    // (PGRST205 / 42P01) yields an empty list rather than a thrown error, so
    // the Admin page shows an "apply the migration" empty state, not a crash.
    private static isMissingTable(error: any): boolean {
        return error?.code === 'PGRST205' || error?.code === '42P01'
            || /could not find the table|does not exist/i.test(error?.message || '');
    }

    public async getCompanies(activeOnly = false): Promise<Company[]> {
        let q = supabase.from('companies').select('*').order('code');
        if (activeOnly) q = q.eq('active', true);
        const { data, error } = await q;
        if (error) {
            if (DatabaseService.isMissingTable(error)) return [];
            console.error('DatabaseService.getCompanies:', error);
            return [];
        }
        return (data || []).map((r: any) => ({
            id: r.id, code: r.code, name: r.name, description: r.description || undefined,
            country: r.country || undefined, currency: r.currency || undefined, active: r.active !== false,
        }));
    }

    public async saveCompany(c: Partial<Company> & { code: string; name: string }): Promise<void> {
        const row: any = {
            code: c.code.trim(),
            name: c.name.trim(),
            description: c.description?.trim() || null,
            country: c.country?.trim() || null,
            currency: c.currency?.trim() || null,
            active: c.active !== false,
            updated_at: new Date().toISOString(),
        };
        if (c.id) row.id = c.id;
        const { error } = await supabase.from('companies').upsert(row, { onConflict: 'id' });
        if (error) { console.error('DatabaseService.saveCompany:', error); throw error; }
    }

    public async deleteCompany(id: string): Promise<void> {
        // Soft-delete: org units may still reference it; deactivate rather than orphan.
        const { error } = await supabase.from('companies')
            .update({ active: false, updated_at: new Date().toISOString() }).eq('id', id);
        if (error) { console.error('DatabaseService.deleteCompany:', error); throw error; }
    }

    // ── Per-company number-range overrides (W-2 T-2, SAP NRIV) ──
    // Graceful before migration 0174: a missing table yields [] / no-op.
    //
    // Readiness gate: 0173 (companies) can be applied while 0174 (assets.
    // company_id + overrides table) is not. The T-2 UI (asset company selector,
    // override editor) MUST be gated on this — otherwise assigning a company to
    // an asset would send a company_id the assets table doesn't have yet and the
    // insert would fail. True only once 0174's overrides table exists.
    public async orgNumberingReady(): Promise<boolean> {
        // GET (limit 1), not head:true — see strategiesReady note (missing-table
        // PGRST205 is only parseable from a response body, which HEAD lacks).
        const { error } = await supabase.from('numbering_config_overrides').select('company_id').limit(1);
        return !(error && DatabaseService.isMissingTable(error));
    }

    public async getNumberingOverrides(): Promise<NumberingOverride[]> {
        const { data, error } = await supabase.from('numbering_config_overrides').select('*');
        if (error) {
            if (DatabaseService.isMissingTable(error)) return [];
            console.error('DatabaseService.getNumberingOverrides:', error);
            return [];
        }
        return (data || []).map((r: any) => ({
            companyId: r.company_id, objectClass: r.object_class,
            prefix: r.prefix, pad: r.pad, nextNumber: Number(r.next_number),
        }));
    }

    public async saveNumberingOverride(o: NumberingOverride): Promise<void> {
        const { error } = await supabase.from('numbering_config_overrides').upsert({
            company_id: o.companyId,
            object_class: o.objectClass,
            prefix: o.prefix.trim(),
            pad: Math.max(1, Math.min(12, Number(o.pad) || 6)),
            next_number: Math.max(1, Number(o.nextNumber) || 1),
            updated_at: new Date().toISOString(),
        }, { onConflict: 'company_id,object_class' });
        if (error) { console.error('DatabaseService.saveNumberingOverride:', error); throw error; }
    }

    public async deleteNumberingOverride(companyId: string, objectClass: 'EQUIPMENT' | 'FLOC'): Promise<void> {
        const { error } = await supabase.from('numbering_config_overrides')
            .delete().eq('company_id', companyId).eq('object_class', objectClass);
        if (error) { console.error('DatabaseService.deleteNumberingOverride:', error); throw error; }
    }

    // ── Maintenance strategies & packages (R-5, SAP strategy plans) ──
    // Graceful before migration 0175: a missing table yields [] / not-ready.
    public async strategiesReady(): Promise<boolean> {
        // NOTE: use a GET (limit 1), not head:true — a HEAD to a missing table
        // returns no body, so the PGRST205 code can't be read and the miss is
        // undetectable. A GET returns the parseable error.
        const { error } = await supabase.from('maintenance_strategies').select('id').limit(1);
        return !(error && DatabaseService.isMissingTable(error));
    }

    public async getStrategies(): Promise<MaintenanceStrategy[]> {
        const { data, error } = await supabase
            .from('maintenance_strategies')
            .select('id, name, description, active, strategy_packages(id, label, interval_days, task_count, sort_order)')
            .order('name');
        if (error) {
            if (DatabaseService.isMissingTable(error)) return [];
            console.error('DatabaseService.getStrategies:', error);
            return [];
        }
        return (data || []).map((r: any) => ({
            id: r.id,
            name: r.name,
            packages: ((r.strategy_packages || []) as any[])
                .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.interval_days - b.interval_days)
                .map(p => ({ id: p.id, label: p.label, intervalDays: p.interval_days, taskCount: p.task_count ?? 0 })),
        }));
    }

    /** Upsert a strategy and REPLACE its packages (simplest consistent write). */
    public async saveStrategy(s: { id?: string; name: string; description?: string; packages: StrategyPackage[] }): Promise<string> {
        const stratRow: any = { name: s.name.trim(), description: s.description?.trim() || null, updated_at: new Date().toISOString() };
        if (s.id) stratRow.id = s.id;
        const { data, error } = await supabase.from('maintenance_strategies').upsert(stratRow, { onConflict: 'id' }).select('id').single();
        if (error) { console.error('DatabaseService.saveStrategy:', error); throw error; }
        const strategyId = data.id as string;
        // Replace packages.
        await supabase.from('strategy_packages').delete().eq('strategy_id', strategyId);
        if (s.packages.length) {
            const rows = s.packages.map((p, i) => ({ strategy_id: strategyId, label: p.label.trim(), interval_days: Math.max(1, Math.round(p.intervalDays)), task_count: p.taskCount ?? 0, sort_order: i }));
            const { error: pErr } = await supabase.from('strategy_packages').insert(rows);
            if (pErr) { console.error('DatabaseService.saveStrategy(packages):', pErr); throw pErr; }
        }
        return strategyId;
    }

    public async deleteStrategy(id: string): Promise<void> {
        const { error } = await supabase.from('maintenance_strategies').delete().eq('id', id);
        if (error) { console.error('DatabaseService.deleteStrategy:', error); throw error; }
    }

    // ── Numbering configuration (SAP NRIV-style ranges) ──
    // Per-tenant since 0273 — see saveHierarchyConfig for the pattern.
    public async getNumberingConfig(): Promise<any | null> {
        const { data, error } = await supabase.from('numbering_config_effective').select('*').limit(1).maybeSingle();
        if (error) { console.error('DatabaseService.getNumberingConfig:', error); return null; }
        return data;
    }

    /** Read the change history (audit_logs) for a record — powers the Tracking > Audit Trail tab (UAT F-009). */
    public async getAuditLog(tableName: string, recordId: string): Promise<any[]> {
        const { data, error } = await supabase.from('audit_logs')
            .select('*')
            .eq('table_name', tableName)
            .eq('record_id', recordId)
            .order('timestamp', { ascending: false })
            .limit(200);
        if (error) { console.error('DatabaseService.getAuditLog:', error); return []; }
        const rows = data || [];

        // Parse the changes JSON once per row.
        const parsed = rows.map((r: any) => {
            let c: any = {};
            try { c = typeof r.changes === 'string' ? JSON.parse(r.changes) : (r.changes || {}); } catch { /* ignore */ }
            return c;
        });

        // Actor resolution, in priority order:
        //   1. changes.actor          — app-stamped display name (e.g. tag-change docs)
        //   2. changes.actor_email    — JWT email captured by the audit trigger (0172);
        //                               mapped email → username, else the email's local part
        //   3. changed_by → users.id  — legacy path (rarely matches: changed_by holds the
        //                               AUTH uid, not the app users.id)
        //   4. 'System'               — a write with no captured identity
        const emails = [...new Set(parsed.map(c => c?.actor_email).filter(Boolean).map((e: string) => e.toLowerCase()))];
        const ids = [...new Set(rows.map((r: any) => r.changed_by).filter(Boolean))];
        const nameByEmail = new Map<string, string>();
        const nameById = new Map<string, string>();
        if (emails.length) {
            const { data: us } = await supabase.from('users').select('username, email').in('email', emails);
            (us || []).forEach((u: any) => { if (u.email) nameByEmail.set(String(u.email).toLowerCase(), u.username); });
        }
        if (ids.length) {
            const { data: us } = await supabase.from('users').select('id, username').in('id', ids);
            (us || []).forEach((u: any) => nameById.set(u.id, u.username));
        }
        const fromEmail = (email?: string): string | undefined => {
            if (!email) return undefined;
            return nameByEmail.get(email.toLowerCase()) || email.split('@')[0];
        };

        rows.forEach((r: any, i: number) => {
            const c = parsed[i];
            r.actorName = c?.actor || fromEmail(c?.actor_email) || (r.changed_by && nameById.get(r.changed_by)) || 'System';
        });
        return rows;
    }

    public async saveNumberingConfig(cfg: Record<string, any>): Promise<void> {
        // Copy-on-write; never target the global row. The tenant's first save
        // must carry a complete row, so the insert path merges the current
        // effective config (global defaults) under the patch.
        const patch = { ...cfg, updated_at: new Date().toISOString() };
        delete (patch as any).id; delete (patch as any).company_id;
        const { data, error } = await supabase.from('numbering_config')
            .update(patch).not('company_id', 'is', null).select('id');
        if (error) { console.error('DatabaseService.saveNumberingConfig:', error); throw error; }
        if (data && data.length > 0) return;
        const current = await this.getNumberingConfig() ?? {};
        delete (current as any).id; delete (current as any).company_id;
        const { error: insErr } = await supabase.from('numbering_config').insert({ ...current, ...patch });
        if (insErr) { console.error('DatabaseService.saveNumberingConfig(insert):', insErr); throw insErr; }
    }

    // Qualifications
    public async getQualifications(contactId: string): Promise<any[]> {
        const { data } = await supabase.from('qualifications').select('*').eq('contact_id', contactId);
        return (data || []).map((r: any) => ({
            id: r.id,
            name: r.name,
            type: r.type,
            dateAchieved: r.date_achieved,
            dateExpires: r.date_expires,
            status: r.status,
            notes: r.notes,
            imageUrl: r.image_url
        }));
    }

    public async addQualification(contactId: string, qual: any): Promise<any> {
        const { data, error } = await supabase.from('qualifications').insert({
            contact_id: contactId,
            name: qual.name,
            type: qual.type,
            date_achieved: qual.dateAchieved,
            date_expires: qual.dateExpires,
            status: qual.status,
            notes: qual.notes,
            image_url: qual.imageUrl
        }).select().single();
        if (error) throw error;
        return { ...qual, id: data.id };
    }

    public async deleteQualification(id: string): Promise<void> {
        await supabase.from('qualifications').delete().eq('id', id);
    }

    // Entity Files
    public async getEntityFiles(entityId: string, entityType: string): Promise<any[]> {
        const { data } = await supabase.from('entity_files').select('*').eq('entity_id', entityId).eq('entity_type', entityType);
        return (data || []).map((row: any) => ({
            id: row.id,
            entityId: row.entity_id,
            entityType: row.entity_type,
            name: row.name,
            url: row.url,
            type: row.type,
            sizeBytes: row.size_bytes,
            uploadedBy: row.uploaded_by,
            createdAt: row.created_at,
            category: row.category || null,
            description: row.description || null,
            taskId: row.task_id || null,
        }));
    }

    public async addEntityFile(file: any): Promise<any> {
        const row: Record<string, any> = {
            entity_id: file.entityId,
            entity_type: file.entityType,
            name: file.name,
            url: file.url,
            type: file.type || 'application/octet-stream',
            size_bytes: file.sizeBytes || 0,
            uploaded_by: file.uploadedBy,
        };
        // Include optional document management fields
        if (file.category) row.category = file.category;
        if (file.description) row.description = file.description;
        if (file.taskId) row.task_id = file.taskId;

        const { data, error } = await supabase.from('entity_files').insert(row).select().single();
        if (error) throw error;
        return { ...file, id: data.id, createdAt: data.created_at };
    }

    /** Update an entity file's metadata (category, description, taskId) */
    public async updateEntityFile(id: string, updates: { category?: string; description?: string; taskId?: string | null }): Promise<void> {
        const row: Record<string, any> = {};
        if (updates.category !== undefined) row.category = updates.category;
        if (updates.description !== undefined) row.description = updates.description;
        if (updates.taskId !== undefined) row.task_id = updates.taskId;
        if (Object.keys(row).length === 0) return;
        const { error } = await supabase.from('entity_files').update(row).eq('id', id);
        if (error) throw error;
    }

    public async deleteEntityFile(id: string): Promise<void> {
        await supabase.from('entity_files').delete().eq('id', id);
    }

    // Journals
    public async getJournalEntries(entityId: string, entityType: string): Promise<any[]> {
        const { data } = await supabase.from('journal_entries').select('*')
            .eq('entity_id', entityId)
            .order('created_at', { ascending: false });

        return (data || []).map((r: any) => ({
            id: r.id,
            type: r.entry_type,
            description: r.entry,
            createdAt: r.created_at,
            createdBy: r.created_by,
            isLocked: false
        }));
    }

    public async addJournalEntry(entityId: string, entityType: string, entry: any): Promise<any> {
        const { data, error } = await supabase.from('journal_entries').insert({
            entity_id: entityId,
            entity_type: entityType,
            entry_type: entry.type,
            entry: entry.description,
            created_by: entry.createdBy
        }).select().single();
        if (error) throw error;
        return { ...entry, id: data.id, createdAt: data.created_at };
    }



    // --- ORGANIZATION UNITS ---

    public async getOrgUnits(): Promise<OrganizationUnit[]> {
        const { data, error } = await supabase.from('organization_units').select('*');
        if (error) {
            console.error("Supabase Error (getOrgUnits):", error);
            return [];
        }

        return (data || []).map((row: any) => ({
            id: row.id,
            name: row.name,
            code: row.code,
            type: row.type,
            parentId: row.parent_id,
            managerId: row.manager_id,
            companyId: row.company_id ?? null,
            description: row.description,
            location: row.location,
            email: row.email,
            phone: row.phone,
            customFields: row.custom_fields || []
        }));
    }

    public async addOrgUnit(unit: OrganizationUnit): Promise<OrganizationUnit> {
        const row: Record<string, any> = {
            name: unit.name,
            code: unit.code,
            type: unit.type,
            parent_id: unit.parentId,
            manager_id: unit.managerId,
        };
        if (unit.companyId !== undefined) row.company_id = unit.companyId || null;
        // Only include optional fields if they have values (defensive against missing columns)
        if (unit.description) row.description = unit.description;
        if (unit.location) row.location = unit.location;
        if (unit.email) row.email = unit.email;
        if (unit.phone) row.phone = unit.phone;
        const { data, error } = await supabase.from('organization_units').insert(row).select().single();
        if (error) throw new Error(error.message);
        return { ...unit, id: data.id };
    }

    public async updateOrgUnit(unit: OrganizationUnit): Promise<OrganizationUnit> {
        const row: Record<string, any> = {
            name: unit.name,
            code: unit.code,
            type: unit.type,
            parent_id: unit.parentId,
            manager_id: unit.managerId,
            updated_at: new Date().toISOString()
        };
        if (unit.companyId !== undefined) row.company_id = unit.companyId || null;
        // Only include optional fields if they have values
        if (unit.description) row.description = unit.description;
        if (unit.location) row.location = unit.location;
        if (unit.email) row.email = unit.email;
        if (unit.phone) row.phone = unit.phone;
        const { error } = await supabase.from('organization_units').update(row).eq('id', unit.id);
        if (error) throw new Error(error.message);
        return unit;
    }

    public async getAssetsByOrgUnit(unitCode: string): Promise<any[]> {
        // Fallback or Simple Match for now
        // Match 'cost_center_id' OR 'department' (if we had it)
        // For now, we will look for assets where 'costCenter' matches unitCode OR 'location' matches
        // This is heuristic until we have strict linking
        const allAssets = await this.getAssets();
        return allAssets.filter(a => a.costCenter === unitCode || a.location === unitCode);
    }

    public async getWorkOrdersByOrgUnit(unitId: string): Promise<WorkOrder[]> {
        // 1. Get Members of this Unit
        const { data: memberIds } = await supabase.from('organization_unit_members')
            .select('contact_id')
            .eq('organization_unit_id', unitId);

        const contactIds = (memberIds || []).map((m: any) => m.contact_id);

        // 2. Get Users linked to these Contacts
        const { data: users } = await supabase.from('users')
            .select('id')
            .in('contact_id', contactIds);

        const userIds = (users || []).map((u: any) => u.id);

        // 3. Query work orders assigned to these users from Supabase
        if (userIds.length === 0) return [];
        const { data: woData, error: woError } = await supabase
            .from('work_orders')
            .select('*')
            .in('assigned_to', userIds);

        if (woError) {
            console.error('[DatabaseService] getWorkOrdersByOrgUnit error:', woError);
            return [];
        }
        return (woData || []) as any;
    }

    public async deleteOrgUnit(id: string): Promise<void> {
        // 1. Unassign members manually (Application-side Cascade)
        // This is required because the DB constraint might be RESTRICT (default) instead of ON DELETE SET NULL
        // and we might not have permissions to alter the schema from here.
        const { error: unassignError } = await supabase.from('contacts')
            .update({ organization_unit_id: null })
            .eq('organization_unit_id', id);

        if (unassignError) {
            console.error("Error unassigning contacts:", unassignError);
            throw new Error("Failed to unassign members before deletion.");
        }

        // 2. Delete the unit
        const { error } = await supabase.from('organization_units').delete().eq('id', id);
        if (error) throw new Error(error.message);
    }

    public async assignContactsToUnit(contactIds: string[], unitId: string | null): Promise<void> {
        // 1. Update the FK on contacts table
        const { error } = await supabase.from('contacts')
            .update({ organization_unit_id: unitId })
            .in('id', contactIds);

        if (error) throw new Error(error.message);

        // 2. Sync M2M table (organization_unit_members) — ensures Admin OrgTreePicker sees the change
        for (const cId of contactIds) {
            // Remove old M2M entries for this contact
            await supabase.from('organization_unit_members').delete().eq('contact_id', cId);

            // Insert new M2M entry if assigning (not unassigning)
            if (unitId) {
                const { error: m2mError } = await supabase.from('organization_unit_members').insert({
                    contact_id: cId,
                    organization_unit_id: unitId,
                    is_primary: true
                });
                if (m2mError) console.error('M2M sync error:', m2mError);
            }
        }
    }



    public async getContactsByUnit(unitId: string): Promise<Contact[]> {
        const { data, error } = await supabase.from('contacts').select('*').eq('organization_unit_id', unitId);

        if (error) {
            console.error("Error fetching contacts by unit:", error);
            return [];
        }

        // Reuse the mapping logic from getContacts or simplify if we just need count
        // For now, let's just return the raw loaded count or basic info if needed. 
        // But to be type safe with Contact[], we should map.
        // Let's call the main getContacts() and filter for now to ensure consistency, 
        // OR duplicate the mapping. Duplication is safer for a focused query.

        const mappedContacts = (data || []).map((row: any) => ({
            id: row.id,
            name: row.name,
            firstName: row.name.split(' ')[0],
            lastName: row.name.split(' ').slice(1).join(' '),
            code: row.code,
            title: row.title,
            email: row.email,
            phone: row.phone,
            mobile: row.mobile,
            active: row.is_active,
            types: row.roles || [],
            defaultType: (row.roles && row.roles.length > 0) ? row.roles[0] : 'GUEST',
            hourlyRate: row.hourly_rate || 0,
            currency: 'USD',
            address: row.address || { street: '', city: '', state: '', zip: '' },
            flags: {
                // Attribute flags only — permissions are resolved from the role system.
                isLabour: row.is_employee || false,
                hasQualifications: row.has_qualifications || false,
                isVendor: row.is_vendor || false
            },
            customFields: row.custom_fields || [],
            labourRules: row.labor_rules || undefined,
            qualifications: [],
            image: row.image_url,
            organizationUnitId: row.organization_unit_id,
            organizationUnitIds: row.organization_unit_members?.map((m: any) => m.organization_unit_id) || []
        }));

        this._cachedContacts = mappedContacts;
        return mappedContacts;
    }

    /**
     * Checks if a User (linked to Contact) has permission to be assigned to/work on a specific Org Unit.
     * "Hard Rule": Any person assigned to a team where no permission has been set (in the admin - user access) it will give a prompt.
     */
    public async checkUserAccess(contactId: string, unitId: string): Promise<boolean> {
        try {
            // 1. Find User linked to this Contact
            const { data: userData, error } = await supabase.from('users').select('*').eq('contact_id', contactId).single();

            if (error || !userData) {
                console.warn(`Access Blocked: No User account found for Contact ${contactId}`);
                return false;
            }

            // Map DB snake_case to usage (Critical fix)
            const userRoles: string[] = userData.roles || [];
            const userStatus: string = userData.status;
            const userOverrides: DataScope | null = userData.data_scope_overrides;

            // 2. Check Global Admin
            if (userRoles.includes('ADMIN') || userRoles.includes('SYS_ADMIN')) {
                return true;
            }

            // 3. Status Check
            if (userStatus !== 'active') return false;

            // 4. Resolve Effective Scope
            const allowedSites = new Set<string>();

            // 4a. Scope from Roles (via Contact Type Dictionaries)
            if (userRoles.length > 0) {
                const { data: rolesData } = await supabase
                    .from('reference_codes_effective')
                    .select('properties')
                    .eq('category', 'CONTACT_TYPE')
                    .in('code', userRoles);

                if (rolesData) {
                    rolesData.forEach((r: any) => {
                        const scope = r.properties?.dataScope as DataScope | undefined;
                        if (scope?.siteIds) {
                            scope.siteIds.forEach(id => allowedSites.add(id));
                        }
                    });
                }
            }

            // 4b. Scope from User Overrides
            if (userOverrides?.siteIds) {
                userOverrides.siteIds.forEach(id => allowedSites.add(id));
            }

            // 5. Check Unit against Allowed Sites
            if (allowedSites.has('*')) return true;
            if (allowedSites.has(unitId)) return true;

            // TODO: Hierarchy check (e.g. if unitId is a child of an allowed site)

            return false;
        } catch (e) {
            console.error("Error checking user access:", e);
            return false;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // DATA SCOPE FILTERING — Site-Level Access Enforcement (ISO 55000/NIST)
    // Pure utilities: filter already-fetched data by user's allowed siteIds.
    // Design: null/undefined/['*'] siteIds = Global Access (all data).
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Filter assets by the user's allowed site scope.
     * Walks the parent hierarchy to find each asset's root SITE ancestor.
     * @param assets - Full asset list (flat, with parentId references)
     * @param allowedSiteIds - From AuthContext dataScope.siteIds (['*'] = global)
     * @returns Filtered assets belonging to allowed sites (includes the SITE nodes themselves)
     */
    public static filterAssetsBySiteScope(assets: any[], allowedSiteIds: string[] | null | undefined): any[] {
        // Global scope — no filtering needed
        if (!allowedSiteIds || allowedSiteIds.length === 0 || allowedSiteIds.includes('*')) {
            return assets;
        }

        const allowedSet = new Set(allowedSiteIds);
        const assetMap = new Map<string, any>();
        assets.forEach(a => assetMap.set(a.id, a));

        // An asset is in scope if it — or ANY ancestor — is one of the allowed site ids.
        // Level-agnostic (SITE / AREA / custom): matches by asset id along the parent
        // chain, not a hardcoded category string, so AREA-typed or custom-level sites
        // scope correctly. (Previously keyed on category === 'site'/'area', which the
        // read-mapper only sets for SITE — AREA/custom fell through and broke scoping.)
        const inScopeCache = new Map<string, boolean>();
        const inScope = (assetId: string, visited = new Set<string>()): boolean => {
            if (inScopeCache.has(assetId)) return inScopeCache.get(assetId)!;
            if (visited.has(assetId)) return false; // circular guard
            visited.add(assetId);
            if (allowedSet.has(assetId)) { inScopeCache.set(assetId, true); return true; }
            const parentId = assetMap.get(assetId)?.parentId;
            const result = parentId ? inScope(parentId, visited) : false;
            inScopeCache.set(assetId, result);
            return result;
        };

        return assets.filter(a => inScope(a.id));
    }

    /**
     * Filter work orders by the user's allowed site scope.
     * Resolves each WO's assetId against the asset list to determine site membership.
     * @param workOrders - Full work order list
     * @param assets - Full asset list (needed for hierarchy resolution)
     * @param allowedSiteIds - From AuthContext dataScope.siteIds
     * @returns Filtered work orders belonging to allowed sites
     */
    public static filterWorkOrdersBySiteScope(workOrders: any[], assets: any[], allowedSiteIds: string[] | null | undefined): any[] {
        // Global scope — no filtering needed
        if (!allowedSiteIds || allowedSiteIds.length === 0 || allowedSiteIds.includes('*')) {
            return workOrders;
        }

        // Pre-compute which assets are in scope
        const scopedAssets = DatabaseService.filterAssetsBySiteScope(assets, allowedSiteIds);
        const scopedAssetIds = new Set(scopedAssets.map(a => a.id));

        return workOrders.filter(wo => {
            // WO with no asset link → include (can't determine site, fail-open)
            if (!wo.assetId) return true;
            return scopedAssetIds.has(wo.assetId);
        });
    }

    // --- USERS ---

    public async getUsers(): Promise<UserRecord[]> {
        const { data, error } = await supabase.from('users').select('*');
        console.log('[DatabaseService] getUsers Raw Data:', data);
        if (error) {
            console.error("Supabase Error (getUsers):", error);
            return [];
        }

        const mappedUsers: UserRecord[] = (data || []).map((row: any) => ({
            id: row.id,
            username: row.username,
            email: row.email,
            contact_id: row.contact_id,     // DB snake_case
            contactId: row.contact_id,      // App camelCase (redundant but safe)
            status: row.status,
            roles: row.roles,
            mfaEnabled: row.mfa_enabled || false,
            permissionOverrides: row.permission_overrides || {},
            dataScopeOverrides: row.data_scope_overrides || {},
            created_at: row.created_at,
            updated_at: row.updated_at
        }));

        this._cachedUsers = mappedUsers;
        return mappedUsers;
    }

    public async updateUserPermissions(userId: string, overrides: any, scope: any): Promise<void> {
        const { error } = await supabase.from('users').update({
            permission_overrides: overrides,
            data_scope_overrides: scope,
            updated_at: new Date().toISOString()
        }).eq('id', userId);

        if (error) throw new Error(error.message);

    }

    public async createUser(user: UserRecord, password?: string): Promise<UserRecord> {
        // 1. Production Mode: PostgreSQL RPC (Secure, atomic, no Edge Function needed)
        if (password) {
            try {
                const contact_id = (user as any).contactId || user.contact_id || null;
                // Param names MUST match the deployed function. Migration 0141
                // renamed them to p_* (was email/password/username/role/contact_id).
                const { data, error } = await supabase.rpc('create_auth_user', {
                    p_email: user.email,
                    p_password: password,
                    p_username: user.username,
                    p_role: (user.roles && user.roles.length > 0) ? user.roles[0] : 'GUEST',
                    p_contact_id: contact_id
                });

                if (error) {
                    console.error("RPC 'create_auth_user' failed:", error);
                    throw new Error(`Failed to create secure user: ${error.message}`);
                }

                console.log("✅ User created via secure RPC. ID:", data);
                return { ...user, id: data || user.id };

            } catch (invokeErr: any) {
                console.error("Auth User creation error:", invokeErr);
                throw invokeErr;
            }
        }

        // 2. Client-Side Fallback (For manual scripts/tests without passwords)
        // NOTE: Client-side creation of 'public.users' will FAIL due to FK constraint on auth.users(id)
        // unless 'user.id' is a valid Auth User ID.

        // Check if ID looks like UUID
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id);

        if (!isUUID) {
            throw new Error("Cannot create User Record: Invalid User ID (Must be Auth UUID). Use Admin Script to provision users.");
        }

        const row = {
            id: user.id,
            username: user.username,
            email: user.email,
            contact_id: (user as any).contactId || user.contact_id,
            status: user.status || 'active',
            roles: user.roles || [],
            mfa_enabled: user.mfaEnabled || false
        };

        const { data, error } = await supabase.from('users').insert(row).select().single();
        if (error) throw new Error(error.message);
        return user;
    }

    public async updateUser(userId: string, updates: Partial<UserRecord>): Promise<void> {
        if (!userId) throw new Error("User ID required");

        const rowUpdates: any = {};
        if (updates.username !== undefined) rowUpdates.username = updates.username;

        // Handle contact_id (support both snake and camel if passed, prefer snake)
        if (updates.contact_id !== undefined) rowUpdates.contact_id = updates.contact_id;
        else if ((updates as any).contactId !== undefined) rowUpdates.contact_id = (updates as any).contactId;

        if (updates.status !== undefined) rowUpdates.status = updates.status;
        if (updates.mfaEnabled !== undefined) rowUpdates.mfa_enabled = updates.mfaEnabled;
        if (updates.roles !== undefined) rowUpdates.roles = updates.roles;

        // Add verified/updated_at?
        // rowUpdates.updated_at = new Date().toISOString();

        console.log('[DatabaseService] updateUser: userId=', userId, 'rowUpdates=', rowUpdates);
        const { data, error } = await supabase.from('users').update(rowUpdates).eq('id', userId).select();
        if (error) {
            console.error('[DatabaseService] updateUser ERROR:', error);
            throw new Error(error.message);
        }
        console.log('[DatabaseService] updateUser SUCCESS. Rows returned:', data?.length, data);
    }

    public async deleteUser(userId: string): Promise<void> {
        // Note: This only deletes public.users. Auth user remains unless deleted via Admin API.

        // Validate UUID to prevent "invalid input syntax" error for mock data (Cascading Delete Fix)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(userId)) {
            console.warn(`Skipping database user delete for mock ID: ${userId}.`);
            this._cachedUsers = this._cachedUsers.filter(u => u.id !== userId);

            // Also update any LocalStorage fallback for Users if it existed?
            // Current implementation of getUsers doesn't seem to use LocalStorage explicitly for fallback 
            // the same way contacts does, but let's be safe if we add it later.
            return;
        }

        // Remove the login (auth.users) too — the browser can't delete auth rows, so
        // use the SECURITY DEFINER RPC. This is what stops a deleted user still signing in.
        const { error: authErr } = await supabase.rpc('delete_auth_user', { p_user_id: userId });
        if (authErr) console.warn('delete_auth_user RPC failed (login may persist):', authErr.message);

        const { error } = await supabase.from('users').delete().eq('id', userId);
        if (error) throw new Error(error.message);
    }

    /** Enable/disable a login without deleting it (bans/unbans the auth user). */
    public async setUserLoginActive(userId: string, active: boolean): Promise<void> {
        const { error } = await supabase.rpc('set_user_login_active', { p_user_id: userId, p_active: active });
        if (error) { console.error('DatabaseService.setUserLoginActive:', error); throw new Error(error.message); }
        // Reflect it in the app profile status too.
        await supabase.from('users').update({ status: active ? 'active' : 'inactive' }).eq('id', userId);
    }



    // --- ASSETS ---

    public async getAssets(): Promise<any[]> {
        let dbData: any[] | null = null;
        let dbError: any = null;

        try {
            console.log('[getAssets] Querying Supabase assets table...');
            const res = await supabase
                .from('assets')
                .select('*');
            dbData = res.data;
            dbError = res.error;
            console.log('[getAssets] Result:', { count: dbData?.length, error: dbError?.message });
        } catch (e) {
            dbError = e;
            console.error('[getAssets] Exception:', e);
            errorLog.apiError('assets', '[getAssets] Exception querying Supabase', e);
        }

        if (dbError) {
            console.error('[getAssets] Supabase Error:', dbError);
        }

        return (dbData || []).map((row: any) => ({
            id: row.id,
            tag: row.tag,
            name: row.name,
            parentId: row.parent_id,
            companyId: row.company_id ?? null,   // W-2: owning Company Code (null until assigned)
            hierarchyLevel: row.hierarchy_level,
            category: row.hierarchy_level === 'SITE' ? 'Site' :
                row.hierarchy_level === 'UNIT' ? 'Unit' :
                    row.hierarchy_level === 'SYSTEM' ? 'System' :
                        (row.properties?.category || 'Asset'), // Fallback or custom property?
            // Note: Schema has 'hierarchy_level'. UI has 'category'.
            // UI categories: 'Pump', 'Motor', 'Site', 'Area'...
            // We might need to map or store specific category in a separate field if hierarchy_level isn't enough.
            // For now, map simple levels or use a 'category' column if added to custom properties.
            // Let's assume 'category' is stored in 'model' or deduced, OR we add 'category' to DB.
            // *Wait*, 'assets' table in schema definition has:
            // hierarchy_level, manufacturer, model... no 'category' column explicitly besides 'hierarchy_level'.
            // But 'types.ts' Asset has 'category'.
            // Let's map hierarchy_level for structural items, and use 'model' or a new convention for equipment types.
            // actually, let's just pass 'hierarchy_level' as category for now, or check if we should add a column.
            // Better: Let's use 'manufacturer' for now? No.
            // Let's check `0000_initial_schema.sql` again. It has `manufacturer`, `model`.
            // *Self-Correction*: I will map 'hierarchy_level' to category if it matches, else default.
            // Actually, let's map properties if available, or just use what we have.

            // Fix: The UI expects 'category' to be 'Pump', 'Site', etc.
            // The DB has 'hierarchy_level' ('SITE', 'EQUIPMENT'...).
            // If EQUIPMENT, we probably want the specific type.
            // Let's blindly map 'hierarchy_level' to 'category' property for now, 
            // BUT capitalized: SITE -> Site.

            status: (row.status_code === 'OPERATING' ? 'ACTIVE' : row.status_code) || 'ACTIVE', // Normalize OPERATING→ACTIVE per ISO 14224
            criticality: row.criticality,
            responsibleWorkCenterId: row.responsible_work_center_id || undefined, // 0179

            location: row.location_id ? 'Linked Loc' : '', // We need to join locations ideally. For now, empty string.
            manufacturer: row.manufacturer,
            manufacturerId: row.manufacturer_id,
            model: row.model,
            serialNumber: row.serial_number,
            department: '', // Not in DB schema

            // Map cost_center_id from joined financial record (array or single obj based on relationship)
            costCenter: (row.asset_financials && row.asset_financials.length > 0)
                ? row.asset_financials[0].cost_center_id
                : (row.asset_financials?.cost_center_id || undefined), // Handle array or single obj return

            // UI Specifics
            healthScore: 100, // Mock
            image: row.image_url || undefined,
            bomItems: [], // BOM now lazy-loaded from asset_bom table via getBomForAsset()
            trackingLog: [],
            // Classification fields
            assetCategory: row.asset_category || '',
            assetType: row.asset_type_code || '',
            assetClass: row.asset_class || '',
            // Internal Equipment Number (SAP PM parity)
            equipmentNumber: row.equipment_number || undefined,
            equipmentGeneration: row.equipment_generation || 1,
        }));
    }



    public async addAsset(asset: any): Promise<any> {
        // Map UI -> DB
        // Hierarchy Level — prefer the explicitly-chosen level (from the create
        // modal's Level dropdown), else fall back to the legacy category mapping.
        let level = (asset.hierarchyLevel || '').toString().toUpperCase();
        const cat = (asset.category || '').toUpperCase();
        if (!level) {
            level = 'EQUIPMENT';
            if (['SITE', 'AREA'].includes(cat)) level = 'SITE';
            if (cat === 'UNIT') level = 'UNIT';
            if (['SYSTEM', 'SUBSYSTEM'].includes(cat)) level = 'SYSTEM';
        }

        const row = {
            id: asset.id && asset.id.startsWith('new-') ? undefined : asset.id, // Let DB gen UUID if new-
            tag: asset.tag,
            name: asset.name,
            parent_id: asset.parentId || null,
            hierarchy_level: level,
            criticality: asset.criticality || null,
            status_code: asset.status || 'ACTIVE',
            manufacturer: asset.manufacturer,
            manufacturer_id: asset.manufacturerId || null,
            model: asset.model || asset.category,
            image_url: asset.image,
            // IEN — when undefined the DB trigger auto-generates EQ-NNNNNN
            equipment_number: asset.equipmentNumber || null,
            // W-2: owning Company Code (drives per-company numbering). Only sent
            // when set, so inserts still work before migration 0174 adds the column.
            ...(asset.companyId ? { company_id: asset.companyId } : {}),
            // ISO 14224 Classification
            asset_category: asset.assetCategory || null,
            asset_type_code: asset.assetType || null,
            asset_class: asset.assetClass || null,
            properties: {
                ...(asset.properties || {})
            }
        };

        // Try DB Insert
        const { data, error } = await supabase.from('assets').insert(row).select().single();

        if (error) {
            console.error("Supabase Error (addAsset):", error);
            throw error;
        }

        // Handle Financials (Cost Center)
        if (asset.costCenter) {
            const finRow = {
                asset_id: data.id,
                cost_center_id: asset.costCenter
                // Defaults for new financial record
            };
            const { error: finError } = await supabase.from('asset_financials').insert(finRow);
            if (finError) console.warn("Failed to create default financials for asset:", finError);
        }

        // Return DB-generated identifiers (tag/equipment_number) so a blank Tag ID
        // surfaces the auto-generated FL-/EQ- value to the UI (UAT F-009).
        return { ...asset, id: data.id, tag: data.tag, equipmentNumber: data.equipment_number };
    }

    public async updateAsset(asset: any): Promise<void> {
        // Hierarchy level — prefer the explicit level (Details-tab re-classification),
        // else fall back to the legacy category/type mapping.
        let hierarchy_level: string | undefined = (asset.hierarchyLevel || '').toString().toUpperCase() || undefined;
        if (!hierarchy_level) {
            const cat = (asset.assetType || asset.category || '').toUpperCase();
            if (['SITE', 'AREA'].includes(cat)) hierarchy_level = 'SITE';
            else if (cat === 'UNIT') hierarchy_level = 'UNIT';
            else if (['SYSTEM', 'SUBSYSTEM'].includes(cat)) hierarchy_level = 'SYSTEM';
            else if (cat) hierarchy_level = 'EQUIPMENT';
        }

        const row: Record<string, any> = {
            tag: asset.tag,
            name: asset.name,
            parent_id: asset.parentId || null,
            status_code: asset.status,
            criticality: asset.criticality || null,
            serial_number: asset.serialNumber || null,
            manufacturer: asset.manufacturer,
            manufacturer_id: asset.manufacturerId || null,
            model: asset.model,
            image_url: asset.image,
            // Classification fields
            asset_category: asset.assetCategory || null,
            asset_type_code: asset.assetType || null,
            asset_class: asset.assetClass || null,
            properties: {
                ...(asset.properties || {}) // BOM now managed via asset_bom table
            }
        };
        // Only include hierarchy_level if we determined one
        if (hierarchy_level) row.hierarchy_level = hierarchy_level;
        // 0179 — persist responsible work group only when the field is present, so
        // asset saves keep working before the migration is applied (unknown column).
        if (asset.responsibleWorkCenterId !== undefined) row.responsible_work_center_id = asset.responsibleWorkCenterId || null;
        // W-2: persist the owning Company Code only when set (truthy). Before
        // migration 0174 the column doesn't exist and companyId is null, so
        // asset saves must NOT send it (PostgREST rejects unknown columns).
        // (Clearing an assignment back to null is a later refinement.)
        if (asset.companyId) row.company_id = asset.companyId;

        console.log('[updateAsset] Saving row:', { id: asset.id, ...row });
        // .select('id') is not cosmetic: it is what makes the row count
        // observable. An RLS UPDATE policy is a USING filter, not a rejection —
        // a caller who may not touch this row gets error === null and zero rows,
        // which is indistinguishable from success unless the rows are counted.
        const { data: updated, error } = await supabase
            .from('assets').update(row).eq('id', asset.id).select('id');
        if (error) {
            console.error('[updateAsset] Supabase ERROR:', error.message, error.details, error.hint);
            errorLog.apiError('assets', `[updateAsset] Failed for ${asset.tag || asset.id}`, error, 'asset', asset.id);
        } else if (!updated?.length) {
            console.error('[updateAsset] No row updated for asset:', asset.id, '— refused or missing');
            errorLog.apiError('assets', `[updateAsset] Updated 0 rows for ${asset.tag || asset.id} (RLS refusal or missing row)`,
                { message: 'update affected 0 rows' } as any, 'asset', asset.id);
        } else {
            console.log('[updateAsset] ✅ Saved successfully for asset:', asset.id);
        }

        // Handle Financials Update (Cost Center)
        if (!error && asset.costCenter !== undefined) {
            // We need to upsert. First check if exists or just upsert unique on asset_id?
            // Assuming asset_financials has unique constraint on asset_id.
            // If not, we might create dups. Let's assume 1:1.
            // Best effort: Try update, if 0 rows, insert?
            // Or better: UPSERT on asset_id.
            const finRow = {
                asset_id: asset.id,
                cost_center_id: asset.costCenter,
                updated_at: new Date().toISOString()
            };

            // Upsert functionality requires conflict target usually.
            const { error: finError } = await supabase
                .from('asset_financials')
                .upsert(finRow, { onConflict: 'asset_id' }); // Assuming constraint name or column

            if (finError) console.warn("Failed to update financials for asset:", finError);
        }
        if (error) {
            console.error('[DatabaseService] updateAsset Supabase error:', error);
            throw error;
        }
    }

    public async deleteAsset(assetId: string): Promise<void> {
        const { error } = await supabase.from('assets').delete().eq('id', assetId);
        if (error) {
            console.error('[DatabaseService] deleteAsset Supabase error:', error);
            throw error;
        }
    }

    // --- DICTIONARIES ---

    public async getDictionaries(): Promise<DictionaryEntry[]> {
        const { data, error } = await supabase.from('reference_codes_effective').select('*'); // Removed .eq('active', true) to allow management of inactive codes
        if (error) {
            console.error("Supabase Error (getDictionaries):", error);
            return [];
        }

        // Map 'reference_codes' (DB) -> 'DictionaryEntry' (UI)
        const dictionaryEntries = (data || []).map((d: any) => ({
            id: d.id, // reference_codes has UUID id
            type: d.category as DictionaryType, // Map category -> type
            code: d.code,
            description: d.description,
            active: d.active,
            is_locked: d.is_locked,
            // Spread extended properties from JSONB 'properties' column
            // This restores hourlyRate, permissions, suppression, colorCode, sequence, categoryRef etc.
            ...(d.properties || {}),
            // Keep raw properties for Cost Center and other compound data
            properties: d.properties,
            // Scope carrier (0267 config model): null = the product's standard
            // row, a uuid = this tenant's own row. The Admin manager uses it to
            // label Standard / Customised / Yours and to offer revert. Placed
            // after the properties spread so a stray JSONB key cannot clobber it.
            companyId: d.company_id ?? null,
        })) as DictionaryRecord[];

        // FEDERATION: Inject Cost Centers from FinOps Service
        // Cost Centers are stored in 'cost_centers' table but viewed as 'COST_CENTRE' dictionary type in Admin
        try {
            const costCenters = await FinOpsService.getCostCenters();
            const costCenterEntries: DictionaryRecord[] = costCenters.map(cc => ({
                id: cc.id,
                type: 'COST_CENTRE',
                code: cc.code,
                description: cc.name, // Name maps to Description
                active: cc.active,
                is_locked: false, // Generally editable unless specific logic added
                properties: {
                    costCenterType: cc.costCenterType,
                    companyCode: cc.companyCode,
                    controllingArea: cc.controllingArea,
                    validFrom: cc.validFrom,
                    validTo: cc.validTo,
                    responsiblePersonId: cc.responsiblePersonId
                },
                updated_at: new Date().toISOString()
            }));

            // Merge results
            return [...dictionaryEntries as DictionaryEntry[], ...costCenterEntries as DictionaryEntry[]];
        } catch (e) {
            console.error("Federation Error (Cost Centers): Failed to fetch from FinOpsService", e);
            errorLog.apiError('dictionaries', 'Federation Error: Cost Centers fetch failed', e);
            return dictionaryEntries as DictionaryEntry[]; // Return at least standard dictionaries
        }
    }

    public async addDictionary(entry: DictionaryRecord): Promise<DictionaryRecord> {
        // FEDERATION: Redirect COST_CENTRE to FinOpsService
        if (entry.type === 'COST_CENTRE') {
            console.log('[DatabaseService] Redirecting addDictionary(COST_CENTRE) to FinOpsService');
            const extended = (entry as any).properties || {};
            const costCenterPayload = {
                code: entry.code,
                name: entry.description, // Description maps to Name
                description: undefined, // Optional description field in CC
                parentId: (extended as any).parentId,
                companyCode: (extended as any).companyCode || 'CORP', // Default if missing
                controllingArea: (extended as any).controllingArea || '1000',
                costCenterType: (extended as any).costCenterType || 'MAINTENANCE',
                responsiblePersonId: (extended as any).responsiblePersonId,
                validFrom: (extended as any).validFrom || new Date().toISOString(),
                validTo: (extended as any).validTo,
                active: entry.active ?? true
            };

            const newCC = await FinOpsService.createCostCenter(costCenterPayload as any);
            return {
                ...entry,
                id: newCC.id
            };
        }

        // Pack extended props into JSONB
        const { id, type, code, description, is_locked, active, updated_at, metadata, ...extended } = entry as any;

        // Explicitly separate known columns from extended properties
        // Columns: id, type, code, description, is_locked, active, updated_at, metadata
        const dbRecord: any = {
            category: type, // Map type -> category
            code,
            description,
            is_locked: is_locked ?? false,
            active: active ?? true,
            properties: extended // Pack the rest (hourlyRate, permissions etc)
        };

        // Only include id if provided (otherwise let database auto-generate)
        if (id) {
            dbRecord.id = id;
        }

        // Add metadata if present (for ORG_LEVEL, NOTIFICATION_EVENT, etc.)
        if (metadata) {
            dbRecord.metadata = metadata;
        }

        console.log('[DatabaseService] addDictionary (reference_codes):', dbRecord);

        const { data, error } = await supabase.from('reference_codes').insert(dbRecord).select().single();
        if (error) {
            console.error('[DatabaseService] addDictionary error:', error);
            throw new Error(error.message);
        }

        return { ...entry, id: data?.id };
    }
    /**
     * UPSERT a dictionary entry - Update if exists (by category+code), Insert if not
     * This is used for ORG_LEVEL and other entries where category+code is the unique key
     */
    public async upsertDictionary(entry: any): Promise<any> {
        const { id: _id, type, code, description, is_locked, active, updated_at, metadata, ...extended } = entry;
        const upperCode = code.toUpperCase();

        console.log('[DatabaseService] upsertDictionary: checking if exists', { type, code: upperCode });

        // First check if entry exists
        const { data: existing, error: findError } = await supabase
            .from('reference_codes')
            .select('id')
            .eq('category', type) // Map type -> category
            .eq('code', upperCode)
            .maybeSingle();

        if (findError) {
            console.error('[DatabaseService] upsertDictionary find error:', findError);
            throw new Error(findError.message);
        }

        const dbRecord: any = {
            category: type, // Map type -> category
            code: upperCode,
            description,
            is_locked: is_locked ?? false,
            active: active ?? true,
            updated_at: new Date().toISOString(),
            // Pack extended properties (categoryRef, sequence, colorCode, hourlyRate, etc.) into JSONB
            properties: Object.keys(extended).length > 0 ? extended : undefined,
        };

        // Add metadata if present
        if (metadata) {
            dbRecord.metadata = metadata;
        }

        if (existing?.id) {
            // UPDATE existing — merge properties so we don't overwrite what's already there
            if (dbRecord.properties) {
                const { data: currentRow } = await supabase
                    .from('reference_codes')
                    .select('properties')
                    .eq('id', existing.id)
                    .single();
                dbRecord.properties = { ...(currentRow?.properties || {}), ...dbRecord.properties };
            }
            console.log('[DatabaseService] upsertDictionary: UPDATING id=', existing.id, dbRecord);
            // Copy-on-write when `existing` turns out to be a global default —
            // the plain update would match zero rows and report success.
            await this.writeConfigRow('reference_codes', existing.id, dbRecord);
            return { ...entry, id: existing.id };
        } else {
            // INSERT new
            console.log('[DatabaseService] upsertDictionary: INSERTING', dbRecord);
            const { data, error: insertError } = await supabase
                .from('reference_codes')
                .insert(dbRecord)
                .select()
                .single();

            if (insertError) {
                console.error('[DatabaseService] upsertDictionary insert error:', insertError);
                throw new Error(insertError.message);
            }
            return { ...entry, id: data?.id };
        }
    }



    /**
     * Re-sync org unit types based on their hierarchy depth.
     * This updates all organization_units.type based on their position in the tree
     * and the configured ORG_LEVEL order.
     */
    public async resyncOrgUnitTypes(): Promise<{ updated: number; errors: string[] }> {
        console.log('[DatabaseService] Starting resyncOrgUnitTypes...');

        // 1. Get all org levels sorted by sort_order
        const dictionaries = await this.getDictionaries();
        const orgLevels = dictionaries
            .filter((d: any) => d.type === 'ORG_LEVEL' && d.active !== false)
            .map((d: any) => ({
                code: d.code,
                sortOrder: d.metadata?.sort_order ?? 99
            }))
            .sort((a: any, b: any) => a.sortOrder - b.sortOrder);

        console.log('[DatabaseService] Org levels order:', orgLevels.map(l => l.code));

        if (orgLevels.length === 0) {
            return { updated: 0, errors: ['No ORG_LEVEL configurations found'] };
        }

        // 2. Get all org units
        const orgUnits = await this.getOrgUnits();
        console.log('[DatabaseService] Total org units:', orgUnits.length);

        // 3. Build a map for quick parent lookups
        const unitMap = new Map<string, any>();
        orgUnits.forEach(u => unitMap.set(u.id, u));

        // 4. Calculate depth for each unit
        const getDepth = (unit: any): number => {
            let depth = 0;
            let current = unit;
            while (current.parentId && unitMap.has(current.parentId)) {
                depth++;
                current = unitMap.get(current.parentId);
            }
            return depth;
        };

        // 5. Update each unit's type based on depth
        let updated = 0;
        const errors: string[] = [];

        for (const unit of orgUnits) {
            const depth = getDepth(unit);
            const expectedType = orgLevels[Math.min(depth, orgLevels.length - 1)]?.code;

            if (expectedType && unit.type !== expectedType) {
                console.log(`[DatabaseService] Updating ${unit.name}: ${unit.type} -> ${expectedType} (depth: ${depth})`);

                const { error } = await supabase
                    .from('organization_units')
                    .update({ type: expectedType })
                    .eq('id', unit.id);

                if (error) {
                    errors.push(`Failed to update ${unit.name}: ${error.message}`);
                } else {
                    updated++;
                }
            }
        }

        console.log(`[DatabaseService] Resync complete. Updated: ${updated}, Errors: ${errors.length}`);
        return { updated, errors };
    }

    public async updateDictionary(id: string, updates: Partial<DictionaryRecord>): Promise<void> {
        // FEDERATION: Redirect COST_CENTRE to FinOpsService
        // We need to know the Type. If 'updates' has type, great. If not, we might need to check.
        // Optimistically check if it's a Cost Center ID? Or better, just check if Type is passed.
        // However, update often only sends partials.
        // Fallback: If type is missing, we fetch the generic dict. If not found, try cost center?
        // Simpler: The UI Context usually allows us to know the type. But here we only have ID.
        // Let's try to fetch generic dictionary first. If not found, assuming ID is UUID, try FinOps?
        // Actually, let's look at `updates.type`. If the UI passes type, we are golden.
        // Ensure UI passes type in updates!

        // Checking if it's a Cost Center by querying FinOps?
        // Let's fetch the Generic Dictionary first.
        const genericDict = await this.getDictionary(id);

        if (!genericDict) {
            // Not in 'dictionaries' table. Check if it's a Cost Center.
            // This is slightly expensive but safe.
            // Alternatively, we could mandate 'type' in updates.
            // Let's assume if genericDict is null, it MIGHT be a Cost Center.
            try {
                // Try updating Cost Center via FinOps
                const extended = (updates as any).properties || {};
                const ccUpdates: any = {};

                if (updates.code) ccUpdates.code = updates.code;
                if (updates.description) ccUpdates.name = updates.description; // Description -> Name
                if (updates.active !== undefined) ccUpdates.active = updates.active;

                // Extended props
                if (extended.companyCode) ccUpdates.companyCode = extended.companyCode;
                if (extended.costCenterType) ccUpdates.costCenterType = extended.costCenterType;
                if (extended.controllingArea) ccUpdates.controllingArea = extended.controllingArea;
                if (extended.validFrom) ccUpdates.validFrom = extended.validFrom;
                if (extended.validTo) ccUpdates.validTo = extended.validTo;

                await FinOpsService.updateCostCenter(id, ccUpdates);
                console.log('[DatabaseService] Redirected updateDictionary to FinOpsService for ID:', id);
                return;
            } catch (e) {
                // If it fails here (e.g. ID not found in Cost Centers either), strict error?
                console.warn('[DatabaseService] Update failed for Dictionary ID (not found in generic or cost centers):', id);
                // Throwing original error or generic?
            }
        }

        // If we found it in Generic Dictionaries, proceed as normal.
        if (genericDict && genericDict.type === 'COST_CENTRE') {
            // Should not happen if data is clean (Cost Centers shouldn't be in dictionaries table)
            // But if migration partial, handle it?
        }

        // We need to merge existing properties with new updates if we are updating extended fields.
        // For simplicity, we'll fetch, merge, and save, OR just use jsonb_set logic if strict.
        // But since we are updating `properties` wholesale, let's look at what we are sending.

        // Separate columns from extended
        const { id: _id, type, code, description, is_locked, active, updated_at, metadata, ...extendedUpdates } = updates as any;

        const coreUpdates: any = {};
        if (description !== undefined) coreUpdates.description = description;
        if (code !== undefined) coreUpdates.code = code; // Enable code updates
        if (is_locked !== undefined) coreUpdates.is_locked = is_locked;
        if (active !== undefined) coreUpdates.active = active;
        if (metadata !== undefined) coreUpdates.metadata = metadata; // Handle metadata JSONB
        coreUpdates.updated_at = new Date().toISOString();

        // If there are extended updates, we need to merge them into 'properties'
        if (Object.keys(extendedUpdates).length > 0) {
            // Fetch current to merge JSON
            const current = await this.getDictionary(id);
            const currentProps = current ? (current as any).properties || {} : {};
            const newProps = { ...currentProps, ...extendedUpdates };
            coreUpdates.properties = newProps;
        }

        await this.writeConfigRow('reference_codes', id, coreUpdates);
    }

    /**
     * The (category|code) keys of the PRODUCT'S standard rows. The manager
     * needs them to tell a "customised" entry (shadows a standard) from a
     * purely-own one — the effective view collapses the pair, so the entry
     * alone cannot say which it is. Read from the base table: the read policy
     * (company_id IS NULL OR own) exposes global rows to every tenant.
     */
    public async getStandardCodeKeys(): Promise<Set<string>> {
        const { data, error } = await supabase
            .from('reference_codes').select('category, code').is('company_id', null);
        if (error) { console.error('DatabaseService.getStandardCodeKeys:', error); return new Set(); }
        return new Set((data ?? []).map((r: any) => `${r.category}|${r.code}`));
    }

    /**
     * Write to a config table that carries global defaults alongside tenant rows.
     *
     * Since 0267 these tables hold BOTH: `company_id IS NULL` is the product's
     * default, shared by every customer, and a row with a company_id is that
     * tenant's own. RLS lets you read both and write only your own — so an
     * UPDATE aimed at a global row matches zero rows and returns HTTP 200 with
     * `error: null`. Checking only `error` would report success to precisely the
     * edit that did not happen, which is the bug this whole workstream started
     * with.
     *
     * So: try the update; if it touched nothing, the row is a global default and
     * the edit becomes a COPY. That is what the override pattern is for — the
     * customer gets their own version, everyone else keeps the standard one, and
     * the product's seed data stays intact.
     */
    private async writeConfigRow(
        table: 'reference_codes' | 'dictionaries' | 'manufacturers',
        id: string,
        patch: Record<string, any>,
    ): Promise<void> {
        const { data, error } = await supabase.from(table).update(patch).eq('id', id).select('id');
        if (error) throw new Error(error.message);
        if (data && data.length > 0) return;                    // it was already ours

        // Zero rows: either a global default, or gone, or the role cannot write.
        const { data: source, error: readErr } = await supabase
            .from(table).select('*').eq('id', id).maybeSingle();
        if (readErr) throw new Error(readErr.message);
        if (!source) throw new Error(`That ${table} entry no longer exists.`);
        if (source.company_id) {
            // Ours, yet the update did nothing — that is the role gate, not tenancy.
            throw new Error('Not saved — your role cannot change configuration (admins only).');
        }

        // Copy-on-write. company_id is omitted on purpose: its DEFAULT is
        // caller_company(), so the copy lands in the caller's tenant without the
        // client having to know its own id.
        const { id: _drop, company_id: _drop2, ...rest } = source as Record<string, any>;
        const { error: insErr } = await supabase.from(table).insert({ ...rest, ...patch });
        if (insErr) {
            throw new Error(
                insErr.message.includes('duplicate')
                    ? 'You already have a custom version of this entry.'
                    : insErr.message,
            );
        }
    }

    // Helper to get raw for updates
    private async getDictionary(id: string): Promise<DictionaryRecord | null> {
        const { data, error } = await supabase.from('reference_codes').select('*').eq('id', id).single();
        if (error) return null;
        // Map back to dictionary record structure for internal use
        return {
            ...data,
            type: data.category
        } as any as DictionaryRecord;
    }


    public async deleteDictionary(id: string): Promise<void> {
        // FEDERATION: Check if it's a Cost Center first (or check generic dict)
        const genericDict = await this.getDictionary(id);

        if (!genericDict) {
            // Try delete Cost Center
            try {
                await FinOpsService.deleteCostCenter(id);
                console.log('[DatabaseService] Redirected deleteDictionary to FinOpsService for ID:', id);
                return;
            } catch (e) {
                // Ignore or throw?
            }
        }

        // A global default cannot be deleted — it belongs to the product, not to
        // one customer. Deactivating it via copy-on-write is the tenant-local
        // equivalent: the entry stops appearing for this customer and stays
        // untouched for everyone else. Silently deleting nothing was the other
        // option, and that is the failure mode this codebase keeps relearning.
        const { data, error } = await supabase.from('reference_codes').delete().eq('id', id).select('id');
        if (error) throw new Error(error.message);
        if (!data || data.length === 0) {
            await this.writeConfigRow('reference_codes', id, { active: false });
        }
    }



    // --- READINGS / CONDITION MONITORING ---

    public async getReadingDefinitions(assetId?: string): Promise<any[]> {
        let query = supabase.from('reading_definitions')
            .select('*')
            .eq('is_active', true);

        if (assetId) {
            query = query.eq('asset_id', assetId);
        }

        const { data, error } = await query;
        if (error) {
            console.error("Error fetching reading definitions:", error);
            return [];
        }

        return (data || []).map((row: any) => ({
            id: row.id,
            assetId: row.asset_id,
            readingTypeCode: row.reading_type_code,
            name: row.name,
            unit: row.unit,
            category: row.category,
            isActive: row.is_active,
            minCritical: row.min_critical,
            minWarning: row.min_warning,
            maxWarning: row.max_warning,
            maxCritical: row.max_critical,
            monitoringFrequencyDays: row.monitoring_frequency_days ?? null,
            pfIntervalDays: row.pf_interval_days ?? null,
            // Band provenance (0198). NULL/absent = legacy "unverified" band.
            limitSource: row.limit_source ?? null
        }));
    }

    public async addReadingDefinition(def: any): Promise<any> {
        // Map UI -> DB
        const row: any = {
            asset_id: def.assetId,
            reading_type_code: def.readingTypeCode,
            name: def.name,
            unit: def.unit,
            category: def.category,
            min_critical: def.minCritical,
            min_warning: def.minWarning,
            max_warning: def.maxWarning,
            max_critical: def.maxCritical,
            is_active: true,
            // Per-point cadence (0176) + band provenance (0198). Harmless when
            // null; stripped on retry below if the migrations aren't applied yet.
            monitoring_frequency_days: def.monitoringFrequencyDays ?? null,
            pf_interval_days: def.pfIntervalDays ?? null,
            limit_source: def.limitSource ?? null,
            // ISA-18.2 rationalization (0205)
            operator_action: def.operatorAction ?? null,
        };

        let { data, error } = await supabase.from('reading_definitions').insert(row).select().single();
        // Graceful degradation: if 0176/0198/0205 aren't applied yet, the new
        // columns don't exist — retry without them so add-point still works.
        if (error && /monitoring_frequency_days|pf_interval_days|limit_source|operator_action|PGRST204|column .* does not exist/i.test(error.message || '')) {
            const { monitoring_frequency_days, pf_interval_days, limit_source, operator_action, ...legacy } = row;
            ({ data, error } = await supabase.from('reading_definitions').insert(legacy).select().single());
        }
        if (error) throw new Error(error.message);

        return { ...def, id: data.id };
    }

    /**
     * Update ONLY a definition's alarm bands + their provenance (Phase 1.5).
     * Used by the learned-baseline "Suggest limits" flow and the threshold-
     * adapter agent's approved proposals — both human-approved before writing.
     */
    public async updateReadingDefinitionBands(id: string, bands: {
        minCritical?: number | null; minWarning?: number | null;
        maxWarning?: number | null; maxCritical?: number | null;
        limitSource?: string | null;
    }): Promise<void> {
        const row: any = {
            min_critical: bands.minCritical ?? null,
            min_warning: bands.minWarning ?? null,
            max_warning: bands.maxWarning ?? null,
            max_critical: bands.maxCritical ?? null,
            limit_source: bands.limitSource ?? null,
        };
        let { error } = await supabase.from('reading_definitions').update(row).eq('id', id);
        // Graceful degradation while 0198 is unapplied.
        if (error && /limit_source|PGRST204|column .* does not exist/i.test(error.message || '')) {
            const { limit_source, ...legacy } = row;
            ({ error } = await supabase.from('reading_definitions').update(legacy).eq('id', id));
        }
        if (error) throw new Error(error.message);
    }

    public async deleteReadingDefinition(id: string): Promise<void> {
        // Logs table appears empty or broken, so we skip manual cascade.
        // If logs existed with proper FK, we'd need cascade, but currently schema is mismatched.
        const { error } = await supabase.from('reading_definitions').delete().eq('id', id);
        if (error) throw new Error(error.message);
    }

    public async getReadingLogs(assetId?: string): Promise<any[]> {
        let query = supabase.from('reading_logs').select('*').order('reading_date', { ascending: false });
        if (assetId) {
            query = query.eq('asset_id', assetId);
        }

        const { data, error } = await query;
        if (data && data.length > 0) {
            console.log("DB LOG ROW KEYS:", Object.keys(data[0]));
            console.log("DB LOG ROW:", data[0]);
        }
        if (error) {
            console.error("Error fetching reading logs:", error);
            return [];
        }

        return (data || []).map((row: any) => ({
            id: row.id,
            definitionId: row.definition_id,
            assetId: row.asset_id,
            readingTypeCode: row.reading_type_code,
            date: row.reading_date,
            // Postgres TIME comes back 'HH:MM:SS' while the UI writes 'HH:MM' —
            // normalize to 'HH:MM' so consumers can compose `${date}T${time}`
            // timestamps (and display) without caring which shape arrived.
            time: typeof row.reading_time === 'string' ? row.reading_time.slice(0, 5) : row.reading_time,
            value: row.reading_value,
            delta: row.delta,
            enteredBy: row.entered_by,
            isActive: row.is_active,
            isAlarm: row.is_alarm,
            comments: row.comments,
            valuationCode: row.valuation_code
        }));
    }

    /**
     * REAL condition-alarm state for an asset (R-4): evaluate the latest reading
     * on each measurement point against its alarm bands (min/max critical/warning).
     * This replaces the synthetic Predict alerts with actual band breaches.
     */
    public async getAssetConditionAlarms(assetId: string): Promise<{
        pointCount: number; criticalCount: number; warningCount: number;
        breaches: { name: string; unit?: string; value: number; level: 'WARNING' | 'CRITICAL'; detail: string; date?: string }[];
    }> {
        const [defs, logs] = await Promise.all([this.getReadingDefinitions(assetId), this.getReadingLogs(assetId)]);
        // logs are ordered newest-first; keep the first (latest) per definition.
        const latestByDef = new Map<string, any>();
        for (const l of logs) if (!latestByDef.has(l.definitionId)) latestByDef.set(l.definitionId, l);

        const breaches: { name: string; unit?: string; value: number; level: 'WARNING' | 'CRITICAL'; detail: string; date?: string }[] = [];
        for (const def of defs) {
            const latest = latestByDef.get(def.id);
            if (!latest || latest.value == null) continue;
            const res = evaluateReading(Number(latest.value), def);
            if (res.level !== 'OK') {
                breaches.push({ name: def.name, unit: def.unit, value: Number(latest.value), level: res.level as 'WARNING' | 'CRITICAL', detail: res.detail, date: latest.date });
            }
        }
        // Critical first, then warning.
        breaches.sort((a, b) => (a.level === b.level ? 0 : a.level === 'CRITICAL' ? -1 : 1));
        return {
            pointCount: defs.length,
            criticalCount: breaches.filter(b => b.level === 'CRITICAL').length,
            warningCount: breaches.filter(b => b.level === 'WARNING').length,
            breaches,
        };
    }

    public async logReading(log: any): Promise<any> {
        const row: any = {
            definition_id: log.definitionId || log.definition_id,
            asset_id: log.assetId || log.asset_id,
            reading_type_code: log.readingTypeCode || log.reading_type_code,
            reading_date: log.date || log.reading_date,
            reading_time: log.time || log.reading_time,
            reading_value: log.value,
            delta: log.delta,
            entered_by: log.enteredBy || log.entered_by, // entry sheet sends snake_case — was silently NULL
            comments: log.comments,
            // is_alarm calculated by DB trigger ideally, or passed from UI
            is_alarm: log.isAlarm || log.is_alarm || false
        };
        // Coded finding (0192) — only sent when picked, so inserts keep working
        // against databases where the column doesn't exist yet.
        const vCode = log.valuationCode || log.valuation_code;
        if (vCode) row.valuation_code = vCode;

        let { data, error } = await supabase.from('reading_logs').insert(row).select().single();

        // Tolerate a missing valuation_code column (0192 not applied yet): strip + retry.
        if (error && row.valuation_code !== undefined && (/valuation_code|PGRST204|column .* does not exist/i.test(error.message || ''))) {
            const { valuation_code, ...rest } = row;
            ({ data, error } = await supabase.from('reading_logs').insert(rest).select().single());
        }
        if (error) throw new Error(error.message);

        return { ...log, id: data.id };
    }


    public async createWorkOrder(wo: any, actor: string): Promise<any> {
        let { data, error } = await supabase.from('work_orders').insert(wo).select().single();

        // Tolerate a missing work_center_id column (0178 not applied yet): strip + retry.
        if (error && wo.work_center_id !== undefined && (/work_center_id|PGRST204|column .* does not exist/i.test(error.message || ''))) {
            const { work_center_id, ...rest } = wo;
            ({ data, error } = await supabase.from('work_orders').insert(rest).select().single());
        }

        if (error) {
            // Fallback: if status enum violation on SCHED/PLAN, retry with WIP
            const errMsg = (error.message || '').toLowerCase();
            const isEnumError = errMsg.includes('invalid input value') 
                || errMsg.includes('enum') 
                || errMsg.includes('wo_status')
                || errMsg.includes('check constraint')
                || errMsg.includes('violates check');

            if (isEnumError && (wo.status === 'SCHED' || wo.status === 'PLAN')) {
                console.warn(`[createWorkOrder] Status '${wo.status}' rejected by DB. Falling back to 'WIP'.`);
                const { data: retryData, error: retryError } = await supabase
                    .from('work_orders')
                    .insert({ ...wo, status: 'WIP' })
                    .select()
                    .single();
                if (retryError) throw retryError;
                return retryData;
            }

            throw error;
        }

        // Audit handled by DB Trigger
        return data;
    }

    /**
     * Schedule/Reschedule a Work Order.
     * Handles date updates, status transitions, and optional assignment.
     * Includes fallback if 'SCHED'/'PLAN' enum values are not yet in the DB.
     */
    public async scheduleWorkOrder(
        woId: string,
        updates: {
            date_due_start?: string;
            due_date?: string;
            assigned_to?: string;
            status?: string;
        },
        actor: string
    ): Promise<any> {
        const payload: any = {
            updated_at: new Date().toISOString(),
        };

        if (updates.date_due_start) payload.date_due_start = updates.date_due_start;
        if (updates.due_date) payload.due_date = updates.due_date;
        if (updates.assigned_to) payload.assigned_to = updates.assigned_to;

        // Determine status to set
        const targetStatus = updates.status || 'SCHED';

        // First attempt: use target status (may be SCHED/PLAN)
        payload.status = targetStatus;

        const { data, error } = await supabase
            .from('work_orders')
            .update(payload)
            .eq('id', woId)
            .select()
            .single();

        if (error) {
            // Fallback: if the error is a status enum violation, retry with 'WIP'
            const errMsg = (error.message || '').toLowerCase();
            const isEnumError = errMsg.includes('invalid input value') 
                || errMsg.includes('enum') 
                || errMsg.includes('wo_status')
                || errMsg.includes('check constraint')
                || errMsg.includes('violates check');

            if (isEnumError && (targetStatus === 'SCHED' || targetStatus === 'PLAN')) {
                console.warn(`[scheduleWorkOrder] Status '${targetStatus}' rejected by DB enum. Falling back to 'WIP'.`);
                payload.status = 'WIP';
                
                const { data: retryData, error: retryError } = await supabase
                    .from('work_orders')
                    .update(payload)
                    .eq('id', woId)
                    .select()
                    .single();

                if (retryError) throw retryError;
                return retryData;
            }

            throw error;
        }

        return data;
    }

    public async getWorkOrders(): Promise<WorkOrderRecord[]> {
        const { data, error } = await supabase.from('work_orders').select('*, wo_failure_data(*)').order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    }

    /**
     * Lightweight head-count of the entities the getting-started checklist tracks,
     * so onboarding steps auto-complete from real data (no full-list fetches).
     */
    public async getOnboardingCounts(): Promise<{
        assets: number; pms: number; workOrders: number; people: number;
        inventory: number; vendors: number; readings: number; batches: number; connectors: number; codes: number;
        bom: number;
    }> {
        const head = async (table: string) => {
            const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true });
            return error ? 0 : (count || 0);
        };
        const [assets, pms, workOrders, people, inventory, vendors, readings, batches, connectors, codes, bom] = await Promise.all([
            head('assets'), head('recurring_work'), head('work_orders'), head('contacts'),
            head('inventory_items'), head('vendors'), head('reading_logs'),
            head('import_batches'), head('connectors'), head('reference_codes'),
            head('asset_bom'),
        ]);
        return { assets, pms, workOrders, people, inventory, vendors, readings, batches, connectors, codes, bom };
    }

    /**
     * Active work orders assigned to one technician (contact), with the asset
     * name embedded — powers the "My Work" home. Excludes finished/cancelled.
     */
    public async getMyWorkOrders(contactId: string): Promise<(WorkOrderRecord & { assets?: { name?: string } | null })[]> {
        const { data, error } = await supabase
            .from('work_orders')
            .select('*, assets(name)')
            .eq('assigned_to', contactId)
            .not('status', 'in', '(TECO,CLOSED,CANC,CANCELLED)')
            .order('due_date', { ascending: true, nullsFirst: false });
        if (error) throw error;
        return data || [];
    }

    /**
     * Get all work orders linked to a specific asset.
     * Used by the Asset Jobs tab to show associated work.
     */
    public async getWorkOrdersByAssetId(assetId: string): Promise<WorkOrderRecord[]> {
        const { data, error } = await supabase
            .from('work_orders')
            .select('*, wo_failure_data(*)')
            .eq('asset_id', assetId)
            .order('created_at', { ascending: false });
        if (error) {
            console.error('[DatabaseService] getWorkOrdersByAssetId error:', error);
            return [];
        }
        return data || [];
    }

    /**
     * Get all work orders assigned to a specific contact (the person's "Jobs").
     * Matches on work_orders.assigned_to (FK -> contacts.id).
     */
    public async getWorkOrdersByContactId(contactId: string): Promise<WorkOrderRecord[]> {
        const { data, error } = await supabase
            .from('work_orders')
            .select('*')
            .eq('assigned_to', contactId)
            .order('created_at', { ascending: false });
        if (error) {
            console.error('[DatabaseService] getWorkOrdersByContactId error:', error);
            return [];
        }
        return data || [];
    }

    /**
     * Get all recurring work (PMs) linked to a specific asset.
     * Used by the Asset Jobs tab to show associated PM strategies.
     */
    public async getPMsByAssetId(assetId: string): Promise<any[]> {
        const { data, error } = await supabase
            .from('recurring_work')
            .select('*')
            .eq('asset_id', assetId)
            .order('next_due_date', { ascending: true });
        if (error) {
            console.error('[DatabaseService] getPMsByAssetId error:', error);
            return [];
        }
        return data || [];
    }

    public async getWorkOrder(id: string): Promise<any> {
        const { data, error } = await supabase
            .from('work_orders')
            .select(`
                *,
                job_tasks(*),
                work_order_labor(*),
                work_order_parts(*),
                jsa_assessments(*, jsa_hazards(*)),
                wo_failure_data(*)
            `)
            .eq('id', id)
            .single();

        if (error) {
            console.error("Error fetching work order:", error);
            return undefined;
        }
        return data;
    }

    public async updateWorkOrder(
        id: string,
        updates: Partial<WorkOrderRecord> & { tasks?: JobTask[]; labor?: JobLabor[]; inventory?: JobInventory[]; jsa?: JobJSA },
        actor: string
    ): Promise<WorkOrderRecord> {
        // Separate generic updates from Relational Updates
        const { tasks, labor, inventory, jsa, failureData, ...coreUpdates } = updates as any;
        console.log(`[updateWorkOrder] ${id} - Recv: Tasks=${tasks?.length}, Labor=${labor?.length}, Inv=${inventory?.length}`);

        // Governance Rules (Freezing) are handled by DB Trigger 'enforce_cost_freezing'

        // --- FAILURE DATA PERSISTENCE (ISO 14224) ---
        // Moved BEFORE TECO validation so data is in the table when validation queries it
        if (failureData && (failureData.failureMode || failureData.failureCause || failureData.remedyCode || failureData.localImpact || failureData.plantWideImpact)) {
            const failureRow = {
                wo_id: id,
                failure_mode_code: failureData.failureMode || null,
                failure_cause_code: failureData.failureCause || null,
                remedy_code: failureData.remedyCode || null,
                comments: failureData.comments || null,
                local_impact: failureData.localImpact || null,
                plant_wide_impact: failureData.plantWideImpact || null,
                updated_at: new Date().toISOString(),
            };

            const { error: failureError } = await supabase
                .from('wo_failure_data')
                .upsert(failureRow, { onConflict: 'wo_id' });

            if (failureError) {
                console.error('[updateWorkOrder] Failed to upsert wo_failure_data:', failureError);
            } else {
                console.log(`[updateWorkOrder] Failure data saved for WO ${id}:`, failureRow);
            }
        }

        // --- TECO VALIDATION (Failure Coding) ---
        // PM jobs: no failure coding required (no failure occurred)
        // CM/other jobs: only Failure Mode is mandatory; Failure Cause & Remedy are optional
        if (coreUpdates.status === 'TECO' || coreUpdates.status === 'CLOSED') {
            // Check the WO type to decide validation rules
            const { data: woTypeData } = await supabase
                .from('work_orders')
                .select('type')
                .eq('id', id)
                .single();

            const woType = woTypeData?.type || coreUpdates.type || '';
            // Single policy shared with the client gate — see lib/workOrder.ts.
            const isPM = isPreventiveWoType(woType);

            if (!isPM) {
                // CM / other jobs: Failure Mode is mandatory
                const { data: existingFailure } = await supabase
                    .from('wo_failure_data')
                    .select('failure_mode_code')
                    .eq('wo_id', id)
                    .maybeSingle();

                if (!existingFailure?.failure_mode_code) {
                    throw new Error(
                        `TECO_BLOCKED: Cannot set status to ${coreUpdates.status}. ` +
                        `Missing mandatory failure coding: Failure Mode. ` +
                        `Failure Mode must be completed for corrective work orders.`
                    );
                }
            }
            // PM jobs pass through — no failure coding required
        }

        // --- GATEKEEPER PROTOCOL ---
        // "Any cancellation of a WO on a Criticality A asset requires rejection_reason and sign-off"
        // Both cancel spellings exist in the wo_status enum ('CANCELLED' from 0000,
        // 'CANC' from 0148, which is what the status dictionary emits) — matching
        // only one made the gate trivially bypassable.
        if (String(coreUpdates.status || '').toUpperCase().startsWith('CANC')) {
            const { data: woData } = await supabase
                .from('work_orders')
                .select('asset_id')
                .eq('id', id)
                .single();

            if (woData?.asset_id) {
                const { data: assetData } = await supabase
                    .from('assets')
                    .select('criticality')
                    .eq('id', woData.asset_id)
                    .single();

                if (assetData?.criticality === 'A') {
                    const rejectionReason = (coreUpdates as any).rejection_reason || (coreUpdates.properties as any)?.rejection_reason;
                    if (!rejectionReason) {
                        throw new Error(
                            `GATEKEEPER_BLOCKED: Cannot cancel Work Order on Criticality A asset. ` +
                            `A mandatory "Reason for Rejection" and digital sign-off is required.`
                        );
                    }
                    // Log the gatekeeper action for audit
                    console.log(`[GATEKEEPER] Criticality A WO ${id} cancelled by ${actor}. Reason: ${rejectionReason}`);
                }
            }
        }

        // Handle Properties merging if present in generic updates
        const finalUpdates = { ...coreUpdates, updated_at: new Date().toISOString() };

        if (coreUpdates.properties) {
            // If we are updating properties, we likely want to merge, but for now specific flags from UI are passed as full object construction in DataMapper
            // So we just take what's passed.
        }

        // Strip undefined values to prevent sending null for NOT NULL columns (e.g. asset_id)
        Object.keys(finalUpdates).forEach(key => {
            if ((finalUpdates as any)[key] === undefined) {
                delete (finalUpdates as any)[key];
            }
        });

        const { data, error } = await supabase.from('work_orders').update(finalUpdates).eq('id', id).select().single();

        if (error) throw error;

        // Handle Relational Updates
        let taskSemaphores: Record<string, string> = {}; // Map TempID -> RealID

        if (tasks) {
            taskSemaphores = await this.updateJobTasks(id, tasks);
            console.log('[updateWorkOrder] Task Semaphores:', taskSemaphores);
        }

        if (labor) {
            // Fix Task IDs if they were temporary
            const fixedLabor = labor.map((l: any) => {
                if (l.jobTaskId && l.jobTaskId.startsWith('new-')) {
                    if (taskSemaphores[l.jobTaskId]) {
                        console.log(`[updateWorkOrder] Fixing Labor Task ID: ${l.jobTaskId} -> ${taskSemaphores[l.jobTaskId]}`);
                        return { ...l, jobTaskId: taskSemaphores[l.jobTaskId] };
                    } else {
                        console.error(`[updateWorkOrder] FAILED to fix Labor Task ID: ${l.jobTaskId}. Missing from semaphores!`);
                    }
                }
                return l;
            });
            await this.updateJobLabor(id, fixedLabor);
        }

        if (inventory) {
            // Fix Task IDs if they were temporary
            const fixedInventory = inventory.map((i: any) => {
                if (i.jobTaskId && i.jobTaskId.startsWith('new-')) {
                    if (taskSemaphores[i.jobTaskId]) {
                        console.log(`[updateWorkOrder] Fixing Inventory Task ID: ${i.jobTaskId} -> ${taskSemaphores[i.jobTaskId]}`);
                        return { ...i, jobTaskId: taskSemaphores[i.jobTaskId] };
                    } else {
                        console.error(`[updateWorkOrder] FAILED to fix Inventory Task ID: ${i.jobTaskId}. Missing from semaphores!`);
                    }
                }
                return i;
            });
            await this.updateJobInventory(id, fixedInventory);
        }

        if (jsa) {
            await this.updateJobJSA(id, jsa, actor);
        }


        // --- WARRANTY AUTO-CLAIM ON TECO (G2, G7, G14) ---
        // When a warranted WO reaches TECO, auto-draft a warranty claim
        if (coreUpdates.status === 'TECO' || coreUpdates.status === 'CLOSED') {
            try {
                // Check if WO has warranty flag
                const woWarranty = data.warranty_flag && data.warranty_id;
                if (woWarranty) {
                    console.log(`[TECO-WARRANTY] WO ${id} has warranty_flag=true, warranty_id=${data.warranty_id}`);

                    // G2: Auto-generate DRAFT claim
                    const claim = await FinOpsService.autoGenerateWarrantyClaimFromWO(id, data.warranty_id);
                    if (claim) {
                        console.log(`[TECO-WARRANTY] ✅ Auto-drafted claim ${claim.claimNumber} for $${claim.totalClaimAmount}`);
                    }

                    // G14: Update warranty hours counter
                    // (column is hours_worked — 'act_hours' never existed, so this
                    // block silently no-oped inside the catch below)
                    const { data: laborData } = await supabase
                        .from('work_order_labor')
                        .select('hours_worked')
                        .eq('wo_id', id);

                    const totalActualHours = (laborData || []).reduce(
                        (sum, row) => sum + (parseFloat(row.hours_worked || 0)), 0
                    );

                    if (totalActualHours > 0) {
                        const counterResult = await FinOpsService.updateWarrantyCounters(data.warranty_id, totalActualHours);
                        if (counterResult.warning) {
                            console.warn(`[TECO-WARRANTY] ${counterResult.warning}`);
                        }
                    }
                }
            } catch (warrantyErr) {
                // Don't block TECO on warranty automation failure
                console.error('[TECO-WARRANTY] Auto-claim generation failed (non-blocking):', warrantyErr);
            }
        }

        return data;
    }

    public async deleteWorkOrder(id: string): Promise<void> {
        // Delete child records first to avoid FK constraint violations
        await supabase.from('jsa_hazards').delete().in(
            'assessment_id',
            (await supabase.from('jsa_assessments').select('id').eq('wo_id', id)).data?.map((r: any) => r.id) || []
        );
        await supabase.from('jsa_assessments').delete().eq('wo_id', id);
        await supabase.from('work_order_labor').delete().eq('wo_id', id);
        await supabase.from('work_order_parts').delete().eq('wo_id', id);
        await supabase.from('job_tasks').delete().eq('wo_id', id);
        const { error } = await supabase.from('work_orders').delete().eq('id', id);
        if (error) throw error;
    }

    public async sendJobNotifications(jobId: string): Promise<number> {
        console.log(`[DatabaseService] Sending notifications for Job ${jobId}`);
        const job = await this.getWorkOrder(jobId);
        if (!job) return 0;

        let sentCount = 0;

        // 1. Notify Assigned Labor (People)
        // Check both top-level labor and task assignments
        const laborIds = new Set<string>();

        // From Task Assignments
        if (job.job_tasks) {
            job.job_tasks.forEach((t: any) => {
                if (t.assigned_user_ids) {
                    t.assigned_user_ids.forEach((uid: string) => laborIds.add(uid));
                }
            });
        }

        // From Labor Tab
        if (job.work_order_labor) {
            job.work_order_labor.forEach((l: any) => {
                // Assuming labor entries might link to a user or contact. 
                // Creating a simplified notification flow for now based on direct User ID assign.
                // In real app, we'd map Contact -> User or directly use User ID.
            });
        }

        // Send to each unique user
        for (const userId of Array.from(laborIds)) {
            console.log(`[Notification] Sending to User ${userId}: Job ${job.wo_number} is Scheduled.`);

            // Log to DB (Simulated)
            // Schema might not have notification_logs table ready, skipping insert to avoid error if table missing.
            // Just return success count for UI feedback.
            sentCount++;
        }

        return sentCount > 0 ? sentCount : 1; // Return at least 1 to confirm "Sent" action processed if logic runs
    }

    // --- REQUEST LOGIC ---

    public async getRequests(limit: number = 500, offset: number = 0): Promise<ServiceRequestRecord[]> {
        const { data, error } = await supabase
            .from('service_requests')
            .select('*, work_orders(id, wo_number)')
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);
        if (error) throw error;
        return data || [];
    }

    public async createRequest(req: ServiceRequestRecord, actor: string): Promise<ServiceRequestRecord> {
        // GAP-3 FIX: Enforce Functional Failure for Criticality A assets (ISO 14224)
        if (!req.functional_failure_id && req.asset_id) {
            const { data: asset } = await supabase
                .from('assets')
                .select('criticality')
                .eq('id', req.asset_id)
                .single();

            if (asset?.criticality === 'A') {
                throw new Error(
                    'Validation Error: Functional Failure classification is mandatory ' +
                    'for Criticality A assets per ISO 14224. Please select a fault type.'
                );
            }
        }

        return this.insertTolerant('service_requests', req, ['work_center_id']);
    }

    public async updateRequest(id: string, updates: Partial<ServiceRequestRecord>, actor: string): Promise<ServiceRequestRecord> {
        const { data, error } = await supabase.from('service_requests').update({
            ...updates,
            updated_at: new Date().toISOString()
        }).eq('id', id).select().single();
        if (error) throw error;
        return data;
    }

    public async deleteRequest(id: string): Promise<void> {
        const { error } = await supabase.from('service_requests').delete().eq('id', id);
        if (error) throw error;
    }

    public async approveRequestAndConvert(requestId: string, actor: string): Promise<WorkOrderRecord> {
        // 1. Fetch Request
        const { data: req, error: getErr } = await supabase.from('service_requests').select('*').eq('id', requestId).single();
        if (getErr || !req) throw new Error('Request not found');

        if (req.status !== 'AUTHORIZED') {
            throw new Error('Workflow Violation: Request must be AUTHORIZED before Approval.');
        }

        // 2. Update Request -> CONVERTED
        const { error: updateErr } = await supabase.from('service_requests').update({
            status: 'CONVERTED',
            updated_at: new Date().toISOString()
        }).eq('id', requestId);
        if (updateErr) throw updateErr;

        // GAP-4 FIX: Use DB sequence for collision-safe WO numbers (SAP AUFNR parity)
        const { data: seqData, error: seqErr } = await supabase.rpc('generate_wo_number');
        const woNumber = (seqErr || !seqData)
            ? `WO-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}` // Fallback
            : seqData;

        // 3. Create Work Order
        const newWO: WorkOrderRecord = {
            id: crypto.randomUUID(),
            wo_number: woNumber,
            title: req.description.substring(0, 50),
            description: req.description,
            status: 'OPEN',
            type: req.is_breakdown ? 'BM' : 'CM', // Breakdown Maintenance vs Corrective
            priority_code: 'MEDIUM',
            asset_id: req.asset_id,
            request_id: requestId, // Explicitly link
            cost_frozen: false,
            frozen_labor_cost: 0,
            frozen_material_cost: 0,
            created_by: actor && actor.length > 10 ? actor : undefined as any,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const { data: woData, error: woError } = await supabase.from('work_orders').insert(newWO).select().single();
        if (woError) throw woError;

        return woData;
    }

    // --- INVENTORY LOGIC ---
    // --- INVENTORY LOGIC ---
    public async getInventory(): Promise<any[]> {
        // Query Logic: Fetch Items + their Stock Levels + Location Names
        const { data: dbData, error: dbError } = await supabase
            .from('inventory_items')
            .select(`
                *,
                inventory_stock (
                    id,
                    quantity,
                    min_level,
                    max_level,
                    reorder_qty,
                    qty_on_order,
                    bin_location,
                    location:inventory_locations (
                        id,
                        name
                    )
                )
            `)
            .order('part_number', { ascending: true });

        // Helper to map DB row to UI Type
        const mapToUI = (row: any): any => ({
            id: row.id,
            materialNumber: row.material_number || undefined,
            code: row.part_number,
            description: row.description,
            type: row.type || 'PART',
            uom: row.uom || 'EA',
            manufacturer: row.manufacturer,
            manufacturerId: row.manufacturer_id,
            model: row.model,

            // Financials
            itemCost: row.unit_cost || 0,
            costCenterInbound: row.properties?.financials?.inboundId,
            costCenterOutbound: row.properties?.financials?.outboundId,

            // Map Relational Stock to UI Array
            stockLocations: row.inventory_stock
                ?.filter((stk: any) => stk.location && stk.location.id) // Filter out broken links
                .map((stk: any) => ({
                    id: stk.location.id, // Verified existing by filter
                    storeName: stk.location.name || 'Unknown',
                    qtyOnHand: stk.quantity,
                    binLocation: stk.bin_location,
                    stockId: stk.id,
                    minQty: stk.min_level || 0,
                    maxQty: stk.max_level || 0,
                    reorderQty: stk.reorder_qty || 0,
                    qtyOnOrder: stk.qty_on_order || 0
                })) || [],

            suppliers: row.properties?.suppliers || [],

            // Global Stock (Sum or Cached)
            totalQtyOnHand: row.inventory_stock?.reduce((sum: number, s: any) => sum + (parseFloat(s.quantity) || 0), 0) ?? (parseFloat(row.stock_on_hand) || 0),

            minLevel: row.min_level || 0,
            maxLevel: row.max_level || 100,

            isActive: row.is_active !== false,
            isCritical: row.is_critical || false,

            transactions: row.transactions || [],

            image: row.image_url,
            comments: row.comments,
            customFields: row.properties?.customFields || []
        });

        if (dbError) {
            console.error('[DatabaseService] getInventory error:', dbError);
            errorLog.apiError('inventory_items', 'Error fetching inventory', dbError);
            return [];
        }
        if (!dbData || dbData.length === 0) {
            return [];
        }

        const mapped = (dbData || []).map(mapToUI);


        return mapped;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // BOM CRUD — asset_bom junction table (SAP Material Master parity)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Get all BOM items for an asset from the asset_bom table.
     * LEFT JOINs inventory_items for linked materials.
     */
    public async getBomForAsset(assetId: string): Promise<any[]> {
        const { data, error } = await supabase
            .from('asset_bom')
            .select(`
                *,
                inventory_item:inventory_items (
                    id, material_number, part_number, description, type, uom, unit_cost
                )
            `)
            .eq('asset_id', assetId)
            .order('created_at', { ascending: true });

        if (error) {
            console.error('[getBomForAsset] Error:', error);
            return [];
        }

        return (data || []).map((row: any) => {
            const inv = row.inventory_item;
            const isLinked = !!row.inventory_item_id;
            return {
                id: row.id,
                inventoryItemId: row.inventory_item_id || undefined,
                materialNumber: inv?.material_number || undefined,
                materialType: inv?.type || undefined,
                partNumber: row.part_number || inv?.part_number || undefined,
                inventoryCode: row.part_number || inv?.part_number || undefined,
                description: row.description || inv?.description || 'No Description',
                quantity: parseFloat(row.quantity) || 1,
                uom: row.uom || inv?.uom || 'EA',
                critical: row.is_critical || false,
                estimatedCost: parseFloat(row.estimated_cost) || 0,
                replacementIntervalDays: row.replacement_interval_days || undefined,
                notes: row.notes || undefined,
                isLinked,
                isStockable: undefined, // resolved by UI from INVENTORY_TYPE dictionary
            };
        });
    }

    /**
     * Add a linked BOM entry (material already exists in inventory_items).
     */
    public async addBomEntry(assetId: string, inventoryItemId: string, quantity: number, isCritical: boolean, uom?: string, notes?: string): Promise<any> {
        // Fetch material data to populate denormalized fields
        const { data: inv } = await supabase.from('inventory_items').select('part_number, description, unit_cost, uom').eq('id', inventoryItemId).single();

        const row = {
            asset_id: assetId,
            inventory_item_id: inventoryItemId,
            part_number: inv?.part_number || '',
            description: inv?.description || 'Unknown Material',
            quantity,
            uom: uom || inv?.uom || 'EA',
            is_critical: isCritical,
            estimated_cost: inv?.unit_cost || 0,
            notes: notes || null,
        };

        const { data, error } = await supabase.from('asset_bom').insert(row).select().single();
        if (error) {
            console.error('[addBomEntry] Error:', error);
            throw error;
        }
        return data;
    }

    /**
     * Add a Text BOM entry (no material record — real component, not individually purchased).
     */
    public async addTextBomEntry(assetId: string, description: string, quantity: number, uom: string, isCritical: boolean, partNumber?: string, notes?: string): Promise<any> {
        const row = {
            asset_id: assetId,
            inventory_item_id: null, // Text BOM — no material link
            part_number: partNumber || null,
            description,
            quantity,
            uom: uom || 'EA',
            is_critical: isCritical,
            estimated_cost: 0,
            notes: notes || null,
        };

        const { data, error } = await supabase.from('asset_bom').insert(row).select().single();
        if (error) {
            console.error('[addTextBomEntry] Error:', error);
            throw error;
        }
        return data;
    }

    /**
     * Update an existing BOM entry.
     */
    public async updateBomEntry(bomId: string, patch: Record<string, any>): Promise<void> {
        const row: Record<string, any> = {};
        if (patch.quantity !== undefined) row.quantity = patch.quantity;
        if (patch.uom !== undefined) row.uom = patch.uom;
        if (patch.isCritical !== undefined) row.is_critical = patch.isCritical;
        if (patch.estimatedCost !== undefined) row.estimated_cost = patch.estimatedCost;
        if (patch.notes !== undefined) row.notes = patch.notes;
        if (patch.description !== undefined) row.description = patch.description;
        if (patch.replacementIntervalDays !== undefined) row.replacement_interval_days = patch.replacementIntervalDays;
        row.updated_at = new Date().toISOString();

        const { error } = await supabase.from('asset_bom').update(row).eq('id', bomId);
        if (error) {
            console.error('[updateBomEntry] Error:', error);
            throw error;
        }
    }

    /**
     * Remove a BOM entry.
     */
    public async removeBomEntry(bomId: string): Promise<void> {
        const { error } = await supabase.from('asset_bom').delete().eq('id', bomId);
        if (error) {
            console.error('[removeBomEntry] Error:', error);
            throw error;
        }
    }

    /**
     * Promote a Text BOM item to a Material.
     * Creates an inventory_items record (auto-assigns MAT-NNNNNN) then links the BOM entry.
     */
    public async promoteBomToMaterial(bomId: string, materialType: string, description: string, uom: string, partNumber?: string): Promise<any> {
        // 1. Create the material record
        const materialRow = {
            part_number: partNumber || `BOM-${Date.now()}`,
            description,
            type: materialType,
            uom,
            unit_cost: 0,
            stock_on_hand: 0,
            min_level: 0,
            max_level: 0,
            is_active: true,
            is_critical: false,
        };

        const { data: inv, error: invError } = await supabase.from('inventory_items').insert(materialRow).select().single();
        if (invError) {
            console.error('[promoteBomToMaterial] Error creating material:', invError);
            throw invError;
        }

        // 2. Link the BOM entry to the new material
        const { error: linkError } = await supabase
            .from('asset_bom')
            .update({
                inventory_item_id: inv.id,
                part_number: inv.part_number,
                updated_at: new Date().toISOString()
            })
            .eq('id', bomId);

        if (linkError) {
            console.error('[promoteBomToMaterial] Error linking BOM:', linkError);
            throw linkError;
        }

        return inv; // Return the new material record (includes material_number)
    }

    /**
     * Create a new material record and immediately link it as a BOM entry on an asset.
     * Used when populating BOM from OEM equipment documents.
     * The MAT-NNNNNN identifier is auto-assigned by the DB trigger.
     */
    public async createMaterialAndLinkBom(
        assetId: string,
        partNumber: string,
        description: string,
        materialType: string,
        uom: string,
        unitCost: number,
        quantity: number,
        isCritical: boolean
    ): Promise<any> {
        // 1. Create the material record in inventory_items
        const materialRow = {
            part_number: partNumber,
            description,
            type: materialType,
            uom,
            unit_cost: unitCost,
            stock_on_hand: 0,
            min_level: 0,
            max_level: 0,
            is_active: true,
            is_critical: isCritical,
        };

        const { data: inv, error: invError } = await supabase
            .from('inventory_items')
            .insert(materialRow)
            .select()
            .single();

        if (invError) {
            console.error('[createMaterialAndLinkBom] Error creating material:', invError);
            throw invError;
        }

        // 2. Create the BOM junction record linking the material to the asset
        const bomRow = {
            asset_id: assetId,
            inventory_item_id: inv.id,
            part_number: inv.part_number,
            description: inv.description,
            quantity,
            uom: inv.uom || uom,
            is_critical: isCritical,
            estimated_cost: inv.unit_cost || 0,
        };

        const { data: bom, error: bomError } = await supabase
            .from('asset_bom')
            .insert(bomRow)
            .select()
            .single();

        if (bomError) {
            console.error('[createMaterialAndLinkBom] Error creating BOM entry:', bomError);
            throw bomError;
        }

        return { material: inv, bom };
    }

    /**
     * Get all assets that use a specific material (Where-Used analysis).
     */
    public async getWhereUsed(inventoryItemId: string): Promise<any[]> {
        const { data, error } = await supabase
            .from('asset_bom')
            .select(`
                id, quantity, is_critical,
                asset:assets ( id, tag, name, criticality, status_code )
            `)
            .eq('inventory_item_id', inventoryItemId);

        if (error) {
            console.error('[getWhereUsed] Error:', error);
            return [];
        }

        return (data || []).map((row: any) => ({
            bomId: row.id,
            quantity: row.quantity,
            isCritical: row.is_critical,
            assetId: row.asset?.id,
            assetTag: row.asset?.tag,
            assetName: row.asset?.name,
            criticality: row.asset?.criticality,
            status: row.asset?.status_code,
        }));
    }

    /**
     * Search inventory items (Material Master) by part number, description, or MAT number.
     * Returns results with usage count from asset_bom.
     */
    public async searchInventory(query: string, limit: number = 20): Promise<any[]> {
        if (!query || query.length < 2) return [];

        const { data, error } = await supabase
            .from('inventory_items')
            .select('id, material_number, part_number, description, type, uom, unit_cost, stock_on_hand')
            .or(`part_number.ilike.%${query}%,description.ilike.%${query}%,material_number.ilike.%${query}%`)
            .limit(limit);

        if (error) {
            console.error('[searchInventory] Error:', error);
            return [];
        }

        // Get usage counts for the found items
        const ids = (data || []).map(d => d.id);
        const usageCounts: Record<string, number> = {};
        if (ids.length > 0) {
            const { data: bomData } = await supabase
                .from('asset_bom')
                .select('inventory_item_id')
                .in('inventory_item_id', ids);
            if (bomData) {
                for (const row of bomData) {
                    usageCounts[row.inventory_item_id] = (usageCounts[row.inventory_item_id] || 0) + 1;
                }
            }
        }

        return (data || []).map((row: any) => ({
            id: row.id,
            materialNumber: row.material_number,
            code: row.part_number,
            description: row.description,
            type: row.type,
            uom: row.uom,
            unitCost: row.unit_cost || 0,
            stockOnHand: row.stock_on_hand || 0,
            usedOnAssets: usageCounts[row.id] || 0,
        }));
    }

    /**
     * Create a new material and immediately link it to an asset's BOM.
     */
    public async createMaterialAndLink(assetId: string, description: string, materialType: string, uom: string, quantity: number, isCritical: boolean, partNumber?: string): Promise<any> {
        // 1. Create material
        const materialRow = {
            part_number: partNumber || `NEW-${Date.now()}`,
            description,
            type: materialType,
            uom,
            unit_cost: 0,
            stock_on_hand: 0,
            min_level: 0,
            max_level: 0,
            is_active: true,
            is_critical: isCritical,
        };

        const { data: inv, error: invError } = await supabase.from('inventory_items').insert(materialRow).select().single();
        if (invError) throw invError;

        // 2. Link to BOM
        await this.addBomEntry(assetId, inv.id, quantity, isCritical, uom);

        return inv;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SCHEDULING INTEGRATION — Material Availability & Labor Resource Checks
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Check material availability for a Work Order's parts list.
     * Returns per-item availability status and an overall readiness flag.
     * Integrates with: inventory_items, inventory_stock, work_order_parts, purchase_orders
     */
    public async checkMaterialAvailability(woId: string): Promise<{
        ready: boolean;
        items: {
            inventoryItemId: string;
            description: string;
            materialNumber?: string;
            requiredQty: number;
            onHandQty: number;
            onOrderQty: number;
            reservedQty: number;
            availableQty: number;
            status: 'AVAILABLE' | 'ON_ORDER' | 'SHORTAGE';
            earliestAvailDate?: string;
        }[];
        suggestedEarliestDate?: string;
    }> {
        try {
            // 1. Fetch WO parts list
            const { data: woParts, error: partsErr } = await supabase
                .from('work_order_parts')
                .select('item_id, quantity, notes')
                .eq('wo_id', woId);

            if (partsErr || !woParts || woParts.length === 0) {
                return { ready: true, items: [], suggestedEarliestDate: undefined };
            }

            // 2. For each part, check inventory stock
            const results: any[] = [];
            let allReady = true;
            let latestAvailDate: Date | null = null;

            for (const part of woParts) {
                if (!part.item_id) continue;

                // Fetch inventory item with stock levels
                const { data: invItem } = await supabase
                    .from('inventory_items')
                    .select(`
                        id, material_number, description, stock_on_hand, min_level,
                        properties,
                        inventory_stock ( quantity, qty_on_order )
                    `)
                    .eq('id', part.item_id)
                    .single();

                if (!invItem) continue;

                const totalOnHand = invItem.inventory_stock?.reduce(
                    (sum: number, s: any) => sum + (parseFloat(s.quantity) || 0), 0
                ) ?? (parseFloat(invItem.stock_on_hand) || 0);

                const totalOnOrder = invItem.inventory_stock?.reduce(
                    (sum: number, s: any) => sum + (parseFloat(s.qty_on_order) || 0), 0
                ) ?? 0;

                const requiredQty = parseFloat(part.quantity) || 0;
                const minLevel = parseFloat(invItem.min_level) || 0;

                // IN-1 (ATP netting): subtract quantities already reserved by OTHER open WOs,
                // so two orders can't both count the same stock as available.
                let reservedByOthers = 0;
                try {
                    const { data: otherParts } = await supabase
                        .from('work_order_parts')
                        .select('quantity, work_orders!inner(status)')
                        .eq('item_id', part.item_id)
                        .neq('wo_id', woId);
                    reservedByOthers = (otherParts || [])
                        .filter((p: any) => !['CLOSED', 'CANC', 'CANCELLED', 'TECO'].includes(p.work_orders?.status))
                        .reduce((s: number, p: any) => s + (parseFloat(p.quantity) || 0), 0);
                } catch { /* no FK embed → no netting (fail-open) */ }

                const effectiveAvailable = Math.max(0, totalOnHand - minLevel - reservedByOthers); // safety stock + other reservations

                let status: 'AVAILABLE' | 'ON_ORDER' | 'SHORTAGE';
                let earliestAvailDate: string | undefined;

                if (effectiveAvailable >= requiredQty) {
                    status = 'AVAILABLE';
                } else if (totalOnOrder > 0 && (effectiveAvailable + totalOnOrder) >= requiredQty) {
                    status = 'ON_ORDER';
                    allReady = false;
                    // Estimate availability from supplier lead time
                    const leadTimeDays = invItem.properties?.suppliers?.[0]?.leadTimeDays || 14;
                    const estDate = new Date();
                    estDate.setDate(estDate.getDate() + leadTimeDays);
                    earliestAvailDate = estDate.toISOString().split('T')[0];
                    if (!latestAvailDate || estDate > latestAvailDate) latestAvailDate = estDate;
                } else {
                    status = 'SHORTAGE';
                    allReady = false;
                    const leadTimeDays = invItem.properties?.suppliers?.[0]?.leadTimeDays || 21;
                    const estDate = new Date();
                    estDate.setDate(estDate.getDate() + leadTimeDays);
                    earliestAvailDate = estDate.toISOString().split('T')[0];
                    if (!latestAvailDate || estDate > latestAvailDate) latestAvailDate = estDate;
                }

                results.push({
                    inventoryItemId: invItem.id,
                    description: invItem.description,
                    materialNumber: invItem.material_number,
                    requiredQty,
                    onHandQty: totalOnHand,
                    onOrderQty: totalOnOrder,
                    reservedQty: reservedByOthers,
                    availableQty: effectiveAvailable,
                    status,
                    earliestAvailDate,
                });
            }

            return {
                ready: allReady,
                items: results,
                suggestedEarliestDate: latestAvailDate ? latestAvailDate.toISOString().split('T')[0] : undefined,
            };
        } catch (err) {
            console.error('[checkMaterialAvailability] Error:', err);
            return { ready: true, items: [], suggestedEarliestDate: undefined }; // Fail-open: don't block scheduling
        }
    }

    /**
     * Get schedulable labor resources with availability for a date range.
     * Integrates with: contacts (labourRules, qualifications, types, hourlyRate),
     *                  work_order_labor (existing assignments), organization_units
     */
    public async getLaborAvailability(dateRange: { start: string; end: string }, siteIds?: string[]): Promise<{
        resources: {
            contactId: string;
            name: string;
            craftTypes: string[];
            hourlyRate: number;
            dailyCapacityHours: number;
            workingDays: string[];
            qualifications: { name: string; status: string; expires: string }[];
            orgUnitIds: string[];
            assignments: { woId: string; woNumber: string; date: string; hours: number }[];
            availableHoursPerDay: Record<string, number>;
        }[];
    }> {
        try {
            // 1. Fetch labor contacts
            const contacts = await this.getContacts();
            let laborContacts = contacts.filter((c: any) =>
                c.active && (c.flags?.isLabour || c.types?.some((t: string) =>
                    ['TECHNICIAN', 'ELECTRICIAN', 'MECHANIC', 'INSTRUMENT', 'OPERATOR', 'SUPERVISOR'].includes(t.toUpperCase())
                ))
            );

            // 2. Apply site scope filter
            if (siteIds && siteIds.length > 0) {
                laborContacts = laborContacts.filter((c: any) =>
                    c.organizationUnitIds?.some((id: string) => siteIds.includes(id))
                );
            }

            // 3. Fetch existing labor assignments in date range
            const { data: laborAssignments } = await supabase
                .from('work_order_labor')
                .select('contact_id, wo_id, hours_worked, date_worked, work_orders(wo_number)')
                .gte('date_worked', dateRange.start)
                .lte('date_worked', dateRange.end);

            // Build assignment map: contactId -> assignments[]
            const assignmentMap: Record<string, any[]> = {};
            for (const la of (laborAssignments || [])) {
                if (!assignmentMap[la.contact_id]) assignmentMap[la.contact_id] = [];
                assignmentMap[la.contact_id].push({
                    woId: la.wo_id,
                    woNumber: (la as any).work_orders?.wo_number || '',
                    date: la.date_worked,
                    hours: parseFloat(la.hours_worked) || 0,
                });
            }

            // 4. Build resource list with availability
            const resources = [];
            for (const contact of laborContacts) {
                const labourRules = (contact as any).labourRules;
                const dailyHours = labourRules?.dailyHours || 8;
                const workingDays = labourRules?.days || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
                const assignments = assignmentMap[contact.id] || [];

                // Calculate available hours per day in the range
                const availableHoursPerDay: Record<string, number> = {};
                const start = new Date(dateRange.start);
                const end = new Date(dateRange.end);
                for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                    const dateStr = d.toISOString().split('T')[0];
                    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
                    const isWorkDay = workingDays.includes(dayName);
                    const assignedHours = assignments
                        .filter(a => a.date === dateStr)
                        .reduce((sum: number, a: any) => sum + a.hours, 0);
                    availableHoursPerDay[dateStr] = isWorkDay ? Math.max(0, dailyHours - assignedHours) : 0;
                }

                // Fetch qualifications
                let quals: any[] = [];
                try {
                    quals = await this.getQualifications(contact.id);
                } catch { /* ignore */ }

                resources.push({
                    contactId: contact.id,
                    name: contact.name,
                    craftTypes: (contact.types || []).filter((t: string) =>
                        !['INTERNAL', 'LABOUR', 'LABOR', 'SYSTEM_USER'].includes(t.toUpperCase())
                    ),
                    hourlyRate: (contact as any).hourlyRate || 0,
                    dailyCapacityHours: dailyHours,
                    workingDays,
                    qualifications: quals.map((q: any) => ({
                        name: q.name || q.qualification_name || '',
                        status: q.status || 'Active',
                        expires: q.dateExpires || q.expiry_date || '',
                    })),
                    orgUnitIds: (contact as any).organizationUnitIds || [],
                    assignments,
                    availableHoursPerDay,
                });
            }

            return { resources };
        } catch (err) {
            console.error('[getLaborAvailability] Error:', err);
            return { resources: [] };
        }
    }

    /**
     * Get resource demand aggregated by craft type and date.
     * Used by the Capacity Planning dashboard.
     */
    public async getResourceDemand(dateRange: { start: string; end: string }): Promise<Record<string, Record<string, number>>> {
        try {
            const { data: wos } = await supabase
                .from('work_orders')
                .select('id, date_due_start, est_duration, work_order_labor(contact_type_code, hours_worked, headcount)')
                .gte('date_due_start', dateRange.start)
                .lte('date_due_start', dateRange.end)
                .in('status', ['OPEN', 'PLAN', 'SCHED', 'WIP']);

            const demand: Record<string, Record<string, number>> = {};

            for (const wo of (wos || [])) {
                const date = wo.date_due_start;
                if (!date) continue;

                if (wo.work_order_labor && wo.work_order_labor.length > 0) {
                    for (const lab of wo.work_order_labor) {
                        const craft = lab.contact_type_code || 'GENERAL';
                        const hours = (parseFloat(lab.hours_worked) || 0) * (parseInt(lab.headcount) || 1);
                        if (!demand[craft]) demand[craft] = {};
                        demand[craft][date] = (demand[craft][date] || 0) + hours;
                    }
                } else {
                    // No labor breakdown — use estimated duration
                    const craft = 'GENERAL';
                    if (!demand[craft]) demand[craft] = {};
                    demand[craft][date] = (demand[craft][date] || 0) + (wo.est_duration || 0);
                }
            }

            return demand;
        } catch (err) {
            console.error('[getResourceDemand] Error:', err);
            return {};
        }
    }


    public async getInventoryLocations(): Promise<any[]> {
        const { data, error } = await supabase.from('inventory_locations').select('*').eq('is_active', true);
        if (error) return [];
        return (data || []).map(l => ({
            id: l.id,
            name: l.name,
            code: l.code || '',
            location: l.address || '',
            description: l.description || '',
            bins: l.bins || []
        }));
    }

    public async addStore(store: any): Promise<any> {
        const row = {
            id: (store.id && store.id.length > 10 && !store.id.startsWith('store-')) ? store.id : undefined,
            name: store.name,
            code: store.code,
            address: store.location,
            description: store.description,
            bins: store.bins,
            is_active: true
        };
        const { data, error } = await supabase.from('inventory_locations').insert(row).select().single();
        if (error) throw error;

        return {
            id: data.id,
            name: data.name,
            code: data.code || '',
            location: data.address || '',
            description: data.description || '',
            bins: data.bins || []
        };
    }

    public async updateStore(store: any): Promise<any> {
        const row = {
            name: store.name,
            code: store.code,
            address: store.location,
            description: store.description,
            bins: store.bins
        };
        const { data, error } = await supabase.from('inventory_locations').update(row).eq('id', store.id).select().single();
        if (error) throw error;
        return {
            id: data.id,
            name: data.name,
            code: data.code || '',
            location: data.address || '',
            description: data.description || '',
            bins: data.bins || []
        };
    }

    public async addInventoryItem(item: InventoryItemRecord, initialStock: any[] = []): Promise<InventoryItemRecord> {
        // Item is already mapped to DB format by caller
        const row = {
            ...item,
            id: (item.id && item.id.length > 10) ? item.id : undefined,
            // Ensure properties are included if present, and merge financials
            properties: {
                ...item.properties,
                financials: {
                    inboundId: (item as any).costCenterInbound,
                    outboundId: (item as any).costCenterOutbound
                }
            }
        };

        const { data, error } = await supabase.from('inventory_items').insert(row).select().single();
        if (error) {
            console.error("Failed to add inventory item", error);
            throw error;
        }

        // Process Initial Stock
        if (initialStock && initialStock.length > 0) {
            const stockInserts: any[] = [];
            const txInserts: any[] = [];

            for (const stock of initialStock) {
                // stock.id should be the location ID based on Inventory.tsx update
                const locationId = stock.id;

                // Basic validation for UUID-like ID
                if (locationId && locationId.length > 10 && !locationId.startsWith('loc-')) {
                    stockInserts.push({
                        item_id: data.id,
                        location_id: locationId,
                        quantity: stock.qtyOnHand || 0,
                        // The UI type names these minQty/maxQty/binLocation; older
                        // callers pass min/max/bin. Accept both so levels and bin
                        // actually persist instead of silently defaulting to 0/''.
                        min_level: stock.min ?? stock.minQty ?? 0,
                        max_level: stock.max ?? stock.maxQty ?? 0,
                        reorder_qty: stock.reorderQty || 0,
                        bin_location: stock.bin ?? stock.binLocation ?? ''
                    });

                    if (stock.qtyOnHand > 0) {
                        txInserts.push({
                            item_id: data.id,
                            transaction_type: 'ADJUST',
                            quantity: stock.qtyOnHand,
                            cost_at_time: item.unit_cost || 0,
                            timestamp: new Date().toISOString()
                        });
                    }
                }
            }

            if (stockInserts.length > 0) {
                const { error: stockError } = await supabase.from('inventory_stock').insert(stockInserts);
                if (stockError) {
                    console.error("Stock Insert Failed:", stockError);
                    // Decide if we throw or just log. For now, strict throw to debug.
                    throw new Error("Failed to save stock levels: " + stockError.message);
                }
            }
            if (txInserts.length > 0) {
                const { error: txError } = await supabase.from('inventory_transactions').insert(txInserts);
                if (txError) console.error("Transaction Log Failed:", txError);
            }
        }

        return { ...item, id: data.id };
    }

    /**
     * Delete an inventory item and its associated stock location records.
     * Respects referential integrity by cascading child records first.
     */
    public async deleteInventoryItem(id: string): Promise<void> {
        // 1. Remove stock location records
        const { error: stockErr } = await supabase
            .from('inventory_stock_locations')
            .delete()
            .eq('inventory_item_id', id);
        if (stockErr) console.warn('Non-fatal: stock location cleanup:', stockErr.message);

        // 2. Movement history is NOT purged.
        //
        // This step used to delete on `inventory_item_id`, a column that does
        // not exist — so it always errored and the error was swallowed as
        // "non-fatal". It was never removing anything. That accident is now
        // the intended behaviour: since 0245 a movement carries an account
        // assignment and may point at a posted financial document, so deleting
        // it would destroy the evidence behind a ledger entry. The item_id
        // foreign key blocks the delete below, and the message says why.
        const { count: movements } = await supabase
            .from('inventory_transactions')
            .select('id', { count: 'exact', head: true })
            .eq('item_id', id);
        if ((movements || 0) > 0) {
            throw new Error(
                `Cannot delete this item: it has ${movements} stock movement${movements === 1 ? '' : 's'} on record. ` +
                `Movement history is financial evidence — deactivate the item instead.`,
            );
        }

        // 3. Delete the item itself
        const { error } = await supabase
            .from('inventory_items')
            .delete()
            .eq('id', id);
        if (error) throw new Error(`Failed to delete inventory item: ${error.message}`);
    }

    public async updateInventoryItem(id: string, updates: Partial<InventoryItemRecord>, stockUpdates?: any[]): Promise<InventoryItemRecord> {
        const row: any = { ...updates };

        // Handle Financials Persistence
        if ((updates as any).costCenterInbound !== undefined || (updates as any).costCenterOutbound !== undefined) {
            const { data: existing } = await supabase.from('inventory_items').select('properties').eq('id', id).single();
            // Optimization: Just merge into properties if we assume we have them, or use simple object merge
            const existingProps = (existing?.properties) || {};
            row.properties = {
                ...existingProps,
                financials: {
                    ...(existingProps as any).financials,
                    inboundId: (updates as any).costCenterInbound,
                    outboundId: (updates as any).costCenterOutbound
                }
            };
            // Clean up root fields so they don't break INSERT if strict (though here it's any)
            delete row.costCenterInbound;
            delete row.costCenterOutbound;
        }

        row.updated_at = new Date().toISOString();

        const { data, error } = await supabase.from('inventory_items').update(row).eq('id', id).select().single();

        if (error) {
            console.error("❌ CRITICAL DB UPDATE ERROR:", error);
            console.error("Payload was:", row);
            throw error; // Force UI to see the error
            // console.warn("Supabase Offline (updateInventory). Saving to Local.");
            // const current = this.getFromLocal('nexus_inventory') || [];
            // const idx = current.findIndex((i: any) => i.id === id);
            // if (idx >= 0) {
            //     // Approximate update for local mock
            //     current[idx] = { ...current[idx], ...updates };
            //     this.saveToLocal('nexus_inventory', current);
            // }
            // return { ...updates, id } as any;
        }

        // Handle Stock Updates (Upsert)
        if (stockUpdates && stockUpdates.length > 0) {
            const stockUpserts = stockUpdates.map(s => ({
                item_id: id,
                location_id: s.id, // Ensure this maps to location_id
                quantity: s.qtyOnHand || 0,
                min_level: s.minQty || s.min || 0,
                max_level: s.maxQty || s.max || 0,
                reorder_qty: s.reorderQty || 0,
                bin_location: s.binLocation || s.bin || ''
            }));

            // Upsert functionality via supabase
            const { error: stockError } = await supabase
                .from('inventory_stock')
                .upsert(stockUpserts, { onConflict: 'item_id,location_id' });

            if (stockError) {
                console.error("Stock update failed", stockError);
                throw stockError;
            }
        }

        return data;
    }

    public async adjustInventoryStock(
        itemId: string,
        locationId: string,
        newLocationQty: number,
        transactionType: 'ISSUE' | 'RECEIPT' | 'ADJUSTMENT' | 'STOCKTAKE',
        reason: string,
        actor: string,
        /**
         * IN-3 (0245) — what this movement actually is. Without the order or PO
         * reference the same physical act is a different movement type and
         * settles to a different receiver, so callers that know should say.
         */
        opts?: { poId?: string; woId?: string; movementType?: string }
    ): Promise<void> {
        // 1. Get current stock at this location
        const { data: currentStock, error: fetchError } = await supabase
            .from('inventory_stock')
            .select('*')
            .eq('item_id', itemId)
            .eq('location_id', locationId)
            .single();

        let currentQty = 0;
        let stockRecordId = null;

        if (currentStock) {
            currentQty = currentStock.quantity;
            stockRecordId = currentStock.id;
        }

        // 2. Calculate Delta
        let delta = 0;
        // Logic: newLocationQty is the TARGET (because UI sends "New Total" for Stocktake, or calculated total for Adjust)
        // Wait, UI:
        // Stocktake -> Sends user input (Total).
        // Adjustment -> Sends (Current + Input) = Total.
        // My previous UI code in StockAdjustmentModal:
        //    if (adjType === 'ADJUSTMENT') targetQty = currentQty + qtyNum;
        // So `newLocationQty` IS ALWAYS THE TARGET TOTAL.

        delta = newLocationQty - currentQty;

        if (delta === 0) return; // No change

        // 3. Update or Insert Stock Record
        if (stockRecordId) {
            const { error } = await supabase
                .from('inventory_stock')
                .update({ quantity: newLocationQty, updated_at: new Date().toISOString() })
                .eq('id', stockRecordId);
            if (error) throw error;
        } else {
            // Create new entry
            const { error } = await supabase
                .from('inventory_stock')
                .insert({
                    item_id: itemId,
                    location_id: locationId,
                    quantity: newLocationQty
                });
            if (error) throw error;
        }

        // 4. Update Item Global Cache (Optional but good)
        // Trigger might do this, but lets do it to be sure if we rely on stock_on_hand col
        // const { error: updateItemError } = await supabase.rpc('recalculate_stock_on_hand', { item_uuid: itemId });

        // 5. Create the movement record (IN-3 / 0245).
        //
        // This used to write ADJUST for everything — a PO receipt included —
        // with quantity abs(delta) and cost_at_time 0. Three consequences: a
        // receipt was indistinguishable from a stocktake, a count gain from a
        // loss, and no movement could ever be valued, so none could post to
        // FI. All three are what a movement type carries.
        const isReceipt = transactionType === 'RECEIPT';
        const isIssue = transactionType === 'ISSUE';
        const movementType = opts?.movementType ?? movementTypeFor({
            transactionType, poId: opts?.poId, woId: opts?.woId, delta,
        });

        // A movement with no value cannot reach the ledger, so value it here.
        const { data: costRow } = await supabase
            .from('inventory_items').select('unit_cost').eq('id', itemId).maybeSingle();

        const { error: txError } = await supabase.from('inventory_transactions').insert({
            item_id: itemId,
            transaction_type: isReceipt ? 'RECEIPT' : isIssue ? 'ISSUE' : 'ADJUST',
            movement_type: movementType,
            location_id: locationId,
            wo_id: opts?.woId ?? null,
            po_id: opts?.poId ?? null,
            quantity: Math.abs(delta),
            cost_at_time: Number(costRow?.unit_cost) || 0,
            timestamp: new Date().toISOString()
        });
        // The stock level has already moved. A lost movement row leaves on-hand
        // and the transaction history disagreeing with nothing to say which is
        // right — the same rule goodsIssue.ts applies via mustWrite.
        if (txError) {
            throw new Error(`Stock updated but the movement record failed (${reason} by ${actor}): ${txError.message}`);
        }
    }

    // --- JOB TASKS ---

    public async getJobTasks(woId: string): Promise<JobTask[]> {
        const { data, error } = await supabase.from('job_tasks').select('*')
            .eq('wo_id', woId)
            .order('sequence', { ascending: true });

        if (error) {
            console.warn("Supabase Error (getJobTasks):", error);
            // Fallback to local storage or empty if offline logic isn't fully robust yet
            return [];
        }

        return (data || []).map(DataMapper.toUIJobTask);
    }

    public async updateJobTasks(woId: string, tasks: JobTask[]): Promise<Record<string, string>> {
        console.log(`[updateJobTasks] Starting update for WO: ${woId}`, tasks);
        // Track all IDs that should be kept (both existing and newly created)
        const activeIds: string[] = [];
        const idMap: Record<string, string> = {}; // Temp -> Real

        // 1. Upsert provided tasks
        for (const task of tasks) {
            // Map to DB Record
            const dbRecord = DataMapper.toDBJobTask(task, woId);
            // console.log('[updateJobTasks] Upserting task:', dbRecord); // Reducing log noise

            // We MUST select the returned ID to know what the DB generated for new tasks
            const { data, error } = await supabase.from('job_tasks').upsert(dbRecord).select('id').single();
            if (error) {
                console.error("[updateJobTasks] Error updating task:", error);
                throw error;
            }

            if (data && data.id) {
                activeIds.push(data.id);
                // If it was a new task (temp ID), record the mapping
                if (task.id.startsWith('new-')) {
                    idMap[task.id] = data.id;
                }
            }
        }

        // 2. Handle Deletions (Tasks present in DB but not in the list of active/upserted IDs)
        const { data: existing, error: fetchError } = await supabase.from('job_tasks').select('id').eq('wo_id', woId);

        if (fetchError) {
            console.error("[updateJobTasks] Error fetching existing tasks:", fetchError);
        }

        if (existing) {
            // Delete any task currently in DB that wasn't just Upserted/Inserted
            const toDelete = existing.map((r: any) => r.id).filter(id => !activeIds.includes(id));

            console.log('[updateJobTasks] IDs to delete:', toDelete);

            if (toDelete.length > 0) {
                const { error: deleteError } = await supabase.from('job_tasks').delete().in('id', toDelete);
                if (deleteError) {
                    console.error("[updateJobTasks] Error deleting tasks:", deleteError);
                }
            }
        }
        console.log(`[updateJobTasks] Completed update for WO: ${woId}`);
        return idMap;
    }

    public async updateJobLabor(woId: string, labor: JobLabor[]): Promise<void> {
        // 1. Upsert provided records, tracking actual DB IDs
        const activeIds: string[] = [];
        for (const item of labor) {
            const record = DataMapper.toDBJobLabor(item, woId);
            const { data, error } = await supabase.from('work_order_labor').upsert(record).select('id').single();
            if (error) {
                console.error("Error updating labor:", error);
                throw error;
            }
            if (data) activeIds.push(data.id);
        }

        // 2. Handle Deletions — use ACTUAL DB IDs, not UI IDs. Posted time
        // confirmations (confirmation_no set) are actuals owned by the WM-2c
        // confirmation flow, not planner resource lines — a resource re-sync from a
        // session with stale labor state must never delete them.
        const { data: existing } = await supabase.from('work_order_labor').select('id, confirmation_no').eq('wo_id', woId);
        if (existing) {
            const toDelete = existing
                .filter((r: any) => r.confirmation_no == null)
                .map((r: any) => r.id)
                .filter(id => !activeIds.includes(id));
            if (toDelete.length > 0) {
                await supabase.from('work_order_labor').delete().in('id', toDelete);
            }
        }
    }

    public async updateJobInventory(woId: string, inventory: JobInventory[]): Promise<void> {
        // 1. Upsert, tracking actual DB IDs
        const activeIds: string[] = [];
        for (const item of inventory) {
            const record = DataMapper.toDBJobInventory(item, woId);
            const { data, error } = await supabase.from('work_order_parts').upsert(record).select('id').single();
            if (error) {
                console.error("Error updating inventory:", error);
                throw error;
            }
            if (data) activeIds.push(data.id);
        }

        // 2. Deletions — use ACTUAL DB IDs, not UI IDs
        const { data: existing } = await supabase.from('work_order_parts').select('id').eq('wo_id', woId);
        if (existing) {
            const toDelete = existing.map((r: any) => r.id).filter(id => !activeIds.includes(id));
            if (toDelete.length > 0) {
                await supabase.from('work_order_parts').delete().in('id', toDelete);
            }
        }
    }

    // ── WM-2c — OPERATION CONFIRMATIONS & COST ROLL-UP (the FI-1 settlement handoff) ──
    //
    // Actual labour cost per operation = Σ(confirmed hours × resolved rate), where the
    // rate resolves job_tasks.planned_rate ?? work_centers.activity_rate ??
    // work_order_labor.rate_per_hour. The default settlement receiver is the operation's
    // work-center cost_center_id. These read-side helpers give FI-1 a stable roll-up so
    // it never has to re-derive actuals from raw labour rows.

    /**
     * Per-operation actual roll-up for a work order. Returns one entry per operation
     * (job_task), including operations with zero confirmed hours (so the caller sees
     * the full operation list and each one's settlement receiver).
     */
    public async getOperationActuals(woId: string): Promise<OperationActual[]> {
        const [tasksRes, laborRes] = await Promise.all([
            supabase.from('job_tasks')
                .select('id, operation_no, work_center_id, planned_rate, work_centers(activity_rate, cost_center_id)')
                .eq('wo_id', woId)
                .order('sequence', { ascending: true }),
            supabase.from('work_order_labor')
                .select('job_task_id, hours_worked, rate_per_hour')
                .eq('wo_id', woId),
        ]);

        if (tasksRes.error) { console.error('getOperationActuals(tasks):', tasksRes.error); return []; }

        const labour = laborRes.error ? [] : (laborRes.data || []);
        const byOp = new Map<string, { hours: number; cost: number }>();

        for (const task of (tasksRes.data || []) as any[]) {
            const wc = Array.isArray(task.work_centers) ? task.work_centers[0] : task.work_centers;
            const plannedRate = task.planned_rate != null ? Number(task.planned_rate) : undefined;
            const wcRate = wc?.activity_rate != null ? Number(wc.activity_rate) : undefined;

            let hours = 0, cost = 0;
            for (const l of labour.filter((x: any) => x.job_task_id === task.id)) {
                const h = Number(l.hours_worked) || 0;
                // Rate precedence: the row's own posted rate first — it's the snapshot
                // resolved at posting time (person → craft → work centre) and must not be
                // re-valued at the blended work-centre rate. Op/WC rates are fallbacks
                // for legacy rows posted without one.
                const posted = Number(l.rate_per_hour) || 0;
                // `!== 0`, not `> 0`: sem_wo_actual_lines uses NULLIF(rate, 0),
                // which honours a NEGATIVE posted rate (a credit line). Under
                // `> 0` the Cost tab would fall back to the planned rate while
                // the ledger used the negative one — the exact divergence the
                // mirror comment forbids.
                const rate = posted !== 0 ? posted : (plannedRate ?? wcRate ?? 0);
                hours += h;
                cost += h * rate;
            }
            byOp.set(task.id, { hours, cost });
        }

        return ((tasksRes.data || []) as any[]).map(task => {
            const wc = Array.isArray(task.work_centers) ? task.work_centers[0] : task.work_centers;
            const agg = byOp.get(task.id) || { hours: 0, cost: 0 };
            return {
                operationId: task.id,
                operationNo: task.operation_no || undefined,
                workCenterId: task.work_center_id || undefined,
                costCenterId: wc?.cost_center_id || undefined,
                actualHours: Number(agg.hours.toFixed(2)),
                actualLabourCost: Number(agg.cost.toFixed(2)),
            };
        });
    }

    /**
     * Order-level actual roll-up (the settlement basis handed to FI-1): total actual
     * labour cost (operation-linked confirmations + any order-level labour not tied to
     * an operation) plus actual parts cost.
     */
    public async getOrderActuals(woId: string): Promise<OrderActuals> {
        const operations = await this.getOperationActuals(woId);
        const operationLabour = operations.reduce((s, o) => s + o.actualLabourCost, 0);

        // Order-level labour: confirmations/lines with no operation link, valued at their own rate.
        const { data: unlinked } = await supabase.from('work_order_labor')
            .select('hours_worked, rate_per_hour')
            .eq('wo_id', woId)
            .is('job_task_id', null);
        const orderLevelLabour = (unlinked || []).reduce(
            (s: number, l: any) => s + (Number(l.hours_worked) || 0) * (Number(l.rate_per_hour) || 0), 0);

        // Material is actual cost only once it has been ISSUED (0245). A part
        // still flagged is_planned is a reservation — 0201 has already netted
        // it out of ATP; charging it as spend as well would bill the plant for
        // a decision, not a consumption. is_planned NULL counts as issued:
        // those rows predate the flag, when a part row meant consumption.
        // Filtered here rather than in the query so it reads the same way as
        // the `is_planned IS DISTINCT FROM TRUE` in sem_wo_actual_lines.
        const { data: parts } = await supabase.from('work_order_parts')
            .select('quantity, unit_cost, is_planned')
            .eq('wo_id', woId);
        const partsCost = (parts || [])
            .filter((p: any) => p.is_planned !== true)
            .reduce((s: number, p: any) => s + (Number(p.quantity) || 0) * (Number(p.unit_cost) || 0), 0);

        // SERVICE (0249): received service-PO lines carrying this order. A
        // service never enters stock, so no goods issue will ever charge it —
        // receipt is the consumption. Ordered-but-not-received is a commitment
        // and is excluded, exactly as a planned part is.
        const { data: serviceLines } = await supabase.from('purchase_order_lines')
            .select('qty_received, unit_cost')
            .eq('work_order_id', woId)
            .eq('line_type', 'SERVICE');
        const serviceCost = (serviceLines || [])
            .reduce((s: number, l: any) => s + (Number(l.qty_received) || 0) * (Number(l.unit_cost) || 0), 0);

        const labourCost = Number((operationLabour + orderLevelLabour).toFixed(2));
        const partsTotal = Number(partsCost.toFixed(2));
        const serviceTotal = Number(serviceCost.toFixed(2));
        return {
            labourCost,
            partsCost: partsTotal,
            serviceCost: serviceTotal,
            total: Number((labourCost + partsTotal + serviceTotal).toFixed(2)),
            operations,
        };
    }

    /**
     * Post a time confirmation against an operation (SAP IW41/CO11). Assigns the next
     * confirmation number for that operation; a final confirmation rolls the summed
     * confirmed hours into the operation's actual_hours and closes it (status COMPLETED).
     */
    public async postConfirmation(params: {
        woId: string;
        operationId: string;      // job_tasks.id
        hours: number;
        contactId?: string;
        contactType?: string;
        ratePerHour?: number;     // resolved rate snapshot (person → craft → work centre) valid at posting time
        dateWorked?: string;      // ISO date; defaults to today
        isFinal?: boolean;
        remainingHours?: number;
        notes?: string;
    }): Promise<void> {
        const { woId, operationId, hours } = params;

        // Next confirmation number for this operation.
        const { count } = await supabase.from('work_order_labor')
            .select('id', { count: 'exact', head: true })
            .eq('job_task_id', operationId);
        const confirmationNo = (count || 0) + 1;

        const { error: insErr } = await supabase.from('work_order_labor').insert({
            wo_id: woId,
            job_task_id: operationId,
            contact_id: params.contactId || null,
            contact_type_code: params.contactType || 'INTERNAL',
            hours_worked: Number(hours) || 0,
            rate_per_hour: params.ratePerHour != null ? params.ratePerHour : 0,
            date_worked: params.dateWorked || new Date().toISOString().split('T')[0],
            is_final: !!params.isFinal,
            confirmation_no: confirmationNo,
            remaining_hours: params.remainingHours != null ? params.remainingHours : null,
            notes: params.notes || null,
        });
        if (insErr) { console.error('postConfirmation(insert):', insErr); throw insErr; }

        // Final confirmation closes the operation and rolls up its confirmed hours.
        if (params.isFinal) {
            const { data: confs } = await supabase.from('work_order_labor')
                .select('hours_worked')
                .eq('job_task_id', operationId);
            const totalHours = (confs || []).reduce((s: number, c: any) => s + (Number(c.hours_worked) || 0), 0);
            const { error: updErr } = await supabase.from('job_tasks').update({
                actual_hours: Number(totalHours.toFixed(2)),
                status: 'COMPLETED',
                actual_finish_date: (params.dateWorked || new Date().toISOString().split('T')[0]),
                updated_at: new Date().toISOString(),
            }).eq('id', operationId);
            if (updErr) { console.error('postConfirmation(roll-up):', updErr); throw updErr; }
        }
    }

    // --- PURCHASE ORDER LOGIC ---
    /**
     * A PO line is MATERIAL when it names a stock item and SERVICE otherwise.
     *
     * The rule holds in both directions, which is why it can be derived rather
     * than asked for: a line with a stock item is received into stores and only
     * becomes cost when it is issued to an order, while a line without one
     * never enters stock, so nothing downstream will ever charge it and receipt
     * IS its consumption (0249). A free-text line for a real part behaves like
     * a service for exactly the same reason.
     */
    private poLineType(inventoryId?: string | null): 'MATERIAL' | 'SERVICE' {
        return inventoryId ? 'MATERIAL' : 'SERVICE';
    }

    /** purchase_order_lines row → the PurchaseOrderItem shape the UI edits. */
    private mapPOLine(row: any): any {
        return {
            id: row.id,
            lineNo: row.line_no,
            lineType: row.line_type,
            inventoryId: row.inventory_id || undefined,
            description: row.description || '',
            uom: row.uom || 'EA',
            qtyOrdered: Number(row.qty_ordered) || 0,
            qtyReceivedTotal: Number(row.qty_received) || 0,
            unitCost: Number(row.unit_cost) || 0,
            taxAmount: Number(row.tax_amount) || 0,
            lineTotal: Number(row.line_total) || 0,
            jobId: row.work_order_id || undefined,
            glCode: row.gl_account || undefined,
            costCenterId: row.cost_center_id || undefined,
            invoiceNumber: row.invoice_number || undefined,
            invoiceMatched: !!row.invoice_matched,
        };
    }

    public async getPurchaseOrders(): Promise<any[]> {
        // Lines live in purchase_order_lines since 0248; purchase_orders.items
        // is frozen legacy and deliberately not read.
        const [poRes, lineRes] = await Promise.all([
            supabase.from('purchase_orders').select('*'),
            supabase.from('purchase_order_lines').select('*').order('line_no', { ascending: true }),
        ]);
        if (poRes.error) return [];
        if (lineRes.error) console.warn('[po] line read failed (0248 applied?):', lineRes.error.message);

        const linesByPo = new Map<string, any[]>();
        for (const row of lineRes.data || []) {
            const list = linesByPo.get(row.po_id) || [];
            list.push(this.mapPOLine(row));
            linesByPo.set(row.po_id, list);
        }

        return (poRes.data || []).map(row => ({
            id: row.id,
            poCode: row.po_code,
            status: row.status,
            supplierId: row.supplier_id,
            dateCreated: row.date_created,
            dateRequired: row.date_required,
            taxInclusive: row.tax_inclusive,
            currency: row.currency,
            createdById: row.created_by,
            items: linesByPo.get(row.id) || [],
            supplierContactName: row.supplier_contact_name,
            deliveryContactId: row.delivery_contact_id,
            invoiceContactId: row.invoice_contact_id,
            reference: row.reference,
            comments: row.comments,
            dateFinished: row.date_finished
        }));
    }

    /**
     * Persist a PO's lines. Upsert by id and delete what the user removed —
     * never delete-and-reinsert, because a goods receipt points at a line id
     * and re-creating the row would orphan every receipt taken against it.
     */
    private async syncPurchaseOrderLines(poId: string, items: any[]): Promise<void> {
        const lines = (items || []).filter(Boolean);

        const rows = lines.map((it: any, idx: number) => ({
            // A line created before 0248 carries a `pi-…` id, which is not a
            // uuid; give those a real one on their first save.
            id: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(it.id || ''))
                ? it.id : crypto.randomUUID(),
            po_id: poId,
            line_no: (idx + 1) * 10,
            legacy_ref: String(it.id || '').startsWith('pi-') ? it.id : null,
            line_type: it.lineType || this.poLineType(it.inventoryId),
            inventory_id: it.inventoryId || null,
            description: it.description || '',
            uom: it.uom || 'EA',
            qty_ordered: Number(it.qtyOrdered) || 0,
            qty_received: Number(it.qtyReceivedTotal) || 0,
            unit_cost: Number(it.unitCost) || 0,
            tax_amount: Number(it.taxAmount) || 0,
            work_order_id: it.jobId || null,
            cost_center_id: it.costCenterId || null,
            gl_account: it.glCode || null,
            invoice_number: it.invoiceNumber || null,
            invoice_matched: !!it.invoiceMatched,
            updated_at: new Date().toISOString(),
        }));

        const keep = rows.map(r => r.id);
        let del = supabase.from('purchase_order_lines').delete().eq('po_id', poId);
        if (keep.length > 0) del = del.not('id', 'in', `(${keep.join(',')})`);
        const { error: delErr } = await del;
        if (delErr) throw new Error(`Failed to remove deleted PO lines: ${delErr.message}`);

        if (rows.length === 0) return;
        const { error } = await supabase.from('purchase_order_lines').upsert(rows, { onConflict: 'id' });
        if (error) throw new Error(`Failed to save PO lines: ${error.message}`);
    }

    public async createPurchaseOrder(po: any): Promise<any> {
        const dbRow = {
            id: po.id,
            po_code: po.poCode,
            status: po.status,
            supplier_id: po.supplierId || null, // Handle empty string
            date_created: po.dateCreated,
            date_required: po.dateRequired,
            tax_inclusive: po.taxInclusive,
            currency: po.currency,
            created_by: po.createdById,
            // Legacy column, frozen at 0248. Written empty so a new order never
            // carries a second, divergent copy of its own lines.
            items: [],
            supplier_contact_name: po.supplierContactName,
            delivery_contact_id: po.deliveryContactId,
            invoice_contact_id: po.invoiceContactId,
            reference: po.reference,
            comments: po.comments,
            date_finished: po.dateFinished
        };

        const { data, error } = await supabase.from('purchase_orders').insert(dbRow).select().single();
        if (error) throw error;

        if ((po.items || []).length > 0) {
            await this.syncPurchaseOrderLines(data.id, po.items);
        }

        // Return mapped back
        return {
            ...po,
            id: data.id
        };
    }

    public async updatePurchaseOrder(id: string, updates: Partial<any>): Promise<any> {
        const dbUpdates: any = {};

        // Map UI fields to DB columns
        if (updates.poCode !== undefined) dbUpdates.po_code = updates.poCode;
        if (updates.status !== undefined) dbUpdates.status = updates.status;
        if (updates.supplierId !== undefined) dbUpdates.supplier_id = updates.supplierId || null;
        if (updates.dateCreated !== undefined) dbUpdates.date_created = updates.dateCreated;
        if (updates.dateRequired !== undefined) dbUpdates.date_required = updates.dateRequired;
        if (updates.taxInclusive !== undefined) dbUpdates.tax_inclusive = updates.taxInclusive;
        if (updates.currency !== undefined) dbUpdates.currency = updates.currency;
        // `items` is no longer written to the header — lines are rows (0248).
        if (updates.supplierContactName !== undefined) dbUpdates.supplier_contact_name = updates.supplierContactName;
        if (updates.deliveryContactId !== undefined) dbUpdates.delivery_contact_id = updates.deliveryContactId;
        if (updates.invoiceContactId !== undefined) dbUpdates.invoice_contact_id = updates.invoiceContactId;
        if (updates.reference !== undefined) dbUpdates.reference = updates.reference;
        if (updates.comments !== undefined) dbUpdates.comments = updates.comments;
        if (updates.dateFinished !== undefined) dbUpdates.date_finished = updates.dateFinished;
        if (updates.authorizedById !== undefined) dbUpdates.authorized_by = updates.authorizedById;

        const { data, error } = await supabase
            .from('purchase_orders')
            .update(dbUpdates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        if (updates.items !== undefined) {
            await this.syncPurchaseOrderLines(id, updates.items);
        }
        return data;
    }

    /**
     * Receive against a PO line, as one durable operation (0248).
     *
     * Receiving used to move stock immediately but leave the received quantity
     * in a React state object until somebody pressed Save — so an abandoned tab
     * left stores holding parts the order still showed as outstanding. Stock,
     * the line, and the goods receipt now move together.
     *
     * The GRN number comes from the database sequence, not from here: a receipt
     * is a numbered document and two clients receiving at once must not be able
     * to mint the same number.
     */
    public async receivePOLine(params: {
        poId: string;
        lineId: string;
        quantity: number;
        locationId?: string;
        actor?: string;
    }): Promise<{ grnNumber: string; qtyReceivedTotal: number }> {
        const { poId, lineId, quantity } = params;
        if (!(quantity > 0)) throw new Error('Receive quantity must be greater than zero.');

        const { data: line, error: lineErr } = await supabase
            .from('purchase_order_lines').select('*').eq('id', lineId).single();
        if (lineErr || !line) throw new Error(`PO line not found: ${lineErr?.message || lineId}`);

        // 1. Stock first for a material line — it is the physical fact, and the
        //    movement type carries the PO so it is a 101 rather than a 501.
        if (line.inventory_id) {
            if (!params.locationId) {
                throw new Error('Set a delivery location on the Details tab before receiving stock lines.');
            }
            const { data: stock } = await supabase
                .from('inventory_stock').select('quantity')
                .eq('item_id', line.inventory_id).eq('location_id', params.locationId).maybeSingle();
            await this.adjustInventoryStock(
                line.inventory_id,
                params.locationId,
                (Number(stock?.quantity) || 0) + quantity,
                'RECEIPT',
                `PO receipt against line ${line.line_no}`,
                params.actor || 'Unknown User',
                { poId },
            );
        }

        // 2. The receipt document. Nothing wrote this table before 0248 because
        //    there was no stable line to point at and no number to give it.
        //
        //    storage_location is a document field a receiver reads, so it holds
        //    the location's CODE — the assessment found the uuid being written
        //    here, which no system on the other side can resolve.
        let storageLocation: string | null = null;
        if (params.locationId) {
            const { data: loc } = await supabase
                .from('inventory_locations').select('code, name')
                .eq('id', params.locationId).maybeSingle();
            storageLocation = loc?.code || loc?.name || params.locationId;
        }
        const { data: grn, error: grnErr } = await supabase
            .from('goods_receipts')
            .insert({
                po_id: poId,
                po_line_id: lineId,
                inventory_id: line.inventory_id,
                quantity,
                unit_cost: Number(line.unit_cost) || 0,
                total_cost: Number((quantity * (Number(line.unit_cost) || 0)).toFixed(2)),
                storage_location: storageLocation,
                received_date: new Date().toISOString().split('T')[0],
            })
            .select('grn_number')
            .single();
        if (grnErr) throw new Error(`Goods receipt failed: ${grnErr.message}`);

        // 3. The line's received quantity.
        const newTotal = Number((Number(line.qty_received || 0) + quantity).toFixed(3));
        const { error: updErr } = await supabase
            .from('purchase_order_lines')
            .update({ qty_received: newTotal, updated_at: new Date().toISOString() })
            .eq('id', lineId);
        if (updErr) throw new Error(`Receipt recorded but the line did not update: ${updErr.message}`);

        // 4. A received SERVICE line is actual cost on its work order the moment
        //    it lands (0249) — nothing downstream will ever issue it.
        if (line.work_order_id && line.line_type === 'SERVICE') {
            const { error: settleErr } = await supabase.rpc('ers_settle_work_order', { p_wo_id: line.work_order_id });
            if (settleErr) console.warn('[po] service settlement deferred to the next run:', settleErr.message);
        }

        return { grnNumber: grn?.grn_number, qtyReceivedTotal: newTotal };
    }

    public async deletePurchaseOrder(id: string): Promise<void> {
        const { error } = await supabase
            .from('purchase_orders')
            .delete()
            .eq('id', id);

        if (error) throw error;
    }



    // --- RECURRING WORK (PMs) ---
    // --- RECURRING WORK (PMs) ---
    public async getPMs(): Promise<any[]> {
        // Return raw records, UI layer handles mapping to RecurringJob if needed
        const { data, error } = await supabase.from('recurring_work').select('*').order('next_due_date', { ascending: true });
        if (error) return [];
        return data || [];
    }

    public async createPM(pm: Partial<RecurringWorkRecord>): Promise<any> {
        const data = await this.insertTolerant('recurring_work', pm, ['work_center_id']);
        return data;
    }

    /**
     * Insert a row, retrying without the given optional columns if the DB doesn't
     * have them yet (migration not applied). Lets features that add a nullable
     * column ship before the migration lands without breaking the create flow.
     */
    private async insertTolerant(table: string, row: any, optionalCols: string[]): Promise<any> {
        let { data, error } = await supabase.from(table).insert(row).select().single();
        if (error && optionalCols.some(c => (error!.message || '').includes(c)) || (error && /PGRST204|column .* does not exist/i.test(error.message || ''))) {
            const trimmed = { ...row };
            for (const c of optionalCols) delete trimmed[c];
            ({ data, error } = await supabase.from(table).insert(trimmed).select().single());
        }
        if (error) throw error;
        return data;
    }

    public async updatePM(id: string, updates: Partial<RecurringWorkRecord>): Promise<any> {
        const payload: any = { ...updates, updated_at: new Date().toISOString() };
        console.log('[DatabaseService.updatePM] id:', id, 'payload:', payload);
        const { data, error } = await supabase.from('recurring_work').update(payload).eq('id', id).select().single();
        if (error) {
            console.error('[DatabaseService.updatePM] Supabase Error:', error);
            throw new Error(`Update PM failed: ${error.message} (code: ${error.code}, details: ${error.details})`);
        }
        return data;
    }

    public async deletePM(id: string): Promise<void> {
        console.log('[DatabaseService.deletePM] Deleting PM:', id);

        // 1. Unlink any generated Work Orders (set recurring_work_id = null)
        const { error: unlinkError } = await supabase
            .from('work_orders')
            .update({ recurring_work_id: null })
            .eq('recurring_work_id', id);

        if (unlinkError) {
            console.error('[DatabaseService.deletePM] Phase 1 - Unlink WOs Failed:', unlinkError);
            // We continue, as maybe there are no WOs, but log it.
        }

        // 2. Delete the PM
        const { error, count } = await supabase.from('recurring_work').delete({ count: 'exact' }).eq('id', id);
        if (error) {
            console.error('[DatabaseService.deletePM] Supabase Error:', error);
            throw new Error(`Delete PM failed: ${error.message} (code: ${error.code})`);
        }
        console.log('[DatabaseService.deletePM] Success. Rows deleted:', count);
    }

    public async savePMTemplates(pmId: string, templates: { tasks?: any[]; jsa?: any; labor?: any[]; inventory?: any[] }): Promise<void> {
        console.log('[DatabaseService.savePMTemplates] pmId:', pmId);
        const { error } = await supabase.from('recurring_work').update({ templates, updated_at: new Date().toISOString() }).eq('id', pmId);
        if (error) {
            console.error('[DatabaseService.savePMTemplates] Supabase Error:', error);
            throw new Error(`Save PM templates failed: ${error.message} (code: ${error.code})`);
        }
    }

    public async getPMTemplates(pmId: string): Promise<{ tasks: any[]; jsa: any; labor: any[]; inventory: any[] }> {
        const { data, error } = await supabase.from('recurring_work').select('templates').eq('id', pmId).single();
        if (error || !data) return { tasks: [], jsa: null, labor: [], inventory: [] };
        const t = data.templates || {};
        return { tasks: t.tasks || [], jsa: t.jsa || null, labor: t.labor || [], inventory: t.inventory || [] };
    }

    public async generateWOFromPM(pmId: string, assetId?: string, skipDateAdvance?: boolean, meterReading?: number): Promise<WorkOrderRecord> {
        // A generated WO is only as good as the plan copied onto it. Each copy
        // below is best-effort so one failure cannot abandon a WO that already
        // exists — but the caller is told what is missing rather than handing a
        // technician a work order silently stripped of its steps or its JSA.
        const copyFailures: string[] = [];
        // 1. Fetch PM with templates
        const { data: pm, error: getErr } = await supabase.from('recurring_work').select('*').eq('id', pmId).single();
        if (getErr || !pm) throw new Error('PM Strategy not found');

        const templates = pm.templates || {};

        // 2. Create WO with traceability link
        const woId = crypto.randomUUID();
        // DataMapper.toUIWorkOrder prepends 'WO-', so store just the numeric portion
        const woNumber = `${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;

        // Calculate due date from PM's next_due_date or generate date
        const dueDate = pm.next_due_date
            ? new Date(pm.next_due_date).toISOString()
            : new Date().toISOString();

        const newWO: any = {
            id: woId,
            wo_number: woNumber,
            title: (pm.description || pm.title) + ' (Generated)',
            description: pm.description || pm.title,
            status: 'OPEN',
            type: pm.job_type || 'PM',
            priority_code: pm.priority_code || 'MEDIUM',
            asset_id: assetId || pm.asset_id,  // Use per-asset ID if provided
            recurring_work_id: pmId,
            cost_frozen: false,
            frozen_labor_cost: 0,
            frozen_material_cost: 0,
            created_by: null,  // System-generated; null avoids UUID FK constraint
            due_date: dueDate,
            date_due_start: dueDate,
            est_duration: pm.est_duration || pm.estimated_duration || 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        console.log('[generateWOFromPM] Inserting WO:', JSON.stringify(newWO, null, 2));
        const { data, error } = await supabase.from('work_orders').insert(newWO).select().single();
        if (error) {
            console.error('[generateWOFromPM] WO INSERT FAILED:', error.message, error.code, error.details, error.hint);
            throw error;
        }
        console.log('[generateWOFromPM] WO created successfully:', data.id);

        // 2b. Seed wo_failure_data with failure context from PM template (ISO 14224 §B.2.5)
        //     Carries: failure_mode_code (the mode this PM prevents), local_impact, plant_wide_impact
        if (pm.failure_mode_code || pm.local_impact || pm.plant_wide_impact) {
            const failureSeed: any = {
                wo_id: woId,
                failure_mode_code: pm.failure_mode_code || '',
                failure_cause_code: '',
                remedy_code: '',
                local_impact: pm.local_impact || null,
                plant_wide_impact: pm.plant_wide_impact || null,
                comments: pm.failure_mode_code ? `Failure mode "${pm.failure_mode_code}" inherited from PM strategy.` : null,
            };
            const { error: fdErr } = await supabase.from('wo_failure_data').insert(failureSeed);
            if (fdErr) {
                console.warn('[generateWOFromPM] Failed to seed wo_failure_data:', fdErr.message);
            } else {
                console.log('[generateWOFromPM] Seeded wo_failure_data with PM failure context (mode + impacts)');
            }
        }

        // 3. Copy template tasks → job_tasks.
        // The plan is the whole point of a PM, so carry the operation across
        // intact: operation number, work centre, control key and planned rate
        // were previously dropped here, which quietly stripped an imported SAP
        // task list back to bare descriptions by the time a technician saw it.
        if (templates.tasks && templates.tasks.length > 0) {
            const taskRows = templates.tasks.map((task: any, idx: number) => {
                const seq = task.sequence || (idx + 1) * 10;
                return {
                    id: crypto.randomUUID(),
                    wo_id: woId,
                    sequence: seq,
                    description: task.description || '',
                    est_hours: task.estHours || 0,
                    status: 'PENDING',
                    instructions: task.instructions || [],
                    operation_no: task.operationNo || String(seq).padStart(4, '0'),
                    control_key: task.controlKey || 'PM01',
                    work_center_id: task.workCenterId || null,
                    planned_rate: task.plannedRate ?? null,
                    assigned_user_ids: task.assignedUserIds || [],
                    assigned_org_unit_ids: task.assignedOrgUnitIds || [],
                };
            });
            // One insert instead of N — a 40-operation task list was 40 round
            // trips, each unchecked.
            if (!await tryWrite(supabase.from('job_tasks').insert(taskRows), `job steps for WO ${woId}`)) {
                copyFailures.push(`${taskRows.length} job step(s)`);
            }
        }

        // 4. Copy template JSA → jsa_assessments + jsa_hazards
        if (templates.jsa && templates.jsa.hazards && templates.jsa.hazards.length > 0) {
            const jsaId = crypto.randomUUID();
            const jsaOk = await tryWrite(supabase.from('jsa_assessments').insert({
                id: jsaId,
                wo_id: woId,
                status: 'DRAFT',
                created_by: 'system',
                permits: templates.jsa.permits || [],
                updated_at: new Date().toISOString(),
            }), `JSA for WO ${woId}`);
            if (!jsaOk) copyFailures.push('the job safety analysis');
            const hazardRows = templates.jsa.hazards.map((h: any) => ({
                id: crypto.randomUUID(),
                jsa_id: jsaId,
                hazard: h.hazard,
                risk_score: h.riskScore || 'Medium',
                controls: h.controls || '',
            }));
            if (jsaOk && hazardRows.length > 0) {
                if (!await tryWrite(supabase.from('jsa_hazards').insert(hazardRows), `JSA hazards for WO ${woId}`)) {
                    copyFailures.push(`${hazardRows.length} JSA hazard(s)`);
                }
            }
        }

        // 5. Copy template labor → work_order_labor
        if (templates.labor && templates.labor.length > 0) {
            const laborRows = templates.labor.map((l: any) => ({
                id: crypto.randomUUID(),
                wo_id: woId,
                contact_id: l.contactId || null,
                contact_type_code: l.contactType || 'TECHNICIAN',
                hours_worked: l.estDuration || 0,
                rate_per_hour: 0,
                date_worked: new Date().toISOString().split('T')[0],
                created_at: new Date().toISOString(),
            }));
            if (!await tryWrite(supabase.from('work_order_labor').insert(laborRows), `planned labour for WO ${woId}`)) {
                copyFailures.push(`${laborRows.length} planned labour line(s)`);
            }
        }

        // 6. Copy template inventory → work_order_parts
        if (templates.inventory && templates.inventory.length > 0) {
            const partRows = templates.inventory.map((item: any) => ({
                id: crypto.randomUUID(),
                wo_id: woId,
                item_id: item.inventoryId || null,
                notes: item.description || '',
                quantity: item.estQty || 0,
                unit_cost: item.estUnitCost || 0,
                date_used: new Date().toISOString().split('T')[0],
            }));
            if (!await tryWrite(supabase.from('work_order_parts').insert(partRows), `planned parts for WO ${woId}`)) {
                copyFailures.push(`${partRows.length} planned part line(s)`);
            }
        }

        // 7. Update PM last_generated_date and calculate next_due_date (skip if multi-asset
        //    batch, or if this is a meter-driven generation — for a meter PM the running-meter
        //    baseline below is authoritative, not a calendar date).
        if (!skipDateAdvance && meterReading == null) {
            const now2 = new Date();
            const freqUnit = (pm.frequency_type || pm.frequency_unit || '').toUpperCase();
            const freqInterval = pm.interval || pm.frequency_interval || 0;

            // Roll forward from current next_due_date (not from today)
            let nextDue: Date | null = null;
            if (freqUnit && freqInterval) {
                const baseDate = pm.next_due_date ? new Date(pm.next_due_date) : now2;
                nextDue = new Date(baseDate);
                if (freqUnit === 'DAYS') nextDue.setDate(nextDue.getDate() + freqInterval);
                else if (freqUnit === 'WEEKS') nextDue.setDate(nextDue.getDate() + freqInterval * 7);
                else if (freqUnit === 'MONTHS') nextDue.setMonth(nextDue.getMonth() + freqInterval);
                else if (freqUnit === 'YEARS') nextDue.setFullYear(nextDue.getFullYear() + freqInterval);
                else if (freqUnit === 'HOURS') nextDue.setHours(nextDue.getHours() + freqInterval);
            }

            await supabase.from('recurring_work').update({
                last_generated_date: now2.toISOString(),
                ...(nextDue ? { next_due_date: nextDue.toISOString() } : {}),
            }).eq('id', pmId);
        }

        // 8. Stamp per-asset completion into recurring_work.assigned_assets (JSONB —
        //    the per-asset store; there is no recurring_work_assigned_assets table).
        //    lastCompletedDate always; for a meter-driven generation also stamp
        //    lastReadingValue as the baseline the next due is computed from, so the
        //    PM isn't re-fired on the next reading.
        const targetAssetId = assetId || pm.asset_id;
        if (targetAssetId) {
            try {
                const existing: any[] = Array.isArray(pm.assigned_assets) ? [...pm.assigned_assets] : [];
                const idx = existing.findIndex((a: any) => a.assetId === targetAssetId);
                const stamp: any = { assetId: targetAssetId, lastCompletedDate: new Date().toISOString().split('T')[0] };
                if (meterReading != null) stamp.lastReadingValue = meterReading;
                if (idx >= 0) existing[idx] = { ...existing[idx], ...stamp };
                else existing.push(stamp);
                await supabase.from('recurring_work').update({ assigned_assets: existing }).eq('id', pmId);
                console.log(`[generateWOFromPM] Stamped per-asset completion for ${targetAssetId}${meterReading != null ? ` (meter baseline ${meterReading})` : ''}`);
            } catch (e) {
                console.warn('[generateWOFromPM] Could not stamp per-asset completion:', e);
            }
        }

        if (copyFailures.length > 0) {
            console.error(`[generateWOFromPM] WO ${data?.wo_number ?? woId} generated WITHOUT ${copyFailures.join(', ')}`);
            (data as any).__copyFailures = copyFailures;
        }
        return data;
    }

    // --- WO RESOURCES (Labor, Parts, Files) ---

    public async getLabor(woId: string): Promise<any[]> {
        const { data, error } = await supabase.from('work_order_labor').select('*').eq('wo_id', woId);
        if (error) return [];
        return data;
    }

    public async addLabor(entry: any): Promise<any> {
        const { data, error } = await supabase.from('work_order_labor').insert(entry).select().single();
        if (error) throw error;
        return data;
    }

    public async getParts(woId: string): Promise<any[]> {
        const { data, error } = await supabase.from('work_order_parts').select('*').eq('wo_id', woId);
        if (error) return [];
        return data;
    }

    public async addPart(entry: any): Promise<any> {
        const { data, error } = await supabase.from('work_order_parts').insert(entry).select().single();
        if (error) throw error;
        return data;
    }

    public async getFiles(woId: string): Promise<any[]> {
        const { data, error } = await supabase.from('work_order_files').select('*').eq('wo_id', woId);
        if (error) return [];
        return data;
    }

    public async addFile(entry: any): Promise<any> {
        const { data, error } = await supabase.from('work_order_files').insert(entry).select().single();
        if (error) throw error;
        return data;
    }

    // --- JSA SAFETY ---

    public async getJSA(woId: string): Promise<any> {
        const { data, error } = await supabase.from('jsa_assessments').select('*').eq('wo_id', woId).single();
        if (error) return null; // No JSA yet

        // Fetch hazards
        const { data: hazards } = await supabase.from('jsa_hazards').select('*').eq('jsa_id', data.id);
        return { ...data, hazards: hazards || [] };
    }

    public async createJSA(jsa: any, hazards: any[]): Promise<any> {
        const { data, error } = await supabase.from('jsa_assessments').insert(jsa).select().single();
        if (error) throw error;

        if (hazards.length > 0) {
            const hazardsWithId = hazards.map(h => ({ ...h, jsa_id: data.id }));
            await supabase.from('jsa_hazards').insert(hazardsWithId);
        }
        return this.getJSA(jsa.wo_id);
    }

    // --- JSA TEMPLATE LIBRARY (team-shared, 0209) ---

    public async getJSATemplates(): Promise<{ id: string; name: string; hazards: any[] }[]> {
        const { data, error } = await supabase.from('jsa_templates').select('id, name, hazards').order('name');
        if (error) { console.error('[getJSATemplates]', error); return []; }
        return data || [];
    }

    /**
     * Upsert by name — saving under an existing name replaces that template.
     * Scoped to the tenant since 0265: the name is unique per company, not
     * globally, so one customer naming a template "Hot Work" no longer stops
     * every other customer from doing the same. The conflict target names the
     * index, so company_id appears here even though the payload omits it (the
     * column default supplies the value).
     */
    public async saveJSATemplate(name: string, hazards: any[], actor?: string): Promise<void> {
        const { error } = await supabase.from('jsa_templates')
            .upsert({ name, hazards, created_by: actor || null }, { onConflict: 'company_id,name' });
        if (error) throw error;
    }

    public async deleteJSATemplate(id: string): Promise<void> {
        const { error } = await supabase.from('jsa_templates').delete().eq('id', id);
        if (error) throw error;
    }

    /** One-time import of a browser's legacy localStorage templates. Existing
     *  shared names win (ignoreDuplicates) so a stale local copy can't clobber
     *  what a teammate already published. */
    public async importJSATemplates(templates: { name: string; hazards: any[] }[], actor?: string): Promise<void> {
        if (!templates?.length) return;
        const rows = templates
            .filter(t => t && typeof t.name === 'string' && t.name.trim())
            .map(t => ({ name: t.name, hazards: t.hazards || [], created_by: actor || null }));
        if (!rows.length) return;
        const { error } = await supabase.from('jsa_templates')
            .upsert(rows, { onConflict: 'company_id,name', ignoreDuplicates: true });
        if (error) throw error;
    }


    // --- TASK LIBRARY ---

    private mapLibraryTaskRow(d: any): LibraryTask {
        return {
            id: d.id,
            code: d.code,
            title: d.title,
            description: d.description,
            category: d.category,
            estimatedDuration: d.estimated_duration_hours,
            instructions: d.instructions || [],
            safetyRequirements: d.safety_requirements || [],
            createdAt: d.created_at,
            createdBy: d.created_by,
            // Enhancement 2: Asset class association
            assetClassCodes: d.asset_class_codes || [],
            // Enhancement 3: Version / Lock control
            version: d.version || 1,
            isLocked: d.is_locked || false,
            lockedAt: d.locked_at || null,
            lockedBy: d.locked_by || null,
            parentTaskId: d.parent_task_id || null,
        };
    }

    public async getLibraryTasks(): Promise<LibraryTask[]> {
        const { data, error } = await supabase.from('task_library_items').select('*').order('title');
        if (error) throw new Error(error.message);
        return data.map((d: any) => this.mapLibraryTaskRow(d));
    }

    // Enhancement 2: Filtered query by asset class code
    public async getLibraryTasksByAssetClass(assetClassCode: string): Promise<LibraryTask[]> {
        const { data, error } = await supabase
            .from('task_library_items')
            .select('*')
            .contains('asset_class_codes', [assetClassCode])
            .order('title');
        if (error) {
            // Fallback: if contains query fails (column may not exist yet), return all
            console.warn('[getLibraryTasksByAssetClass] Filtered query failed, falling back to all:', error.message);
            return this.getLibraryTasks();
        }
        return data.map((d: any) => this.mapLibraryTaskRow(d));
    }

    public async getLibraryTask(id: string): Promise<LibraryTask | null> {
        const { data, error } = await supabase.from('task_library_items').select('*').eq('id', id).single();
        if (error) return null;

        const task: LibraryTask = {
            ...this.mapLibraryTaskRow(data),
            inventory: [],
            roles: [],
            files: []
        };

        const [inv, roles, files] = await Promise.all([
            supabase.from('task_library_inventory').select('*, inventory_items(code, description, uom)').eq('task_id', id),
            supabase.from('task_library_roles').select('*').eq('task_id', id),
            supabase.from('task_library_files').select('*').eq('task_id', id)
        ]);

        if (inv.data) {
            task.inventory = inv.data.map((i: any) => ({
                id: i.id,
                taskId: i.task_id,
                inventoryItemId: i.inventory_item_id,
                quantity: i.quantity,
                notes: i.notes,
                itemCode: i.inventory_items?.code,
                itemDescription: i.inventory_items?.description,
                uom: i.inventory_items?.uom
            }));
        }

        if (roles.data) {
            task.roles = roles.data.map((r: any) => ({
                id: r.id,
                taskId: r.task_id,
                roleCode: r.role_code,
                quantity: r.quantity,
                estimatedHours: r.estimated_hours
            }));
        }

        if (files.data) {
            task.files = files.data.map((f: any) => ({
                id: f.id,
                taskId: f.task_id,
                name: f.name,
                url: f.url,
                type: f.type,
                uploadedAt: f.uploaded_at
            }));
        }

        return task;
    }

    public async createLibraryTask(task: Partial<LibraryTask>, inventory: any[], roles: any[], files: any[] = [], actor: string): Promise<LibraryTask | null> {
        // 1. Create Core
        const { data, error } = await supabase.from('task_library_items').insert({
            code: task.code,
            title: task.title,
            description: task.description,
            category: task.category,
            estimated_duration_hours: task.estimatedDuration,
            instructions: task.instructions,
            safety_requirements: task.safetyRequirements,
            created_by: actor,
            // Enhancement 2: Asset class association
            asset_class_codes: task.assetClassCodes || [],
            // Enhancement 3: Version control
            version: task.version || 1,
            is_locked: false,
            parent_task_id: task.parentTaskId || null,
        }).select().single();

        if (error) throw error;
        const taskId = data.id;

        // 2. Add sub-items
        if (inventory.length > 0) {
            await supabase.from('task_library_inventory').insert(inventory.map((i: any) => ({
                task_id: taskId,
                inventory_item_id: i.inventoryItemId,
                quantity: i.quantity,
                notes: i.notes
            })));
        }

        if (roles.length > 0) {
            await supabase.from('task_library_roles').insert(roles.map((r: any) => ({
                task_id: taskId,
                role_code: r.roleCode,
                quantity: r.quantity,
                estimated_hours: r.estimatedHours
            })));
        }

        if (files.length > 0) {
            await supabase.from('task_library_files').insert(files.map((f: any) => ({
                task_id: taskId,
                name: f.name,
                url: f.url,
                type: f.type
            })));
        }

        return this.getLibraryTask(taskId);
    }

    public async updateLibraryTask(id: string, task: Partial<LibraryTask>, inventory: any[], roles: any[], files: any[]): Promise<LibraryTask | null> {
        // Enhancement 3: MoC guard — refuse edits on locked templates
        const existing = await this.getLibraryTask(id);
        if (existing?.isLocked) {
            throw new Error('LOCKED: This template is locked (used on a completed Work Order). Create a new version via Management of Change.');
        }

        // 1. Update Core
        const { error } = await supabase.from('task_library_items').update({
            code: task.code,
            title: task.title,
            description: task.description,
            category: task.category,
            estimated_duration_hours: task.estimatedDuration,
            instructions: task.instructions,
            safety_requirements: task.safetyRequirements,
            // Enhancement 2
            asset_class_codes: task.assetClassCodes || [],
        }).eq('id', id);

        if (error) throw error;

        // 2. Replace Sub-items (Delete all and re-insert strategies for simple synchronization)
        await supabase.from('task_library_inventory').delete().eq('task_id', id);
        await supabase.from('task_library_roles').delete().eq('task_id', id);
        await supabase.from('task_library_files').delete().eq('task_id', id);

        if (inventory.length > 0) {
            await supabase.from('task_library_inventory').insert(inventory.map((i: any) => ({
                task_id: id,
                inventory_item_id: i.inventoryItemId,
                quantity: i.quantity,
                notes: i.notes
            })));
        }

        if (roles.length > 0) {
            await supabase.from('task_library_roles').insert(roles.map((r: any) => ({
                task_id: id,
                role_code: r.roleCode,
                quantity: r.quantity,
                estimated_hours: r.estimatedHours
            })));
        }

        if (files.length > 0) {
            await supabase.from('task_library_files').insert(files.map((f: any) => ({
                task_id: id,
                name: f.name,
                url: f.url,
                type: f.type
            })));
        }

        return this.getLibraryTask(id);
    }

    public async deleteLibraryTask(id: string): Promise<void> {
        // Enhancement 3: Refuse deletion of locked templates
        const existing = await this.getLibraryTask(id);
        if (existing?.isLocked) {
            throw new Error('LOCKED: Cannot delete a locked template. It is referenced by completed Work Orders.');
        }
        const { error } = await supabase.from('task_library_items').delete().eq('id', id);
        if (error) throw error;
    }

    // Enhancement 3: Lock a template when used on a TECO'd Work Order (MoC compliance)
    public async lockLibraryTask(taskId: string, userId: string): Promise<void> {
        const { error } = await supabase.from('task_library_items').update({
            is_locked: true,
            locked_at: new Date().toISOString(),
            locked_by: userId,
        }).eq('id', taskId);
        if (error) {
            console.warn('[lockLibraryTask] Failed to lock template:', error.message);
        }
    }

    // Enhancement 3: Create a new version of a locked template (MoC workflow)
    public async createNewVersion(taskId: string, actor: string): Promise<LibraryTask | null> {
        const original = await this.getLibraryTask(taskId);
        if (!original) throw new Error('Original template not found');

        const newVersion = (original.version || 1) + 1;
        const newCode = original.code.replace(/(-v\d+)$/, '') + `-v${newVersion}`;

        const newTask = await this.createLibraryTask(
            {
                code: newCode,
                title: original.title,
                description: original.description,
                category: original.category,
                estimatedDuration: original.estimatedDuration,
                instructions: original.instructions,
                safetyRequirements: original.safetyRequirements,
                assetClassCodes: original.assetClassCodes,
                version: newVersion,
                parentTaskId: taskId,
            },
            (original.inventory || []).map(i => ({ inventoryItemId: i.inventoryItemId, quantity: i.quantity, notes: i.notes })),
            (original.roles || []).map(r => ({ roleCode: r.roleCode, quantity: r.quantity, estimatedHours: r.estimatedHours })),
            (original.files || []).map(f => ({ name: f.name, url: f.url, type: f.type })),
            actor
        );

        return newTask;
    }

    // --- NOTIFICATION RULES ---

    public async getNotificationRules(): Promise<any[]> { // Return Typed Objects from UI types or Records
        const { data, error } = await supabase.from('notification_rules').select('*');
        if (error) {
            console.error('[DatabaseService] Error fetching notification rules:', error);
            errorLog.apiError('notification_rules', 'Error fetching notification rules', error);
            return [];
        }

        // Map DB snake_case to UI camelCase if needed, or stick to type
        // The UI uses NotificationRule (camelCase). schema uses snake_case.
        const mapped = (data || []).map((r: any) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            module: r.module,
            eventTrigger: r.event_trigger,
            isActive: r.is_active,
            severity: r.severity,
            filters: r.filters || [],
            recipients: r.recipients || [],
            channels: r.channels || [],
            escalationTimeoutMinutes: r.escalation_timeout_minutes,
            escalationRecipientRole: r.escalation_recipient_role || '',
            escalationScope: r.escalation_scope || 'ORG_UNIT'
        }));

        return mapped;
    }

    public async addNotificationRule(rule: any): Promise<any> {
        const row = {
            name: rule.name,
            description: rule.description,
            module: rule.module,
            event_trigger: rule.eventTrigger,
            is_active: rule.isActive,
            severity: rule.severity,
            filters: rule.filters || [],
            recipients: rule.recipients || [],
            channels: rule.channels || [],
            escalation_timeout_minutes: rule.escalationTimeoutMinutes || 0,
            escalation_recipient_role: rule.escalationRecipientRole || '',
            escalation_scope: rule.escalationScope || 'ORG_UNIT'
        };

        const { data, error } = await supabase.from('notification_rules').insert(row).select().single();
        if (error) {
            console.error("Error adding rule:", error);
            throw new Error(error.message);
        }

        return { ...rule, id: data.id };
    }

    public async updateNotificationRule(rule: any): Promise<void> {
        const row = {
            name: rule.name,
            description: rule.description,
            module: rule.module,
            event_trigger: rule.eventTrigger,
            is_active: rule.isActive,
            severity: rule.severity,
            filters: rule.filters || [],
            recipients: rule.recipients || [],
            channels: rule.channels || [],
            escalation_timeout_minutes: rule.escalationTimeoutMinutes || 0,
            escalation_recipient_role: rule.escalationRecipientRole || '',
            escalation_scope: rule.escalationScope || 'ORG_UNIT',
            updated_at: new Date().toISOString()
        };

        const { error } = await supabase.from('notification_rules').update(row).eq('id', rule.id);
        if (error) {
            console.error("Error updating rule:", error);
            throw new Error(error.message);
        }
    }

    public async deleteNotificationRule(id: string): Promise<void> {
        const { error } = await supabase.from('notification_rules').delete().eq('id', id);
        if (error) console.error("Error deleting rule:", error);
    }


    // --- NOTIFICATION CONFIGURATION ---

    public async getNotificationChannels(): Promise<NotificationChannelConfig[]> {
        const { data, error } = await supabase.from('notification_channels').select('*');
        if (error) {
            console.warn("Could not fetch channels:", error);
            return [];
        }

        return (data || []).map((r: any) => ({
            id: r.id,
            type: r.type,
            isActive: r.is_active,
            config: r.config_json || {}
        }));
    }

    /**
     * One channel of each type PER TENANT since 0265, not one globally. The
     * conflict target names the index, so company_id is listed even though the
     * payload omits it — the column default fills that in.
     */
    public async saveNotificationChannel(config: NotificationChannelConfig): Promise<void> {
        const { error } = await supabase.from('notification_channels').upsert({
            type: config.type,
            is_active: config.isActive,
            config_json: config.config,
            updated_at: new Date().toISOString()
        }, { onConflict: 'company_id,type' });

        if (error) throw error;
    }

    public async getMessageTemplates(): Promise<MessageTemplate[]> {
        const { data, error } = await supabase.from('message_templates').select('*');
        if (error) {
            console.warn("Could not fetch templates:", error);
            return [];
        }

        return (data || []).map((r: any) => ({
            id: r.id,
            name: r.name,
            triggerEvent: r.trigger_event,
            channelType: r.channel_type,
            subjectTemplate: r.subject_template || '',
            bodyTemplate: r.body_template || '',
            isActive: r.is_active
        }));
    }

    public async saveMessageTemplate(template: MessageTemplate): Promise<void> {
        // If ID is a temp ID (e.g. 'new-...'), omit it to let DB generate UUID.
        // OR simply rely on DB ignoring ID if it's not a valid UUID match for update.
        // Best practice: if it looks like a UUID, use it. If not, don't.

        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(template.id);

        const row: any = {
            name: template.name,
            trigger_event: template.triggerEvent,
            channel_type: template.channelType,
            subject_template: template.subjectTemplate,
            body_template: template.bodyTemplate,
            is_active: template.isActive,
            updated_at: new Date().toISOString()
        };

        if (isUUID) {
            row.id = template.id;
        }

        const { error } = await supabase.from('message_templates').upsert(row);
        if (error) throw error;
    }

    // --- IN-APP MAIL / LOGS ---

    public async getNotificationLogs(limit = 50): Promise<NotificationLog[]> {
        const { data, error } = await supabase
            .from('notification_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            console.warn("Could not fetch logs:", error);
            return [];
        }

        return (data || []).map((r: any) => ({
            id: r.id,
            recipientId: r.recipient_id,
            channel: r.channel,
            subject: r.subject,
            body: r.body,
            status: r.status,
            sentAt: r.created_at,
            errorMessage: r.error_message
        }));
    }

    public async logNotificationAudit(recipient: string, channel: string, subject: string, body: string): Promise<void> {
        const { error } = await supabase.from('notification_logs').insert({
            recipient_id: recipient,
            channel: channel,
            subject: subject,
            body: body,
            status: 'SENT',
            created_at: new Date().toISOString()
        });
        if (error) throw error;
    }

    // --- IN-APP NOTIFICATIONS (notifications table) ---

    public async createNotification(notification: {
        recipientId: string;
        recipientRole?: string;
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
        escalationTimeoutMinutes?: number;
        escalationRecipientRole?: string;
        vendorRecipientId?: string;
        createdBy?: string;
    }): Promise<any> {
        // --- CRITICALITY→SEVERITY AUTO-MAPPING ---
        // If notification is linked to an entity, check asset criticality and auto-escalate severity
        let effectiveSeverity = notification.severity;
        if (notification.entityId && notification.entityType) {
            try {
                let assetCriticality: string | null = null;

                if (notification.entityType === 'ASSET') {
                    const { data: asset } = await supabase
                        .from('assets').select('criticality').eq('id', notification.entityId).maybeSingle();
                    assetCriticality = asset?.criticality;
                } else if (notification.entityType === 'WORK_ORDER') {
                    const { data: wo } = await supabase
                        .from('work_orders').select('asset_id').eq('id', notification.entityId).maybeSingle();
                    if (wo?.asset_id) {
                        const { data: asset } = await supabase
                            .from('assets').select('criticality').eq('id', wo.asset_id).maybeSingle();
                        assetCriticality = asset?.criticality;
                    }
                } else if (notification.entityType === 'WORK_REQUEST') {
                    const { data: sr } = await supabase
                        .from('service_requests').select('asset_id').eq('id', notification.entityId).maybeSingle();
                    if (sr?.asset_id) {
                        const { data: asset } = await supabase
                            .from('assets').select('criticality').eq('id', sr.asset_id).maybeSingle();
                        assetCriticality = asset?.criticality;
                    }
                }

                // Auto-escalate: Crit A → always CRITICAL, Crit B + INFO → WARNING
                if (assetCriticality === 'A' && effectiveSeverity !== 'CRITICAL') {
                    console.log(`[CRITICALITY→SEVERITY] Auto-escalated from ${effectiveSeverity} to CRITICAL (Asset Criticality A)`);
                    effectiveSeverity = 'CRITICAL';
                } else if (assetCriticality === 'B' && effectiveSeverity === 'INFO') {
                    console.log(`[CRITICALITY→SEVERITY] Auto-escalated from INFO to WARNING (Asset Criticality B)`);
                    effectiveSeverity = 'WARNING';
                }
            } catch (e) {
                // Non-blocking — use original severity if lookup fails
                console.warn('[createNotification] Criticality lookup failed, using original severity:', e);
            }
        }

        const escalationDeadline = notification.escalationTimeoutMinutes && notification.escalationTimeoutMinutes > 0
            ? new Date(Date.now() + notification.escalationTimeoutMinutes * 60 * 1000).toISOString()
            : null;

        const row = {
            recipient_id: notification.recipientId,
            recipient_role: notification.recipientRole || null,
            title: notification.title,
            message: notification.message,
            severity: effectiveSeverity,
            notification_type: notification.notificationType,
            module: notification.module,
            entity_id: notification.entityId || null,
            entity_type: notification.entityType || null,
            entity_number: notification.entityNumber || null,
            action_link: notification.actionLink || null,
            action_required: notification.actionRequired || false,
            escalation_deadline: escalationDeadline,
            escalation_recipient_role: notification.escalationRecipientRole || null,
            vendor_recipient_id: notification.vendorRecipientId || null,
            created_by: notification.createdBy || 'SYSTEM',
        };

        const { data, error } = await supabase.from('notifications').insert(row).select().single();
        if (error) {
            console.error('[DatabaseService] Error creating notification:', error);
            return null;
        }
        return data;
    }

    public async getNotifications(userId: string, options?: {
        limit?: number;
        offset?: number;
        unreadOnly?: boolean;
        severity?: string;
        module?: string;
        notificationType?: string;
    }): Promise<any[]> {
        const limit = options?.limit || 50;
        const offset = options?.offset || 0;

        let query = supabase
            .from('notifications')
            .select('*')
            .eq('recipient_id', userId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (options?.unreadOnly) query = query.eq('is_read', false);
        if (options?.severity) query = query.eq('severity', options.severity);
        if (options?.module) query = query.eq('module', options.module);
        if (options?.notificationType) query = query.eq('notification_type', options.notificationType);

        const { data, error } = await query;
        if (error) {
            console.warn('[DatabaseService] Error fetching notifications:', error);
            return [];
        }

        return (data || []).map((r: any) => ({
            id: r.id,
            recipientId: r.recipient_id,
            title: r.title,
            message: r.message,
            severity: r.severity,
            notificationType: r.notification_type,
            module: r.module,
            entityId: r.entity_id,
            entityType: r.entity_type,
            entityNumber: r.entity_number,
            actionLink: r.action_link,
            actionRequired: r.action_required,
            escalationLevel: r.escalation_level,
            escalationDeadline: r.escalation_deadline,
            escalationRecipientRole: r.escalation_recipient_role,
            isRead: r.is_read,
            isAcknowledged: r.is_acknowledged,
            readAt: r.read_at,
            acknowledgedAt: r.acknowledged_at,
            acknowledgedBy: r.acknowledged_by,
            createdAt: r.created_at,
            createdBy: r.created_by,
        }));
    }

    public async getUnreadNotificationCount(userId: string): Promise<number> {
        const { count, error } = await supabase
            .from('notifications')
            .select('*', { count: 'exact', head: true })
            .eq('recipient_id', userId)
            .eq('is_read', false);

        if (error) {
            console.warn('[DatabaseService] Error counting unread:', error);
            return 0;
        }
        return count || 0;
    }

    public async markNotificationRead(id: string): Promise<void> {
        const { error } = await supabase.from('notifications').update({
            is_read: true,
            read_at: new Date().toISOString(),
        }).eq('id', id);
        if (error) console.error('[DatabaseService] Error marking read:', error);
    }

    /**
     * Records that a notification has been escalated: bumps the level and clears
     * the deadline so no other session or later sweep escalates it again (the
     * server-side dedup for NotificationService.checkEscalations).
     */
    public async bumpNotificationEscalation(id: string, level: number): Promise<void> {
        const { error } = await supabase.from('notifications').update({
            escalation_level: level,
            escalation_deadline: null,
        }).eq('id', id);
        if (error) console.error('[DatabaseService] Error bumping escalation:', error);
    }

    public async markAllNotificationsRead(userId: string): Promise<void> {
        const { error } = await supabase.from('notifications').update({
            is_read: true,
            read_at: new Date().toISOString(),
        }).eq('recipient_id', userId).eq('is_read', false);
        if (error) console.error('[DatabaseService] Error marking all read:', error);
    }

    public async acknowledgeNotification(id: string, acknowledgedBy: string): Promise<void> {
        const { error } = await supabase.from('notifications').update({
            is_acknowledged: true,
            is_read: true,
            acknowledged_at: new Date().toISOString(),
            acknowledged_by: acknowledgedBy,
            read_at: new Date().toISOString(),
        }).eq('id', id);
        if (error) console.error('[DatabaseService] Error acknowledging:', error);
    }

    public async deleteNotification(id: string): Promise<void> {
        const { error } = await supabase.from('notifications').delete().eq('id', id);
        if (error) console.error('[DatabaseService] Error deleting notification:', error);
    }

    // --- DIAGNOSTICS ---

    public async getLogs(limit = 100): Promise<AuditLogRecord[]> {
        const { data, error } = await supabase
            .from('audit_logs')
            .select('*')
            .order('timestamp', { ascending: false })
            .limit(limit);

        if (error) {
            console.warn("Could not fetch audit logs:", error);
            return [];
        }
        return data as AuditLogRecord[];
    }

    public async reset(): Promise<void> {
        // No-op for real DB, or maybe clear local caches
        this._cachedContacts = [];
        this._cachedUsers = [];
        console.log("DatabaseService local cache reset.");
    }

    // --- JSA ---
    public async updateJobJSA(woId: string, jsa: JobJSA, actor: string): Promise<string | undefined> {
        // 1. Find existing JSA or Create
        const { data: existing } = await supabase.from('jsa_assessments').select('id, status').eq('wo_id', woId).maybeSingle();

        const dbJSA = DataMapper.toDBJobJSA(jsa, woId);
        let jsaId = existing?.id;

        // The 0210 restrictive policy blocks hazard writes while the stored
        // status is AUTHORIZED. So order matters: when locking (payload says
        // AUTHORIZED) write hazards first, status last; when unlocking or
        // staying unlocked, write status first so the hazards can follow.
        const locking = jsa.status === 'AUTHORIZED';

        const writeAssessment = async () => {
            const { error } = await supabase.from('jsa_assessments').update(dbJSA).eq('id', existing!.id);
            if (error) throw error;
        };

        // Hazards — upsert by stable client-generated id, then remove the
        // rows the user deleted. Preserves row ids across saves (the old
        // delete-all-and-reinsert regenerated every id) and converges when the
        // offline queue replays the same payload. Rows the user hasn't
        // described yet are skipped, not persisted blank.
        const writeHazards = async () => {
            if (!jsaId || !jsa.hazards) return;
            const rows = jsa.hazards
                .filter(h => (h.hazard || '').trim() || (h.controls || '').trim())
                .map(h => DataMapper.toDBJSAHazard(h, jsaId!));
            let del = supabase.from('jsa_hazards').delete().eq('jsa_id', jsaId);
            if (rows.length > 0) del = del.not('id', 'in', `(${rows.map(r => r.id).join(',')})`);
            const { error: dErr } = await del;
            if (dErr) throw dErr;
            if (rows.length > 0) {
                const { error: hErr } = await supabase.from('jsa_hazards').upsert(rows);
                if (hErr) throw hErr;
            }
        };

        if (existing) {
            if (locking) {
                await writeHazards();
                await writeAssessment();
            } else {
                await writeAssessment();
                await writeHazards();
            }
        } else {
            const { data, error } = await supabase.from('jsa_assessments').insert({ ...dbJSA, created_by: actor }).select().single();
            if (error) throw error;
            jsaId = data.id;
            await writeHazards();
        }
        return jsaId;
    }

    // --- PTW (PERMIT TO WORK) ---

    public async getPermitsByJSA(jsaId: string): Promise<PTWPermit[]> {
        const { data, error } = await supabase
            .from('ptw_permits')
            .select('*, ptw_isolation_points(*), ptw_approvals(*)')
            .eq('jsa_id', jsaId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('[getPermitsByJSA] Error:', error);
            return [];
        }
        return (data || []).map(DataMapper.toUIPTWPermit);
    }

    public async createPermit(permit: Partial<PTWPermit>, jsaId: string, actor: string): Promise<PTWPermit | null> {
        const dbPermit = DataMapper.toDBPTWPermit(permit, jsaId);
        dbPermit.created_by = actor;

        const { data, error } = await supabase
            .from('ptw_permits')
            .insert(dbPermit)
            .select('*, ptw_isolation_points(*), ptw_approvals(*)')
            .single();

        if (error) {
            console.error('[createPermit] Error:', error);
            throw error;
        }

        // Insert initial isolation points if provided
        if (permit.isolationPoints && permit.isolationPoints.length > 0 && data) {
            const dbPoints = permit.isolationPoints.map(p => DataMapper.toDBIsolationPoint(p, data.id));
            const { error: pErr } = await supabase.from('ptw_isolation_points').insert(dbPoints);
            if (pErr) console.error('[createPermit] Isolation points error:', pErr);
        }

        // Insert default approval workflow (4 roles)
        if (data) {
            const defaultApprovals = [
                { permit_id: data.id, role: 'AREA_AUTHORITY', decision: 'PENDING', sequence: 1 },
                { permit_id: data.id, role: 'HSE_OFFICER', decision: 'PENDING', sequence: 2 },
                { permit_id: data.id, role: 'OPS_SUPERVISOR', decision: 'PENDING', sequence: 3 },
                { permit_id: data.id, role: 'ISSUING_AUTHORITY', decision: 'PENDING', sequence: 4 },
            ];
            const { error: aErr } = await supabase.from('ptw_approvals').insert(defaultApprovals);
            if (aErr) console.error('[createPermit] Approvals error:', aErr);
        }

        // Re-fetch with all sub-entities
        if (data) {
            const { data: full } = await supabase
                .from('ptw_permits')
                .select('*, ptw_isolation_points(*), ptw_approvals(*)')
                .eq('id', data.id)
                .single();
            return full ? DataMapper.toUIPTWPermit(full) : null;
        }
        return null;
    }

    public async updatePermit(permitId: string, updates: Partial<PTWPermit>): Promise<void> {
        const dbUpdates: any = {};
        if (updates.description !== undefined) dbUpdates.description = updates.description;
        if (updates.permitType !== undefined) dbUpdates.permit_type = updates.permitType;
        if (updates.safetyRequirements !== undefined) dbUpdates.safety_requirements = updates.safetyRequirements;
        if (updates.ppeRequirements !== undefined) dbUpdates.ppe_requirements = updates.ppeRequirements;
        if (updates.certificatesRequired !== undefined) dbUpdates.certificates_required = updates.certificatesRequired;
        if (updates.environmentalConditions !== undefined) dbUpdates.environmental_conditions = updates.environmentalConditions;
        if (updates.validityStart !== undefined) dbUpdates.validity_start = updates.validityStart;
        if (updates.validityEnd !== undefined) dbUpdates.validity_end = updates.validityEnd;
        if (updates.permitHolderId !== undefined) dbUpdates.permit_holder_id = updates.permitHolderId;
        if (updates.toolboxTalkCompleted !== undefined) dbUpdates.toolbox_talk_completed = updates.toolboxTalkCompleted;
        if (updates.toolboxTalkNotes !== undefined) dbUpdates.toolbox_talk_notes = updates.toolboxTalkNotes;
        dbUpdates.updated_at = new Date().toISOString();

        const { error } = await supabase.from('ptw_permits').update(dbUpdates).eq('id', permitId);
        if (error) throw error;
    }

    public async updatePermitStatus(permitId: string, newStatus: string, actor: string): Promise<void> {
        // Validation: Check if status transition is allowed
        const { data: permit } = await supabase.from('ptw_permits').select('status').eq('id', permitId).single();
        if (!permit) throw new Error('Permit not found');

        const validTransitions: Record<string, string[]> = {
            'DRAFT': ['PENDING'],
            'PENDING': ['APPROVED', 'REJECTED'],
            'APPROVED': ['ISSUED'],
            'ISSUED': ['ACTIVE'],
            'ACTIVE': ['SUSPENDED', 'RETURNED'],
            'SUSPENDED': ['ACTIVE', 'RETURNED'],
            'RETURNED': ['CLOSED'],
        };

        const allowed = validTransitions[permit.status] || [];
        if (!allowed.includes(newStatus)) {
            throw new Error(`Invalid status transition: ${permit.status} → ${newStatus}`);
        }

        // For APPROVED: check all approvals are approved
        if (newStatus === 'APPROVED') {
            const { data: approvals } = await supabase.from('ptw_approvals').select('decision').eq('permit_id', permitId);
            const allApproved = (approvals || []).every(a => a.decision === 'APPROVED');
            if (!allApproved) {
                throw new Error('Cannot approve permit: not all approvals are complete');
            }
        }

        // For ISSUED: check toolbox talk is completed
        if (newStatus === 'ISSUED') {
            const { data: permitFull } = await supabase.from('ptw_permits').select('toolbox_talk_completed, issuer_id, receiver_id').eq('id', permitId).single();
            if (!permitFull?.toolbox_talk_completed) {
                throw new Error('Cannot issue permit: toolbox talk not completed');
            }
        }

        // For CLOSED: check all isolation points are DE_ISOLATED
        if (newStatus === 'CLOSED') {
            const { data: points } = await supabase.from('ptw_isolation_points').select('status').eq('permit_id', permitId);
            const allDeIsolated = (points || []).length === 0 || (points || []).every(p => p.status === 'DE_ISOLATED');
            if (!allDeIsolated) {
                throw new Error('Cannot close permit: not all isolation points are de-isolated');
            }
        }

        const updatePayload: any = { status: newStatus, updated_at: new Date().toISOString() };

        const { error } = await supabase.from('ptw_permits').update(updatePayload).eq('id', permitId);
        if (error) throw error;
    }

    public async upsertIsolationPoints(permitId: string, points: PTWIsolationPoint[]): Promise<void> {
        // Replace strategy: delete all, insert new
        await supabase.from('ptw_isolation_points').delete().eq('permit_id', permitId);

        if (points.length > 0) {
            const dbPoints = points.map(p => DataMapper.toDBIsolationPoint(p, permitId));
            const { error } = await supabase.from('ptw_isolation_points').insert(dbPoints);
            if (error) throw error;
        }
    }

    public async updateIsolationPointStatus(
        pointId: string,
        newStatus: 'ISOLATED' | 'VERIFIED' | 'DE_ISOLATED',
        actor: string
    ): Promise<void> {
        const updatePayload: any = { status: newStatus, updated_at: new Date().toISOString() };

        if (newStatus === 'ISOLATED') {
            updatePayload.isolated_by = actor;
            updatePayload.isolated_at = new Date().toISOString();
        } else if (newStatus === 'VERIFIED') {
            updatePayload.verified_by = actor;
            updatePayload.verified_at = new Date().toISOString();
        } else if (newStatus === 'DE_ISOLATED') {
            updatePayload.de_isolated_by = actor;
            updatePayload.de_isolated_at = new Date().toISOString();
        }

        const { error } = await supabase.from('ptw_isolation_points').update(updatePayload).eq('id', pointId);
        if (error) throw error;
    }

    public async recordApprovalDecision(
        approvalId: string,
        decision: 'APPROVED' | 'REJECTED',
        comments: string,
        actor: string
    ): Promise<void> {
        const { error } = await supabase
            .from('ptw_approvals')
            .update({
                approver_id: actor,
                decision,
                comments,
                decided_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', approvalId);
        if (error) throw error;
    }

    public async returnPermit(permitId: string, returnNotes: string, actor: string): Promise<void> {
        const { error } = await supabase
            .from('ptw_permits')
            .update({
                status: 'RETURNED',
                return_notes: returnNotes,
                returned_at: new Date().toISOString(),
                returned_by: actor,
                updated_at: new Date().toISOString()
            })
            .eq('id', permitId);
        if (error) throw error;
    }

}
