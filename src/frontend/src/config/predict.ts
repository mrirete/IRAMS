/**
 * Predict module configuration.
 */

/**
 * Data-freshness gate: when the newest twin/sensor data is older than this,
 * the module must stop presenting itself as live — the operating-state pill
 * shows "Stale — reconnect" and the readings header drops "Live". A monitoring
 * surface that hasn't seen data in weeks must never show a green heartbeat.
 */
export const STALE_DAYS = 7;

/**
 * Health-index value the heuristic RUL treats as failure (PredictionService
 * fallback: remaining health = HI - threshold). The twin trajectory draws the
 * same line so the two never disagree on where "failed" is.
 */
export const HEALTH_FAILURE_THRESHOLD = 30;

/**
 * Remaining-life alert window, days, by asset criticality: a FITTED life model
 * whose expected remaining life falls inside the window opens a 'rul_warning'
 * alert (lib/predict/rulAlert). A critical asset needs more notice to plan a
 * shutdown and get parts; the fallback covers unset or unknown criticality.
 */
export const RUL_ALERT_WINDOW_DAYS: Record<string, number> & { default: number } = { A: 30, B: 21, default: 14 };
