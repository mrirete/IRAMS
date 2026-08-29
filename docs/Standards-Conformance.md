# IREAMS — Standards Conformance Statement

**Status:** Governance record · **Last reviewed:** 2026-08-24
**Purpose:** name the international standard that governs each capability, and state the posture toward vendor (SAP) terminology — so the product's canon is anchored to public standards, not to any vendor's intellectual property.
**Scope note:** this is an engineering-governance document, not legal advice. Where a client contract makes vendor-IP posture load-bearing, have counsel confirm §4 specifically.

---

## 1. The governing principle

**The canonical data model and business rules of IREAMS are governed by international standards. Vendor vocabularies — SAP's included — appear only at interoperability boundaries** (imports from, exports to, and mappings against that vendor's system), which is standard, accepted compatibility practice. SAP implements the same public standards this document cites; aligning with those standards is not aligning with SAP.

Three consequences of that principle, visible in the code:

1. The outbound canonical documents (`lib/erp/canonical.ts`) use a **vendor-neutral movement semantic** (`issue_to_order`, `receipt_against_order`, `scrap`, `count_gain`…); SAP BWART codes are declared "mapping hint only".
2. The semantic catalog (`semantic_catalog.iso_standard`) stamps datasets with the standard that defines them (ISO 14224 on failure events, work history, reliability KPIs).
3. Vendor field names (`EQUNR`, `TPLNR`, `MATNR`…) appear in migration templates and sheet-profile aliases — the surfaces whose entire job is to speak the other system's dialect — and nowhere in the canonical schema.

---

## 2. Asset & reliability data — governing standards

| Capability | Governing standard | Where implemented |
|---|---|---|
| Equipment taxonomy & hierarchy levels; the **position vs. object** split (functional location vs. equipment) | **ISO 14224** (reliability & maintenance data collection/exchange — its taxonomy levels and use/location structure) | `hierarchyModel.ts` (FLOC/EQUIPMENT object classes, ISO levels), `assets.tag` + `equipment_number` + `equipment_generation` (0121/0293) |
| Failure modes, causes, remedies; failure-event log | **ISO 14224** + **IEC 60812** (FMEA) | `wo_failure_data`, `sem_failure_events` (0183), failure-code catalogs |
| **Primary vs. secondary (collateral) failures** | **ISO 14224** primary/secondary distinction | 0289 (`secondary_failure`, `caused_by_wo_id`); excluded from the victim's MTBF, always shown |
| Failure-event definition (breakdown = loss of required function) and event timing (malfunction window, not paperwork dates) | **ISO 14224** failure definition; **EN 13306** terminology | 0283 (`breakdown`, `malfunction_start/end`), 0295 (breakdown-aware canonical predicate, client + SQL in lockstep) |
| Maintenance terminology: corrective / preventive / predictive, technical vs. business completion | **EN 13306** (maintenance terminology) | canonical WO state (0233), TECO vs. CLOSED distinction |
| Maintenance KPIs: MTBF, MTTR, availability, PM compliance | **SMRP Best Practices** / **EN 15341** (maintenance KPIs) | `reliabilityMetrics.ts` (documented SMRP-aligned), `sem_asset_reliability` |
| RCM decision logic | **SAE JA1011 / JA1012** | RCM module |
| Weibull / life-data analysis | Standard reliability engineering practice (IEC 61649 is the reference for Weibull analysis) | Reliability module (β/η); censoring on the roadmap |
| Asset management system context | **ISO 55000 / 55001** | product posture; asset register, criticality, strategy links |
| Condition monitoring & alarm limits | ISO 17359 family (condition monitoring guidance); ISO 10816/20816 for vibration severity zones where applicable | `reading_definitions` warning/critical limits, P-F interval fields |

---

## 3. Financial procedures — governing standards

The rule of thumb throughout: **IREAMS follows IFRS-consistent recognition and control procedures for the maintenance cost ledger it owns, and leaves statutory accounting to the ERP** (see the FI boundary, `ERP-Integration-Design.md` §0a).

