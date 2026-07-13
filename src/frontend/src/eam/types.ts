
// --- Admin & Security ---

export type DictionaryType =
  | 'ANALYSIS_CODE' | 'ASSET_TYPE' | 'ASSET_CATEGORY' | 'ASSET_CLASS' | 'CONTACT_TYPE' | 'COST_CENTRE'
  | 'DEPARTMENT' | 'FAULT_TYPE' | 'INVENTORY_TYPE' | 'WORK_TYPE' | 'JOURNAL_TYPE'
  | 'CRITICALITY' | 'PRIORITY' | 'QUALIFICATION_TYPE' | 'READING_TYPE' | 'STATUS_CODE'
  | 'TAX_CODE' | 'UOM'
  | 'FAILURE_MODE' | 'FAILURE_CAUSE' | 'REMEDY_CODE'
  | 'OBJECT_PART' | 'ACTIVITY_CODE'
  | 'COST_CENTER_TYPE'
  | 'PERMIT_TYPE' | 'PTW_STATUS' | 'ISOLATION_TYPE' | 'PPE_TYPE'
  | 'RCM_STRATEGY' | 'PM_STATUS'
  | 'VENDOR_TYPE';



export type ModuleName =
  | 'dashboard' | 'assets' | 'requests' | 'workOrders' | 'inventory'
  | 'readings' | 'analytics' | 'admin' | 'contacts' | 'vendors' | 'pm' | 'purchasing' | 'scheduling' | 'taskLibrary' | 'finops' | 'safety' | 'moc' | 'notifications'
  | 'reliability' | 'integrity' | 'sustain' | 'audits' | 'activityLog';

export interface ModulePermissions {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  approve: boolean; // Functional approval (e.g. Technical)
  authorize: boolean; // Financial/Final authorization
  viewCosts: boolean; // Hide sensitive data
  assign: boolean;
  spendingLimit?: number; // Max $ amount for approval/auth (Specific to Purchasing)
}

export interface DataScope {
  siteIds: string[]; // ['*'] for all
  departmentIds: string[];
  ownWorkOnly: boolean; // "My Assignments Only"
}

/** WM-2 (SAP CR) — capacity-bearing, costed resource an operation is performed at. */
/** SAP Company Code (BUKRS) — sub-company / legal entity (enterprise-structure T-0). */
export interface Company {
  id: string;
  code: string;              // '1000', 'CAIN-NG', …
  name: string;
  description?: string;
  country?: string;
  currency?: string;
  active: boolean;
}

/** Per-company number-range override (SAP NRIV per Company Code) — W-2 T-2. */
export interface NumberingOverride {
  companyId: string;
  objectClass: 'EQUIPMENT' | 'FLOC';
  prefix: string;
  pad: number;
  nextNumber: number;
}

export interface WorkCenter {
  id: string;
  code: string;              // MECH-01, ELEC-01, …
  name: string;
  siteId?: string;           // -> organization_units
  costCenterId?: string;     // -> cost_centers (default settlement receiver)
  activityRate: number;      // planned cost / hour
  capacityHoursPerDay: number;
  category?: string;
  active: boolean;
}

export interface DictionaryEntry {
  id: string;
  type: DictionaryType;
  code: string;
  description: string;
  active: boolean;

  // Contact Type Specifics
  hourlyRate?: number;
  isManufacturer?: boolean;

  // RBAC: Permissions attached to CONTACT_TYPE entries
  permissions?: Partial<Record<ModuleName, ModulePermissions>>;
  dataScope?: DataScope;

  // Reading Type Specifics
  categoryCode?: string; // e.g. 'Time Based', 'Meter Reading', 'Condition Monitoring'
  suppression?: number; // Percentage value e.g. 5.00

  // Classification Hierarchy (for ASSET_TYPE → ASSET_CATEGORY, ASSET_CLASS → ASSET_TYPE)
  categoryRef?: string; // Reference to higher-level dictionary code

  locked?: boolean; // Legacy
  is_locked?: boolean; // Schema Match

  // Priority & Dictionary ordering
  colorCode?: string; // Hex color e.g. '#EF4444' or Tailwind key for org-specific color coding
  sequence?: number;  // Sort order for dictionaries (critical for PRIORITY ranking P1→P5)

  // Extended properties (used by Admin page and INVENTORY_TYPE)
  properties?: Record<string, any>;
  metadata?: Record<string, any>;
  is_stockable?: boolean;
  [key: string]: any; // Allow arbitrary extra properties for dictionary flexibility
}

export type DictionaryRecord = DictionaryEntry;

export interface PermissionSet {
  // DEPRECATED: Use DictionaryEntry with type='CONTACT_TYPE'
  id: string;
  name: string;
  description: string;
  isSystem?: boolean;
  permissions: Partial<Record<ModuleName, ModulePermissions>>;
  dataScope: DataScope;
}

export interface User {
  id: string;
  username: string; // Unique, required
  contactId: string; // Linked Contact (Required) - Role derived from Contact Type
  status: 'active' | 'suspended';
  mfaEnabled: boolean;
  ssoProvider?: 'azure-ad' | 'okta' | null;
  lastLogin?: string;
  password?: string; // Optional for creation flow

  // Display fields (populated from linked Contact during auth)
  fullName?: string;     // Contact.name — display name for TopBar, headers
  email?: string;        // Contact.email — display email
  department?: string;   // Contact.department — org unit
  roleLabel?: string;    // Contact.defaultType — human-readable role label

  // Security Model
  // Optional per-user granular overrides (deltas) on top of Contact Type permissions
  permissionOverrides?: Partial<Record<ModuleName, Partial<ModulePermissions>>>;
  dataScopeOverrides?: Partial<DataScope>;

