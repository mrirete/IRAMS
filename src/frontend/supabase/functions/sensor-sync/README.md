# sensor-sync — scheduled sensor connector

The real backend worker behind the Connector Hub's **cloud route**. Pulls active
`rest_api`, `historian`, and `weather_api` connectors from the `connectors`
table and upserts their readings into `ers_sensor_readings` — the feed Predict
reads and the CSV importer writes to. Idempotent per `(asset_id, tag)`.

Plant-local protocols (OPC-UA, MQTT, on-prem SQL, watched file shares) are **not**
handled here and never will be: an edge function can't hold a broker
subscription or dial into a firewalled network. Those run on the ERS Collector
inside the customer network, which pushes to the `ingest-readings` function.

## Execution kinds

`config.kind` picks the path. Rows written before `kind` existed are `rest`.

| kind | Used by | Behaviour |
|---|---|---|
| `rest` | `rest_api`, `historian` | Fetch a JSON endpoint, walk `root` to an array, map each record. **Replaces** each series with the pulled window. |
| `weather` | `weather_api` | Call a provider adapter (`_shared/weather.ts`), emit one point per selected measurement against one asset. **Appends** — each poll is a single sample. |

A historian is just REST with Basic auth and a query path, so it shares the
engine rather than getting its own.

## 1. Apply the migration first

Run `supabase/migrations/0177_connectors.sql` in the Supabase SQL editor (creates
`connectors` + `connector_sync_logs`).

## 2. Deploy the function

```bash
supabase functions deploy sensor-sync
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — the
service role bypasses RLS so the function can write. **Do not** put any source
API tokens in this repo; put them in the connector's `config.headers` (below) or
as a function secret (`supabase secrets set MY_TOKEN=…`).

## 3. Register a connector (one row per source)

`config` tells the function how to read the source. `map` points our fields at
the source's JSON field paths (dotted paths supported); `root` is the path to the
array of records (omit if the response body *is* the array).

```sql
INSERT INTO connectors (name, type, config) VALUES (
  'Plant REST feed', 'rest_api',
  '{
     "url": "https://your-historian.example.com/api/readings",
     "headers": { "Authorization": "Bearer REPLACE_ME" },
     "root": "data",
     "map": {
       "asset": "equipment_tag",
       "tag": "sensor",
       "value": "reading",
       "unit": "uom",
       "timestamp": "ts",
       "alarm_high": "hi",
       "alarm_low": "lo"
     }
   }'::jsonb
);
```

`asset` is matched against `assets.tag` or `assets.id`. Rows whose asset can't be
resolved, or whose value isn't numeric, are skipped.

### Weather connectors (`kind: "weather"`)

The wizard writes these for you; this is the shape it produces. Open-Meteo needs
no API key, which makes it the fastest way to prove the pipe end to end.

```sql
INSERT INTO connectors (name, type, is_active, config) VALUES (
  'Bonny Island weather', 'weather_api', true,
  '{
     "kind": "weather",
     "provider": "openmeteo",
     "latitude": 4.4397,
     "longitude": 7.1534,
     "units": "metric",
     "data_points": ["temperature","humidity","wind_speed","precipitation"],
     "asset": "WS-001"
   }'::jsonb
);
```

`asset` is an existing asset tag or id — the readings land against it tagged
`weather_temperature`, `weather_humidity`, and so on, appended to the series on
each run.

Provider coverage (a measurement a provider can't serve is skipped and logged,
never fabricated):

| Provider | Key? | Serves |
|---|---|---|
| `openmeteo` | no | temperature, humidity, wind_speed, precipitation, pressure |
| `openweather` | yes | the above + visibility |
| `weatherapi` | yes | all eight, incl. uv_index and dew_point |

Keep this table in step with `WEATHER_SUPPORT` in `src/types/connectors.ts` —
that's what the wizard greys out.

### Historian connectors

Same `kind: "rest"` shape as above: `url` is the historian's API URL plus your
query path, `headers.Authorization` is Basic auth, and `map` points at the
readings in the response.

## 4. Schedule it (pg_cron + pg_net)

In the SQL editor (enable the `pg_cron` and `pg_net` extensions first, under
Database → Extensions):

```sql
select cron.schedule(
  'sensor-sync-15min', '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/sensor-sync',
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer <SERVICE_ROLE_KEY>'),
    body    := '{}'::jsonb
  );
  $$
);
```

Replace `<PROJECT_REF>` and `<SERVICE_ROLE_KEY>`. To run one connector on demand:
`POST /functions/v1/sensor-sync` with body `{"connectorId":"<uuid>"}`.

## 5. Verify

```bash
supabase functions invoke sensor-sync --no-verify-jwt   # local/manual test
```
Then check `connector_sync_logs` for `status='ok'` and rows in
`ers_sensor_readings`. Run a Digital Twin Snapshot in Predict on those assets to
compute health from the synced data.

## What this does and doesn't cover

- ✅ Scheduled/on-demand **pull** connectors: REST, historian, weather — any
  internet-reachable HTTP/JSON source.
- ⛔ Plant-local protocols (OPC-UA, MQTT, on-prem SQL, watched file shares).
  These need code running *inside* the customer network; the collector agent
  speaks them locally and POSTs to `ingest-readings`.

## Where readings are stored

Two tables, written together (0236):

| Table | Role |
|---|---|
| `ers_sensor_reading_points` | **Source of truth.** Append-only history: one row per `(asset_id, tag, ts, value)`, unique on `(asset_id, tag, ts)` so a retried poll or replayed batch cannot double-count. |
| `ers_sensor_readings` | **Projection.** One row per `(asset, tag)` with `current_value`, `trend`, and the last 50 values for the sparkline. This is what Predict, the digital twin, and PredictionService read — unchanged. |

`ingest-readings` rebuilds the projection's series *from* the points table after
each push, so the two never drift. If the points write fails the projection
still updates, so ingestion degrades rather than breaks.

Retention: `select ers_prune_reading_points(90)` drops raw points older than 90
days; scheduled nightly as `sensor-points-retention`.

## Scheduling

`sensor-sync-tick` fires every 5 minutes, but the function only syncs
connectors that are actually **due** — `now - last_sync >= sync_interval_seconds`.
That is what makes the per-connector interval in the wizard real; before this,
every active connector ran at whatever cadence the cron used. An explicit
`{"connectorId": "…"}` (Sync Now, wizard Test) always runs regardless.

## Testing the weather adapters

`_shared/weather.ts` is pure logic + `fetch` with no Deno APIs, so it can be
exercised straight from Node against the live providers — see the adapter test
in the scratchpad, which transpiles this file with `tsc` and asserts the point
shape, units, skip-reporting, and failure messages.
