
import {
    DictionaryEntry, Asset, AssetStatus, WorkOrder, WorkOrderStatus, WorkOrderType,
    Contact, User, ServiceRequest, RequestStatus, PermissionSet, ModuleName, ModulePermissions, RecurringJob, InventoryItem,
    ReadingDefinition, ReadingLogEntry, PurchaseOrder, POStatus, Store, NotificationRule, Alert
} from './types';

export const RELANTERN_SYSTEM_INSTRUCTION = `You are the Reliability Specialist, an advanced Industrial Asset Value Advisor embedded inside IREAMS (Integrated Reliability and Enterprise Management System).
Your mission: help engineers, managers, and executives MAXIMIZE THE VALUE their physical assets generate while MINIMIZING lifecycle costs. Every recommendation must connect maintenance actions to financial outcomes.

═══ CORE IDENTITY ═══
- You think like an experienced asset manager and reliability engineer with 20+ years on the shop floor AND in the boardroom.
- You act like an operations executive who translates engineering data into business decisions.
- You learn like a data scientist, spotting patterns in failure data and cost trends.
- You produce BESPOKE solutions grounded in the user's ACTUAL data — never generic textbook answers.
- You ALWAYS maintain HITL (Human-In-The-Loop): you ADVISE, humans DECIDE. You NEVER authorize shutdowns, purchases, asset disposal, or budget changes.

═══ DATA-FIRST REASONING PROTOCOL ═══
MANDATORY — Before answering ANY question, you MUST:

1. READ the full context block provided in the conversation — every field, every number, every path.
2. CITE specific data points from the context in your answer. Use exact values.
3. NEVER say "N/A", "not available", or "not specified" when the data IS present in the context.
4. If asked about location → read "Hierarchy Path" from the context.
5. If asked about cost → read "Total Maintenance Cost" and calculate annualized values.
6. If asked about reliability → read "MTBF", compare to OREDA, state the variance factor.
7. If asked about condition → read latest readings, state trend direction and proximity to limits.
8. If data genuinely is not in the context, say exactly WHAT data is missing and WHERE in IREAMS to find it (which module, which tab).
9. Every recommendation MUST reference THIS SPECIFIC ASSET's data — compare actual performance to OREDA benchmarks for this equipment class, calculate financial impact using THIS asset's cost history, reference actual work orders by number.

═══ IREAMS PLATFORM KNOWLEDGE ═══
You are embedded inside IREAMS. You have DIRECT ACCESS to live system data provided in the context block.

▸ ASSET HIERARCHY (ISO 14224 — 8-Level Taxonomy):
  L1: Enterprise → L2: Site → L3: Unit → L4: System → L5: Equipment → L6: Subunit → L7: Component → L8: Maintainable Item
  CRITICAL: Location of any asset is DERIVED FROM ITS HIERARCHY PATH — it is NOT a flat "location" field.
  When asked "Where is [asset]?", ALWAYS read the "Hierarchy Path" from the context and describe the full chain with names.
  Example: "HX-105 is located at SITE-HOU (Houston Refinery Complex) → UNIT-100 (Crude Distillation Unit) → SYS-100-COOL (Overhead Cooling System)."

▸ IREAMS WORKFLOW RULES (you MUST know and enforce these):
  - Work orders can ONLY target Equipment (L5+) or Maintainable Items — NEVER System level (L4). This ensures granular reliability data capture.
  - A Work Order CANNOT be Technically Complete (TECO) until the technician selects: Failure Mode + Failure Cause + Remedy (standardized ISO 14224 codes).
  - Criticality A asset WO cancellation requires: mandatory "Reason for Rejection" + digital sign-off from authorized user (Gatekeeper Protocol).
  - Canonical codes (Work Type, Failure Mode, Cost Center) LOCK after first use in a closed transaction. Changes require Management of Change (MoC) workflow.
  - RPN (Risk Priority Number) = Asset Criticality × Failure Severity. High-RPN deviations auto-escalate to "Emergency" status.
  - Generators, compressors, turbines default to Criticality A (Safety Critical), triggering mandatory failure coding and engineering review.

▸ IREAMS MODULE MAP (so you can direct users):
  Assets → Asset Register, hierarchy, BOM, readings, reliability intelligence
  Work Orders → WO lifecycle (OPEN → PLAN → SCHED → WIP → TECO → CLOSED)
  Service Requests → Work Requests (intake), auto-triage by RPN
  Recurring Work → PM/PdM programs, interval optimization
  Inventory → Spare parts, reorder intelligence, dead stock analysis
  Readings → Condition monitoring, meter readings, alarm management
  FinOps → Budget vs actuals, cost center management, RAV analysis
  Scheduling → Weekly schedule, resource leveling, backlog management
  People → Workforce, qualifications, craft assignments
  Vendors → Supplier management, performance scorecards
  Analyze → RCA, FMEA, Weibull, Criticality Assessment, Bad Actor Pareto

═══ KNOWLEDGE BASE ═══

▸ OREDA REFERENCE DATA (6th Edition — Generic Failure Rates per 10⁶ hours):
  Centrifugal Pumps: λ=120, MTBF≈8,300h | Reciprocating Compressors: λ=360, MTBF≈2,800h
  Gate Valves: λ=18, MTBF≈55,000h | Electric Motors (>100kW): λ=35, MTBF≈28,500h
  Heat Exchangers (Shell&Tube): λ=22, MTBF≈45,000h | Centrifugal Compressors: λ=180, MTBF≈5,600h
  Gas Turbines: λ=450, MTBF≈2,200h | Diesel Engines: λ=280, MTBF≈3,500h
  PSVs (Pressure Safety Valves): λ=8, MTBF≈125,000h | Control Valves: λ=55, MTBF≈18,000h
  Overhead Condensers (S&T): λ=22, MTBF≈45,000h | Fin-Fan Coolers: λ=45, MTBF≈22,000h
  Use these to benchmark. If actual λ > 1.5× generic → asset is a "bad actor." If actual λ < 0.5× generic → maintenance strategy is effective.

▸ ISO 55000:2024 — ASSET LIFECYCLE VALUE FRAMEWORK:
  Decision Points: Acquire (NPV>0, strategic fit) → Operate (maximize OEE) → Maintain (optimize TCO) → Renew (when repair cost trajectory exceeds replacement annuity) → Dispose (when net value turns negative).
  Value = f(Performance, Cost, Risk). Always express recommendations in these three dimensions.
  Total Cost of Ownership (TCO) = Acquisition + Σ(Maintenance + Downtime + Energy) + Disposal − Residual Value.

▸ ISO 14224 — FAILURE TAXONOMY (always use this hierarchy):
  L1: Equipment Class → L2: Functional Failure (what function was lost) → L3: Failure Mode (how it failed, observable) → L4: Failure Cause (why it failed, root) → L5: Failure Mechanism (degradation process).

▸ ISO 31000 / ISO 45001 — RISK FRAMEWORK:
  Risk = Consequence × Likelihood. Use 5×5 matrix. ALARP principle applies.
  Controls hierarchy: Eliminate > Substitute > Engineer > Administrate > PPE.

▸ RCM DECISION LOGIC (Moubray / SAE JA1011):
  For each failure mode, select strategy:
  - Condition-Based (CBM): When P-F interval is detectable and ≥ intervention time. Best for random failures on critical assets.
  - Time-Based (TBM): When failure rate is age-related (wear-out, β>1). Best for known degradation patterns.
  - Run-to-Failure (RTF): When consequence is low AND no cost-effective PM exists. Only for Criticality C/D assets.
  - Redesign: When no PM can reduce risk to acceptable level.

▸ FINANCIAL KPIs (always tie recommendations to these):
  MTBF = Total Operating Time / Number of Failures
  MTTR = Total Repair Time / Number of Repairs
  OEE = Availability × Performance × Quality
  Availability = (Planned Time − Downtime) / Planned Time
  Maintenance Cost Ratio = Annual Maintenance Cost / RAV. Benchmark: 2-4%.
  RONA = Net Operating Income / Net Assets
  Wrench Time benchmark: 35-65% (world class >55%)
  Schedule Compliance benchmark: >90% (world class >95%)
  PM:CM Ratio target: >80% planned, <20% reactive

▸ MAINTENANCE BEST PRACTICES:
  - Criticality A (Safety Critical): Mandatory failure coding, engineering review, RCM analysis
  - Criticality B (Production Critical): Planned PM, condition monitoring recommended
  - Criticality C (General): Standard PM program
  - Criticality D (Low): Run-to-failure acceptable
  - Bad Actor Rule: Assets with >5% of total maintenance budget OR >1.5× OREDA failure rate → defect elimination program
  - Warranty Check: ALWAYS flag if repair may be under warranty before committing spend
  - Spare Parts: Critical spares (for Crit A/B assets) should maintain min 1 unit on hand

═══ WO TASK WRITING STANDARDS ═══
When drafting or reviewing work order tasks, follow these industry best-practice rules:

▸ TASK STRUCTURE:
  - Sequence in increments of 10 (10, 20, 30...) to allow insertion of steps
  - Each task = ONE discrete work step a technician can complete and sign off
  - Start every task with an ACTION VERB: "Inspect", "Replace", "Torque", "Record", "Verify", "Isolate", "Test"
  - Include measurable acceptance criteria: "Torque flange bolts to 45 ft-lb in star pattern"
  - Include recording points: "Record bearing temperature (°C) — Log in Readings module"
  - Specify tools/equipment needed if non-standard

▸ MANDATORY TASK SEQUENCE FOR INTRUSIVE WORK:
  10. SAFETY PREP — Isolation verification, LOTO confirmation, gas test, PTW confirmation
  20-70. EXECUTION — The actual maintenance work steps in logical sequence
  80. QC/VERIFICATION — Post-work checks, functional test, leak test, alignment check
  90. RESTORATION — Remove scaffolding, reinstate guards, clear LOTO, return tools
  100. DOCUMENTATION — Complete failure coding, update readings, close out PTW

▸ ESTIMATED HOURS:
  - Base on OREDA/industry data for the specific equipment class
  - Account for wrench time factor: actual wrench time is typically 35-55% of total labor hours
  - Add 15-20% contingency for first-time or complex procedures
  - Flag if task requires special crane, scaffolding, or confined space entry (adds setup time)

▸ CRAFT ASSIGNMENT:
  - Mechanical: Rotating equipment, piping, valves, heat exchangers
  - Electrical: Motors, switchgear, transformers, cabling
  - Instrumentation: Control valves, transmitters, analyzers, DCS/PLC
  - Multi-craft: Flag coordination points and hold points requiring supervisor witness

═══ PLANNING & SCHEDULING EXPERTISE ═══

▸ PLANNING PRINCIPLES (ISO 55000 / SMRP Best Practice):
  - Ready Backlog: Maintain 2-4 weeks of fully planned work (parts staged, tools identified, permits ready)
  - Planning accuracy: Estimated vs actual hours should be within ±15%
  - Every planned job must have: scope, tasks, parts list, craft requirements, duration estimate, safety requirements
  - Job Plans should be reusable — link to Task Library for standard procedures

▸ SCHEDULING RULES:
  - Weekly schedule freeze: Lock schedule by Thursday for the following week
  - Schedule Compliance target: >90% (world class >95%)
  - Schedule Break-in limit: <10% of weekly schedule should be unplanned break-ins
  - NEVER schedule PM and CM on same equipment on same day (conflicts and shortcuts)
  - Group related work: If opening a vessel, bundle ALL pending inspection/repair work
  - Critical path method: Identify the longest task sequence and flag resource bottlenecks
  - Resource leveling: No craft should exceed 85% capacity utilization to absorb emergencies

▸ BACKLOG MANAGEMENT:
  - Backlog age >90 days → Review for relevance, recommend cancel if no longer valid
  - Backlog >6 weeks equivalent → Planning/resource constraint, recommend staffing or contractor augmentation
  - Priority P1/P2 in backlog >24h → Immediate escalation required
  - Aging backlog is a leading indicator of maintenance debt — always flag

═══ EXPERT RELIABILITY ENGINEERING ═══

▸ FAILURE PATTERN RECOGNITION (Moubray / Nowlan & Heap):
  Pattern A (Bathtub): 4% of failures — infant mortality + constant + wear-out
  Pattern B (Wear-out only): 2% — age-related degradation, increasing failure rate
  Pattern C (Gradually increasing): 5% — slowly increasing failure rate, no distinct wear-out point
  Pattern D (Initial break-in): 7% — low initial reliability then constant
  Pattern E (Random/constant): 14% — constant failure rate, no age relationship
  Pattern F (Infant mortality): 68% — decreasing early failure rate then constant
  KEY INSIGHT: 82% of failures (D+E+F) are NOT age-related → Time-based PM is often ineffective for these.
  Condition-Based Maintenance is the optimal strategy for the majority of failure modes.

▸ P-F INTERVAL GUIDANCE BY TECHNOLOGY:
  Vibration analysis: P-F = 1-9 months (most common: 3-6 months)
  Oil analysis: P-F = 1-6 months
  Thermography: P-F = 1-3 months
  Ultrasonic: P-F = 1-4 weeks (late detection)
  Visual inspection: P-F = days to weeks (very late detection)
  RULE: Inspection interval must be LESS THAN HALF the P-F interval to catch degradation before failure.

▸ WEIBULL PARAMETER INTERPRETATION:
  β < 1: Infant mortality — improve installation/commissioning/QC procedures
  β ≈ 1 (0.8-1.2): Random failures — condition monitoring is optimal, time-based PM adds no value
  β = 1.5-2.5: Early wear-out — moderate age relationship, consider hybrid CBM+TBM
  β = 2.5-4.0: Wear-out — strong age relationship, time-based replacement is justified
  β > 4.0: Highly predictable — tight age-replacement window, near-deterministic failure timing
  η (characteristic life): 63.2% of population will have failed by this age

▸ COST-RISK OPTIMIZATION:
  Optimal PM interval = point where total cost (PM cost + residual failure risk cost) is minimized
  If annual PM cost > (Annual failure probability × Cost of failure) → PM is DESTROYING VALUE
  Replace vs Repair: When cumulative repair cost over remaining life > 60% of replacement cost → replace
  Economic life: The age at which total annualized cost (depreciation + maintenance) reaches minimum

═══ RESPONSE GUIDELINES ═══
1. ALWAYS read the context data first. Cite specific values. Never ignore available data.
2. Connect every recommendation to FINANCIAL IMPACT (cost savings, risk reduction, revenue protection).
3. When comparing options, present a simple cost-benefit table with actual numbers from the data.
4. When analyzing failures, follow ISO 14224 taxonomy strictly.
5. Cite OREDA data when benchmarking — show actual vs. generic and calculate the variance factor.
6. Use executive-friendly language. Explain technical terms on first use.
7. Always state confidence level (High/Medium/Low) based on data quality.
8. Format responses with clear headers (use **bold**), bullet points, and tables.
9. End significant analyses with "⚡ Recommended Action" and "💰 Estimated Impact" sections.
10. When data is insufficient, state exactly what's missing and what module in IREAMS contains it.
11. Respect HITL — phrase as "I recommend..." or "Consider..." — never "I will..." or "Executing..."
12. For task lists, use sequenced format (10, 20, 30...) with action verbs and acceptance criteria.
13. When suggesting PM intervals, reference P-F interval data and Moubray's failure patterns.
14. Always check: Is the asset under warranty? Is there a PM already covering this failure mode?`;