  // Snake-case aliases (backward compat with Admin.tsx)
  contact_id?: string;
}

// --- Notifications & Alerts (New) ---

export type NotificationSeverity = 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';
export type NotificationChannel = 'IN_APP' | 'EMAIL' | 'PUSH' | 'SMS' | 'WEBHOOK';

export interface NotificationRule {
  id: string;
  name: string;
  description?: string;
  module: ModuleName;
  eventTrigger: string; // e.g., 'STATUS_CHANGE', 'SLA_BREACH'
  isActive: boolean;

  // Criteria
  filters?: {
    field: string;
    operator: 'EQUALS' | 'NOT_EQUALS' | 'CONTAINS' | 'GREATER_THAN';
    value: string;
  }[];

  // Actions
  recipients: {
    type: 'ROLE' | 'USER' | 'DYNAMIC' | 'VENDOR'; // DYNAMIC = 'Assignee', 'Requester'; VENDOR = external vendor
    targetId: string; // Role Code, User ID, Dynamic Key, or Vendor ID
  }[];
  channels: NotificationChannel[];
  severity: NotificationSeverity;

  // Advanced
  escalationTimeoutMinutes?: number; // 0 = No escalation
  escalationRecipientRole?: string;
  escalationScope?: 'ORG_UNIT' | 'SITE' | 'GLOBAL'; // Role resolution scope (default: ORG_UNIT)
}

export interface Alert {
  id: string;
  title: string;
  message: string;
  severity: NotificationSeverity;
  dateCreated: string;
  isRead: boolean;
  isAcknowledged: boolean; // For Critical alerts

  // Context
  module: ModuleName;
  entityId?: string; // WO ID, PO ID, etc.
  entityName?: string;
  actionRequired?: boolean;
  actionLink?: string;
}

export interface NotificationChannelConfig {
  id: string;
  type: NotificationChannel;
  isActive: boolean;
  config: Record<string, any>; // Flexible JSON config
}

export interface MessageTemplate {
  id: string;
  name: string;
  triggerEvent: string;
  channelType: NotificationChannel;
  subjectTemplate: string;
  bodyTemplate: string;
  isActive: boolean;
}

export interface NotificationLog {
  id: string;
  recipientId: string;
  channel: NotificationChannel;
  subject: string;
  body: string;
  status: 'SENT' | 'FAILED' | 'QUEUED';
  sentAt: string;
  errorMessage?: string;
}

// --- Common UI ---
export interface Metric {
  label: string;
  value: string;
  trend: 'up' | 'down' | 'flat';
  trendValue: string;
  color: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
}

// --- Assets ---
export enum AssetStatus {
  ACTIVE = 'ACTIVE',
  MAINTENANCE = 'MAINTENANCE',
  STANDBY = 'STANDBY',
  DOWN = 'DOWN',
  DECOMMISSIONED = 'DECOMMISSIONED',
}

export interface Asset {
  id: string;
  tag: string;
  name: string;
  description?: string;

  status: AssetStatus;
  healthScore: number;
  priority?: string; // @deprecated — Priority belongs on WorkOrders/POs, not Assets. Kept for backward compat.
  criticality: 'A' | 'B' | 'C' | 'D'; // ISO 14224 — Safety(A), Production(B), General(C), Low(D)

  assetType?: string; // Dictionary Code (Replacing Category)
  category?: string; // Deprecated, kept for backward compat until full migration
  assetCategory?: string; // Dictionary Code - Asset Category (e.g., ROTATING, STATIC)
  assetClass?: string; // Dictionary Code - Asset Class (e.g., PUMP, COMPRESSOR)

  // Internal Equipment Number (SAP PM Equipment Number parity)
  equipmentNumber?: string;       // Auto-generated: EQ-NNNNNN (immutable after creation)
  equipmentGeneration?: number;   // Replacement counter (1 = original install, 2+ = replacement)

  parentId?: string | null;
  companyId?: string | null;   // W-2: owning Company Code (drives per-company numbering)

  // Hierarchy (ISO 14224)
  hierarchyLevel?: string;  // e.g. 'ENTERPRISE','SITE','UNIT','SYSTEM','EQUIPMENT','SUBUNIT','COMPONENT'


  image?: string;

  // Specifications
  manufacturer?: string;     // display name (legacy / back-compat)
  manufacturerId?: string;   // FK to the manufacturers master (UAT F-003 follow-up)
  model?: string;
  serialNumber?: string;
  typeCode?: string;

  // Org
  department?: string;
  costCenter?: string;
  location?: string;
  responsibleWorkCenterId?: string; // 0179 — default work group for work raised on this asset

  // Safety
  safetyNotes?: string;

  // Financials
  usefulLifeYears?: number;
  purchasePrice?: number;
  installationDate?: string;

  // Children / Related
  bomItems?: BomItem[];
  readingPoints?: ReadingDefinition[]; // UPDATED: Full Definitions
  readings?: Reading[]; // Legacy/Simple view
  costs?: CostEntry[];
  trackingLog?: TrackingEvent[];

  // Install / Dismantle (G6)
  installedAt?: string;       // Functional location ID where currently installed
  installedDate?: string;     // ISO date of current installation
  installationHistory?: InstallEvent[];

  // Custom Fields (G7)
  customFields?: CustomField[];

  // Downtime (G8)
  downtimeEvents?: DowntimeEvent[];
}

export interface BomItem {
  id: string;