| Procedure | Governing standard / framework | Where implemented |
|---|---|---|
| Inventory valuation at **weighted average cost** | **IAS 2 — Inventories** (permits FIFO or weighted average; prohibits LIFO — IREAMS uses WAC, compliant) | `inventory_valuations` (WAC), `unit_cost`, `cost_at_time` on movements |
| **Capital spares** distinguished from consumable inventory | **IAS 16 — PP&E** (spare parts expected to be used over more than one period qualify as PP&E) | `inventory_items.is_capital_spare` |
| Maintenance cost expensed as incurred; asset-level cost visibility | **IAS 16** (day-to-day servicing expensed, not capitalized) | work-order cost collection → settlement to cost centers |
| Depreciation as operational analytics (books of record stay in the ERP) | **IAS 16** depreciation concepts | FinOps depreciation view, `inventory_items.depreciation_method`/`salvage_value` — analytics, not statutory postings |
| **Commitment vs. cost**: an open PO is a commitment; receipt or issue is the cost | Accrual basis — **IFRS Conceptual Framework**; commitments disclosed, not posted (**IAS 37** territory) | PO lines carry commitments; `goods_receipts`/issues are the recognition events; "ordering is a commitment" rule (0248/0249) |
| Received-not-invoiced control (GR/IR concept) | Accrual accounting; ICFR cut-off control | `goods_receipts` vs. `invoice_matches` per PO; reconciliation panel shows what has not reached the books |
| **Three-way match** (PO ↔ GR ↔ invoice), tolerances, payment block | **COSO Internal Control — Integrated Framework** / ICFR; a payables control that predates every ERP vendor | 0255/0256 line-level match, configurable tolerance table, PRICE/QUANTITY payment blocks |
| **Duplicate-payment prevention** | ICFR (COSO control activities) | `UNIQUE(company_id, vendor_id, invoice_number)` on invoices |
| **Approval limits / authorization** | COSO control activities; segregation of duties | PO authorization threshold; role-gated settlement (`finops.edit`); RBAC submit-level guards (ISO 27001/NIST-aligned) |
| **Document principle**: every posting is a document; corrections are reversals, never edits | Auditability expectations under **ISA** audit assertions; document-based bookkeeping (the principle national regimes like Germany's GoBD codify) | `cost_allocations` append-only with delta postings and visible reversals; movement documents; GRN numbering |
| **Cut-off / period integrity** | ISA 315 audit assertions (cut-off, completeness, accuracy) | 0284 — cost freeze at business close with a real snapshot; immutability guards; frozen values displayed as the number of record |
| Audit trail of changes | **ISO 27001** logging controls; ICFR | append-only `audit_logs` (0186 tier-3a), movement `notes` + `performed_by` (0297) |
| **Currency**: documents keep their own currency; no translation performed | **IAS 21** — FX translation is a books-of-record activity, deliberately left to the ERP | `fmtMoney(amount, document currency)`; company currency on `companies`; boundary stated in §0a |
| Tax | Determined at invoice in the finance system — jurisdiction-specific, deliberately out of scope | Net amounts throughout; stated on the PO footer |

**Deliberate non-implementations** (the boundary, not gaps): G/L account determination, tax engines, FX translation, payment runs, fiscal-period close, group consolidation. These belong to the ERP/statutory books; IREAMS hands over documents (five canonical families) that let the ERP perform them.

---

## 4. The SAP interoperability posture

Where SAP vocabulary appears, and why each use is sound:

| Surface | SAP vocabulary used | Posture |
|---|---|---|
| Migration templates & sheet profiles | Field names (`EQUNR`, `TPLNR`, `MATNR`, `MSAUS`…), transaction names (IW38, IE05) as export instructions | **Interoperability**: the surface exists to read SAP's own exports. Referencing SAP by name for compatibility is nominative trademark use; no endorsement is implied or claimed |
| Movement types | Numeric codes (101, 261, 561…) with generic English descriptions | Numbers and generic descriptions; the **canonical semantic is vendor-neutral** (`MovementSemantic`), with codes retained as the interchange dialect the client's ERP speaks |
| Tolerance keys | PP/DQ key names | The control is ICFR; the key names mirror the client's configuration for reconciliation. Renameable without semantic change |
| Analyst/agent prompts, docs | SAP concepts explained for migration guidance | Descriptive/educational reference |

**Commitments:** SAP field names never become canonical schema names; "SAP-compatible" is claimed, "SAP-certified/endorsed" is not; marketing language is "standards-based (ISO 14224, EN 13306, EN 15341, IAS 2), compatible with SAP, Maximo, MaintainX and spreadsheet-based systems."

---

## 5. Security, privacy, and management-system standards

| Domain | Standard | Where |
|---|---|---|
| Information security management | **ISO 27001** | ISMS pack + Statement of Applicability (see `docs/compliance/`) |
| Service organization controls | **SOC 2** (roadmap) | compliance program |
| Privacy | **GDPR** | erasure & retention automation (0282), records of processing, privacy notice |
| Access control | ISO 27001 / NIST CSF | RLS enforcement, role gates, tenant isolation |

---

## 6. Known open items (honest register)

- **FI-4 cost elements** — open by design for now; the ERP owns the chart of accounts.
- **Single document currency per company** — parallel/group currencies are IAS 21 activities left to the ERP; stated, not hidden.
- **Movement-type numeric codes as the internal vocabulary** — low risk (numbers + generic text, industry-mirrored), with a planned neutralization path: promote `MovementSemantic` to the canonical column, demote codes to an interchange alias.
- **Weibull censoring** — required for defensible life-data analysis per IEC 61649 practice; on the reliability roadmap.

---

*Maintained alongside `ERP-Integration-Design.md` (the FI boundary, §0a) and `SAP-Parity-Gap-Assessment.md`. Update this document when a new module ships or a boundary moves.*
