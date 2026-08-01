# IREAMS EAM — Asset Register UAT Closeout Plan

**Responds to:** AgileAsset Reliability Solutions — *UAT Report v1.0* (28 Jun 2026) **and** *UAT Follow-Up Report Rev 2* (1 Jul 2026)
**Scope:** Asset Register (FLOC hierarchy, creation, numbering, hierarchy panel) + People & Org + Work Management (Requests)
**Findings:** 15 total (F-001…F-015) — 4 CRITICAL · 4 HIGH · 4 MEDIUM · 1 LOW
**Standards in scope:** ISO 14224:2016, ISO 55000/55001:2014, IEC 60812, PAS 55
**Reviewer context:** SAP PM background — uses SAP parity terms (FLOC/`TPLNR`, Equipment/`EQUNR`, Business Partner/Vendor `LFA1`, number ranges/`NRIV`, ABC indicator, change documents `CDHDR`/`CDPOS`).
**Version:** 2.0 — adds the **Rev 2 closeout register (§10)** covering all 15 findings with commit/migration traceability, the tester-permission caveats, and sign-off. (§1–§9 record the original Rev 1 plan; §2 object-model decision, revised F-003, AM requirements §5, migration posture §6, governance §8 stand.)

---

## 1. Unifying Diagnosis

Ten of the eleven findings are **downstream symptoms of a single architectural gap (F-010)**: IREAMS persists the *master-data columns* for a level-aware technical-object model, but **no engine governs behaviour by level**, and **Equipment is not modelled as a distinct object** — it is merely a deeper node of the same `assets` tree.

What already exists in the schema ([`schema.ts`](../src/frontend/src/eam/schema.ts)):

| Column | Meaning | SAP parity |
|---|---|---|
| `assets.tag` | Functional Location ID (stays with the position) | `TPLNR` |
| `assets.equipment_number` | Internal Equipment Number (per physical asset) | `EQUNR` |
| `assets.equipment_generation` | Replacement counter | EQUI generation |
| `assets.hierarchy_level` | `SITE \| UNIT \| SYSTEM \| EQUIPMENT \| COMPONENT` | FLOC structure / category |
| `assets.asset_type_code` | Type discriminator | Object type |

What is **missing**: (a) a level-resolution + configuration layer the create forms, numbering, field-visibility, criticality, and "Add Child" all read from; and (b) a **distinction between the Functional Location (the position) and the Equipment (the maintainable item installed there)**. Today both are the same row type, differing only by `hierarchy_level`.

**Code-grounded proof:**

- **Numbering trigger fires for every level.** [`0121_add_equipment_number.sql`](../src/frontend/supabase/migrations/0121_add_equipment_number.sql) — `generate_equipment_number()` runs `BEFORE INSERT ON assets FOR EACH ROW` and assigns `EQ-NNNNNN` whenever `equipment_number IS NULL`, **with no level check** (**F-004**).
- **Truth is scattered.** `isLocation()` ([`Assets.tsx:668`](../src/frontend/src/eam/pages/Assets.tsx)) hardcodes `['SITE','AREA','UNIT','SYSTEM']`; `'AREA'` is **not** in the `HierarchyLevel` enum — a latent bug and proof of duplicated logic.
- **"Add Child" is type-blind.** Toolbar calls `openAddModal('Asset')` unconditionally ([`Assets.tsx:1443`](../src/frontend/src/eam/pages/Assets.tsx)) (**F-005**).
- **Manufacturer "+" opens the wrong object.** `AddContactModal` is invoked with `initialType="MANUFACTURER"` ([`Assets.tsx:2049`](../src/frontend/src/eam/pages/Assets.tsx)) but renders the person/entity form with username + password (**F-003**).
- **Equipment has no installation relationship.** No `functional_location_id` on equipment, no install/dismantle/transfer — confirming Equipment is not a separate object (drives the §2 decision).