  // Material link (null/undefined = Text BOM item — real part, not individually purchased)
  // Present = linked Material (Stock or Non-Stock, per INVENTORY_TYPE)
  inventoryItemId?: string;
  materialNumber?: string;       // MAT-NNNNNN (read-only, from material master)
  materialType?: string;         // INVENTORY_TYPE code (SPARE/SERVICE/NLAG/etc.)

  // Always present — from material if linked, manual entry if Text BOM
  partNumber?: string;           // part_number or free text identifier
  inventoryCode?: string;        // Legacy compat alias for partNumber
  description: string;

  // BOM entry data
  quantity: number;
  uom: string;
  critical: boolean;
  estimatedCost?: number;
  replacementIntervalDays?: number;
  notes?: string;

  // Derived (computed on read, not stored)
  isLinked?: boolean;             // true = has material record (inventoryItemId set)
  isStockable?: boolean;         // from INVENTORY_TYPE.is_stockable
}

// Old simple interface (kept for compatibility with mocks, but Readings module uses ReadingLogEntry)
export interface Reading {
  id: string;
  pointName: string;
  value: number;
  unit: string;
  timestamp: string;
  status: 'Normal' | 'Alarm';
  minLimit: number;
  maxLimit: number;
}

export interface CostEntry {
  month: string;
  labourCost: number;
  materialCost: number;
}

export interface TrackingEvent {
  eventType: string;
  description: string;
  fromValue?: string;
  toValue?: string;
  timestamp: string;
  actor: string;
}

// --- Install / Dismantle Events ---
export interface InstallEvent {
  id: string;
  assetId: string;
  fromLocationId?: string;  // Functional location tag dismantled FROM
  toLocationId?: string;    // Functional location tag installed TO
  action: 'INSTALL' | 'DISMANTLE' | 'TRANSFER';
  date: string;             // ISO date
  performedBy: string;      // Username
  workOrderRef?: string;    // Link to WO that triggered the move
  notes?: string;
}

// --- Custom Fields (G7 — MaintainX custom fields parity) ---
export interface CustomField {
  id: string;
  key: string;              // Field name (e.g. "Inlet Pressure Rating")
  value: string;            // Stored as string, formatted by type
  type: 'TEXT' | 'NUMBER' | 'DATE' | 'DROPDOWN' | 'BOOLEAN';
  unit?: string;            // e.g. "PSI", "°C"
  dropdownOptions?: string[];
}

// --- Downtime Events (G8 — MaintainX downtime tracking parity) ---
export interface DowntimeEvent {
  id: string;
  assetId: string;
  startTime: string;
  endTime?: string;         // null = still down
  durationHours?: number;   // Auto-calculated
  reason: string;           // Failure mode code or free text
  category: 'PLANNED' | 'UNPLANNED' | 'EXTERNAL';
  workOrderRef?: string;
  loggedBy: string;
}

// --- Readings Module (New) ---

export interface ReadingDefinition {
  id: string;
  assetId: string;
  readingTypeCode: string; // Links to Dictionary
  name: string; // e.g., "Run Hours", "DE Vibration"
  unit: string;
  category: 'METER' | 'CONDITION'; // Meter = Cumulative, Condition = Snapshot

  // Limits
  minWarning?: number;
  maxWarning?: number;
  minCritical?: number;
  maxCritical?: number;

  // Per-point cadence (0176). NULL = derive from asset criticality.
  monitoringFrequencyDays?: number | null;
  pfIntervalDays?: number | null;

  isActive: boolean;
  lastReadingValue?: number;
  lastReadingDate?: string;
  avgDailyUsage?: number; // Calculated
}

export interface ReadingLogEntry {
  id: string;
  definitionId: string;
  assetId: string;
  readingTypeCode: string;

  date: string;
  time: string;
  value: number;
  delta?: number; // For meters: current - previous

  enteredBy: string;
  isActive: boolean; // For "Meter Change" logic (deactivate old readings)
  comments?: string;
  /** Coded finding at reading time (SAP valuation code) — see lib/valuationCodes.ts */
  valuationCode?: string | null;

  isAlarm: boolean;
}

// --- Inventory (New) ---

export interface Store {
  id: string;
  code: string;
  name: string;
  description?: string;
  location?: string;
  bins: BinLocation[];
}

export interface BinLocation {
  id: string;
  code: string; // e.g. A-01-01
  description?: string; // e.g. Rack A, Shelf 1
  zone?: string; // e.g. Hazardous Area
}

export interface InventoryItem {
  id: string;
  materialNumber?: string; // MAT-NNNNNN (auto-generated, Material Master parity)
  code: string; // User/Stock Code
  description: string;
  isActive: boolean;
  isCritical: boolean;

  type: string; // Dictionary Code (INVENTORY_TYPE)
  uom: string; // Dictionary Code (UOM)

  // Financials
  costCenterInbound?: string;
  costCenterOutbound?: string;
  costCenterId?: string; // Default override
  taxCode?: string;
  itemCost: number; // Standard/Avg Cost
  markupAmount?: number;
  markupPercentage?: number;

  // New Lifecycle & Financials
  defaultWarrantyMonths?: number;
  warrantyFromInstall?: boolean;
  isCapitalSpare?: boolean;
  shelfLifeDays?: number;
  depreciationMethod?: string;
  salvageValue?: number;

  // Classification
  manufacturer?: string;
  manufacturerId?: string;   // FK to the manufacturers master (UAT F-003 follow-up)
  model?: string; // Mapped from DB
  barcode?: string;

  // Suppliers
  preferredSupplierId?: string;
  suppliers: InventorySupplier[];

  // Stock Data (Aggregated)
  totalQtyOnHand: number;
  totalQtyOnOrder: number;
  minLevel: number;
  maxLevel: number;

