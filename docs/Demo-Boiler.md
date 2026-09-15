# Demo: coal-fired boiler B-301 — real plant data end to end

**What this is.** A real coal-fired boiler's five days of DCS data, loaded onto a real
register asset in the showcase tenant, with the P&ID drawn, the reading points banded,
and the load tag set — so every layer built in September 2026 (readable signal history,
`query_readings`, the regime-aware detector, P&ID isolation proposals, drawings on the
asset) can be shown on one asset with numbers that are not invented.

**Tenant:** the showcase tenant (`admin001@cainergy.com`). **Asset:** `B-301` under
`UNIT-300 Power Generation › SYS-300-BLR Coal-fired boiler train`.

---

## 1. Dataset and provenance

| | |
|---|---|
| Source | Hu, W., Jiang, A., Chen, K., Zheng, J., Shang, W. & Cao, Z. (2025). *A long-tailed distribution time-series dataset in boiler equipment.* Sci Data 12:742. https://doi.org/10.1038/s41597-025-05096-4 |
| Data | figshare doi:10.6084/m9.figshare.28868849 — **CC0**, public, no login. File `xinan_completed_data.csv` (missing values imputed by the authors' AutoReg). |
| Plant | Coal-fired circulating-fluidised-bed boiler, Zhejiang Xin'an Chemical Group, China |
| Record | 2022-03-27 14:28 → 2022-04-01 14:28 local, 5-second samples, 86 400 rows, 30 DCS tags |
| Loaded as | 1-minute means (7 201 points per tag, 216 030 total), time-shifted so the record **ends at load time** (2026-09-15 20:23 UTC) — a "last 7 days" question has an answer today |
| Abnormal state (paper) | Outlet steam temperature `TE_8332A` outside 530–545 °C — 8.6 % of the 5 s samples. In the 1-minute load: **8.0 %** (7 201 samples, min 517.1, mean 537.5, max 550.4 °C). |
| Units | Table 1 of the paper names the tags but gives no units; units in `scripts/boiler-columns.json` are inferred from tag prefix and value range and are flagged `inferred_unit`. |

The 30 tags, in the paper's words (Table 1): six upper-furnace pressures, drum ("pot")
pressure and outlet vapour pressure, flue-gas temperatures at the upper economiser outlet
(L/R), upper furnace temperature, primary/secondary air preheater outlet temperatures,
**boiler outlet steam temperature**, desuperheater spray valve position, primary/secondary
fan flows, return-air (loop seal) flows L/R, economiser-inlet O₂ L/R, **induced-draft fan
motor current** and two bearing-housing vibrations, upper/lower hearth differential
pressures L/R, bed-layer differential pressures L/R, primary desuperheating water flow,
and **main steam flow (compensated)** — the load tag.

## 2. What was built in the tenant

Both scripts are idempotent and have `--clean`.

```
node scripts/provision-boiler-demo.mjs
node scripts/seed-boiler-history.mjs --csv <xinan_completed_data.csv> --asset B-301
```

- **Register:** `SYS-300-BLR` (SYSTEM) → `B-301 Coal-fired CFB boiler` (EQUIPMENT,
  `HEATER_BOILER`, criticality A, ISO 14224 operating context filled) → 17 COMPONENTs
  from the process flow diagram: furnace, cyclones L/R, loop seal, HT/LT superheaters,
  primary/secondary desuperheaters, upper/lower economisers, primary/secondary air
  preheaters, primary/secondary/ID fans, coal feeder, chimney.
- **Reading points:** 30 `reading_definitions` on B-301, one per tag, linked to the live
  series by `sensor_tag`. `TE_8332A` carries the paper's band (warn 530–545, crit 525–550,
  `limit_source` cites the paper). Every other point has no band — the projection's alarm
  line is the loaded data's 1st/99th percentile, an envelope, not a limit.
- **Signals:** `ers_sensor_reading_points` (raw, 1-min), `ers_sensor_readings` (50-point
  projection Predict reads), `ers_reading_rollups_hourly` (3 630 rows = 30 tags × 121 h).
- **Load tag:** `assets.properties.predict.regime = { loadTag: 'ZZQBCHLL', baselineDays: 30,
  excludeTags: ['TV_8329ZC'] }` — every other point is judged *at this steam flow*.
- **P&ID:** `B-301 coal-fired CFB boiler — steam generation`, 28 nodes / 37 edges drawn
  from Fig. 3: solids loop (feeder → furnace → cyclones → loop seal → furnace), flue path
  (cyclones → superheaters → economisers → air preheaters → ID-fan inlet damper → ID fan →
  outlet damper → chimney), water/steam path (feedwater isolation → economisers → drum →
  LT SH → primary desuperheater → HT SH → secondary desuperheater → main steam isolation),
  spray water (isolation → two spray valves), combustion air (two fans → preheaters →
  furnace), and three instruments.

All 30 tags sit on B-301 itself: the regime detector needs the load and the point on the
same asset. The components exist for the breakdown, the P&ID and FMEA work.

## 3. The Specialist on real data (captured 2026-09-15, deployed `agent-run` v39)

**Q1 — "Read the last 5 days of TE_8332A on B-301. Is it holding inside 530–545 °C, how
often was it outside, and which way is it trending?"**

> The outlet steam temperature TE_8332A on boiler B-301 has not been holding inside the
> 530–545 °C normal band over the last 7 days. The temperature ranged from a minimum of
> 517.11 °C to a maximum of 550.39 °C. It was outside the normal band for 70 % of the
> time. The trend is flat, with only a 0.1 % change over the 7-day period. Note that only
> 72.9 % of the window has data.