export const MOCK_NOTIFICATION_RULES: NotificationRule[] = [
    {
        id: 'rule1',
        name: 'Critical Work Assignment',
        description: 'Notify technician immediately when a High Priority Job is assigned.',
        module: 'workOrders',
        eventTrigger: 'WO_ASSIGNED',
        isActive: true,
        filters: [{ field: 'priority', operator: 'EQUALS', value: 'HIGH' }],
        recipients: [{ type: 'DYNAMIC', targetId: 'Assignee' }],
        channels: ['IN_APP', 'PUSH', 'EMAIL'],
        severity: 'CRITICAL',
        escalationTimeoutMinutes: 60,
        escalationRecipientRole: 'SUPERVISOR'
    },
    {
        id: 'rule2',
        name: 'Stockout Alert',
        description: 'Alert Stores and Planner when critical parts hit 0 Qty.',
        module: 'inventory',
        eventTrigger: 'STOCK_OUT',
        isActive: true,
        filters: [{ field: 'isCritical', operator: 'EQUALS', value: 'true' }],
        recipients: [{ type: 'ROLE', targetId: 'PLANNER' }, { type: 'ROLE', targetId: 'STORE_MANAGER' }],
        channels: ['IN_APP', 'EMAIL'],
        severity: 'WARNING'
    },
    {
        id: 'rule3',
        name: 'PM Generation Report',
        description: 'Daily summary of generated PMs.',
        module: 'pm',
        eventTrigger: 'PM_WO_GENERATED',
        isActive: true,
        filters: [],
        recipients: [{ type: 'ROLE', targetId: 'PLANNER' }],
        channels: ['EMAIL'],
        severity: 'INFO'
    },
    {
        id: 'rule4',
        name: 'Condition Monitoring Alarm',
        description: 'Notify On-Call Tech when vibration/temp exceeds critical limit.',
        module: 'readings',
        eventTrigger: 'READING_ALARM',
        isActive: true,
        filters: [],
        recipients: [{ type: 'ROLE', targetId: 'TECHNICIAN' }], // Ideally "On-Call"
        channels: ['PUSH', 'SMS'],
        severity: 'CRITICAL',
        escalationTimeoutMinutes: 15,
        escalationRecipientRole: 'SUPERVISOR'
    }
];

export const MOCK_ALERTS: Alert[] = [
    {
        id: 'alert1',
        title: 'Critical Vibration: P-101-A',
        message: 'Vibration reading 4.2mm/s exceeds critical limit of 3.5mm/s.',
        severity: 'CRITICAL',
        dateCreated: new Date().toISOString(),
        isRead: false,
        isAcknowledged: false,
        module: 'readings',
        entityId: 'log15',
        entityName: 'P-101-A DE Vibration',
        actionRequired: true
    },
    {
        id: 'alert2',
        title: 'Approval Required: WO-2023-009',
        message: 'Emergency repair work order created by Night Shift requires authorization.',
        severity: 'WARNING',
        dateCreated: new Date(Date.now() - 3600000).toISOString(), // 1 hr ago
        isRead: false,
        isAcknowledged: false,
        module: 'workOrders',
        entityId: 'WO-2023-009',
        entityName: 'WO-2023-009',
        actionRequired: true,
        actionLink: '/work-orders/WO-2023-009'
    },
    {
        id: 'alert3',
        title: 'PMs Generated',
        message: 'Weekly PM generation complete. 12 new work orders created.',
        severity: 'INFO',
        dateCreated: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
        isRead: true,
        isAcknowledged: true,
        module: 'pm',
        actionRequired: false
    }
];

export const MOCK_ASSETS: Asset[] = [
    {
        id: 'a1', tag: 'P-101-A', name: 'Primary Feed Pump A', description: 'Main crude feed pump to unit 100',
        status: AssetStatus.ACTIVE, healthScore: 92, priority: 'HIGH', criticality: 'A',
        assetType: 'PUMP', assetCategory: 'ROTATING', assetClass: 'CENTRIFUGAL_PUMP',
        manufacturer: 'Flowserve', model: 'HPX', serialNumber: 'SN-2023-001-A',
        location: 'Unit 100', costCenter: 'CC-M100',
        purchasePrice: 45000, installationDate: '2023-01-15', usefulLifeYears: 20,
        bomItems: [
            { id: 'bi1', inventoryCode: 'SEAL-001', description: 'Mech Seal API 53', quantity: 1, uom: 'EA', critical: true },
            { id: 'bi2', inventoryCode: 'BRG-6205', description: 'Ball Bearing', quantity: 2, uom: 'EA', critical: false }
        ]
    },
    {
        id: 'a2', tag: 'M-101-A', name: 'Pump Motor A', description: 'Drive motor for P-101-A',
        status: AssetStatus.ACTIVE, healthScore: 98, priority: 'HIGH', criticality: 'B',
        assetType: 'MOTOR', assetCategory: 'ELECTRICAL',
        manufacturer: 'Siemens', model: '1LA7', serialNumber: 'M-998877',
        location: 'Unit 100', costCenter: 'CC-E100',
        purchasePrice: 12000, installationDate: '2023-01-15'
    }
];

// --- Mock Readings Data ---

export const MOCK_READING_DEFINITIONS: ReadingDefinition[] = [
    { id: 'def1', assetId: 'a1', readingTypeCode: 'Hours', name: 'Run Hours', unit: 'Hours', category: 'METER', isActive: true, lastReadingValue: 12500, avgDailyUsage: 24 },
    { id: 'def2', assetId: 'a1', readingTypeCode: 'Vibration', name: 'DE Vibration', unit: 'mm/s', category: 'CONDITION', isActive: true, minWarning: 0, maxWarning: 3.5, maxCritical: 7.0 },
    { id: 'def3', assetId: 'a1', readingTypeCode: 'Temperature', name: 'Bearing Temp', unit: '°C', category: 'CONDITION', isActive: true, maxWarning: 85, maxCritical: 100 }
];

export const MOCK_READING_LOGS: ReadingLogEntry[] = [
    // Run Hours History
    { id: 'log1', definitionId: 'def1', assetId: 'a1', readingTypeCode: 'Hours', date: '2023-10-20', time: '08:00', value: 12380, delta: 24, enteredBy: 'System', isActive: true, isAlarm: false },
    { id: 'log2', definitionId: 'def1', assetId: 'a1', readingTypeCode: 'Hours', date: '2023-10-21', time: '08:00', value: 12404, delta: 24, enteredBy: 'System', isActive: true, isAlarm: false },
    { id: 'log3', definitionId: 'def1', assetId: 'a1', readingTypeCode: 'Hours', date: '2023-10-22', time: '08:00', value: 12428, delta: 24, enteredBy: 'System', isActive: true, isAlarm: false },
    { id: 'log4', definitionId: 'def1', assetId: 'a1', readingTypeCode: 'Hours', date: '2023-10-23', time: '08:00', value: 12452, delta: 24, enteredBy: 'System', isActive: true, isAlarm: false },
    { id: 'log5', definitionId: 'def1', assetId: 'a1', readingTypeCode: 'Hours', date: '2023-10-24', time: '08:00', value: 12476, delta: 24, enteredBy: 'System', isActive: true, isAlarm: false },
    { id: 'log6', definitionId: 'def1', assetId: 'a1', readingTypeCode: 'Hours', date: '2023-10-25', time: '08:00', value: 12500, delta: 24, enteredBy: 'System', isActive: true, isAlarm: false },

    // Vibration History
    { id: 'log10', definitionId: 'def2', assetId: 'a1', readingTypeCode: 'Vibration', date: '2023-10-20', time: '10:00', value: 2.1, enteredBy: 'John Doe', isActive: true, isAlarm: false },
    { id: 'log11', definitionId: 'def2', assetId: 'a1', readingTypeCode: 'Vibration', date: '2023-10-21', time: '10:00', value: 2.3, enteredBy: 'John Doe', isActive: true, isAlarm: false },
    { id: 'log12', definitionId: 'def2', assetId: 'a1', readingTypeCode: 'Vibration', date: '2023-10-22', time: '10:00', value: 2.8, enteredBy: 'John Doe', isActive: true, isAlarm: false },
    { id: 'log13', definitionId: 'def2', assetId: 'a1', readingTypeCode: 'Vibration', date: '2023-10-23', time: '10:00', value: 3.4, enteredBy: 'John Doe', isActive: true, isAlarm: false },
    { id: 'log14', definitionId: 'def2', assetId: 'a1', readingTypeCode: 'Vibration', date: '2023-10-24', time: '10:00', value: 3.9, enteredBy: 'John Doe', isActive: true, isAlarm: true, comments: 'Slight noise heard' },
    { id: 'log15', definitionId: 'def2', assetId: 'a1', readingTypeCode: 'Vibration', date: '2023-10-25', time: '14:00', value: 4.2, enteredBy: 'John Doe', isActive: true, isAlarm: true, comments: 'Alert level reached' },
];

/** @deprecated — All contact data now comes from the database (People module). */
export const MOCK_CONTACTS: Contact[] = [];

export const MOCK_STORES: Store[] = [
    {
        id: 's1', code: 'STR-MAIN', name: 'Main Store', location: 'Houston - Site Main', description: 'Central spare parts repository.',
        bins: [
            { id: 'b1', code: 'A-01-01', description: 'Rack A, Shelf 1, Bin 1', zone: 'Spares' },
            { id: 'b2', code: 'A-01-02', description: 'Rack A, Shelf 1, Bin 2', zone: 'Spares' },
            { id: 'b3', code: 'C2-01-4-2', description: 'Rack C2, Shelf 4', zone: 'Seals' },
            { id: 'b4', code: 'B4-02-1-1', description: 'Rack B4, Shelf 2', zone: 'Bearings' },
        ]
    },
    {
        id: 's2', code: 'STR-U100', name: 'Unit 100 Satellite', location: 'Unit 100 Control Building', description: 'Critical spares for Unit 100 immediate access.',
        bins: [
            { id: 'b5', code: 'Cab-1', description: 'Cabinet 1 - Critical Spares', zone: 'Critical' }
        ]
    }
];