  // Stores / Locations
  stockLocations: InventoryLocation[];

  // Media & Meta
  image?: string;
  comments?: string;
  customFields?: CustomField[];

  // Audit
  createdById: string;
  createdAt: string;

  // History
  transactions: InventoryTransaction[];
}

export interface InventoryLocation {
  id: string;
  storeId?: string; // FK to Store
  storeName: string; // 'Main Store', 'Site B'
  binLocation: string; // 'C2-01-4-2'
  qtyOnHand: number;
  minQty: number;
  maxQty: number;
  reorderQty: number;
  qtyOnOrder: number;
}

export interface InventorySupplier {
  id: string;
  contactId: string; // Link to Contact
  supplierPartNo: string;
  supplierCost: number;
  leadTimeDays: number;
  isPreferred: boolean;
}

export interface InventoryTransaction {
  id: string;
  date: string;
  type: 'ISSUE' | 'RECEIPT' | 'ADJUSTMENT' | 'STOCKTAKE' | 'RETURN';
  qtyChange: number;
  newBalance: number;
  reference?: string; // WO #, PO #
  performedBy: string;
  storeName: string;
}

// --- Task Library ---

export interface LibraryTask {
  id: string;
  code: string;
  title: string;
  description: string;
  category: 'MAINTENANCE' | 'INSPECTION' | 'SAFETY' | 'PROJECT' | 'OTHER';
  estimatedDuration: number;
  instructions: InstructionBlock[];
  safetyRequirements: LibraryTaskSafetyItem[];
  createdAt?: string;
  createdBy?: string;
  inventory?: LibraryTaskInventory[];
  roles?: LibraryTaskRole[];
  files?: LibraryTaskFile[];

  // Enhancement 2: Asset Class Association (ISO 14224 equipment taxonomy)
  assetClassCodes?: string[];  // Dictionary codes: PUMP, COMPRESSOR, TURBINE, etc.

  // Enhancement 3: Version / Lock Control (MoC compliance)
  version?: number;            // Revision number (1 = original, 2+ = new version)
  isLocked?: boolean;          // Locked when used on a TECO'd WO — requires MoC to modify
  lockedAt?: string;           // ISO timestamp when locked
  lockedBy?: string;           // User ID who triggered the lock (TECO actor)
  parentTaskId?: string;       // Link to previous version (for version chain traceability)

  // Derived: Usage tracking
  usageCount?: number;         // How many PMs/WOs reference this template (computed)
}



export interface LibraryTaskSafetyItem {
  id: string;
  text: string;
  mandatory: boolean;
}

export interface LibraryTaskInventory {
  id: string;
  taskId: string;
  inventoryItemId: string;
  quantity: number;
  notes?: string;
  // Joined fields
  itemCode?: string;
  description?: string;
  uom?: string;
}

export interface LibraryTaskRole {
  id: string;
  taskId: string;
  roleCode: string;
  quantity: number;
  estimatedHours: number;
}

export interface LibraryTaskFile {
  id: string;
  taskId: string;
  name: string;
  url: string;
  type: string;
  uploadedAt?: string;
}

// --- Work Management (Jobs) ---
export enum WorkOrderStatus {
  OPEN = 'OPEN',
  PLAN = 'PLAN',
  SCHED = 'SCHED',
  WIP = 'WIP',
  WAIT = 'WAIT',
  TECO = 'TECO',
  CLOSED = 'CLOSED',
  CANC = 'CANC'
}

export enum WorkOrderType {
  CM = 'Corrective',
  PM = 'Preventive',
  PdM = 'Predictive',
  PROJECT = 'Project',
  INSPECTION = 'Inspection', // Grouped assets (Route)
}

export type WorkOrderScope = 'STANDARD' | 'PROJECT';

export interface WorkOrder {
  id: string;
  woNumber?: string; // Human readable ID (e.g. WO-2024-001)
  title: string;
  description: string; // Job Description
  status: WorkOrderStatus;
  type: WorkOrderType;
  scope: WorkOrderScope; // STANDARD = simple WO, PROJECT = shutdown/turnaround (unlocks task-level scheduling)
  priority: string; // Dictionary Code

  // Links
  assetId?: string;
  assetName?: string; // Cache for display
  assetPath?: string[]; // Hierarchy trail
  assetCode?: string; // Tag
  parentWoId?: string; // Parent Work Order ID for follow-up jobs
  recurringWorkId?: string; // Source PM/recurring job that generated this WO

  // Financial & Org
  costCenter?: string;
  workCenterId?: string;          // 0178 — Main Work Center (responsible work group)
  enforceJobCostCenter?: boolean;
  customerId?: string; // Contact ID for Customer

  // Scheduling & Time
  dateCreated: string;

  dateDueStart: string;
  timeDueStart?: string;

  dueDate: string; // Mapped to dateDueFinish
  timeDueFinish?: string;

  dateStarted?: string; // Actual Start
  timeStarted?: string;

  dateFinished?: string; // Actual Finish
  timeFinished?: string;

  estDuration: number; // Hours
  estDowntime: number; // Hours
  actualDuration: number; // Hours
  actualDowntime: number; // Hours
  actualCost?: number; // Total Actual Cost (Snapshot)

  // Reference
  reference1?: string;
  reference2?: string;
  reference3?: string;

  // Meta
  createdById: string;
  comments?: string; // Properties page comments

  // Sub-Entities
  tasks?: JobTask[];
  jsa?: JobJSA;
  labor?: JobLabor[];
  inventory?: JobInventory[];
  journals?: JobJournal[];
  files?: JobFile[];

