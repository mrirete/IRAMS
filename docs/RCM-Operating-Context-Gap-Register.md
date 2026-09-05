# RCM Operating Context — Review & Gap Register

**Date:** 2026-09-05 · **Scope:** Asset register taxonomy, hierarchy levels, operating context, RCM consumption · **Migration:** 0317

## What was found (verified against code and the live database)

| # | Finding | Evidence | Status |
|---|---------|----------|--------|
| G-A | **Equipment level numbered L5, Component L6.** ISO 14224:2016 Table 3 is nine levels: 1 Industry, 2 Business category, 3 Installation, 4 Plant/Unit, 5 Section/System, **6 Equipment unit**, 7 Subunit, 8 Component/Maintainable item, 9 Part. The failure taxonomy (0285/0288) was already built on L6/L7. | `hierarchyModel.DEFAULT_LEVELS` + live global `hierarchy_config` row | **FIXED** — code default + 0317 renumbers every saved config, adds optional SUBUNIT (L7) under EQUIPMENT, Admin page shows ISO names |
| G-B | **Category → Class → Type cascade broken and inverted.** Live `reference_codes` pointed Type at Category (Type picker empty for every class but Pump); "class" rows were ISO *types* (Centrifugal Pump), "type" rows ISO *classes* (Pump). Three sources disagreed (0027, constants.ts mock, live rows). | live query 2026-09-05 | **FIXED** — `lib/iso14224Taxonomy.ts` is the single source; 0317 seeds 8 categories / 47 classes / 179 types (global, tenant-shadowable), mock generated from the same source, legacy rows deactivated |
| G-C | **Level codes stored as equipment type.** 15 of 70 assets carried AREA/SYSTEM/SITE/COMPONENT in `asset_type_code`; only 3 had a real type (MOTOR ×2, PUMP ×1). | live query | **FIXED** — 0317 clears level codes, remaps legacy words to ISO class; bulk import no longer writes level codes into the type column (`classifyImportRow`) |
| G-D | **Failure-mode and subunit scoping silently dead.** 131 reference rows carry their parent in the `category_ref` column, but the UI only read `properties.categoryRef` (16 rows) — every failure mode shown for every asset. The scope vocabulary (ROTATING, STATIC_PRESSURE, HEAT_TRANSFER, ELECTRICAL, INSTRUMENT, SAFETY_SYSTEM, PIPING, STRUCTURAL) did not exist in the register pickers either. | `DatabaseService.getDictionaries`, `WorkOrders.tsx` resolvedAssetClass | **FIXED** — one-line column fallback in `getDictionaries`; each ISO class carries `failureScope`; `failureScopeFor(asset)` resolves the scope group for the WO pickers |
| G-E | **No "Other" at any tier.** | pickers | **FIXED** — every category and every class has an Other child; hint points to Admin › Dictionaries for a proper code |
| G-F | **No operating-context fields on the asset.** `types/assets.ts` had a DesignData/OperatingContext design that never reached the DB or UI; Custom Fields is freeform. | — | **FIXED** — `assets.operating_context` JSONB + Operating Context card on the Details tab (mode, utilisation, hours/starts per year, redundancy, environment, medium, duty narrative) + class-specific Design / Operating / Max parameter table (`lib/iso14224Parameters.ts`), custom rows, above-design flag |
| G-G | **RCM Specialist blind to class and context.** Prompts carried tag/level/criticality/make/model only. | `RCMService.assetContextFor` | **FIXED** — prompts now carry ISO classification + the composed context (design vs operating, derating flags); one path for all Specialist calls |
| G-H | **RCM study had no record of the context it assumed** (SAE JA1011 §5.1). | `ers_rcm_studies` | **FIXED** — `context_snapshot` on the study, taken on create / asset change / "refresh from register"; Overview shows structured chips and warns when the asset's context changed since |
| G-I | **Predict class map keyed to codes the DB never had** (MOTORS_DRIVES, POWER_DISTRIBUTION…). | `lib/predict/equipmentClass.ts` | **FIXED** — reads `predictClassFor` from the taxonomy; motors/generators score as electrical |