export const MOCK_INVENTORY: InventoryItem[] = [
    {
        id: 'inv1', code: 'SEAL-001', description: 'Mechanical Seal, API Plan 53, 50mm Shaft',
        isActive: true, isCritical: true, type: 'SPARE', uom: 'EA',
        costCenterInbound: 'CC-STOCK', costCenterOutbound: 'CC-M100', taxCode: 'GST',
        itemCost: 450.00, markupPercentage: 10,
        manufacturer: 'Flowserve', barcode: '123456789',
        preferredSupplierId: 'c2',
        suppliers: [
            { id: 's1', contactId: 'c2', supplierPartNo: 'FS-53-50MM', supplierCost: 450.00, leadTimeDays: 14, isPreferred: true }
        ],
        totalQtyOnHand: 3, totalQtyOnOrder: 2, minLevel: 2, maxLevel: 5,
        stockLocations: [
            { id: 'loc1', storeName: 'Main Store', binLocation: 'C2-01-4-2', qtyOnHand: 2, minQty: 2, maxQty: 5, reorderQty: 2, qtyOnOrder: 2 },
            { id: 'loc2', storeName: 'Unit 100 Satellite', binLocation: 'Cab-1', qtyOnHand: 1, minQty: 1, maxQty: 2, reorderQty: 1, qtyOnOrder: 0 }
        ],
        createdById: 'u1', createdAt: '2022-01-15',
        comments: 'Standard seal for all HPX pumps in Unit 100.',
        transactions: [
            { id: 'tx1', date: '2023-10-01', type: 'ISSUE', qtyChange: -1, newBalance: 3, performedBy: 'John Doe', storeName: 'Main Store', reference: 'WO-2023-001' }
        ]
    },
    {
        id: 'inv2', code: 'BRG-6205', description: 'Ball Bearing, 6205-2RS, Sealed',
        isActive: true, isCritical: false, type: 'SPARE', uom: 'EA',
        itemCost: 12.50, markupPercentage: 15,
        manufacturer: 'SKF', barcode: '987654321',
        preferredSupplierId: 'c2',
        suppliers: [],
        totalQtyOnHand: 45, totalQtyOnOrder: 0, minLevel: 10, maxLevel: 100,
        stockLocations: [
            { id: 'loc3', storeName: 'Main Store', binLocation: 'B4-02-1-1', qtyOnHand: 45, minQty: 10, maxQty: 100, reorderQty: 20, qtyOnOrder: 0 }
        ],
        createdById: 'u1', createdAt: '2022-02-20',
        transactions: []
    }
];

export const MOCK_PURCHASE_ORDERS: PurchaseOrder[] = [
    {
        id: 'po1',
        poCode: 'PO-2023-9988',
        status: POStatus.OPEN,
        supplierId: 'c2',
        supplierContactName: 'Sales Desk',
        deliveryContactId: 'c1', // Mocking Site Main as C1 for now
        dateCreated: '2023-10-25',
        dateRequired: '2023-11-01',
        taxInclusive: false,
        currency: 'USD',
        createdById: 'u1',
        requestedBy: 'John Doe',
        comments: 'Urgent order for Unit 100 shutdown.',
        items: [
            {
                id: 'poi1',
                inventoryId: 'inv1',
                description: 'Mechanical Seal, API Plan 53, 50mm Shaft',
                uom: 'EA',
                qtyOrdered: 2,
                qtyReceivedTotal: 0,
                unitCost: 450.00,
                taxAmount: 0,
                lineTotal: 900.00,
                jobId: 'WO-2023-001',
                invoiceMatched: false
            },
            {
                id: 'poi2',
                description: 'Expedite Fee',
                uom: 'EA',
                qtyOrdered: 1,
                qtyReceivedTotal: 1,
                unitCost: 150.00,
                taxAmount: 0,
                lineTotal: 150.00,
                invoiceMatched: false
            }
        ]
    }
];

export const MOCK_RECURRING_JOBS: RecurringJob[] = [
    {
        id: 'rj1',
        code: 'PM-PUMP-001',
        description: 'Monthly Pump External Inspection',
        status: 'ACTIVE',
        scheduleType: 'TIME',
        frequencyInterval: 1,
        frequencyUnit: 'Months',
        leadTimeDays: 5,
        jobType: WorkOrderType.PM,
        priority: 'MEDIUM',
        estDuration: 1,
        estDowntime: 0,
        jobDescription: 'Perform visual inspection of pump skid, check oil levels, record vibration.',
        createdById: 'u1',
        createdAt: '2023-01-10',
        tasks: [
            {
                id: 't1', sequence: 10, description: 'Visual Checks', estHours: 0.5, status: 'PENDING',
                instructions: [
                    { id: 'i1', type: 'CHECKBOX', sequence: 1, label: 'Check for visible leaks', required: true },
                    { id: 'i2', type: 'CHECKBOX', sequence: 2, label: 'Verify Oil Level', required: true }
                ]
            }
        ],
        labor: [
            { id: 'l1', contactType: 'TECHNICIAN', estDuration: 1, estRate: 85 }
        ],
        inventory: [],
        assignedAssets: [
            { assetId: 'a1', lastCompletedDate: '2023-10-01' }
        ]
    },
    {
        id: 'rj2',
        code: 'PM-PUMP-003',
        description: 'Annual Pump Overhaul (Major)',
        status: 'ACTIVE',
        scheduleType: 'TIME',
        frequencyInterval: 12,
        frequencyUnit: 'Months',
        leadTimeDays: 30,
        // Parent suppression: If the annual is due, suppress the monthly? 
        // Typically monthly suppresses nothing, but Annual would suppress Monthly if they coincide.
        // Let's say RJ2 is parent of RJ1.
        jobType: WorkOrderType.PM,
        priority: 'HIGH',
        estDuration: 40,
        estDowntime: 72,
        createdById: 'u1',
        createdAt: '2023-01-10',
        tasks: [],
        labor: [],
        inventory: [],
        assignedAssets: [
            { assetId: 'a1', lastCompletedDate: '2022-11-15' }
        ]
    }
];

export const MOCK_WORK_ORDERS: WorkOrder[] = [
    {
        id: 'WO-2023-001', woNumber: 'WO-2023-001', title: 'P-101-A Seal Replacement', description: 'Mechanical seal leaking. Replace with new API 53 seal.',
        status: WorkOrderStatus.OPEN, type: WorkOrderType.CM, scope: 'STANDARD', priority: 'HIGH',
        assetId: 'a1', assetName: 'Primary Feed Pump A', assetCode: 'P-101-A',
        costCenter: 'CC-M100',
        dateCreated: '2023-10-25', dateDueStart: '2023-10-26', dueDate: '2023-10-28',
        estDuration: 8, estDowntime: 8, actualDuration: 0, actualDowntime: 0,
        createdById: 'u2', assignedTo: 'u1',
        tasks: [
            { id: 't1', sequence: 10, description: 'Isolate and Decontaminate', estHours: 2, status: 'PENDING', instructions: [] },
            { id: 't2', sequence: 20, description: 'Remove Couplinger and Motor', estHours: 1, status: 'PENDING', instructions: [] },
            { id: 't3', sequence: 30, description: 'Replace Mechanical Seal', estHours: 3, status: 'PENDING', instructions: [] }
        ],
        labor: [
            { id: 'l1', contactType: 'TECHNICIAN', estDuration: 8, estRate: 85 }
        ],
        inventory: [
            { id: 'p1', inventoryId: 'inv1', description: 'Mech Seal', estQty: 1, estUnitCost: 450, actualQty: 0, uom: 'EA' }
        ]
    },
    {
        id: 'WO-2023-002', woNumber: 'WO-2023-002', title: 'Unit 100 Weekly Inspection', description: 'Routine operator rounds.',
        status: WorkOrderStatus.WIP, type: WorkOrderType.INSPECTION, scope: 'STANDARD', priority: 'LOW',
        assetId: 'a1', assetName: 'Primary Feed Pump A',
        dateCreated: '2023-10-26', dateDueStart: '2023-10-26', dueDate: '2023-10-26',
        estDuration: 1, estDowntime: 0, actualDuration: 0, actualDowntime: 0,
        createdById: 'u1', assignedTo: 'u1'
    }
];

// --- Permissions ---

const FULL_ACCESS: ModulePermissions = {
    view: true, create: true, edit: true, delete: true,
    approve: true, authorize: true, viewCosts: true, assign: true, spendingLimit: 10000
};
const READ_ONLY: ModulePermissions = {
    view: true, create: false, edit: false, delete: false,
    approve: false, authorize: false, viewCosts: false, assign: false, spendingLimit: 0
};
const TECH_ACCESS: ModulePermissions = {
    view: true, create: true, edit: true, delete: false,
    approve: false, authorize: false, viewCosts: false, assign: false, spendingLimit: 0
};
const SUPERVISOR_ACCESS: ModulePermissions = {
    view: true, create: true, edit: true, delete: false,
    approve: true, authorize: true, viewCosts: true, assign: true, spendingLimit: 5000
};

export const MOCK_PERMISSION_SETS: PermissionSet[] = []; // Deprecated, kept empty to avoid breakages if ref is missed

/** @deprecated — All user data now comes from the database (People module). */
export const MOCK_USERS: User[] = [];

export const MOCK_REQUESTS: ServiceRequest[] = [
    {
        id: 'SR-2023-001', requestNumber: 'SR-2023-001',
        title: 'Leaking flange on P-101-A', description: 'Small drip observed on discharge flange.',
        assetId: 'a1', assetName: 'Primary Feed Pump A',
        priority: 'MEDIUM', status: RequestStatus.NEW, category: 'Maintenance',
        requesterId: 'u1', requesterName: 'John Doe', createdAt: '2023-10-26T08:00:00Z', slaDeadline: '2023-10-27T08:00:00Z'
    },
    {
        id: 'SR-2023-002', requestNumber: 'SR-2023-002',
        title: 'Light bulb out in Control Room', description: 'Overhead light flickering then failed.',
        assetId: 'a8', assetName: 'Unit 100 Control Room', // Assuming a mock location asset
        priority: 'LOW', status: RequestStatus.APPROVED, category: 'Facilities',
        requesterId: 'u1', requesterName: 'John Doe', createdAt: '2023-10-26T09:30:00Z', slaDeadline: '2023-10-28T09:30:00Z'
    }
];

export const DICTIONARY_TYPES = [
    //    { key: 'ANALYSIS_CODE', label: 'Analysis Codes' }, // Removed as per USER request

    { key: 'ASSET_TYPE', label: 'Asset Types' },
    { key: 'ASSET_CATEGORY', label: 'Asset Categories' },
    { key: 'ASSET_CLASS', label: 'Asset Classes' },
    // { key: 'CATEGORY', label: 'Categories' }, // Removed as per USER request
    { key: 'CONTACT_TYPE', label: 'Roles' }, // Renamed from Contact Types / Roles' },
    // { key: 'DEPARTMENT', label: 'Departments' }, // Replaced by Organization Units
    { key: 'FAULT_TYPE', label: 'Functional Failures' },
    { key: 'FAILURE_MODE', label: 'Failure Modes (ISO 14224)' }, // New RCM Type
    { key: 'INVENTORY_TYPE', label: 'Inventory Types' },
    { key: 'WORK_TYPE', label: 'Work Types' },
    { key: 'JOURNAL_TYPE', label: 'Journal Types' },

    { key: 'COST_CENTRE', label: 'Cost Centers' },
    { key: 'CRITICALITY', label: 'Criticality Rankings' },
    { key: 'PRIORITY', label: 'Priorities' },
    { key: 'QUALIFICATION_TYPE', label: 'Qualification Types' },
    { key: 'READING_TYPE', label: 'Reading Types' },
    { key: 'STATUS_CODE', label: 'Status Codes' },
    { key: 'TAX_CODE', label: 'Tax Codes' },
    { key: 'UOM', label: 'Units of Measure' },
    { key: 'REMEDY_CODE', label: 'Remedy Codes' }, // Removed as per USER request
    { key: 'FAILURE_CAUSE', label: 'Failure Causes' }, // New RCM Type
    { key: 'OBJECT_PART', label: 'Object Parts (ISO 14224)' }, // WM-1: maintainable-item catalog
    { key: 'SUBUNIT', label: 'Subunits (ISO 14224 Level 7)' }, // 0288: equipment subdivision, scoped per asset class
    { key: 'DETECTION_METHOD', label: 'Detection Methods (ISO 14224 Table B.4)' }, // 0285: how failures were found
    { key: 'ACTIVITY_CODE', label: 'Maintenance Activities (ISO 14224)' }, // WM-1: activity catalog
    { key: 'COST_CENTER_TYPE', label: 'Cost Center Types' },
    { key: 'PERMIT_TYPE', label: 'Permit Types' },
    { key: 'PTW_STATUS', label: 'PTW Status Codes' },
    { key: 'ISOLATION_TYPE', label: 'Isolation Types' },
    { key: 'PPE_TYPE', label: 'PPE Requirements' },
    { key: 'VENDOR_TYPE', label: 'Vendor Types' },
];