**Conclusion:** the correct response is **one architectural decision + one foundation + level-derived fixes**, not eleven independent patches.

---

## 2. Architectural Decision — FLOC vs Equipment object model *(must be co-signed before Phase 0)*

This is the deepest issue and the one most likely to make a SAP reviewer consider F-010 fully (or only partially) closed. Equipment that can be **swapped, relocated, or replaced** must keep its own history independent of the position it occupies. Two viable models:

### Option A — Separate Equipment object + installation relationship *(SAP-true, recommended)*
- Functional Locations (Levels 1–4) form the position tree. **Equipment is a distinct object** that references its **current** functional location (`functional_location_id`) and can be **installed / dismantled / transferred**, retaining its own work, failure, and cost history across moves.
- **Pros:** true ISO 14224 / SAP parity; correct numbering separation falls out naturally (FLOC `FL-` vs Equipment `EQ-`); supports rotables/spares-pool swap-outs and `equipment_generation` replacements meaningfully; positional history stays with the FLOC, asset history stays with the equipment.
- **Cons:** larger change — a strong object discriminator + an `equipment_installations` (move-log) relationship; migration of existing equipment-level rows; new install/dismantle UI (can land after the data model).

### Option B — Typed single-tree *(pragmatic, faster)*
- Keep one `assets` table; `hierarchy_level` distinguishes FLOC vs Equipment; equipment are leaf nodes. Optionally add a `installed_at` move-log later.
- **Pros:** minimal schema change; fastest path to close the UAT findings; least migration.
- **Cons:** does **not** deliver true install/transfer; relocated equipment loses positional-history fidelity; effectively re-labels the same conflation the report condemns; a SAP reviewer may sign F-010 only "partially closed."

### Recommendation
**Adopt Option A as the target architecture, but stage it to avoid a double migration:**
1. **Decide the object model now** — add the Equipment discriminator + `functional_location_id` + an `equipment_installations` log to the schema in Phase 0, even if the full install/dismantle *UI* lands in Phase 2/3.
2. Ship the **level-aware engine** (governs numbering, fields, criticality, child-creation) immediately so the CRITICALs stop the bleeding.
3. This way the master-data model is correct from the first migration; later phases add UX, not re-keys.

> If the client prefers speed over parity, Option B is acceptable for go-live with a documented architectural-debt item — but it must be a conscious, signed deviation, because it leaves the root of F-010 only partly addressed.

---

## 3. Foundation (closes F-010) — *approved: configurable, seeded with the ISO 14224 levels*

A single source of truth + the §2 object model.

### 3.1 `hierarchyModel` configuration
`src/eam/services/hierarchyModel.ts` + an Admin-editable table, seeded from **ISO 14224:2016 Table 2/3**:

| Level | Default label | Object class | Numbering | Criticality | Equipment fields |
|---|---|---|---|---|---|
| L1 | Site | Functional Location | `FL-` | optional | hidden |
| L2 | Plant / Unit | Functional Location | `FL-` | optional | hidden |
| L3 | System / Process | Functional Location | `FL-` | **mandatory** (default) | hidden |
| L4 | Sub-system | Functional Location | `FL-` | mandatory | hidden |
| L5 | **Equipment** | Equipment object | `EQ-` | mandatory | **shown** |
| L6 | Component | Equipment object | `EQ-` | mandatory | shown |