Sources cited: `ers_sensor_reading_points` (7 201 samples). Every number is real; the
72.9 % coverage is the 5-day record inside a 7-day window, correctly stated. The "70 %"
is *bucket* excursions — any sample in a ~1.75 h bucket touching the line — which the
tool documents but which is not what "how often" means to a plant manager. Fixed the same
evening: `excursions.pct_time_outside_warn` (sample-weighted share of buckets whose *mean*
is outside) is now returned and the tool note tells the model to quote it for "how
often". **Takes effect when `agent-run` is redeployed.** Expected value ≈ 8 %.

**Q2 — "Compare the primary desuperheater spray flow YJJWSLL with main steam flow ZZQBCHLL.
Is spray flow rising at constant load? Using the P&ID, what would that mean for SH-301 and
what work would you raise?"**

> The primary desuperheater spray water flow (YJJWSLL) on B-301 has been flat over the last
> 7 days, not rising at a constant load. The main steam flow (ZZQBCHLL) has also been flat.
> However, if spray flow *were* rising at a constant load, it would mean DSH-301 is
> requiring more water to cool the steam before it enters SH-301. The P&ID confirms the
> flow path: TV_8329ZC spray valve → DSH-301 Primary desuperheater → SH-301 HT superheater.
> … For SH-301 this would mean exposure to higher-than-design temperatures, risking
> overheating, creep damage and reduced remaining life. I would raise: inspect TV_8329ZC
> for calibration and internal leakage; inspect DSH-301 spray nozzles for plugging or
> erosion; verify the temperature control loop; if it persists, NDT on SH-301 at an outage.

Sources: both series (7 201 samples each) and the P&ID. It read the data, found the plant
steady, said so, and reasoned about the drawing rather than inventing a trend.

**Q3 — "Which valves or dampers isolate FAN-303 for maintenance?"**

> To isolate FAN-303, close damper DMP-303A, the ID fan inlet damper. The drawing
> indicates that all inlets to FAN-303 can be isolated.

Correct from the graph (the only upstream boundary is the inlet damper). The same walk is
what the permit's **Propose from P&ID** button inserts as a PROPOSED isolation point.

## 4. The regime-aware detector on real data

Dry run of exactly what *Run analysis* on B-301 computes (baseline = hourly rollups from
30 days ago to 1 day ago; current = last 24 h hourly; every tag vs `ZZQBCHLL`):

**Healthy record → nothing fires.** ID-fan current tracks steam flow with **R² = 0.81,
σ = 0.29 A**, last z = 0.6. Upper-furnace temperature R² = 0.90, secondary air flow 0.70,
spray water flow 0.60. Furnace pressures and bed ΔPs have R² ≈ 0 — the load does not
explain them, and the detector is silent on them by design rather than guessing. Zero
alerts on five steady days is the correct answer.

**Labelled fault → one finding.** `seed-boiler-history.mjs --inject-fault "YFJ3_AI:+8%:3h"`
multiplies the last three hours of ID-fan current by 1.08 and writes those 180 points
with `source = 'csv-injected'` (visible in the table, removed by `--clean`). Result:

> **YFJ3_AI at 24.66 A — 8.9 % above the 22.65 A expected at this load (ZZQBCHLL = 59.51
> t/h); 6.8σ against a 30-day baseline (n=97, R²=0.8132), persisted 2 consecutive
> hour(s).** Inside its alarm band — a fixed limit would not have caught this.

24.66 A is inside the projection's 1st–99th percentile envelope (the "band"); a threshold
scan stays silent. The regime scan fires at HIGH severity (z ≥ 5), and `diagnosisRules`
receives it as `basis: 'regime-residual'` so the fan's FMEA names the hypothesis
(impeller build-up / erosion for a CFB ID fan). No other tag fires.

The injection is currently **on**. To show the quiet case, re-run the seed for that tag
without `--inject-fault` (same `--end` as the original load).

## 5. Reproduce, refresh, remove

```powershell
$env:SEED_EMAIL="admin001@cainergy.com"; $env:SEED_PASSWORD="…"
# data (5.5 MB, CC0): https://ndownloader.figshare.com/files/53975387 → unzip
node scripts/provision-boiler-demo.mjs
node scripts/seed-boiler-history.mjs --csv C:\data\xinan_completed_data.csv --asset B-301
# optional labelled fault for the regime demo
node scripts/seed-boiler-history.mjs --csv … --asset B-301 --tags YFJ3_AI --end <same end as the first run> --inject-fault "YFJ3_AI:+8%:3h"
# remove everything
node scripts/seed-boiler-history.mjs --asset B-301 --clean
node scripts/provision-boiler-demo.mjs --clean
```

The seed prints the end instant it used (`… so it ends 2026-09-15T20:23:43.383Z`); pass
that exact value as `--end` on any per-tag re-run, or the re-run lands offset and doubles
the tag (learned the hard way on 2026-09-15).

## 6. Known caveats

- Units on 27 of 30 tags are inferred (see `scripts/boiler-columns.json`); the three
  temperatures are unambiguous. Say "inferred" if a reviewer asks.
- The record is five days, so a "30-day baseline" is really 4 days (97 hourly pairs) and
  the raw 90-day prune will remove the points in December 2026; the hourly rollups stay.
- The record is time-shifted. The Specialist will call it "the last 7 days"; the plant
  ran in March 2022.
- `agent-run` needs a redeploy for the "how often" fix and the untimed-projection
  fallback to reach the live Specialist.
