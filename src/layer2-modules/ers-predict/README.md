# ers-predict (Python tier) — status: SCAFFOLD, not live

Nothing in this package runs in production. The frontend never calls it, it
reads no database table, and no model here has been trained on anything.

| File | What it actually is | What it is designed to become |
|---|---|---|
| `models/heuristic_health_scorer.py` | Hand-weighted linear score over engineered features | `xgboost.XGBRegressor` health / failure-probability model, same interface |
| `models/zscore_anomaly_detector.py` | Per-tag z-score against a baseline mean/std | LSTM autoencoder reconstruction-error detector (PyTorch), same interface |
| `models/weibull_survival.py` | Closed-form Weibull helpers | `scipy.stats.weibull_min` / `lifelines` fit with censoring |
| `models/physics_informed.py` | Named mechanism constants | Physics-informed residual model |
| `models/ensemble.py` | Weighted blend of the above | Unchanged — the swap happens inside each model |

Live prediction maths lives in the TypeScript frontend (`src/frontend/src/lib/predict/*`,
`PredictionService.ts`) and the Deno agent tools (`supabase/functions/agent-run/`).

## When this tier is worth reviving
A learned model that needs a fleet of history — e.g. one autoencoder per
equipment class across every pump a tenant owns. Prerequisites, in order:
1. A readable time-series window (`sem_readings_window`, migration 0362).
2. Service-role reads of `ers_sensor_reading_points` and `wo_failure_data`.
3. Real model bodies behind the existing interfaces; `requirements.txt`
   already pins scikit-learn / xgboost.
4. Expose through the agent-tool contract in `agent-run/tools.ts`, so the
   Specialist narrates the output the way it narrates `diagnosisRules`.

Until then, do not describe this tier as machine learning.