export const MOCK_DICTIONARIES: DictionaryEntry[] = [
    // Contact Types with Permissions (Replacing Permission Sets)
    {
        id: 'ct1', type: 'CONTACT_TYPE', code: 'TECHNICIAN', description: 'Maintenance Technician', active: true, hourlyRate: 85.00,
        permissions: {
            dashboard: TECH_ACCESS, assets: { ...TECH_ACCESS, edit: false }, requests: TECH_ACCESS, workOrders: TECH_ACCESS,
            inventory: READ_ONLY, readings: TECH_ACCESS, analytics: READ_ONLY, admin: { ...READ_ONLY, view: false }, contacts: { ...READ_ONLY, view: false }, vendors: { ...READ_ONLY, view: false },
            pm: READ_ONLY, purchasing: READ_ONLY, scheduling: READ_ONLY, taskLibrary: READ_ONLY, finops: READ_ONLY, safety: TECH_ACCESS
        },
        dataScope: { siteIds: ['*'], departmentIds: [], ownWorkOnly: true }
    },
    {
        id: 'ct2', type: 'CONTACT_TYPE', code: 'PLANNER', description: 'Maintenance Planner', active: true, hourlyRate: 95.00,
        permissions: {
            dashboard: FULL_ACCESS, assets: FULL_ACCESS, requests: FULL_ACCESS, workOrders: FULL_ACCESS,
            inventory: FULL_ACCESS, readings: FULL_ACCESS, analytics: FULL_ACCESS, admin: READ_ONLY, contacts: READ_ONLY, vendors: FULL_ACCESS,
            pm: FULL_ACCESS, purchasing: { ...FULL_ACCESS, spendingLimit: 2000 }, scheduling: FULL_ACCESS, taskLibrary: FULL_ACCESS, finops: READ_ONLY, safety: FULL_ACCESS
        },
        dataScope: { siteIds: ['*'], departmentIds: [], ownWorkOnly: false }
    },
    {
        id: 'ct3', type: 'CONTACT_TYPE', code: 'SUPERVISOR', description: 'Maintenance Supervisor', active: true, hourlyRate: 110.00,
        permissions: {
            dashboard: FULL_ACCESS, assets: FULL_ACCESS, requests: FULL_ACCESS, workOrders: SUPERVISOR_ACCESS,
            inventory: FULL_ACCESS, readings: FULL_ACCESS, analytics: FULL_ACCESS, admin: READ_ONLY, contacts: SUPERVISOR_ACCESS, vendors: SUPERVISOR_ACCESS,
            pm: SUPERVISOR_ACCESS, purchasing: SUPERVISOR_ACCESS, scheduling: SUPERVISOR_ACCESS, taskLibrary: SUPERVISOR_ACCESS, finops: READ_ONLY, safety: SUPERVISOR_ACCESS
        },
        dataScope: { siteIds: ['*'], departmentIds: [], ownWorkOnly: false }
    },
    { id: 'ct4', type: 'CONTACT_TYPE', code: 'VENDOR', description: 'External Vendor', active: true, hourlyRate: 150.00, locked: false, is_locked: false },
    { id: 'ct5', type: 'CONTACT_TYPE', code: 'MANUFACTURER', description: 'Equipment Manufacturer', active: true, hourlyRate: 0, isManufacturer: true, locked: false, is_locked: false },

    {
        id: 'ct6', type: 'CONTACT_TYPE', code: 'INTERNAL', description: 'Internal Employee', active: true, hourlyRate: 65.00,
        permissions: { // Basic employee access
            dashboard: READ_ONLY, assets: READ_ONLY, requests: TECH_ACCESS, workOrders: { ...READ_ONLY, view: false },
            inventory: { ...READ_ONLY, view: false }, readings: { ...READ_ONLY, view: false }, analytics: { ...READ_ONLY, view: false }, admin: { ...READ_ONLY, view: false }, contacts: { ...READ_ONLY, view: false }, vendors: { ...READ_ONLY, view: false },
            pm: { ...READ_ONLY, view: false }, purchasing: { ...READ_ONLY, view: false }, scheduling: { ...READ_ONLY, view: false }, taskLibrary: { ...READ_ONLY, view: false }, finops: { ...READ_ONLY, view: false }, safety: READ_ONLY
        },
        dataScope: { siteIds: ['*'], departmentIds: [], ownWorkOnly: true }
    },

    // New Roles based on old Permission Sets
    {
        id: 'ct7', type: 'CONTACT_TYPE', code: 'RELIABILITY_ENG', description: 'Reliability Engineer', active: true, hourlyRate: 90.00,
        permissions: {
            dashboard: FULL_ACCESS, assets: FULL_ACCESS, requests: FULL_ACCESS, workOrders: FULL_ACCESS,
            inventory: FULL_ACCESS, readings: FULL_ACCESS, analytics: FULL_ACCESS, admin: READ_ONLY, contacts: READ_ONLY, vendors: FULL_ACCESS,
            pm: FULL_ACCESS, purchasing: READ_ONLY, scheduling: FULL_ACCESS, taskLibrary: FULL_ACCESS, finops: FULL_ACCESS, safety: FULL_ACCESS
        },
        dataScope: { siteIds: ['*'], departmentIds: [], ownWorkOnly: false }
    },
    {
        id: 'ct8', type: 'CONTACT_TYPE', code: 'REQUESTER', description: 'Service Requester', active: true, hourlyRate: 0,
        permissions: {
            dashboard: READ_ONLY, assets: READ_ONLY, requests: TECH_ACCESS, workOrders: { ...READ_ONLY, view: false },
            inventory: { ...READ_ONLY, view: false }, readings: { ...READ_ONLY, view: false }, analytics: { ...READ_ONLY, view: false }, admin: { ...READ_ONLY, view: false }, contacts: { ...READ_ONLY, view: false }, vendors: { ...READ_ONLY, view: false },
            pm: { ...READ_ONLY, view: false }, purchasing: { ...READ_ONLY, view: false }, scheduling: { ...READ_ONLY, view: false }, taskLibrary: { ...READ_ONLY, view: false }, finops: { ...READ_ONLY, view: false }, safety: { ...READ_ONLY, view: false }
        },
        dataScope: { siteIds: ['*'], departmentIds: [], ownWorkOnly: true }
    },
    {
        id: 'ct9', type: 'CONTACT_TYPE', code: 'SYS_ADMIN', description: 'System Administrator', active: true, hourlyRate: 0,
        locked: true, is_locked: true,
        permissions: {
            dashboard: FULL_ACCESS, assets: FULL_ACCESS, requests: FULL_ACCESS, workOrders: FULL_ACCESS,
            inventory: FULL_ACCESS, readings: FULL_ACCESS, analytics: FULL_ACCESS, admin: FULL_ACCESS, contacts: FULL_ACCESS, vendors: FULL_ACCESS,
            pm: FULL_ACCESS, purchasing: { ...FULL_ACCESS, spendingLimit: 1000000 }, scheduling: FULL_ACCESS, taskLibrary: FULL_ACCESS, finops: FULL_ACCESS, safety: FULL_ACCESS
        },
        dataScope: { siteIds: ['*'], departmentIds: [], ownWorkOnly: false }
    },


    // ═══ ISO 14224 Equipment Taxonomy — Category → Class → Type ═══

    // Asset Categories (top-level, no parent)
    { id: 'acat1', type: 'ASSET_CATEGORY', code: 'MECHANICAL', description: 'Mechanical Equipment', active: true },
    { id: 'acat2', type: 'ASSET_CATEGORY', code: 'ELECTRICAL', description: 'Electrical Equipment', active: true },
    { id: 'acat3', type: 'ASSET_CATEGORY', code: 'INSTRUMENT', description: 'Instrumentation', active: true },
    { id: 'acat4', type: 'ASSET_CATEGORY', code: 'PIPING', description: 'Piping Systems', active: true },
    { id: 'acat5', type: 'ASSET_CATEGORY', code: 'STRUCTURAL', description: 'Structural', active: true },
    { id: 'acat6', type: 'ASSET_CATEGORY', code: 'SAFETY_SYSTEM', description: 'Safety Systems', active: true },
    { id: 'acat7', type: 'ASSET_CATEGORY', code: 'SUBSEA', description: 'Subsea Equipment', active: true },

    // Asset Classes (categoryRef → Category code)
    { id: 'acls1', type: 'ASSET_CLASS', code: 'ROTATING', description: 'Rotating Equipment', active: true, categoryRef: 'MECHANICAL' },
    { id: 'acls2', type: 'ASSET_CLASS', code: 'STATIC_PRESSURE', description: 'Static / Pressure Vessels', active: true, categoryRef: 'MECHANICAL' },
    { id: 'acls3', type: 'ASSET_CLASS', code: 'HEAT_TRANSFER', description: 'Heat Transfer Equipment', active: true, categoryRef: 'MECHANICAL' },
    { id: 'acls4', type: 'ASSET_CLASS', code: 'POWER_DISTRIBUTION', description: 'Power Distribution', active: true, categoryRef: 'ELECTRICAL' },
    { id: 'acls5', type: 'ASSET_CLASS', code: 'MOTORS_DRIVES', description: 'Motors & Drives', active: true, categoryRef: 'ELECTRICAL' },
    { id: 'acls6', type: 'ASSET_CLASS', code: 'GENERATORS', description: 'Generators', active: true, categoryRef: 'ELECTRICAL' },
    { id: 'acls7', type: 'ASSET_CLASS', code: 'PROCESS_CONTROL', description: 'Process Control', active: true, categoryRef: 'INSTRUMENT' },
    { id: 'acls8', type: 'ASSET_CLASS', code: 'ANALYZERS', description: 'Analyzers', active: true, categoryRef: 'INSTRUMENT' },
    { id: 'acls9', type: 'ASSET_CLASS', code: 'PROCESS_PIPING', description: 'Process Piping', active: true, categoryRef: 'PIPING' },
    { id: 'acls10', type: 'ASSET_CLASS', code: 'FIRE_GAS', description: 'Fire & Gas Detection', active: true, categoryRef: 'SAFETY_SYSTEM' },
    { id: 'acls11', type: 'ASSET_CLASS', code: 'ESD', description: 'Emergency Shutdown', active: true, categoryRef: 'SAFETY_SYSTEM' },
    { id: 'acls12', type: 'ASSET_CLASS', code: 'PSV', description: 'Pressure Safety Valves', active: true, categoryRef: 'SAFETY_SYSTEM' },

    // Asset Types (categoryRef → Class code)
    { id: 'atyp1', type: 'ASSET_TYPE', code: 'CENTRIFUGAL_PUMP', description: 'Centrifugal Pump', active: true, categoryRef: 'ROTATING' },
    { id: 'atyp2', type: 'ASSET_TYPE', code: 'RECIPROCATING_PUMP', description: 'Reciprocating Pump', active: true, categoryRef: 'ROTATING' },
    { id: 'atyp3', type: 'ASSET_TYPE', code: 'CENTRIFUGAL_COMPRESSOR', description: 'Centrifugal Compressor', active: true, categoryRef: 'ROTATING' },
    { id: 'atyp4', type: 'ASSET_TYPE', code: 'RECIPROCATING_COMPRESSOR', description: 'Reciprocating Compressor', active: true, categoryRef: 'ROTATING' },
    { id: 'atyp5', type: 'ASSET_TYPE', code: 'GAS_TURBINE', description: 'Gas Turbine', active: true, categoryRef: 'ROTATING' },
    { id: 'atyp6', type: 'ASSET_TYPE', code: 'STEAM_TURBINE', description: 'Steam Turbine', active: true, categoryRef: 'ROTATING' },
    { id: 'atyp7', type: 'ASSET_TYPE', code: 'ELECTRIC_MOTOR', description: 'Electric Motor', active: true, categoryRef: 'MOTORS_DRIVES' },
    { id: 'atyp8', type: 'ASSET_TYPE', code: 'VSD', description: 'Variable Speed Drive', active: true, categoryRef: 'MOTORS_DRIVES' },
    { id: 'atyp9', type: 'ASSET_TYPE', code: 'PRESSURE_VESSEL', description: 'Pressure Vessel', active: true, categoryRef: 'STATIC_PRESSURE' },
    { id: 'atyp10', type: 'ASSET_TYPE', code: 'STORAGE_TANK', description: 'Storage Tank', active: true, categoryRef: 'STATIC_PRESSURE' },
    { id: 'atyp11', type: 'ASSET_TYPE', code: 'SEPARATOR', description: 'Separator', active: true, categoryRef: 'STATIC_PRESSURE' },
    { id: 'atyp12', type: 'ASSET_TYPE', code: 'HEAT_EXCHANGER', description: 'Shell & Tube Heat Exchanger', active: true, categoryRef: 'HEAT_TRANSFER' },
    { id: 'atyp13', type: 'ASSET_TYPE', code: 'AIR_COOLER', description: 'Air-Cooled Exchanger', active: true, categoryRef: 'HEAT_TRANSFER' },
    { id: 'atyp14', type: 'ASSET_TYPE', code: 'TRANSFORMER', description: 'Power Transformer', active: true, categoryRef: 'POWER_DISTRIBUTION' },
    { id: 'atyp15', type: 'ASSET_TYPE', code: 'SWITCHGEAR', description: 'Switchgear', active: true, categoryRef: 'POWER_DISTRIBUTION' },
    { id: 'atyp16', type: 'ASSET_TYPE', code: 'FLOW_METER', description: 'Flow Meter', active: true, categoryRef: 'PROCESS_CONTROL' },
    { id: 'atyp17', type: 'ASSET_TYPE', code: 'CONTROL_VALVE', description: 'Control Valve', active: true, categoryRef: 'PROCESS_CONTROL' },
    { id: 'atyp18', type: 'ASSET_TYPE', code: 'PRESSURE_TRANSMITTER', description: 'Pressure Transmitter', active: true, categoryRef: 'PROCESS_CONTROL' },
    { id: 'atyp19', type: 'ASSET_TYPE', code: 'GAS_DETECTOR', description: 'Gas Detector', active: true, categoryRef: 'FIRE_GAS' },
    { id: 'atyp20', type: 'ASSET_TYPE', code: 'FIRE_DETECTOR', description: 'Fire Detector', active: true, categoryRef: 'FIRE_GAS' },

    // Status Codes (SSOT for Requests & WO)
    { id: 'st1', type: 'STATUS_CODE', code: 'OPEN', description: 'Open / New', active: true },
    { id: 'st2', type: 'STATUS_CODE', code: 'PLAN', description: 'Planning', active: true },
    { id: 'st3', type: 'STATUS_CODE', code: 'SCHED', description: 'Scheduled', active: true },
    { id: 'st4', type: 'STATUS_CODE', code: 'WIP', description: 'Work In Progress', active: true },
    { id: 'st5', type: 'STATUS_CODE', code: 'WAIT', description: 'Waiting for Parts/Access', active: true },
    { id: 'st6', type: 'STATUS_CODE', code: 'TECO', description: 'Technically Complete', active: true },
    { id: 'st7', type: 'STATUS_CODE', code: 'CLOSED', description: 'Closed (Financial)', active: true },
    { id: 'st8', type: 'STATUS_CODE', code: 'CANC', description: 'Cancelled', active: true },
    { id: 'st9', type: 'STATUS_CODE', code: 'REJECTED', description: 'Rejected', active: true }, // Keep for Requests if needed

    // Reading Types
    { id: 'rt1', type: 'READING_TYPE', code: 'Hours', description: 'Running Hours', active: true, categoryCode: 'Meter Reading', suppression: 5.00, locked: true },
    { id: 'rt2', type: 'READING_TYPE', code: 'KM', description: 'Kilometres', active: true, categoryCode: 'Meter Reading', suppression: 10.00, locked: true },
    { id: 'rt3', type: 'READING_TYPE', code: 'Temperature', description: 'Temperature (C)', active: true, categoryCode: 'Condition Monitoring', suppression: 0.00, locked: false },
    { id: 'rt4', type: 'READING_TYPE', code: 'Vibration', description: 'Vibration (mm/s)', active: true, categoryCode: 'Condition Monitoring', suppression: 0.00, locked: false },
    { id: 'rt5', type: 'READING_TYPE', code: 'Pressure', description: 'Pressure (Bar)', active: true, categoryCode: 'Condition Monitoring', suppression: 0.00, locked: false },

    // Units of Measure
    { id: 'uom1', type: 'UOM', code: 'EA', description: 'Each', active: true },
    { id: 'uom2', type: 'UOM', code: 'KG', description: 'Kilogram', active: true },
    { id: 'uom3', type: 'UOM', code: 'LTR', description: 'Litre', active: true },
    { id: 'uom4', type: 'UOM', code: 'M', description: 'Metre', active: true },
    { id: 'uom5', type: 'UOM', code: 'BOX', description: 'Box', active: true },
    { id: 'uom6', type: 'UOM', code: 'SET', description: 'Set', active: true },
    { id: 'uom7', type: 'UOM', code: 'HR', description: 'Hour', active: true },

    // Inventory Types — SAP Material Type parity
    // is_stockable: true = carries stock levels (bin, min/max, reorder)
    // is_valued: true = tracks cost/valuation
    { id: 'it1', type: 'INVENTORY_TYPE', code: 'SPARE', description: 'Spare Part', active: true, is_stockable: true, is_valued: true },
    { id: 'it2', type: 'INVENTORY_TYPE', code: 'CONSUMABLE', description: 'Consumable / Expense', active: true, is_stockable: true, is_valued: true },
    { id: 'it3', type: 'INVENTORY_TYPE', code: 'RAW', description: 'Raw Material', active: true, is_stockable: true, is_valued: true },
    { id: 'it4', type: 'INVENTORY_TYPE', code: 'ROTABLE', description: 'Rotable Asset', active: true, is_stockable: true, is_valued: true },
    { id: 'it5', type: 'INVENTORY_TYPE', code: 'SERVICE', description: 'Service / Labor', active: true, is_stockable: false, is_valued: true },
    { id: 'it6', type: 'INVENTORY_TYPE', code: 'TOOL', description: 'Tooling', active: true, is_stockable: true, is_valued: true },
    { id: 'it7', type: 'INVENTORY_TYPE', code: 'NLAG', description: 'Non-Valuated Material', active: true, is_stockable: false, is_valued: false },

    // Criticality Rankings — ISO 14224 / RCM aligned
    { id: 'crit1', type: 'CRITICALITY', code: 'A', description: 'Safety Critical', active: true, sequence: 1, colorCode: '#EF4444' },
    { id: 'crit2', type: 'CRITICALITY', code: 'B', description: 'Production Critical', active: true, sequence: 2, colorCode: '#F97316' },
    { id: 'crit3', type: 'CRITICALITY', code: 'C', description: 'General', active: true, sequence: 3, colorCode: '#3B82F6' },
    { id: 'crit4', type: 'CRITICALITY', code: 'D', description: 'Low / Run-to-Failure', active: true, sequence: 4, colorCode: '#64748B' },

    // Priorities — Oil & Gas P1-P5 (ISO 14224 / RCM aligned)
    { id: 'd1', type: 'PRIORITY', code: 'P1', description: 'Emergency — Immediate response', active: true, sequence: 1, colorCode: '#EF4444' },
    { id: 'd2', type: 'PRIORITY', code: 'P2', description: 'Urgent — Within 24 hours', active: true, sequence: 2, colorCode: '#F97316' },
    { id: 'd3', type: 'PRIORITY', code: 'P3', description: 'High — Within 7 days', active: true, sequence: 3, colorCode: '#F59E0B' },
    { id: 'd4a', type: 'PRIORITY', code: 'P4', description: 'Normal — Planned schedule', active: true, sequence: 4, colorCode: '#3B82F6' },
    { id: 'd4b', type: 'PRIORITY', code: 'P5', description: 'Low — Backlog / opportunistic', active: true, sequence: 5, colorCode: '#64748B' },
    { id: 'd4', type: 'WORK_TYPE', code: 'CM', description: 'Corrective Maintenance', active: true },
    { id: 'd5', type: 'WORK_TYPE', code: 'PM', description: 'Preventive Maintenance', active: true },
    { id: 'd6', type: 'WORK_TYPE', code: 'DE', description: 'Defect Elimination', active: true },
    // Asset Types (Replacing old hardcoded Categories) - linked to Categories via categoryRef
    { id: 'at1', type: 'ASSET_TYPE', code: 'PUMP', description: 'Pump', active: true, categoryRef: 'ROTATING' },
    { id: 'at2', type: 'ASSET_TYPE', code: 'MOTOR', description: 'Electric Motor', active: true, categoryRef: 'ELECTRICAL' },
    { id: 'at3', type: 'ASSET_TYPE', code: 'VALVE', description: 'Valve', active: true, categoryRef: 'STATIC' },
    { id: 'at4', type: 'ASSET_TYPE', code: 'TANK', description: 'Storage Tank', active: true, categoryRef: 'STATIC' },
    { id: 'at5', type: 'ASSET_TYPE', code: 'COMPRESSOR', description: 'Compressor', active: true, categoryRef: 'ROTATING' },
    { id: 'at6', type: 'ASSET_TYPE', code: 'FAN', description: 'Fan / Blower', active: true, categoryRef: 'ROTATING' },
    { id: 'at7', type: 'ASSET_TYPE', code: 'CONVEYOR', description: 'Conveyor Belt', active: true, categoryRef: 'ROTATING' },
    // Locations as Asset Types (if user wants them unified)
    { id: 'at8', type: 'ASSET_TYPE', code: 'SITE', description: 'Site / Plant', active: true },
    { id: 'at9', type: 'ASSET_TYPE', code: 'AREA', description: 'Area / Zone', active: true },
    { id: 'at10', type: 'ASSET_TYPE', code: 'UNIT', description: 'Process Unit', active: true },
    { id: 'at11', type: 'ASSET_TYPE', code: 'SYSTEM', description: 'System', active: true },

    // Asset Categories (New)
    { id: 'cat1', type: 'ASSET_CATEGORY', code: 'ROTATING', description: 'Rotating Equipment', active: true },
    { id: 'cat2', type: 'ASSET_CATEGORY', code: 'STATIC', description: 'Static Equipment', active: true },
    { id: 'cat3', type: 'ASSET_CATEGORY', code: 'ELECTRICAL', description: 'Electrical', active: true },
    { id: 'cat4', type: 'ASSET_CATEGORY', code: 'INSTRUMENTATION', description: 'Instrumentation', active: true },

    // Asset Classes (New) - linked to Types via categoryRef
    { id: 'cls1', type: 'ASSET_CLASS', code: 'CENTRIFUGAL_PUMP', description: 'Centrifugal Pump', active: true, categoryRef: 'PUMP' },
    { id: 'cls2', type: 'ASSET_CLASS', code: 'RECIPROCATING_PUMP', description: 'Reciprocating Pump', active: true, categoryRef: 'PUMP' },
    { id: 'cls3', type: 'ASSET_CLASS', code: 'SCREW_COMPRESSOR', description: 'Screw Compressor', active: true, categoryRef: 'COMPRESSOR' },
    { id: 'cls4', type: 'ASSET_CLASS', code: 'RECIPROCATING_COMPRESSOR', description: 'Reciprocating Compressor', active: true, categoryRef: 'COMPRESSOR' },
    { id: 'cls5', type: 'ASSET_CLASS', code: 'PRESSURE_VESSEL', description: 'Pressure Vessel', active: true, categoryRef: 'TANK' },
    { id: 'cls6', type: 'ASSET_CLASS', code: 'STORAGE_TANK', description: 'Storage Tank', active: true, categoryRef: 'TANK' },
    { id: 'cls7', type: 'ASSET_CLASS', code: 'HEAT_EXCHANGER', description: 'Heat Exchanger', active: true, categoryRef: 'TANK' },
    { id: 'cls8', type: 'ASSET_CLASS', code: 'GATE_VALVE', description: 'Gate Valve', active: true, categoryRef: 'VALVE' },
    { id: 'cls9', type: 'ASSET_CLASS', code: 'BALL_VALVE', description: 'Ball Valve', active: true, categoryRef: 'VALVE' },



    { id: 'd7', type: 'COST_CENTRE', code: 'CC-M100', description: 'Main Maintenance', active: true },

    // ═══ Functional Failures (ISO 14224: Loss of Function) ═══
    // GENERAL — Always shown (no categoryRef)
    { id: 'ff-g01', type: 'FAULT_TYPE', code: 'FAIL_START', description: 'Failure to Start on Demand', active: true },
    { id: 'ff-g02', type: 'FAULT_TYPE', code: 'FAIL_STOP', description: 'Failure to Stop on Demand', active: true },
    { id: 'ff-g03', type: 'FAULT_TYPE', code: 'FAIL_RUN', description: 'Stops Running (Spurious Trip)', active: true },
    { id: 'ff-g04', type: 'FAULT_TYPE', code: 'LEAK_EXT', description: 'External Leakage — Process Medium', active: true },
    { id: 'ff-g05', type: 'FAULT_TYPE', code: 'LEAK_INT', description: 'Internal Leakage (Passing)', active: true },
    { id: 'ff-g06', type: 'FAULT_TYPE', code: 'VIBRATION', description: 'Abnormal Vibration / High Noise', active: true },
    { id: 'ff-g07', type: 'FAULT_TYPE', code: 'OVERHEAT', description: 'Overheating / High Temperature', active: true },
    { id: 'ff-g08', type: 'FAULT_TYPE', code: 'LOW_OUTPUT', description: 'Low Output / Reduced Performance', active: true },
    { id: 'ff-g09', type: 'FAULT_TYPE', code: 'HIGH_OUTPUT', description: 'High Output / Overpressure / Overflow', active: true },
    { id: 'ff-g10', type: 'FAULT_TYPE', code: 'PARAM_DEV', description: 'Parameter Deviation (Control)', active: true },
    { id: 'ff-g11', type: 'FAULT_TYPE', code: 'STRUCTURAL', description: 'Structural Deficiency / Damage', active: true },
    { id: 'ff-g12', type: 'FAULT_TYPE', code: 'ABNORMAL_COND', description: 'Abnormal Condition Detected', active: true },
    { id: 'ff-g13', type: 'FAULT_TYPE', code: 'FF_OTHER', description: 'Other Functional Failure', active: true },

    // ROTATING — Pumps, Compressors, Turbines, Fans
    { id: 'ff-r01', type: 'FAULT_TYPE', code: 'ROT_BRG_FAIL', description: 'Bearing Failure', active: true, categoryRef: 'ROTATING' },
    { id: 'ff-r02', type: 'FAULT_TYPE', code: 'ROT_SEAL_LK', description: 'Seal Leakage / Seal Failure', active: true, categoryRef: 'ROTATING' },
    { id: 'ff-r03', type: 'FAULT_TYPE', code: 'ROT_IMPEL', description: 'Impeller / Rotor Damage', active: true, categoryRef: 'ROTATING' },
    { id: 'ff-r04', type: 'FAULT_TYPE', code: 'ROT_CAVIT', description: 'Cavitation', active: true, categoryRef: 'ROTATING' },
    { id: 'ff-r05', type: 'FAULT_TYPE', code: 'ROT_SURGE', description: 'Compressor Surge', active: true, categoryRef: 'ROTATING' },
    { id: 'ff-r06', type: 'FAULT_TYPE', code: 'ROT_MISAL', description: 'Misalignment / Shaft Deflection', active: true, categoryRef: 'ROTATING' },
    { id: 'ff-r07', type: 'FAULT_TYPE', code: 'ROT_LUB_FAIL', description: 'Lubrication Failure / Oil Contamination', active: true, categoryRef: 'ROTATING' },
    { id: 'ff-r08', type: 'FAULT_TYPE', code: 'ROT_IMBAL', description: 'Imbalance / Out of Balance', active: true, categoryRef: 'ROTATING' },
    { id: 'ff-r09', type: 'FAULT_TYPE', code: 'ROT_COUPL', description: 'Coupling Failure', active: true, categoryRef: 'ROTATING' },
    { id: 'ff-r10', type: 'FAULT_TYPE', code: 'ROT_GEARBOX', description: 'Gearbox Failure', active: true, categoryRef: 'ROTATING' },
    { id: 'ff-r11', type: 'FAULT_TYPE', code: 'ROT_LOW_FLOW', description: 'Low Flow / No Discharge', active: true, categoryRef: 'ROTATING' },
    { id: 'ff-r12', type: 'FAULT_TYPE', code: 'ROT_LOW_PRESS', description: 'Low Discharge Pressure', active: true, categoryRef: 'ROTATING' },

    // STATIC_PRESSURE — Vessels, Tanks, Separators
    { id: 'ff-s01', type: 'FAULT_TYPE', code: 'STA_CORR', description: 'Corrosion (Internal / External)', active: true, categoryRef: 'STATIC_PRESSURE' },
    { id: 'ff-s02', type: 'FAULT_TYPE', code: 'STA_EROS', description: 'Erosion / Wall Thinning', active: true, categoryRef: 'STATIC_PRESSURE' },
    { id: 'ff-s03', type: 'FAULT_TYPE', code: 'STA_CRACK', description: 'Cracking / Fatigue', active: true, categoryRef: 'STATIC_PRESSURE' },
    { id: 'ff-s04', type: 'FAULT_TYPE', code: 'STA_BULGE', description: 'Bulging / Deformation', active: true, categoryRef: 'STATIC_PRESSURE' },
    { id: 'ff-s05', type: 'FAULT_TYPE', code: 'STA_LVL', description: 'Level Control Failure', active: true, categoryRef: 'STATIC_PRESSURE' },
    { id: 'ff-s06', type: 'FAULT_TYPE', code: 'STA_PRV', description: 'Pressure Relief Malfunction', active: true, categoryRef: 'STATIC_PRESSURE' },
    { id: 'ff-s07', type: 'FAULT_TYPE', code: 'STA_FOUL', description: 'Fouling / Scaling', active: true, categoryRef: 'STATIC_PRESSURE' },
    { id: 'ff-s08', type: 'FAULT_TYPE', code: 'STA_FLNG', description: 'Leak at Connection / Flange', active: true, categoryRef: 'STATIC_PRESSURE' },

    // ELECTRICAL — Motors, Generators, Switchgear, Transformers, VSD
    { id: 'ff-e01', type: 'FAULT_TYPE', code: 'ELE_INSUL', description: 'Insulation Failure / Breakdown', active: true, categoryRef: 'ELECTRICAL' },
    { id: 'ff-e02', type: 'FAULT_TYPE', code: 'ELE_WINDING', description: 'Winding Failure (Open / Short)', active: true, categoryRef: 'ELECTRICAL' },
    { id: 'ff-e03', type: 'FAULT_TYPE', code: 'ELE_OVRLD', description: 'Overload / Overcurrent Trip', active: true, categoryRef: 'ELECTRICAL' },
    { id: 'ff-e04', type: 'FAULT_TYPE', code: 'ELE_EARTH', description: 'Earth / Ground Fault', active: true, categoryRef: 'ELECTRICAL' },
    { id: 'ff-e05', type: 'FAULT_TYPE', code: 'ELE_ARC', description: 'Arcing / Flashover', active: true, categoryRef: 'ELECTRICAL' },
    { id: 'ff-e06', type: 'FAULT_TYPE', code: 'ELE_PHASE', description: 'Phase Imbalance / Loss of Phase', active: true, categoryRef: 'ELECTRICAL' },
    { id: 'ff-e07', type: 'FAULT_TYPE', code: 'ELE_PWR', description: 'Power Supply Failure', active: true, categoryRef: 'ELECTRICAL' },
    { id: 'ff-e08', type: 'FAULT_TYPE', code: 'ELE_COOL', description: 'Cooling Failure (Transformer / Motor)', active: true, categoryRef: 'ELECTRICAL' },

    // INSTRUMENT — Transmitters, Analyzers, Control Valves, Meters
    { id: 'ff-i01', type: 'FAULT_TYPE', code: 'INS_READING', description: 'Abnormal Instrument Reading / Drift', active: true, categoryRef: 'INSTRUMENT' },
    { id: 'ff-i02', type: 'FAULT_TYPE', code: 'INS_FTC', description: 'Fail to Close', active: true, categoryRef: 'INSTRUMENT' },
    { id: 'ff-i03', type: 'FAULT_TYPE', code: 'INS_FTO', description: 'Fail to Open', active: true, categoryRef: 'INSTRUMENT' },
    { id: 'ff-i04', type: 'FAULT_TYPE', code: 'INS_FTR', description: 'Fail to Regulate / Control', active: true, categoryRef: 'INSTRUMENT' },
    { id: 'ff-i05', type: 'FAULT_TYPE', code: 'INS_SIGNAL', description: 'Signal Loss / Communication Failure', active: true, categoryRef: 'INSTRUMENT' },
    { id: 'ff-i06', type: 'FAULT_TYPE', code: 'INS_STUCK', description: 'Sticking / Seized', active: true, categoryRef: 'INSTRUMENT' },
    { id: 'ff-i07', type: 'FAULT_TYPE', code: 'INS_SPUR', description: 'Spurious Operation / False Trip', active: true, categoryRef: 'INSTRUMENT' },
    { id: 'ff-i08', type: 'FAULT_TYPE', code: 'INS_SENSOR', description: 'Sensor Failure / Probe Degraded', active: true, categoryRef: 'INSTRUMENT' },
    { id: 'ff-i09', type: 'FAULT_TYPE', code: 'INS_SETPOINT', description: 'Setpoint Error', active: true, categoryRef: 'INSTRUMENT' },

    // PIPING — Process Piping, Fittings, Flanges
    { id: 'ff-p01', type: 'FAULT_TYPE', code: 'PIP_WALL_LK', description: 'Leakage through Pipe Wall / Casing', active: true, categoryRef: 'PIPING' },
    { id: 'ff-p02', type: 'FAULT_TYPE', code: 'PIP_CORR', description: 'Pipe Corrosion (Internal / External)', active: true, categoryRef: 'PIPING' },
    { id: 'ff-p03', type: 'FAULT_TYPE', code: 'PIP_EROS', description: 'Pipe Erosion', active: true, categoryRef: 'PIPING' },
    { id: 'ff-p04', type: 'FAULT_TYPE', code: 'PIP_FLANGE', description: 'Flange Leak / Gasket Failure', active: true, categoryRef: 'PIPING' },
    { id: 'ff-p05', type: 'FAULT_TYPE', code: 'PIP_WELD', description: 'Weld Defect / Weld Failure', active: true, categoryRef: 'PIPING' },
    { id: 'ff-p06', type: 'FAULT_TYPE', code: 'PIP_BLOCKAGE', description: 'Blockage / Plugging', active: true, categoryRef: 'PIPING' },

    // SAFETY_SYSTEM — F&G, ESD, PSV, Deluge
    { id: 'ff-sf01', type: 'FAULT_TYPE', code: 'SAF_FTF', description: 'Fail to Function on Demand (Dangerous Failure)', active: true, categoryRef: 'SAFETY_SYSTEM' },
    { id: 'ff-sf02', type: 'FAULT_TYPE', code: 'SAF_SPUR', description: 'Spurious Trip (Nuisance)', active: true, categoryRef: 'SAFETY_SYSTEM' },
    { id: 'ff-sf03', type: 'FAULT_TYPE', code: 'SAF_VALVE', description: 'Safety Valve Seat Leakage', active: true, categoryRef: 'SAFETY_SYSTEM' },
    { id: 'ff-sf04', type: 'FAULT_TYPE', code: 'SAF_SOLENOID', description: 'Solenoid Valve Failure', active: true, categoryRef: 'SAFETY_SYSTEM' },
    { id: 'ff-sf05', type: 'FAULT_TYPE', code: 'SAF_DETECT', description: 'Detector Failure / False Alarm', active: true, categoryRef: 'SAFETY_SYSTEM' },
    { id: 'ff-sf06', type: 'FAULT_TYPE', code: 'SAF_LOGIC', description: 'Logic Solver / PLC Fault', active: true, categoryRef: 'SAFETY_SYSTEM' },

    // HEAT_TRANSFER — Heat Exchangers, Air Coolers, Boilers
    { id: 'ff-h01', type: 'FAULT_TYPE', code: 'HT_TUBE_LK', description: 'Tube Leak / Tube Bundle Failure', active: true, categoryRef: 'HEAT_TRANSFER' },
    { id: 'ff-h02', type: 'FAULT_TYPE', code: 'HT_FOUL', description: 'Tube Plugging / Fouling', active: true, categoryRef: 'HEAT_TRANSFER' },
    { id: 'ff-h03', type: 'FAULT_TYPE', code: 'HT_BAFFLE', description: 'Baffle / Internal Damage', active: true, categoryRef: 'HEAT_TRANSFER' },
    { id: 'ff-h04', type: 'FAULT_TYPE', code: 'HT_FAN', description: 'Fan Failure (Air Cooler)', active: true, categoryRef: 'HEAT_TRANSFER' },
    { id: 'ff-h05', type: 'FAULT_TYPE', code: 'HT_PERF', description: 'Reduced Thermal Performance', active: true, categoryRef: 'HEAT_TRANSFER' },

    // ═══ Failure Modes (ISO 14224 Table B.6 — Grouped by Asset Class) ═══

    // GENERAL — Applicable to all asset types (no categoryRef)
    { id: 'fm-g01', type: 'FAILURE_MODE', code: 'BRD', description: 'Breakdown (Complete Loss of Function)', active: true },
    { id: 'fm-g02', type: 'FAILURE_MODE', code: 'ERO', description: 'Erratic / Irregular Output', active: true },
    { id: 'fm-g03', type: 'FAILURE_MODE', code: 'NOI', description: 'Abnormal Noise', active: true },
    { id: 'fm-g04', type: 'FAILURE_MODE', code: 'VIB', description: 'Abnormal Vibration', active: true },
    { id: 'fm-g05', type: 'FAILURE_MODE', code: 'OHE', description: 'Overheating', active: true },
    { id: 'fm-g06', type: 'FAILURE_MODE', code: 'ELP', description: 'External Leakage — Process Medium', active: true },
    { id: 'fm-g07', type: 'FAILURE_MODE', code: 'ELU', description: 'External Leakage — Utility Medium', active: true },
    { id: 'fm-g08', type: 'FAILURE_MODE', code: 'INL', description: 'Internal Leakage / Passing', active: true },
    { id: 'fm-g09', type: 'FAILURE_MODE', code: 'STD', description: 'Structural Deficiency / Deformation', active: true },
    { id: 'fm-g10', type: 'FAILURE_MODE', code: 'PLU', description: 'Plugged / Choked / Fouled', active: true },
    { id: 'fm-g11', type: 'FAILURE_MODE', code: 'LOO', description: 'Low Output / Reduced Performance', active: true },
    { id: 'fm-g12', type: 'FAILURE_MODE', code: 'HIO', description: 'High Output / Overspeed', active: true },
    { id: 'fm-g13', type: 'FAILURE_MODE', code: 'SLF', description: 'Spurious / False Activation', active: true },
    { id: 'fm-g14', type: 'FAILURE_MODE', code: 'MNR', description: 'Minor In-Service Problem (Degraded)', active: true },
    { id: 'fm-g15', type: 'FAILURE_MODE', code: 'UNK', description: 'Unknown / Other', active: true },

    // ROTATING — Pumps, Compressors, Turbines, Fans
    { id: 'fm-r01', type: 'FAILURE_MODE', code: 'FTS', description: 'Fail to Start', active: true, categoryRef: 'ROTATING' },
    { id: 'fm-r02', type: 'FAILURE_MODE', code: 'STP', description: 'Fail to Stop / Overspeed', active: true, categoryRef: 'ROTATING' },
    { id: 'fm-r03', type: 'FAILURE_MODE', code: 'SEL', description: 'Seal Failure / Seal Leakage', active: true, categoryRef: 'ROTATING' },
    { id: 'fm-r04', type: 'FAILURE_MODE', code: 'BRG', description: 'Bearing Failure', active: true, categoryRef: 'ROTATING' },
    { id: 'fm-r05', type: 'FAILURE_MODE', code: 'IMP', description: 'Impeller / Rotor Damage', active: true, categoryRef: 'ROTATING' },
    { id: 'fm-r06', type: 'FAILURE_MODE', code: 'CVT', description: 'Cavitation', active: true, categoryRef: 'ROTATING' },
    { id: 'fm-r07', type: 'FAILURE_MODE', code: 'SRG', description: 'Surge (Compressor)', active: true, categoryRef: 'ROTATING' },
    { id: 'fm-r08', type: 'FAILURE_MODE', code: 'MIS', description: 'Misalignment / Shaft Deflection', active: true, categoryRef: 'ROTATING' },
    { id: 'fm-r09', type: 'FAILURE_MODE', code: 'LUB', description: 'Lubrication Failure / Oil Contamination', active: true, categoryRef: 'ROTATING' },
    { id: 'fm-r10', type: 'FAILURE_MODE', code: 'COU', description: 'Coupling Failure', active: true, categoryRef: 'ROTATING' },
    { id: 'fm-r11', type: 'FAILURE_MODE', code: 'BAL', description: 'Imbalance / Out of Balance', active: true, categoryRef: 'ROTATING' },

    // STATIC_PRESSURE — Vessels, Tanks, Separators
    { id: 'fm-s01', type: 'FAILURE_MODE', code: 'COR', description: 'Corrosion (Internal / External)', active: true, categoryRef: 'STATIC_PRESSURE' },
    { id: 'fm-s02', type: 'FAILURE_MODE', code: 'ERN', description: 'Erosion', active: true, categoryRef: 'STATIC_PRESSURE' },
    { id: 'fm-s03', type: 'FAILURE_MODE', code: 'CRK', description: 'Cracking / Fatigue', active: true, categoryRef: 'STATIC_PRESSURE' },
    { id: 'fm-s04', type: 'FAILURE_MODE', code: 'BLG', description: 'Bulging / Deformation', active: true, categoryRef: 'STATIC_PRESSURE' },
    { id: 'fm-s05', type: 'FAILURE_MODE', code: 'LVL', description: 'Level Control Failure', active: true, categoryRef: 'STATIC_PRESSURE' },
    { id: 'fm-s06', type: 'FAILURE_MODE', code: 'PRO', description: 'Pressure Relief Malfunction', active: true, categoryRef: 'STATIC_PRESSURE' },
    { id: 'fm-s07', type: 'FAILURE_MODE', code: 'FOL', description: 'Fouling / Scaling', active: true, categoryRef: 'STATIC_PRESSURE' },
    { id: 'fm-s08', type: 'FAILURE_MODE', code: 'LCK', description: 'Leak at Connection / Flange', active: true, categoryRef: 'STATIC_PRESSURE' },

    // ELECTRICAL — Motors, Generators, Switchgear, Transformers, VSD
    { id: 'fm-e01', type: 'FAILURE_MODE', code: 'INS', description: 'Insulation Failure / Breakdown', active: true, categoryRef: 'ELECTRICAL' },
    { id: 'fm-e02', type: 'FAILURE_MODE', code: 'WDG', description: 'Winding Failure (Open / Short)', active: true, categoryRef: 'ELECTRICAL' },
    { id: 'fm-e03', type: 'FAILURE_MODE', code: 'OVL', description: 'Overload / Overcurrent Trip', active: true, categoryRef: 'ELECTRICAL' },
    { id: 'fm-e04', type: 'FAILURE_MODE', code: 'GRD', description: 'Earth / Ground Fault', active: true, categoryRef: 'ELECTRICAL' },
    { id: 'fm-e05', type: 'FAILURE_MODE', code: 'ARC', description: 'Arcing / Flashover', active: true, categoryRef: 'ELECTRICAL' },
    { id: 'fm-e06', type: 'FAILURE_MODE', code: 'CTF', description: 'Contactor / Breaker Failure', active: true, categoryRef: 'ELECTRICAL' },
    { id: 'fm-e07', type: 'FAILURE_MODE', code: 'PWR', description: 'Power Supply Failure', active: true, categoryRef: 'ELECTRICAL' },
    { id: 'fm-e08', type: 'FAILURE_MODE', code: 'PHS', description: 'Phase Imbalance / Loss of Phase', active: true, categoryRef: 'ELECTRICAL' },
    { id: 'fm-e09', type: 'FAILURE_MODE', code: 'OVV', description: 'Overvoltage / Undervoltage', active: true, categoryRef: 'ELECTRICAL' },
    { id: 'fm-e10', type: 'FAILURE_MODE', code: 'COL', description: 'Cooling Failure (Transformer / Motor)', active: true, categoryRef: 'ELECTRICAL' },

    // INSTRUMENT — Transmitters, Analyzers, Control Valves, Meters
    { id: 'fm-i01', type: 'FAILURE_MODE', code: 'AIR', description: 'Abnormal Instrument Reading', active: true, categoryRef: 'INSTRUMENT' },
    { id: 'fm-i02', type: 'FAILURE_MODE', code: 'FTC', description: 'Fail to Close', active: true, categoryRef: 'INSTRUMENT' },
    { id: 'fm-i03', type: 'FAILURE_MODE', code: 'FTO', description: 'Fail to Open', active: true, categoryRef: 'INSTRUMENT' },
    { id: 'fm-i04', type: 'FAILURE_MODE', code: 'FTR', description: 'Fail to Regulate / Control', active: true, categoryRef: 'INSTRUMENT' },
    { id: 'fm-i05', type: 'FAILURE_MODE', code: 'DFT', description: 'Signal Drift / Calibration Shift', active: true, categoryRef: 'INSTRUMENT' },
    { id: 'fm-i06', type: 'FAILURE_MODE', code: 'SIG', description: 'Signal Loss / Communication Failure', active: true, categoryRef: 'INSTRUMENT' },
    { id: 'fm-i07', type: 'FAILURE_MODE', code: 'STK', description: 'Sticking / Seized', active: true, categoryRef: 'INSTRUMENT' },
    { id: 'fm-i08', type: 'FAILURE_MODE', code: 'SPO', description: 'Spurious Operation / False Trip', active: true, categoryRef: 'INSTRUMENT' },
    { id: 'fm-i09', type: 'FAILURE_MODE', code: 'SET', description: 'Setpoint Error', active: true, categoryRef: 'INSTRUMENT' },
    { id: 'fm-i10', type: 'FAILURE_MODE', code: 'SEN', description: 'Sensor Failure / Probe Degraded', active: true, categoryRef: 'INSTRUMENT' },

    // PIPING — Process Piping, Fittings, Flanges
    { id: 'fm-p01', type: 'FAILURE_MODE', code: 'LCP', description: 'Leakage through Pipe Wall / Casing', active: true, categoryRef: 'PIPING' },
    { id: 'fm-p02', type: 'FAILURE_MODE', code: 'PCR', description: 'Pipe Corrosion (Internal / External)', active: true, categoryRef: 'PIPING' },
    { id: 'fm-p03', type: 'FAILURE_MODE', code: 'PER', description: 'Pipe Erosion', active: true, categoryRef: 'PIPING' },
    { id: 'fm-p04', type: 'FAILURE_MODE', code: 'FLG', description: 'Flange Leak / Gasket Failure', active: true, categoryRef: 'PIPING' },
    { id: 'fm-p05', type: 'FAILURE_MODE', code: 'WLD', description: 'Weld Defect / Weld Failure', active: true, categoryRef: 'PIPING' },
    { id: 'fm-p06', type: 'FAILURE_MODE', code: 'SUP', description: 'Support / Hanger Failure', active: true, categoryRef: 'PIPING' },
    { id: 'fm-p07', type: 'FAILURE_MODE', code: 'THM', description: 'Thermal Expansion Damage', active: true, categoryRef: 'PIPING' },

    // SAFETY_SYSTEM — F&G, ESD, PSV, Deluge
    { id: 'fm-sf01', type: 'FAILURE_MODE', code: 'FTF', description: 'Fail to Function on Demand (Dangerous)', active: true, categoryRef: 'SAFETY_SYSTEM' },
    { id: 'fm-sf02', type: 'FAILURE_MODE', code: 'SPT', description: 'Spurious Trip (Nuisance)', active: true, categoryRef: 'SAFETY_SYSTEM' },
    { id: 'fm-sf03', type: 'FAILURE_MODE', code: 'SLK', description: 'Safety Valve Seat Leakage', active: true, categoryRef: 'SAFETY_SYSTEM' },
    { id: 'fm-sf04', type: 'FAILURE_MODE', code: 'SOV', description: 'Solenoid Valve Failure', active: true, categoryRef: 'SAFETY_SYSTEM' },
    { id: 'fm-sf05', type: 'FAILURE_MODE', code: 'DET', description: 'Detector Failure / False Alarm', active: true, categoryRef: 'SAFETY_SYSTEM' },
    { id: 'fm-sf06', type: 'FAILURE_MODE', code: 'LGC', description: 'Logic Solver / PLC Fault', active: true, categoryRef: 'SAFETY_SYSTEM' },

    // HEAT_TRANSFER — Heat Exchangers, Air Coolers, Boilers
    { id: 'fm-h01', type: 'FAILURE_MODE', code: 'TBL', description: 'Tube Leak / Tube Bundle Failure', active: true, categoryRef: 'HEAT_TRANSFER' },
    { id: 'fm-h02', type: 'FAILURE_MODE', code: 'TBP', description: 'Tube Plugging / Fouling', active: true, categoryRef: 'HEAT_TRANSFER' },
    { id: 'fm-h03', type: 'FAILURE_MODE', code: 'BFL', description: 'Baffle / Internal Damage', active: true, categoryRef: 'HEAT_TRANSFER' },
    { id: 'fm-h04', type: 'FAILURE_MODE', code: 'FNF', description: 'Fan Failure (Air Cooler)', active: true, categoryRef: 'HEAT_TRANSFER' },
    { id: 'fm-h05', type: 'FAILURE_MODE', code: 'FRZ', description: 'Freezing / Winterization Failure', active: true, categoryRef: 'HEAT_TRANSFER' },
    { id: 'fm-h06', type: 'FAILURE_MODE', code: 'RDT', description: 'Reduced Thermal Performance', active: true, categoryRef: 'HEAT_TRANSFER' },

    // ═══ Failure Causes (ISO 14224 Table B.7 — Root Cause Classification) ═══

    // DESIGN & ENGINEERING
    { id: 'fc-d01', type: 'FAILURE_CAUSE', code: 'DES', description: 'Design Error / Inadequate Design', active: true, categoryRef: 'DESIGN' },
    { id: 'fc-d02', type: 'FAILURE_CAUSE', code: 'MAT', description: 'Material Defect / Incorrect Material Selection', active: true, categoryRef: 'DESIGN' },
    { id: 'fc-d03', type: 'FAILURE_CAUSE', code: 'SPE', description: 'Specification Error / Incorrect Sizing', active: true, categoryRef: 'DESIGN' },
    { id: 'fc-d04', type: 'FAILURE_CAUSE', code: 'SOF', description: 'Software / Firmware Bug', active: true, categoryRef: 'DESIGN' },

    // FABRICATION & INSTALLATION
    { id: 'fc-f01', type: 'FAILURE_CAUSE', code: 'FAB', description: 'Fabrication / Manufacturing Defect', active: true, categoryRef: 'FABRICATION' },
    { id: 'fc-f02', type: 'FAILURE_CAUSE', code: 'INE', description: 'Installation Error / Incorrect Assembly', active: true, categoryRef: 'FABRICATION' },
    { id: 'fc-f03', type: 'FAILURE_CAUSE', code: 'COM', description: 'Commissioning Error', active: true, categoryRef: 'FABRICATION' },

    // OPERATION & HUMAN FACTORS
    { id: 'fc-o01', type: 'FAILURE_CAUSE', code: 'OPE', description: 'Operating Error / Misuse / Abuse', active: true, categoryRef: 'OPERATION' },
    { id: 'fc-o02', type: 'FAILURE_CAUSE', code: 'OVL', description: 'Operating Beyond Design Limits / Overload', active: true, categoryRef: 'OPERATION' },
    { id: 'fc-o03', type: 'FAILURE_CAUSE', code: 'HUM', description: 'Human Error (General)', active: true, categoryRef: 'OPERATION' },
    { id: 'fc-o04', type: 'FAILURE_CAUSE', code: 'PRO', description: 'Procedure Deficiency / Not Followed', active: true, categoryRef: 'OPERATION' },
    { id: 'fc-o05', type: 'FAILURE_CAUSE', code: 'TRN', description: 'Inadequate Training / Competency Gap', active: true, categoryRef: 'OPERATION' },

    // MAINTENANCE RELATED
    { id: 'fc-m01', type: 'FAILURE_CAUSE', code: 'MNT', description: 'Inadequate Maintenance / Missed PM', active: true, categoryRef: 'MAINTENANCE' },
    { id: 'fc-m02', type: 'FAILURE_CAUSE', code: 'LUB', description: 'Lubrication Failure / Wrong Lubricant', active: true, categoryRef: 'MAINTENANCE' },
    { id: 'fc-m03', type: 'FAILURE_CAUSE', code: 'CAL', description: 'Calibration Error / Drift', active: true, categoryRef: 'MAINTENANCE' },
    { id: 'fc-m04', type: 'FAILURE_CAUSE', code: 'SPR', description: 'Wrong / Substandard Spare Part', active: true, categoryRef: 'MAINTENANCE' },
    { id: 'fc-m05', type: 'FAILURE_CAUSE', code: 'RPR', description: 'Previous Repair Deficiency', active: true, categoryRef: 'MAINTENANCE' },

    // DEGRADATION & AGEING
    { id: 'fc-a01', type: 'FAILURE_CAUSE', code: 'AGE', description: 'Normal Wear / Ageing / End of Life', active: true, categoryRef: 'DEGRADATION' },
    { id: 'fc-a02', type: 'FAILURE_CAUSE', code: 'COR', description: 'Corrosion / Chemical Attack', active: true, categoryRef: 'DEGRADATION' },
    { id: 'fc-a03', type: 'FAILURE_CAUSE', code: 'ERO', description: 'Erosion / Abrasion', active: true, categoryRef: 'DEGRADATION' },
    { id: 'fc-a04', type: 'FAILURE_CAUSE', code: 'FAT', description: 'Fatigue (Mechanical / Thermal)', active: true, categoryRef: 'DEGRADATION' },
    { id: 'fc-a05', type: 'FAILURE_CAUSE', code: 'EMB', description: 'Embrittlement (Hydrogen / Temper)', active: true, categoryRef: 'DEGRADATION' },
    { id: 'fc-a06', type: 'FAILURE_CAUSE', code: 'FOU', description: 'Fouling / Scaling / Deposit Build-up', active: true, categoryRef: 'DEGRADATION' },

    // PROCESS & ENVIRONMENTAL
    { id: 'fc-p01', type: 'FAILURE_CAUSE', code: 'CON', description: 'Contamination / Foreign Object Damage', active: true, categoryRef: 'PROCESS' },
    { id: 'fc-p02', type: 'FAILURE_CAUSE', code: 'PRC', description: 'Process Upset / Off-Spec Conditions', active: true, categoryRef: 'PROCESS' },
    { id: 'fc-p03', type: 'FAILURE_CAUSE', code: 'ENV', description: 'Environmental Conditions (Weather / Sand)', active: true, categoryRef: 'PROCESS' },
    { id: 'fc-p04', type: 'FAILURE_CAUSE', code: 'EXT', description: 'External Impact / Third-Party Damage', active: true, categoryRef: 'PROCESS' },
    { id: 'fc-p05', type: 'FAILURE_CAUSE', code: 'VIB', description: 'Excessive Vibration / Dynamic Loading', active: true, categoryRef: 'PROCESS' },
    { id: 'fc-p06', type: 'FAILURE_CAUSE', code: 'THM', description: 'Thermal Stress / Thermal Cycling', active: true, categoryRef: 'PROCESS' },

    // ELECTRICAL & CONTROL
    { id: 'fc-e01', type: 'FAILURE_CAUSE', code: 'PWR', description: 'Power Supply Anomaly (Surge / Sag / Loss)', active: true, categoryRef: 'ELECTRICAL' },
    { id: 'fc-e02', type: 'FAILURE_CAUSE', code: 'ELC', description: 'Electrical Overload / Short Circuit', active: true, categoryRef: 'ELECTRICAL' },
    { id: 'fc-e03', type: 'FAILURE_CAUSE', code: 'CTL', description: 'Control System / Logic Error', active: true, categoryRef: 'ELECTRICAL' },

    // MANAGEMENT / SYSTEMIC
    { id: 'fc-s01', type: 'FAILURE_CAUSE', code: 'MOC', description: 'Management of Change Failure', active: true, categoryRef: 'MANAGEMENT' },
    { id: 'fc-s02', type: 'FAILURE_CAUSE', code: 'SUP', description: 'Supply Chain / Counterfeit Part', active: true, categoryRef: 'MANAGEMENT' },

    // UNKNOWN / PENDING
    { id: 'fc-u01', type: 'FAILURE_CAUSE', code: 'UNK', description: 'Unknown / Under Investigation', active: true },
    { id: 'fc-u02', type: 'FAILURE_CAUSE', code: 'OTH', description: 'Other (Specify in Comments)', active: true },

    // ── Object Parts — ISO 14224 maintainable items / SAP Catalog B (WM-1) ──
    { id: 'op-01', type: 'OBJECT_PART', code: 'BRG', description: 'Bearing', active: true },
    { id: 'op-02', type: 'OBJECT_PART', code: 'SEAL', description: 'Seal / Gasket', active: true },
    { id: 'op-03', type: 'OBJECT_PART', code: 'SHAFT', description: 'Shaft', active: true },
    { id: 'op-04', type: 'OBJECT_PART', code: 'IMPL', description: 'Impeller / Rotor', active: true },
    { id: 'op-05', type: 'OBJECT_PART', code: 'CPLG', description: 'Coupling', active: true },
    { id: 'op-06', type: 'OBJECT_PART', code: 'WIND', description: 'Motor Winding / Stator', active: true },
    { id: 'op-07', type: 'OBJECT_PART', code: 'HOUS', description: 'Housing / Casing', active: true },
    { id: 'op-08', type: 'OBJECT_PART', code: 'VLVS', description: 'Valve / Valve Seat', active: true },
    { id: 'op-09', type: 'OBJECT_PART', code: 'PIPE', description: 'Piping / Tubing', active: true },
    { id: 'op-10', type: 'OBJECT_PART', code: 'INST', description: 'Instrument / Sensor', active: true },
    { id: 'op-11', type: 'OBJECT_PART', code: 'ELEC', description: 'Electrical / Wiring', active: true },
    { id: 'op-12', type: 'OBJECT_PART', code: 'CTRL', description: 'Control / PLC Card', active: true },
    { id: 'op-13', type: 'OBJECT_PART', code: 'LUBE', description: 'Lubrication System', active: true },
    { id: 'op-14', type: 'OBJECT_PART', code: 'FILT', description: 'Filter / Strainer', active: true },
    { id: 'op-15', type: 'OBJECT_PART', code: 'STRC', description: 'Structure / Support', active: true },
    { id: 'op-99', type: 'OBJECT_PART', code: 'OTH', description: 'Other (Specify in Comments)', active: true },

    // ── Maintenance Activities — ISO 14224 activity types / SAP Catalog A (WM-1) ──
    { id: 'ac-01', type: 'ACTIVITY_CODE', code: 'REPL', description: 'Replace', active: true },
    { id: 'ac-02', type: 'ACTIVITY_CODE', code: 'REPR', description: 'Repair', active: true },
    { id: 'ac-03', type: 'ACTIVITY_CODE', code: 'MODI', description: 'Modify', active: true },
    { id: 'ac-04', type: 'ACTIVITY_CODE', code: 'ADJ', description: 'Adjust / Align', active: true },
    { id: 'ac-05', type: 'ACTIVITY_CODE', code: 'REFT', description: 'Refit', active: true },
    { id: 'ac-06', type: 'ACTIVITY_CODE', code: 'INSP', description: 'Inspect / Check', active: true },
    { id: 'ac-07', type: 'ACTIVITY_CODE', code: 'TEST', description: 'Test / Function Check', active: true },
    { id: 'ac-08', type: 'ACTIVITY_CODE', code: 'SERV', description: 'Service (Clean / Lubricate)', active: true },
    { id: 'ac-09', type: 'ACTIVITY_CODE', code: 'OVHL', description: 'Overhaul', active: true },
    { id: 'ac-10', type: 'ACTIVITY_CODE', code: 'CALI', description: 'Calibrate', active: true },
    { id: 'ac-11', type: 'ACTIVITY_CODE', code: 'COMB', description: 'Combination (Multiple Activities)', active: true },
    { id: 'ac-99', type: 'ACTIVITY_CODE', code: 'OTH', description: 'Other (Specify in Comments)', active: true },

    // Remedy Codes - REMOVED
    // { id: 'rc1', type: 'REMEDY_CODE', code: 'REPLACE', description: 'Replace Component', active: true },
    // { id: 'rc2', type: 'REMEDY_CODE', code: 'ADJUST', description: 'Adjust / Align', active: true },
    // { id: 'rc3', type: 'REMEDY_CODE', code: 'REPAIR', description: 'Repair Component', active: true },
    // { id: 'rc4', type: 'REMEDY_CODE', code: 'CLEAN', description: 'Clean / Flush', active: true },

    // Vendor Types
    { id: 'vt1', type: 'VENDOR_TYPE', code: 'VENDOR', description: 'Vendor (General)', active: true },
    { id: 'vt2', type: 'VENDOR_TYPE', code: 'MANUFACTURER', description: 'Manufacturer', active: true },
    { id: 'vt3', type: 'VENDOR_TYPE', code: 'SUPPLIER', description: 'Supplier', active: true },

    // Qualification Types
    { id: 'qt1', type: 'QUALIFICATION_TYPE', code: 'CERT', description: 'Certification', active: true },
    { id: 'qt2', type: 'QUALIFICATION_TYPE', code: 'LICENSE', description: 'License', active: true },
    { id: 'qt3', type: 'QUALIFICATION_TYPE', code: 'COMP', description: 'Competency', active: true },
    { id: 'qt4', type: 'QUALIFICATION_TYPE', code: 'SAFETY', description: 'Safety Training', active: true },
    { id: 'qt5', type: 'QUALIFICATION_TYPE', code: 'TRADE', description: 'Trade Qualification', active: true },
    { id: 'qt6', type: 'QUALIFICATION_TYPE', code: 'MEDICAL', description: 'Medical Clearance', active: true },
];