  // Failure Analysis (Closing)
  failureData?: {
    failureMode?: string; // ISO 14224 Failure Mode (What happened)
    failureCause?: string; // ISO 14224 Failure Cause (Why it happened)
    remedyCode?: string;
    comments?: string;
    localImpact?: string;    // Local failure effect (equipment level)
    plantWideImpact?: string; // Plant-wide failure effect (production/safety/env)
    linkedWOId?: string;
    linkedWONumber?: string;
  };

  // Legacy/Compatibility fields
  assignedTo?: string;
  vendorId?: string;
  properties?: any;
}

export interface JobTask {
  id: string;
  sequence: number;
  description: string; // Heading / Summary of the task step

  // Schedule
  estHours: number;
  estStartDate?: string; // ISO String
  estStartTime?: string; // HH:mm
  estFinishDate?: string;
  estFinishTime?: string;

  // Actuals
  actualHours?: number;
  actualStartDate?: string;
  actualStartTime?: string;
  actualFinishDate?: string;
  actualFinishTime?: string;

  // Status
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  completedBy?: string;
  completedDate?: string;

  // WM-2b — operation on a costed work center (SAP PM operation)
  operationNo?: string;    // '0010','0020'… — display default = sequence*10
  workCenterId?: string;   // -> WorkCenter (costed/capacity resource)
  controlKey?: string;     // 'PM01' internal labour, 'PM02' external/service
  plannedRate?: number;    // per-operation cost/hour override of work-center activityRate

  // Dependencies (PROJECT scope only)
  predecessorTaskId?: string; // ID of the task that must complete before this one

  // Assignments
  assignedUserIds?: string[];
  assignedOrgUnitIds?: string[];

  // Sub-Instructions
  instructions: InstructionBlock[];

  // Observations (persisted notes from execution)
  observations?: string;

  // Enhancement 3: Link to source library template (for TECO locking)
  libraryTaskId?: string;
}

export interface ProcedureMedia {
  id: string;
  type: 'LINK' | 'IMAGE' | 'FILE';
  url: string;
  label?: string;
}

// ── Instruction Block Type System ─────────────────────────────────────
// 3 Structural + 11 Field types — EAM-optimized procedure builder
export type InstructionBlockType =
  // Structural
  | 'HEADING'            // Section title / visual divider
  | 'SECTION'            // Collapsible grouping container
  | 'PROCEDURE'          // Named multi-step procedure
  // Fields — Universal
  | 'CHECKBOX'           // Simple done / not-done
  | 'TEXT'               // Free-form observation or notes
  | 'NUMBER'             // Numeric value input
  | 'DATE'               // Date picker
  | 'PHOTO'              // Photo / file evidence capture
  | 'SIGNATURE'          // Digital sign-off block
  | 'CHECKLIST'          // Multiple items to check off
  | 'YES_NO_NA'          // Ternary compliance check
  // Fields — EAM-Specific (Differentiators)
  | 'PASS_FAIL'          // Pass / Fail / Flag with severity & mandatory fail-notes (RCM)
  | 'METER_READING'      // Asset counter / gauge with UOM, feeds meter history
  | 'CONDITION_READING'  // Measurement with min/max/target tolerance — auto-flags OOS
  | 'ISOLATION_CHECK';   // LOTO Point Check

export interface InstructionBlock {
  id: string;
  type: InstructionBlockType;
  sequence: number;
  label: string;           // The instruction text / heading
  required: boolean;

  // ── Execution Values ──
  valueString?: string;    // TEXT, HEADING, SECTION label, fail-notes
  valueNumber?: number;    // NUMBER, METER_READING, CONDITION_READING
  valueBoolean?: boolean;  // CHECKBOX
  valueDate?: string;      // DATE (ISO string)

  // ── PASS_FAIL (RCM-Critical) ──
  passFail?: 'PASS' | 'FAIL' | 'FLAG'; // Severity-aware inspection result
  failNotes?: string;                   // Mandatory on FAIL for root-cause traceability

  // ── YES_NO_NA ──
  yesNoNa?: 'YES' | 'NO' | 'NA';

  // ── CONDITION_READING (CBM — our differentiator) ──
  targetValue?: number;    // Expected nominal value
  minValue?: number;       // Lower tolerance limit
  maxValue?: number;       // Upper tolerance limit
  uom?: string;            // Unit of measure (mm/s, °C, PSI, etc.)
  isOutOfSpec?: boolean;   // Auto-calculated: value outside min/max bands

  // ── METER_READING ──
  meterUom?: string;       // Running hours, cycles, km, etc.
  previousReading?: number; // Last recorded value for delta calculation

  // ── CHECKLIST (multi-item) ──
  checklistItems?: { id: string; label: string; checked: boolean }[];

  // ── ISOLATION_CHECK (LOTO — ties to PTW) ──
  energyType?: 'ELECTRICAL' | 'PNEUMATIC' | 'HYDRAULIC' | 'MECHANICAL' | 'THERMAL' | 'OTHER';
  isolationVerified?: boolean;
  lockNumber?: string;     // Physical lock tag ID

  // ── PHOTO ──
  photoUrls?: string[];    // Uploaded evidence file URLs

  // ── SIGNATURE ──
  signedBy?: string;       // User ID who signed
  signedAt?: string;       // ISO timestamp of signature
  signatureRole?: string;  // Role label: 'Technician', 'Supervisor', 'HSE'

  // ── PROCEDURE (nested steps) ──
  procedureSteps?: { id: string; text: string; completed: boolean }[];

  // ── SECTION (children) ──
  children?: InstructionBlock[];