Each level declares: `objectClass (FLOC\|Equipment)`, `numberingScheme`, `criticalityRule`, `visibleFields[]`, `allowedChildLevels[]`. Labels, count, and the level at which EQ numbering begins are **Admin-configurable** (the report's F-010 ask). *ISO 14224 Table 3 actually defines up to nine taxonomy levels; this six-level seed is a pragmatic, configurable subset — note this to the reviewer so the simplification is explicit, not accidental.*

### 3.2 `resolveLevel(asset)` + hierarchy integrity rules
- `resolveLevel(asset)` is authoritative from `hierarchy_level`, falling back to parent-chain depth. Replaces `isLocation()` and all ad-hoc string checks.
- **Integrity constraints (new):** valid parent→child per `allowedChildLevels`; no Equipment-under-Equipment; an FLOC cannot be a child of an Equipment; **real cycle prevention** (replaces the `depth < 10` band-aid). Enforced both client-side and as DB constraints/trigger.

### 3.3 Admin → Asset / Hierarchy Configuration (single config home)
F-002, F-004, F-007, F-010 all ask for configurability. Build **one** surface: level model + labels, number ranges (prefix/start/level-gate), criticality rules, field visibility — not four scattered settings.

---

## 4. ID-by-ID Closeout

> Each entry: **Root cause → Fix → Files → Retest → ISO clause closed.**

### F-010 · CRITICAL · Hierarchy level numbering misaligned *(architectural root)*
- **Root cause:** no level-aware engine; Equipment not a distinct object.
- **Fix:** §2 object model + §3 foundation. All behaviour derives from `hierarchyModel` + `resolveLevel`.
- **Files:** `hierarchyModel.ts` (new), `Assets.tsx`, Admin config screen, schema/migration (levels table + Equipment object + install log).
- **Retest:** create a record at each level; object class, numbering, fields, child options follow config; relocate an equipment → history follows the equipment, position history stays with the FLOC.
- **Closes:** ISO 14224:2016 §6.3 Table 2/3.

### F-004 · CRITICAL · Equipment number generated below threshold
- **Root cause:** trigger has no level gate.
- **Fix:** Migration — gate `generate_equipment_number()` to Equipment-class levels (configurable threshold). **Additive** correction of existing mis-numbered rows — see §6 (no in-place rewrite).
- **Files:** new migration `0xxx_gate_equipment_numbering.sql`, `hierarchyModel.ts`.
- **Retest:** create Site → no `EQ-`; create Equipment → `EQ-`; audit query returns zero FLOC rows carrying `EQ-`.
- **Closes:** ISO 14224:2016 §6.3 Table 2.

### F-009 · CRITICAL · Auto-number out of sync (blank Tag ID)
- **Root cause:** only `equipment_number` auto-generates (wrongly, all levels); no FLOC sequence; blank Equipment tag isn't filled.
- **Fix:** Two **separate number ranges** (`NRIV` parity): blank FLOC tag → `FL-NNNNNN` (level-gated); blank Equipment tag → configured `EQ-` range. Server-side, Admin-configurable prefix/start/level.
- **Files:** migration (FLOC sequence + gated trigger), Admin number-range config, create-flow wiring.
- **Retest:** blank tag at FLOC → `FL-…`; at Equipment → `EQ-…`; both unique and consistent with the detail panel after save.
- **Closes:** ISO 14224:2016 §6.3; ISO 55001:2014 §8.1.

### F-003 · HIGH · Wrong form for new Manufacturer — *reviewer's defect valid, remedy revised*
- **Root cause:** Manufacturer "+" opens the person/entity form (username/password). In code, a manufacturer is a **business partner** stored as a **contact (`MANUFACTURER`/`VENDOR`) and/or vendor**; the dropdown merges both ([`Assets.tsx:1962`](../src/frontend/src/eam/pages/Assets.tsx)); models live in `manufacturer_models` keyed by **`contact_id`/`vendor_id`** ([`DatabaseService.ts:471`](../src/frontend/src/eam/services/DatabaseService.ts)); `asset.manufacturer` is a **free-text name**.
- **Reviewer recommendation:** "Create a separate Manufacturer master data form and API endpoint; remove the link to People & Org."
- **Assessment (experienced AM):** the *defect* is valid (a manufacturer is not a person), but a **separate manufacturer master is the wrong remedy** — it would create a **third silo** (contacts + vendors + new table), **orphan** the `manufacturer_models` FK, and **diverge from SAP**, where a manufacturer is a Business Partner / Vendor (`LFA1`) distinguished by a **role**, not a separate object.
- **Fix (better, holistic):**
  1. **Fix the form, not the source** — "+" opens a **manufacturer-mode** form writing to the **vendor/business-partner master**: Name, Country of Origin, Website, Contact, Notes; suppress username/create-account/password.
  2. **Collapse the dual source** — make the vendor/business-partner master the single home; treat contact-based manufacturers as legacy to migrate; point `manufacturer_models` at one key.
  3. **Reference by ID, not name** — change `asset.manufacturer` to an FK to the business-partner id, so renames stop breaking model lookups and name-duplicates disappear.
  4. Audit other inline "+" actions for correct domain forms.
- **Deviation logged:** we improve on the reviewer's intent rather than implement it verbatim; rationale recorded here for audit.
- **Files:** `AddContactModal.tsx`, `Assets.tsx` (DetailsTab manufacturer block ~2325–2350), `DatabaseService.ts` (manufacturer/model methods), migration (consolidate source, `asset.manufacturer` → FK).
- **Retest:** Manufacturer "+" shows manufacturer fields, lands in the vendor/business-partner master (not People); models still resolve; renaming a manufacturer doesn't break asset linkage.
- **Closes:** ISO 14224:2016 Annex C; ISO 55001:2014 §8.1 (information quality).

### F-005 · HIGH · "Add Child" doesn't differentiate Location vs Asset
- **Fix:** Split into "Add Child Location" + "Add Child Asset", enabled per `allowedChildLevels`; FLOC records default to Location; "Add Child Asset" hidden above the equipment-eligible level.
- **Files:** `Assets.tsx` (toolbar ~1439–1446, `openAddModal`). **Retest:** Site → child defaults Location, "Add Child Asset" disabled; Sub-system → both available. **Closes:** ISO 55000:2014 §6.2.3; ISO 14224:2016 §6.3.

### F-006 · HIGH · Hierarchy panel adds assets instead of showing a tree
- **Fix:** Render a true collapsible **tree** from `parent_id`, scoped to the selected node's subtree; "+" expands a node; creation only via toolbar.
- **Files:** `Assets.tsx` (hierarchy side panel). **Retest:** panel shows indented collapsible subtree; "+" expands, never creates. **Closes:** ISO 55000:2014; EAM UX best practice.

### F-008 · HIGH · "Change Asset Tag" MoC modal appears during creation
- **Fix:** MoC modal **only on saved records**; creation uses a plain editable identifier (no reason). Rename "Asset Tag" → "Functional Location ID" on FLOC records. Keep `handleChangeTag` ([`Assets.tsx:587`](../src/frontend/src/eam/pages/Assets.tsx)) for existing records.
- **Files:** `Assets.tsx` (DetailsTab change-tag, create flow `tagEditable`). **Retest:** new record → plain field; existing → "Change" opens MoC with reason + audit entry. **Closes:** ISO 55000:2014 §6.4; ISO 55001:2014 §8.1.

### F-001 · MEDIUM · "Tag" label used instead of Functional Location
- **Fix:** On the Location flow rename identifier → "Functional Location ID"; add a Parent-Level indicator; grey Criticality → "N/A at Root Level" when parent = Root.
- **Files:** `Assets.tsx` (create modal ~3096–3140). **Retest:** Location form reads "Functional Location ID", shows Parent Level, disables Criticality at Root. **Closes:** ISO 14224:2016 §6.3; ISO 55000:2014.

### F-011 · HIGH · Cannot add multiple Departments at the same level
- **Fix:** Verify OrgUnit `parent_id` is one-to-many (appears so); make "+ Department" always append a sibling; render peers side-by-side in `OrgChart`. Optional bulk/template add.
- **Files:** `ContactsTabs.tsx`, `OrgChart.tsx`, `OrgUnitModal.tsx`. **Retest:** add ≥3 peer departments under one Division; all persist and render at the same level. **Closes:** ISO 55000:2014 §6.2.

### F-002 · MEDIUM · Equipment fields shown at root level
- **Fix:** Drive visibility from `hierarchyModel.visibleFields(level)`; hide equipment specs above Equipment level; Admin-toggleable.
- **Files:** `Assets.tsx` (DetailsTab ~1946+). **Retest:** Site detail hides equipment specs; Equipment detail shows them. **Closes:** ISO 14224:2016 §6.3; ISO 55000:2014 §6.2.

### F-007 · MEDIUM · Criticality mandatory at all levels *(see §5.2 for the deeper methodology gap)*
- **Fix:** Per-level `criticalityRule` (default mandatory from L3 down, optional above); Admin → Criticality Rules; update create validation ([`Assets.tsx:3064`](../src/frontend/src/eam/pages/Assets.tsx)) + DetailsTab.
- **Files:** `Assets.tsx`, Admin config. **Retest:** L1/L2 save without criticality; L3+ enforce it. **Closes:** ISO 14224:2016 §7; IEC 60812.

### (Report LOW item)
The summary cites 1 LOW; the detailed pages enumerate F-001…F-011 at MEDIUM/HIGH/CRITICAL with no LOW. **Open question for the reviewer** to reconcile the count.

---

## 5. Cross-cutting Asset-Management Requirements *(beyond the report — required for a credible closeout)*

The report fixes UI defects; an AM-grade closeout must also fix what makes the register *trustworthy*.

### 5.1 Data-quality baseline & KPIs
ISO 14224 is fundamentally about data quality. **Measure the register before and after:** % records at correct level, % criticality populated, taxonomy completeness, orphan/duplicate detection. Surface these on the **Reliability Metrics cockpit** (already built) so register health is monitored, not assumed.

### 5.2 Criticality as a *method*, not a dropdown
F-007's deeper issue: A/B/C is a free choice with no basis. Best practice is **risk-based criticality** (consequence × likelihood, IEC 60812 FMECA). Minimum: capture the **basis** for the rating and tie it to the RCM/PM-optimisation already built; target state: a guided criticality assessment.

### 5.3 The second ISO 14224 axis — equipment classification
There are two taxonomies: the **functional hierarchy** *and* the **equipment-class taxonomy** (class → type, with class-specific failure modes, Annex A/B). F-002/F-003 only brush it. Tie the class library to the FMEA/reliability spine so failure modes are class-driven.

---

## 6. Migration & Cutover Safety *(the real risk)*

F-004/F-009 touch **master data that is already wrong** (Sites carry `EQ-` numbers). And the blast radius is wider than "fix the column":

- **QR labels encode the tag** — `ers://asset/${asset.tag}` ([`AssetQRCode.tsx`](../src/frontend/src/eam/components/AssetQRCode.tsx)). Renaming/re-keying tags **invalidates printed field labels** = physical rework, not a migration.
- **Referential integrity:** work orders/history key on the immutable `asset.id` (safe), but `tag` is used as identity in AI context and labels — so **tag must become a stable alias, not be rewritten.**

**Posture — additive, freeze-and-reconcile (not rewrite):**
1. **Dry-run audit (read-only):** count FLOC rows carrying `EQ-`, Equipment rows missing numbers; produce a reconciliation report. **No writes.**
2. **Assign identifiers additively:** introduce `FL-`/`EQ-` as new fields while **retaining the existing `tag` as an alias** so QR deep-links keep resolving (resolver accepts legacy tag *or* new id).
3. **Correct under MoC:** re-key only where required, stamping prior values (`properties.legacy_*`) — auditable and reversible.
4. **Regenerate labels on a controlled cycle**, not silently.
5. Migrations idempotent + gated; run against a backup/branch first.

---

## 7. Sequencing & Sizing

| Phase | Items | Rough size | Gate |
|---|---|---|---|
| **0 — Decision + Foundation** | §2 object model, F-010 (`hierarchyModel`, `resolveLevel`, integrity rules, config table) | L | Unblocks all |
| **1 — Pre-Alpha (CRITICAL)** | F-004, F-009 (+ §6 dry-run/additive), F-003 | M–L | Master-data integrity before go-live |
| **2 — Before Beta** | F-005, F-006, F-008, F-001, F-011, install/dismantle UI | M | Workflow & structure |
| **3 — Config & refinement** | F-002, F-007, Admin Config screen, §5 data-quality + criticality method | M | Polish, configurability, trust |

Dependencies: everything depends on **Phase 0**; F-003 source-consolidation can run parallel to numbering.

---

## 8. Delivery Governance

- **Rollback per phase:** each migration ships with a tested down-path; UI changes behind a flag where feasible.
- **UAT re-run + sign-off loop:** retest each ID against its cited ISO clause; attach evidence to the §9 table; route back to AgileAsset for closure sign-off.
- **Regression scope:** assets feed Work Orders, Scheduling, and the Reliability metrics — re-test those after level/numbering/object-model changes.
- **Comms & training:** release notes + brief training for workflow changes (Tag→FLOC rename, Add-Child split, manufacturer form, install/dismantle).

---

## 9. Traceability & Sign-off

| ID | Sev | Phase | Status | Commit | Retested | ISO clause |
|---|---|---|---|---|---|---|
| F-010 | CRIT | 0 | **Done** — object model + level engine + Admin Hierarchy Config (editable, hydrated at startup) | 25b7a30, 61613c1, f666538 | — | 14224 §6.3 T2/3 |
| F-004 | CRIT | 1 | **Done** — trigger gated + 24 records reconciled (24→0) | ef0f700 (0157) | ✅ audit 0 | 14224 §6.3 T2 |
| F-009 | CRIT | 1 | **Done** — FL/EQ ranges + blank-tag auto-fill | ef0f700, f5c5776 | — | 14224 §6.3; 55001 §8.1 |
| F-003 | HIGH | 1 | **Done** — dedicated manufacturer master (table+API+form), consolidated source, asset refs by id | ce70bd8, cc0dfcc, ca03d5e | — | 14224 Annex C; 55001 §8.1 |
| F-005 | HIGH | 2 | **Done** — level-gated Add Location / Add Asset | 3bc579d | — | 55000 §6.2.3 |
| F-006 | HIGH | 2 | **Already met** — panel is a collapsible indented tree (`treeData`); residual: optional scope-to-selected-site | — | ✅ verified | 55000 |
| F-008 | HIGH | 2 | **Done** — FLOC terminology on tag label + MoC modal; MoC stays gated to saved records | 3bc579d | — | 55000 §6.4 |
| F-011 | HIGH | 2 | **Corrected in Rev 2** — the "already met" desk call was wrong; real root cause was a DB CHECK constraint. See §10. | 0166 | — | 55000 §6.2 |
| F-001 | MED | 2 | **Done** — FLOC ID label, Parent-Level indicator, criticality N/A at root | 3bc579d | — | 14224 §6.3 |
| F-002 | MED | 3 | **Done** — equipment taxonomy + spec fields hidden on FLOCs (hierarchyModel) | (Phase 3) | — | 14224 §6.3 |
| F-007 | MED | 3 | **Done (default rules)** — criticality N/A at root, required for equipment; per-level rules in hierarchyModel. Admin editability pending the config screen | 3bc579d | — | 14224 §7; IEC 60812 |

**Open questions for the reviewer:**
1. **§2 object model** — adopt Option A (separate Equipment + installation, recommended) or accept Option B as signed architectural debt?
2. Confirm the **LOW finding** (§4) so the severity count reconciles.
3. Confirm level **labels/count** (default ISO six-level seed) and the level at which **EQ numbering begins** (default L5).
4. Endorse the **revised F-003** approach (partner-role over a separate manufacturer master).

---

## 10. Revision 2 Closeout Register (responds to UAT Follow-Up Report, 1 Jul 2026)

Rev 2 confirmed **8 of 11** original findings CLOSED, carried **3** (F-002, F-009, F-011), and raised **4** new (F-012–F-015). **All 15 are now addressed.** "Rev 2 status" = the reviewer's assessment; "Resolution" = what shipped.

| ID | Sev | Rev 2 status (reviewer) | Resolution shipped | Commit / Migration |
|---|---|---|---|---|
| F-001 | MED | CLOSED | FLOC ID label, parent-level, criticality N/A at root | 3bc579d |
| F-002 | MED | Open (partial) | Field visibility now **configurable per level** (Admin → Hierarchy Config "Equip fields"); DetailsTab driven by `showsEquipmentFields` | f42a59a (+ 00dcf6c) |
| F-003 | HIGH | CLOSED | Manufacturer master (table+API+form), consolidated, by-id | ce70bd8, cc0dfcc, ca03d5e / **0158** |
| F-004 | CRIT | CLOSED | EQ trigger level-gated; 24 FLOC records reconciled (24→0) | ef0f700 / **0157** |
| F-005 | HIGH | CLOSED | Level-gated Add Location / Add Asset | 3bc579d |
| F-006 | HIGH | CLOSED | Collapsible indented tree (verified) | — |
| F-007 | MED | CLOSED | Per-level criticality rule + Admin config | 3bc579d, f666538 |
| F-008 | HIGH | CLOSED | FLOC terminology; MoC gated to saved records | 3bc579d |
| **F-009** | CRIT | Open → **resolved** | *Re-scoped by reviewer to Audit Trail.* Tab now reads persisted `audit_logs` (DB trigger already wrote them); was reading in-memory `trackingLog` | e548fa6 |
| F-010 | CRIT | CLOSED | Object model + level engine + Admin Hierarchy Config | 25b7a30, 61613c1, f666538 / **0156, 0159, 0163** |
| **F-011** | HIGH | Open (2 cycles) → **resolved** | Root cause = `organization_units.type` CHECK IN ('DIVISION','GROUP','TEAM') rejected DEPARTMENT etc. Dropped the fixed CHECK; type governed by the configurable org model | 3478123 / **0166** |
| **F-012** | HIGH | NEW → **resolved** | Site-scoped asset pickers (Report-a-Problem + Inventory) via `filterAssetsBySiteScope` + "Show all sites" override. *WO Select-Asset picker: last spot, in the in-progress WO work* | c3eb89c, d3060b9 |
| **F-013** | MED | NEW → **resolved** | Create modal defaults Level to **parent+1** (not a same-level sibling) + "New record will be created at: L[N]" label | f42a59a |
| **F-014** | LOW | NEW → **resolved** | Work Management menu reordered (Maintenance Requests before Work Orders) | client (menu config) |
| **F-015** | CRIT | NEW → **reclassified** | Not auto-rejection: requests are created `NEW` (code); the "Rejected" was a **status-badge display bug** (dictionary-driven) — now uses canonical labels. Disabled Reject/Authorize = correct permission + workflow-state gating | c3eb89c |

### 10.1 Tester-permission caveats (material to sign-off)
The Rev 2 cycle was performed under **J.test1 (System Administrator)**, which distorts two findings:
- **F-012** cannot be validated by an admin — a System Administrator has **global data scope (`['*']`)** and *by design* sees all sites. Scoping must be retested with a **site-scoped user** (e.g. K.Syrus scoped to one site via Admin → Data Scope & Site Access).
- **F-015** (claimed CRITICAL "all requests auto-rejected") is **overstated**: requests are created `NEW` in code, the toolbar showed `NEW`, and the header "Rejected" was a display-badge bug (now fixed). **J.test1 (SYS_ADMIN) already carries `requests.authorize`** (role = `FULL_ACCESS`, plus the global-admin bypass) — authorization is **not** permission-blocked. The greyed Reject/Authorize buttons are **pure workflow-state gating**: the state machine is **NEW → Review → Authorize → Approve**, so Reject/Authorize correctly activate only from the `REVIEW` state. On a just-created `NEW` request they're greyed until the user clicks **Review** — expected, not a defect. *Recommended UX: tooltips on the disabled workflow buttons ("Move to Review first") so the sequence isn't misread again.*

### 10.2 Report reconciliation note
The Rev 2 **Priority Action Plan** lists *"F-004 & F-010 — carried over, no progress observed,"* but the Rev 2 **status register marks both CLOSED**. Both were resolved in the Rev 1 cycle (see rows above); the priority-plan mention appears to be a carry-over error. Recommend reconciling at sign-off so closed items aren't re-opened.

### 10.3 Migrations to apply for sign-off
Apply in order (Supabase SQL editor); all additive/reversible:

| # | Purpose |
|---|---|
| 0156 | FLOC/Equipment object model (F-010) |
| 0157 | Numbering fix + reconcile (F-004) |
| 0158 | Manufacturer master (F-003) |
| 0159 | Hierarchy config table (F-010) |
| 0160 | Manufacturer_models parent constraint |
| 0161 | Criticality nullable (upper FLOCs) |
| 0162 | Configurable numbering ranges |
| 0163 | hierarchy_level → TEXT (custom levels) |
| 0164 | User-admin RPCs (delete/disable login) |
| 0165 | Config org-key (multi-tenancy groundwork) |
| **0166** | **Org-unit type flex (F-011)** |
| **0167** | **Numbering-trigger self-heal (collision guard)** |

### 10.4 Post-sign-off testing pass — gaps found & fixed
A verification pass over the shipped work surfaced and closed several real gaps:
- **F-012 scope detection** was silently broken for **AREA-typed / custom-level sites** (keyed on a `category` string the read-mapper only sets for SITE). Rewritten level-agnostic (ancestor-id match); also hardened WO scoping (shared helper). *(19596ad)*
- **F-009 actor** — the manual tag-change write put a username into the UUID `changed_by` column (insert failed); now writes the user UUID and the Audit Trail shows **"by \<name\>"** (resolves `changed_by`→username). *(04d2c61)*
- **Numbering collision guard** — the trigger self-heals if `numbering_config` is missing, preventing `equipment_number` collisions that would block creation. *(0167)*
- **F-002 default** — switching a level to Equipment now defaults its equip-fields flag on.

### 10.5 Known residuals (non-blocking)
- **F-012** — the **Assets** module (list, parent-asset picker, move picker) is already site-scoped at load; **Report-a-Problem** and **Inventory** pickers are scoped. Remaining: the **WO "Select Asset" picker** (2-line change, inside in-progress Work Orders work) and PM/scheduling asset-assignment pickers.
- **Manufacturer** — `AddContactModal`'s manufacturer-mode is now **dead code** (superseded by the dedicated master + `AddManufacturerModal`); unreachable and harmless, flagged for a low-risk cleanup pass (it sits in the user-creation critical path, so not reverted amid active drift).
- **F-015** — optional debug-label removal + workflow-button tooltips (in in-progress ServiceRequests work).
- **`0164` RPCs** are granted to any authenticated user — **role-harden in the RLS/permissions phase**.
- Enterprise multi-site **data isolation (RLS)** is designed separately — see *Multi-Tenancy & Enterprise Structure Design*; F-012's picker filter is its UX (T-4) layer, not the full RLS boundary.

### 10.5 Sign-off (Rev 2)
| Role | Name | Signature | Date |
|---|---|---|---|
| Test Lead / Author | Agile Asset Reliability Solutions | | |
| Client Reviewer | | | |
| Development Lead (Relantern) | | | |
| Project Manager | | | |