## Deferred (not in this slice)

| # | Gap | Why it matters | Suggested build |
|---|-----|----------------|-----------------|
| ~~D-1~~ | Bulk-import template columns | **CLOSED 2026-09-05 (0318 commit):** `assetCategory` / `assetClass` / `assetTypeCode` + `operatingMode`, `utilisationPct`, `hoursPerYear`, `startsPerYear`, `redundancy`, `environment`, `serviceMedium`, `designValues`, `operatingValues` (key=value pairs). Eight worked example rows (site→unit→system, GT-301 with its SUBUNIT and COMPONENT, P-101A/B duty-standby pair, M-101A motor), an "ISO 14224 Codes" sheet generated from the taxonomy, and a "Parameter Keys" sheet per class. `bulkImportService` reads all of it (`parseImportContext`). | — |
| ~~D-8~~ | RCM blind to the asset's components and BOM | **CLOSED 2026-09-05 (0318):** `ers_rcm_failure_modes.component_asset_id` / `bom_item_id`; `RCMService.getAssetBreakdown` (child assets 3 levels down + `asset_bom`); the breakdown is in every Specialist prompt and the model is asked to pin each mode to a component tag and part number (`matchComponent` / `matchPart` map it back); Worksheet rows carry a component/part picker; the study Overview shows a coverage bar — which registered components still have no failure mode, unpinned modes, critical spares nobody names. | — |
| D-2 | Class-aware reading limits | Rated speed/power + ISO 20816 vibration zones could seed reading definitions with correct alarm bands | Derive from `operating_context.parameters` when a reading point is created on a classified asset |
| D-3 | Agent tools do not expose operating context | `get_org_context` exists; there is no `get_asset_context` for the Specialist agents outside RCM | Semantic-layer view + one tool in `agent-run` |
| D-4 | Failure capture cannot pick from *registered* subunits | With SUBUNIT now a level, a WO on an equipment unit could offer its registered subunit rows as the subunit picker | Extend the WO Analysis tab picker to union asset children at level SUBUNIT |
| D-5 | `SUBSYSTEM` is not an ISO level | Kept for existing data (1 asset) and labelled as L5 sub-section; a tenant that does not need it can remove it in Admin | Documentation only |
| D-6 | Reliability Modelling / Weibull does not read design vs operating | A derated pump's β/η could be annotated with its duty point | Show utilisation next to the fit; later, condition on duty |
| D-7 | Data hygiene | 2 duplicate "Crude Oil Unit" studies with no asset; 4 decisions with prose intervals (from the 2026-09-04 audit) | Manual clean-up |
| ~~D-9~~ | Decision spares picker (G10) | **CLOSED 2026-09-05:** Strategy tab shows "Spares the task consumes" on every PM-producing decision — add from the asset BOM (critical spares starred), one-tap add of the part the failure mode is pinned to, editable quantity; writes `spares_requirements`. | — |
| ~~D-10~~ | Coverage in the readiness gate | **CLOSED 2026-09-05:** `assessStudyData` gains a *recommended* item "Components covered · n/N" when the register has components — unmet lists the uncovered tags; never blocks (a study may be scoped to one subunit). | — |

## Where things live

- Taxonomy source: `src/frontend/src/lib/iso14224Taxonomy.ts` (generator `scripts/gen-iso14224-seed.mjs`, test asserts 0317 matches)
- Parameter templates: `src/frontend/src/lib/iso14224Parameters.ts`
- Operating context engine: `src/frontend/src/lib/operatingContext.ts` (normalise, merge template, compose narrative, completeness, snapshot)
- Asset UI: `src/frontend/src/eam/components/OperatingContextCard.tsx` (Details tab, equipment levels only)
- RCM: `RCMService.getAssetContext / refreshContextSnapshot / assetContextFor`, `rcmReadiness.assessStudyData`, `RCMStudyOverview`
- Hierarchy: `hierarchyModel.DEFAULT_LEVELS`, `ISO_LEVEL_NAMES`; Admin › Hierarchy Configuration
- Migration: `supabase/migrations/0317_iso14224_taxonomy_and_operating_context.sql`
