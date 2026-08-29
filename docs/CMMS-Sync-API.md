# CMMS Sync API — keeping IREAMS current from any foreign CMMS

**Status: LIVE with 0298** (endpoint `ingest-work-orders`, deployed alongside `ingest-readings`).

## Why this exists

The reliability-only tier runs IREAMS as an analysis overlay on a customer's
existing CMMS (SAP PM, Maximo, MaintainX, …). Onboarding happens through the
file-based Import Wizard, but a file upload is the wrong tool for *staying*
current. This API is the wizard's commit path over HTTPS: export "work orders
changed since yesterday" from the source system, POST it nightly, and the
reliability engines (Weibull, MTBF, PM optimization, bad actors, the
Specialist agents) stay grounded in live history — without anyone using the
IREAMS EAM day-to-day.

The full loop for a reliability-tier client:

```
their CMMS ──export──▶ ingest-work-orders ──▶ IREAMS analyses
     ▲                                              │
     └────── writeback package (SAP/Maximo/… ◀──────┘
             columns, proposal-writeback)
```

## Endpoints

Both endpoints authenticate with a per-collector API key (`x-api-key`,
`ers_collector_keys` — mint with `node scripts/provision/mint-collector-key.mjs`).
Keys are tenant-bound: lookups and writes never leave the key's company.

### 1. `POST /functions/v1/ingest-work-orders` — history & failure events

```json
{
  "source_system": "sap_pm",
  "work_orders": [{
    "wo_number": "4000123",
    "asset": "P-101A",
    "title": "Seal replacement",
    "type": "PM02",
    "status": "TECO",
    "created_at": "2026-05-02",
    "closed_at": "2026-05-04",
    "breakdown": true,
    "malfunction_start": "2026-05-02T03:10:00Z",
    "malfunction_end": "2026-05-02T09:40:00Z",
    "downtime_hours": 6.5,
    "labor_hours": 12,
    "labor_cost": 1400,
    "material_cost": 830,
    "failure_mode": "SEA",
    "failure_cause": "WEA",
    "remedy": "REP"
  }]
}
```

- `asset` accepts an asset **tag**, **equipment number** (SAP EQUNR), or IREAMS
  asset id. Assets must already exist — unknown references are reported and
  skipped, never silently created flat (migrate the register first, same
  dependency the Migration Center enforces).
- Max 500 work orders per request; batch larger syncs.
- `breakdown` (SAP MSAUS) is the strongest failure signal — send it if the
  source has it. Types the classifier doesn't recognise are kept verbatim and
  stay neutral to failure counting.

**Delta-sync semantics (idempotent):**

- New `wo_number` → inserted as frozen history.
- Existing `wo_number` that came from import/API → **updated** (status,
  closure, breakdown, malfunction window, downtime; costs until frozen).
  Re-sending an unchanged row is safe.
- Existing `wo_number` owned by a native in-app work order → **conflict**,
  reported and left untouched. The sync never clobbers records authored in
  IREAMS.
- Every request creates one `import_batches` row — API syncs appear next to
  file imports in the Migration Center and are **rollback-able by batch**.

### 2. `POST /functions/v1/ingest-readings` — sensor / meter data

Unchanged contract (see the function header), plus since 0298:

- Asset resolution is tenant-scoped to the key's company.
- A `reading_definition` whose `sensor_tag` (or, zero-config, its
  `reading_type_code`) matches the pushed tag gets the latest value mirrored
  into `reading_logs` (throttled to one row per definition per 15 minutes) —
  so live feeds drive **meter-based PMs and reading alarms**, not only the
  Predict twin.

## Scheduling a nightly sync

Any scheduler works — the contract is just JSON over HTTPS:

```bash
# after exporting delta.json from the source CMMS
curl -s -X POST "$SUPABASE_URL/functions/v1/ingest-work-orders" \
  -H "x-api-key: $IREAMS_COLLECTOR_KEY" \
  -H "Content-Type: application/json" \
  --data @delta.json
```

The response reports `created / updated / conflicts / unknownAssets` — treat a
non-empty `unknownAssets` as a register-drift alarm.

## Deploy notes

```
supabase functions deploy ingest-work-orders --no-verify-jwt
supabase functions deploy ingest-readings   --no-verify-jwt
```

Apply migration `0298_standalone_reliability_gaps.sql` first (nullable
`failure_mode_code`, `reading_definitions.sensor_tag`, lifetime KPI columns on
`sem_asset_reliability`).
