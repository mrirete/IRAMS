# sensor-sync — scheduled sensor connector

The real backend worker behind the Connector Hub. Pulls active REST/weather
connectors from the `connectors` table (migration 0177) and upserts their
readings into `ers_sensor_readings` — the feed Predict reads and the CSV importer
writes to. Idempotent per `(asset_id, tag)`.

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

### Free CORS-friendly source to prove the pipe (open-meteo, no key)

```sql
INSERT INTO connectors (name, type, config) VALUES (
  'Site weather (open-meteo)', 'weather_api',
  '{
     "url": "https://api.open-meteo.com/v1/forecast?latitude=4.45&longitude=7.05&current=temperature_2m,wind_speed_10m",
     "root": "",
     "map": { "asset": "constant", "tag": "constant", "value": "current.temperature_2m", "unit": "constant" }
   }'::jsonb
);
```
(For a single-object response like open-meteo, wrap it or point `root` at an array
your source returns — this example shows the shape; real sensor feeds return an
array of point readings.)

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

- ✅ Scheduled/on-demand **pull** connectors (REST, weather, any HTTP-JSON source).
- ⛔ True push streaming (MQTT/OPC-UA) needs a persistent subscriber, not a
  scheduled function — a separate long-running worker. This function is the
  polling half, which covers most historian/REST integrations.