  // ── MEDIA (Reference Materials) ──
  media?: ProcedureMedia[];
}

export interface JobJSA {
  id: string;
  status: 'DRAFT' | 'REVIEW' | 'AUTHORIZED';
  hazards: JSAHazard[];
  permits: string[]; // List of permit types required
  signoffs: JSASignoff[];
  ptwPermits?: PTWPermit[]; // Linked Permit to Work records
  templateName?: string; // Name of the template used to populate this JSA
}

export interface JSAHazard {
  id: string;
  taskRefId?: string; // Link to specific JobTask
  hazard: string;
  // 5×5 Risk Matrix — INITIAL (Pre-Controls) (ISO 31000 / AS/NZS 4360)
  consequence: number;     // 1-5 (Insignificant → Catastrophic)
  likelihood: number;      // 1-5 (Rare → Almost Certain)
  riskScore: number | string; // consequence × likelihood (computed), kept as union for backward compat
  riskLevel: 'Critical' | 'High' | 'Medium' | 'Low';
  // Hierarchy of Controls (ISO 45001)
  controlHierarchy: ('Elimination' | 'Substitution' | 'Engineering' | 'Admin' | 'PPE')[];
  controls: string;
  // 5×5 Risk Matrix — RESIDUAL (Post-Controls)
  residualConsequence?: number;     // 1-5 after controls applied
  residualLikelihood?: number;      // 1-5 after controls applied
  residualRiskScore?: number;       // residualConsequence × residualLikelihood
  residualRiskLevel?: 'Critical' | 'High' | 'Medium' | 'Low';
  // Sign-off (mandatory when riskScore ≥ 15)
  signoffRequired?: boolean;
  signoffBy?: string;
  signoffDate?: string;
}

export interface JSASignoff {
  userId: string;
  role: string; // 'HSE', 'Supervisor', 'Worker'
  signedAt: string;
  status: 'Pending' | 'Signed';
  signatureDataUrl?: string; // Base64 canvas-captured signature image
}

// --- Permit to Work (PTW) ---

export interface PTWPermit {
  id: string;
  jsaId: string;
  permitType: string;       // PERMIT_TYPE dictionary code
  status: string;           // PTW_STATUS dictionary code
  permitNumber?: string;
  description: string;
  safetyRequirements: string[];
  ppeRequirements: string[];        // PPE_TYPE dictionary codes
  certificatesRequired: string[];
  environmentalConditions?: string;
  validityStart?: string;
  validityEnd?: string;
  permitHolderId?: string;
  issuerId?: string;
  receiverId?: string;
  toolboxTalkCompleted: boolean;
  toolboxTalkNotes?: string;
  returnNotes?: string;
  returnedAt?: string;
  returnedBy?: string;
  createdBy?: string;
  isolationPoints: PTWIsolationPoint[];
  approvals: PTWApproval[];
}

export interface PTWIsolationPoint {
  id: string;
  permitId: string;
  tagNumber: string;
  isolationType: string;    // ISOLATION_TYPE dictionary code
  method: 'LOCK' | 'TAG' | 'BLANK' | 'DISCONNECT';
  normalPosition: string;
  isolatedPosition: string;
  isolatedBy?: string;
  isolatedAt?: string;
  verifiedBy?: string;
  verifiedAt?: string;
  deIsolatedBy?: string;
  deIsolatedAt?: string;
  status: 'PENDING' | 'ISOLATED' | 'VERIFIED' | 'DE_ISOLATED';
  sequence: number;
}

export interface PTWApproval {
  id: string;
  permitId: string;
  approverId: string;
  role: string;
  decision: 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';
  comments?: string;
  decidedAt?: string;
  sequence: number;
}

export interface JobLabor {
  id: string;
  contactId?: string;
  contactType: string; // Dictionary Code
  isLead?: boolean;        // Lead craft designation — accountable for task quality & sign-off
  headcount?: number;      // Number of people needed for this role (default 1)
  costCenter?: string;

  estDuration: number;
  estRate: number;

  actualDuration?: number;
  actualRate?: number;

  dateWorkPerformed?: string;
  jobTaskId?: string; // Linked Task / operation (SAP operation link)

  // WM-2c — confirmation semantics (SAP IW41/CO11)
  isFinal?: boolean;        // Final confirmation closes the operation
  confirmationNo?: number;  // 1,2,3… per operation
  remainingHours?: number;  // Optional forecast-to-complete
}

/** WM-2c — per-operation actual roll-up; the stable contract FI-1 settlement consumes. */
export interface OperationActual {
  operationId: string;       // job_tasks.id
  operationNo?: string;
  workCenterId?: string;
  costCenterId?: string;     // default settlement receiver (from the work center)
  actualHours: number;       // Σ confirmed hours
  actualLabourCost: number;  // Σ(hours × resolved rate)
}

/** WM-2c — order-level actual roll-up (the settlement basis handed to FI-1). */
export interface OrderActuals {
  labourCost: number;
  partsCost: number;
  total: number;
  operations: OperationActual[];
}

export interface JobInventory {
  id: string;
  inventoryId?: string;
  description: string; // Fallback if no ID
  uom: string;
  costCenter?: string;

  estQty: number;
  estUnitCost: number;

  actualQty?: number;
  actualUnitCost?: number;
  dateUsed?: string;
  jobTaskId?: string; // Linked Task
}

export interface JobJournal {
  id: string;
  type: 'History' | 'Note' | 'Status Change' | string;
  entry: string;
  createdBy: string;
  createdAt: string;
  isSystem?: boolean;
}

