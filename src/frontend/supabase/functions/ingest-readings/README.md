# ingest-readings — push-model sensor ingestion

`sensor-sync` **pulls** internet-reachable sources on a schedule. This is the
other half: anything that can make an HTTPS request **pushes** here.

That distinction is what makes plant-local protocols reachable at all. An edge
function cannot hold an MQTT subscription, speak binary OPC-UA, or dial into a
firewalled network. The ERS Collector runs *inside* the customer network, speaks
those protocols locally, and POSTs the results here over **outbound HTTPS only**
— no inbound firewall rule, which is what makes enterprise IT say yes.

```
POST /functions/v1/ingest-readings
Headers: x-api-key: <collector key>
Body:
{ "readings": [
    { "asset": "P-101A", "tag": "vibration_de", "value": 4.2,
      "unit": "mm/s", "timestamp": "2026-07-17T10:00:00Z",
      "alarm_high": 7.1, "alarm_low": 0 }
] }
```

A bare array works too. `asset` matches an asset **tag or id**. Max 500 readings
per request. Readings whose asset can't be resolved come back in
`unknownAssets` rather than failing the batch.

## Authentication — per-collector keys

Each Collector install gets its own key (migration 0236). Keys are stored as a
SHA-256 hash with an 8-char prefix for identification; the key itself is shown
once at mint time and is not recoverable.

There is deliberately **no global-key fallback**. One secret shared across every
customer can't be revoked without cutting off everyone, and gives no attribution
for what was written.

```bash
# mint
node scripts/provision/mint-collector-key.mjs --name "Bonny Island terminal"

# list, with last-seen heartbeat and lifetime reading count
node scripts/provision/mint-collector-key.mjs --list

# revoke — takes effect on the next request
node scripts/provision/mint-collector-key.mjs --revoke ers_col_1a2b3c4d
```

Every accepted push stamps `last_seen_at` and increments `readings_count` on the
key, so a collector that has gone quiet is visible without extra plumbing.

## Storage and replay safety

Writes land in both tables (see the sensor-sync README for the full picture):

- `ers_sensor_reading_points` — append-only history, unique on
  `(asset_id, tag, ts)`.
- `ers_sensor_readings` — the latest-value + 50-point projection Predict reads.

**The projection is rebuilt from the points table after each push.** This is what
makes store-and-forward safe: a collector that buffers during a network outage
and replays the same batch will not inflate the series. Verified — three
identical replays of a 3-point batch leave exactly 3 points and a 3-value
sparkline, where blind appending produced 9.

If the points write fails (e.g. 0236 not applied), the function falls back to
appending in memory so ingestion degrades rather than breaks.

## Deploy

```bash
supabase functions deploy ingest-readings --no-verify-jwt
```

`--no-verify-jwt` lets devices call without a Supabase JWT — the collector key is
the gate. Env is the injected `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` only.

## Responses

| Status | Meaning |
|---|---|
| 200 | `{ collector, accepted, points, historyWritten, rejected, unknownAssets }` |
| 401 | missing, unknown, or revoked `x-api-key` |
| 413 | more than 500 readings in one request |
| 422 | readings parsed but no asset matched |
| 503 | collector key store unreachable (is 0236 applied?) |