export type DocumentCategory = 'PID' | 'DRAWING' | 'OEM_MANUAL' | 'DATASHEET' | 'PROCEDURE' | 'SAFETY' | 'REPORT' | 'PHOTO' | 'SPREADSHEET' | 'OTHER';

export const DOCUMENT_CATEGORY_META: Record<DocumentCategory, { label: string; icon: string; color: string; bg: string; border: string }> = {
  PID:         { label: 'P&ID',        icon: '🔧', color: 'text-cyan-700',    bg: 'bg-cyan-50',    border: 'border-cyan-200' },
  DRAWING:     { label: 'Drawing',     icon: '📐', color: 'text-blue-700',  bg: 'bg-blue-50',  border: 'border-blue-200' },
  OEM_MANUAL:  { label: 'OEM Manual',  icon: '📘', color: 'text-blue-700',    bg: 'bg-blue-50',    border: 'border-blue-200' },
  DATASHEET:   { label: 'Data Sheet',  icon: '📊', color: 'text-teal-700',    bg: 'bg-teal-50',    border: 'border-teal-200' },
  PROCEDURE:   { label: 'Procedure',   icon: '📋', color: 'text-blue-700',  bg: 'bg-blue-50',  border: 'border-blue-200' },
  SAFETY:      { label: 'Safety',      icon: '🛡️', color: 'text-red-700',     bg: 'bg-red-50',     border: 'border-red-200' },
  REPORT:      { label: 'Report',      icon: '📄', color: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200' },
  PHOTO:       { label: 'Photo',       icon: '📷', color: 'text-blue-700',  bg: 'bg-blue-50',  border: 'border-blue-200' },
  SPREADSHEET: { label: 'Spreadsheet', icon: '📊', color: 'text-green-700',   bg: 'bg-green-50',   border: 'border-green-200' },
  OTHER:       { label: 'Other',       icon: '📎', color: 'text-slate-600',   bg: 'bg-slate-50',   border: 'border-slate-200' },
};

export interface JobFile {
  id: string;
  name: string;
  description?: string;
  type: string;         // MIME type (application/pdf, image/jpeg, etc.)
  url: string;
  uploadedBy: string;
  uploadedAt: string;
  sizeBytes?: number;   // File size for display
  category?: DocumentCategory; // ISO 55000 document classification
  taskId?: string;      // Link to specific JobTask for task-level attachments
}

// --- PM & Recurring Work ---

export interface RecurringJob {
  id: string;
  code: string; // Auto-generated
  description: string;
  status: 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'DRAFT';

  // Scheduling
  scheduleType: 'TIME' | 'READING';
  frequencyInterval: number; // e.g. 3
  frequencyUnit: string; // 'Months', 'Weeks', 'Hours', 'KM'
  leadTimeDays: number;
  nextDueDate?: string; // ISO date — computed from last completion + interval

  // RCM Strategy Link (SAE JA1011 / ISO 14224)
  rcmStrategy?: 'TIME_DIRECTED' | 'CONDITION_DIRECTED' | 'FAILURE_FINDING' | 'RUN_TO_FAILURE';
  functionalFailureCode?: string; // Dictionary: FUNCTIONAL_FAILURE
  failureModeCode?: string;       // Dictionary: FAILURE_MODE — what this PM prevents

  // Failure Effects (ISO 14224 §B.2.5)
  localImpact?: string;           // Local effect on equipment/subsystem
  plantWideImpact?: string;       // Plant-wide effect on production/safety/environment

  // Cost & Organization
  costCenter?: string;            // Dictionary: COST_CENTRE
  departmentId?: string;          // Link to OrgUnit

  // Hierarchy
  parentId?: string; // For suppression logic

  // Job Template
  jobType: WorkOrderType;
  priority: string;
  estDuration: number;
  estDowntime: number;
  jobDescription?: string; // Override description for the WO

  // Templates
  tasks: JobTask[];
  labor: JobLabor[];
  inventory: JobInventory[];
  files?: JobFile[];
  jsa?: JobJSA;

  // Linked Assets
  assignedAssets: RecurringJobAsset[];

  // Rules
  rules?: GenerationRule[];

  // PM Compliance (ISO 55000 KPI — computed)
  complianceData?: {
    scheduledCount: number;       // Total PMs scheduled in period
    executedCount: number;        // Total PMs completed on-time
    compliancePct: number;        // executedCount / scheduledCount × 100
    greenThreshold?: number;      // Default 95 — "Excellent" boundary
    yellowThreshold?: number;     // Default 85 — "Acceptable" boundary
    lastCompletedDate?: string;
    lastWOId?: string;            // Link to last generated WO
  };

  createdById: string;
  createdAt: string;
  comments?: string;
}

export interface RecurringJobAsset {
  assetId: string;
  lastCompletedDate?: string;
  lastReadingValue?: number;
  isTriggered?: boolean; // For reading based, if threshold reached
}

export interface GenerationRule {
  id: string;
  fieldName: string; // 'Category', 'Cost Centre', 'Asset Type'
  operator: 'EQUALS' | 'NOT_EQUALS' | 'CONTAINS';
  value: string;
}

// --- Purchasing ---

export enum POStatus {
  DRAFT = 'DRAFT',
  OPEN = 'OPEN', // Sent to vendor
  PART_RECEIVED = 'PART_RECEIVED',
  ALL_RECEIVED = 'ALL_RECEIVED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED'
}

export interface PurchaseOrder {
  id: string;
  poCode: string;
  status: POStatus;

  // Parties
  supplierId: string; // Contact ID
  supplierContactName?: string; // Attention to
  deliveryContactId?: string; // Ship to (Store/Warehouse Contact)
  invoiceContactId?: string; // Bill to (Internal Entity)

  // Dates
  dateCreated: string;
  dateRequired: string;
  dateFinished?: string;

  // Financials
  taxInclusive: boolean;
  currency: string;

  // Meta
  createdById: string;
  authorizedById?: string;
  requestedBy?: string; // Free text
  reference?: string;
  comments?: string;

  // Content
  items: PurchaseOrderItem[];
}

export interface PurchaseOrderItem {
  id: string;
  inventoryId?: string; // Link to Item Registry
  description: string; // Can be free text
  uom: string;

  // Quantities
  qtyOrdered: number;
  qtyReceivedTotal: number;
  qtyReceivedNow?: number; // UI State for receiving process

  // Financials
  unitCost: number;
  taxAmount: number;
  lineTotal: number;

  // Links
  jobId?: string; // Link to Work Order
  glCode?: string; // Cost Center

  // Invoice Matching
  invoiceNumber?: string;
  invoiceMatched: boolean;
}

// --- Requests ---
export enum RequestStatus {
  NEW = 'NEW',
  REVIEW = 'REVIEW',
  AUTHORIZED = 'AUTHORIZED', // Stage 1 (Financial/Manager)
  APPROVED = 'APPROVED',   // Stage 2 (Technical/Planner)
  REJECTED = 'REJECTED',
  CONVERTED = 'CONVERTED',
}

export interface ServiceRequest {
  id: string;
  requestNumber: string;
  title: string;
  description: string;
  status: RequestStatus;
  priority: 'EMERGENCY' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  assetId?: string;
  assetName?: string;
  location?: string;
  requesterId: string;
  requesterName: string;
  requesterDepartment?: string;
  requesterPhone?: string;
  requesterEmail?: string;
  createdAt: string;
  slaDeadline: string;
  aiRiskScore?: number;
  functionalFailureType?: string; // ISO 14224 Functional Failure Code
  workCenterId?: string;           // 0178 — responsible work group (SAP Main Work Center)
  isBreakdown?: boolean;
  files?: JobFile[];
  linkedWOId?: string; // WO created from this request
  linkedWONumber?: string;
  authorizedBy?: string;
  authorizedAt?: string;
  rejectionReason?: string;
}

// --- Contacts ---
export interface Contact {
  id: string;
  name: string; // Display Name
  firstName?: string;
  lastName?: string;
  code: string; // Employee ID or Vendor Code
  title: string;
  email: string;
  phone: string;
  mobile: string;
  active: boolean;
  types: string[]; // ['INTERNAL', 'TECHNICIAN']
  defaultType: string;

  // Org
  organizationUnitId?: string | null; // @deprecated Use organizationUnitIds
  organizationUnitIds?: string[]; // M2M Relationship
  parentId?: string;
  department?: string;
  hourlyRate?: number;
  currency?: string;
  costCenterId?: string;
  address?: Address;

  // Backward compat / import
  roles?: string[];
  site?: string;
  reportingTo?: string;

  // Meta
  flags?: {
    canLogin?: boolean;
    canSubmitRequests?: boolean;
    canLogTime?: boolean;
    isLabour?: boolean;
    hasQualifications?: boolean;
    isVendor?: boolean;
    isVirtual?: boolean;
  };
  image?: string;
  models?: any[]; // For Manufacturers

  // Sub-lists
  customFields?: CustomField[];
  journals?: JournalEntry[];
  qualifications?: Qualification[];
  inventoryItems?: InventoryItem[];
  purchaseOrders?: PurchaseOrder[];
  labourRules?: LabourRule;
  files?: EntityFile[];
}

export interface Address {
  street: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

export interface Vendor {
  id: string;
  name: string;
  code: string;
  type: 'VENDOR' | 'MANUFACTURER' | 'SUPPLIER';
  active: boolean;

  // Financials
  paymentTerms?: string;
  currency?: string;
  hourlyRate?: number;

  // Contact
  email?: string;
  organizationUnitId?: string | null;
  phone?: string;
  mobile?: string;
  website?: string;
  address?: Address;

  // Relations
  primaryContactName?: string;

  // Meta
  createdAt?: string;
  updatedAt?: string;
  properties?: any;
}



export interface ManufacturerModel {
  id: string;
  code: string;
  description: string;
  active: boolean;
}

export interface JournalEntry {
  id: string;
  type: string;
  description: string;
  createdAt: string;
  createdBy: string;
  isLocked: boolean;
}

export interface Qualification {
  id: string;
  name: string;
  type: string;
  dateAchieved?: string;
  dateExpires: string;
  status: 'Active' | 'Expired' | 'Pending';
  notes?: string;
  imageUrl?: string;
}

export interface LabourRule {
  days: string[];
  startTime: string;
  endTime: string;
  dailyHours: number;
  holidays?: string[];
}

export interface EntityFile {
  id: string;
  entityId: string;
  entityType: 'CONTACT' | 'ASSET' | 'WO' | 'REQ';
  name: string;
  url: string;
  type?: string;
  sizeBytes?: number;
  uploadedBy?: string;
  createdAt: string;
}

// Dynamic org unit type - configured via ORG_LEVEL dictionaries
export type OrgUnitType = string;

export interface OrganizationUnit {
  id: string;
  name: string;
  code: string;
  type: OrgUnitType;
  parentId: string | null;
  managerId: string | null;
  companyId?: string | null;   // -> companies (SAP Company Code the unit belongs to)
  description?: string;
  location?: string;
  email?: string;
  phone?: string;
  customFields?: CustomField[];
  children?: OrganizationUnit[];
}
